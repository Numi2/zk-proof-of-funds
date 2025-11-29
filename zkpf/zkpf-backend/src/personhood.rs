//! Wallet-Bound Personhood Module
//!
//! This module provides the backend infrastructure for binding ZKPassport personhood
//! identities to multiple wallet types. It stores ONLY:
//! - `personhood_id` (from ZKPassport's uniqueIdentifier)
//! - `wallet_binding_id` (derived from wallet's public key or identifier)
//! - Simple flags and counts
//!
//! NO personally identifiable information (PII) is ever stored.
//!
//! ## Supported Wallet Types
//!
//! - **Zcash**: Ed25519 signature derived from UFVK
//!   `private_key = BLAKE2b-256("zkpf-personhood-signing-v1" || ufvk)`
//! - **Solana**: Native Ed25519 signatures from Phantom/Solflare/Backpack
//! - **NEAR**: Ed25519 signatures from near-connect wallets
//! - **Passkey**: ECDSA P-256 signatures from WebAuthn
//!
//! ## Signature Verification
//!
//! - Ed25519 signatures are verified using ed25519-dalek.
//! - ECDSA P-256 (ES256) signatures for WebAuthn/Passkey are verified using p256.

use std::{
    collections::HashMap,
    env,
    path::Path,
    sync::{Arc, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature as Ed25519Signature, Verifier, VerifyingKey as Ed25519VerifyingKey};
use p256::ecdsa::{Signature as P256Signature, VerifyingKey as P256VerifyingKey};
// Import the Verifier trait for .verify() method on P256VerifyingKey
#[allow(unused_imports)]
use p256::ecdsa::signature::Verifier as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sled::Db;

// ============================================================================
// Constants
// ============================================================================

/// Environment variable for personhood database path
const PERSONHOOD_DB_ENV: &str = "ZKPF_PERSONHOOD_DB";
/// Default path for personhood database
const DEFAULT_PERSONHOOD_DB_PATH: &str = "data/personhood.db";

/// Maximum wallets that can be bound to a single personhood
const MAX_WALLETS_PER_PERSON: usize = 3;

/// Challenge validity window in seconds (10 minutes)
const CHALLENGE_VALIDITY_SECS: u64 = 600;

// Error codes
const CODE_CHALLENGE_EXPIRED: &str = "challenge_expired";
const CODE_INVALID_SIGNATURE: &str = "invalid_signature";
const CODE_TOO_MANY_BINDINGS: &str = "too_many_wallet_bindings";
const CODE_PERSONHOOD_NOT_ACTIVE: &str = "personhood_not_active";
const CODE_INTERNAL_ERROR: &str = "internal_error";
const CODE_INVALID_INPUT: &str = "invalid_input";

// ============================================================================
// Types
// ============================================================================

/// Status of a personhood credential
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PersonhoodStatus {
    Active,
    Revoked,
    Blocked,
}

impl Default for PersonhoodStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// Stored personhood credential (no PII)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PersonhoodCredential {
    pub personhood_id: String,
    pub status: PersonhoodStatus,
    pub first_seen_at: u64,
    pub last_seen_at: u64,
    pub last_bind_at: Option<u64>,
}

/// A wallet linked to a personhood identity
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletPersonhoodLink {
    pub id: u64,
    pub personhood_id: String,
    pub wallet_binding_id: String,
    pub created_at: u64,
    pub revoked_at: Option<u64>,
}

// ============================================================================
// API Types
// ============================================================================

/// Challenge structure that the frontend signs
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BindWalletChallenge {
    pub personhood_id: String,
    pub wallet_binding_id: String,
    pub issued_at: u64,
    pub version: u32,
}

/// Wallet type for signature verification
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WalletType {
    Zcash,
    Solana,
    Near,
    Passkey,
}

/// WebAuthn assertion data for Passkey verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebAuthnAssertionData {
    /// Base64url-encoded authenticatorData from the WebAuthn assertion
    pub authenticator_data: String,
    /// Base64url-encoded clientDataJSON from the WebAuthn assertion
    pub client_data_json: String,
    /// Base64url-encoded signature (DER or raw format)
    pub signature: String,
}

/// Request to bind a wallet to personhood
#[derive(Debug, Serialize, Deserialize)]
pub struct BindWalletRequest {
    pub challenge: BindWalletChallenge,
    /// The canonical JSON string that was signed (must match challenge fields)
    pub challenge_json: String,
    /// Ed25519 signature over challenge_json, hex-encoded (for non-passkey wallets)
    /// For passkeys, use webauthn_assertion instead
    #[serde(default)]
    pub signature: String,
    /// Public key, hex-encoded (32 bytes for Ed25519) or base64url for ECDSA
    pub wallet_pubkey: String,
    /// Optional: wallet type for signature verification (defaults to Ed25519 verification)
    #[serde(default)]
    pub wallet_type: Option<WalletType>,
    /// WebAuthn assertion data (required for passkey wallet type)
    #[serde(default)]
    pub webauthn_assertion: Option<WebAuthnAssertionData>,
}

/// Response from successful binding
#[derive(Debug, Serialize, Deserialize)]
pub struct BindWalletResponse {
    pub status: String,
    pub personhood_id: String,
    pub wallet_binding_id: String,
    pub active_bindings_count: usize,
}

/// Error response
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
    pub error_code: String,
}

/// Query params for status check
#[derive(Debug, Deserialize)]
pub struct StatusQuery {
    pub wallet_binding_id: String,
}

/// Response from status check
#[derive(Debug, Serialize, Deserialize)]
pub struct StatusResponse {
    pub personhood_verified: bool,
    pub personhood_id: Option<String>,
    pub bindings_count_for_person: Option<usize>,
}

// ============================================================================
// Personhood Store
// ============================================================================

/// Database store for personhood data using sled
#[derive(Clone)]
pub struct PersonhoodStore {
    db: Arc<Db>,
    /// In-memory cache for fast lookups
    credentials_cache: Arc<RwLock<HashMap<String, PersonhoodCredential>>>,
    links_cache: Arc<RwLock<HashMap<String, Vec<WalletPersonhoodLink>>>>,
    /// Counter for generating link IDs
    next_link_id: Arc<RwLock<u64>>,
}

impl PersonhoodStore {
    /// Create a new store from environment config
    pub fn from_env() -> Self {
        let path = env::var(PERSONHOOD_DB_ENV)
            .unwrap_or_else(|_| DEFAULT_PERSONHOOD_DB_PATH.to_string());
        Self::persistent(&path)
    }

    /// Create a persistent store at the given path
    pub fn persistent(path: impl AsRef<Path>) -> Self {
        let path_ref = path.as_ref();
        
        // Create parent directories if needed
        if let Some(parent) = path_ref.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).unwrap_or_else(|err| {
                    panic!(
                        "failed to create directory for personhood db at {}: {}",
                        path_ref.display(),
                        err
                    )
                });
            }
        }

        let db = sled::open(path_ref).unwrap_or_else(|err| {
            panic!(
                "failed to open personhood db at {}: {}",
                path_ref.display(),
                err
            )
        });

        // Load existing data into cache
        let credentials_cache = Arc::new(RwLock::new(Self::load_credentials(&db)));
        let (links_cache, max_id) = Self::load_links(&db);
        let links_cache = Arc::new(RwLock::new(links_cache));
        let next_link_id = Arc::new(RwLock::new(max_id + 1));

        Self {
            db: Arc::new(db),
            credentials_cache,
            links_cache,
            next_link_id,
        }
    }

    /// Create an in-memory store (for testing)
    pub fn in_memory() -> Self {
        let db = sled::Config::new()
            .temporary(true)
            .open()
            .expect("failed to open in-memory db");
        
        Self {
            db: Arc::new(db),
            credentials_cache: Arc::new(RwLock::new(HashMap::new())),
            links_cache: Arc::new(RwLock::new(HashMap::new())),
            next_link_id: Arc::new(RwLock::new(1)),
        }
    }

    /// Load credentials from database
    fn load_credentials(db: &Db) -> HashMap<String, PersonhoodCredential> {
        let mut map = HashMap::new();
        let tree = db.open_tree("credentials").expect("failed to open credentials tree");
        
        for item in tree.iter() {
            if let Ok((key, value)) = item {
                if let Ok(key_str) = String::from_utf8(key.to_vec()) {
                    if let Ok(credential) = serde_json::from_slice::<PersonhoodCredential>(&value) {
                        map.insert(key_str, credential);
                    }
                }
            }
        }
        map
    }

    /// Load links from database
    fn load_links(db: &Db) -> (HashMap<String, Vec<WalletPersonhoodLink>>, u64) {
        let mut map: HashMap<String, Vec<WalletPersonhoodLink>> = HashMap::new();
        let mut max_id = 0u64;
        
        let tree = db.open_tree("links").expect("failed to open links tree");
        
        for item in tree.iter() {
            if let Ok((_, value)) = item {
                if let Ok(link) = serde_json::from_slice::<WalletPersonhoodLink>(&value) {
                    if link.id > max_id {
                        max_id = link.id;
                    }
                    map.entry(link.personhood_id.clone())
                        .or_default()
                        .push(link);
                }
            }
        }
        (map, max_id)
    }

    /// Get a personhood credential
    pub fn get_credential(&self, personhood_id: &str) -> Option<PersonhoodCredential> {
        self.credentials_cache
            .read()
            .expect("cache poisoned")
            .get(personhood_id)
            .cloned()
    }

    /// Upsert a personhood credential
    pub fn upsert_credential(&self, credential: PersonhoodCredential) -> Result<(), String> {
        let tree = self.db.open_tree("credentials").map_err(|e| e.to_string())?;
        let value = serde_json::to_vec(&credential).map_err(|e| e.to_string())?;
        tree.insert(credential.personhood_id.as_bytes(), value)
            .map_err(|e| e.to_string())?;
        
        // Update cache
        self.credentials_cache
            .write()
            .expect("cache poisoned")
            .insert(credential.personhood_id.clone(), credential);
        
        Ok(())
    }

    /// Get active wallet links for a personhood
    pub fn get_active_links(&self, personhood_id: &str) -> Vec<WalletPersonhoodLink> {
        self.links_cache
            .read()
            .expect("cache poisoned")
            .get(personhood_id)
            .map(|links| {
                links
                    .iter()
                    .filter(|l| l.revoked_at.is_none())
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get link by wallet binding ID
    pub fn get_link_by_wallet(&self, wallet_binding_id: &str) -> Option<WalletPersonhoodLink> {
        let cache = self.links_cache.read().expect("cache poisoned");
        for links in cache.values() {
            for link in links {
                if link.wallet_binding_id == wallet_binding_id && link.revoked_at.is_none() {
                    return Some(link.clone());
                }
            }
        }
        None
    }

    /// Check if a wallet-personhood link already exists
    pub fn link_exists(&self, personhood_id: &str, wallet_binding_id: &str) -> bool {
        self.links_cache
            .read()
            .expect("cache poisoned")
            .get(personhood_id)
            .map(|links| {
                links.iter().any(|l| {
                    l.wallet_binding_id == wallet_binding_id && l.revoked_at.is_none()
                })
            })
            .unwrap_or(false)
    }

    /// Create a new wallet-personhood link
    pub fn create_link(&self, personhood_id: &str, wallet_binding_id: &str) -> Result<WalletPersonhoodLink, String> {
        let now = current_epoch_secs();
        
        // Get next ID
        let id = {
            let mut id_guard = self.next_link_id.write().expect("id counter poisoned");
            let id = *id_guard;
            *id_guard += 1;
            id
        };

        let link = WalletPersonhoodLink {
            id,
            personhood_id: personhood_id.to_string(),
            wallet_binding_id: wallet_binding_id.to_string(),
            created_at: now,
            revoked_at: None,
        };

        // Store in database
        let tree = self.db.open_tree("links").map_err(|e| e.to_string())?;
        let key = format!("{}:{}", personhood_id, id);
        let value = serde_json::to_vec(&link).map_err(|e| e.to_string())?;
        tree.insert(key.as_bytes(), value).map_err(|e| e.to_string())?;

        // Update cache
        self.links_cache
            .write()
            .expect("cache poisoned")
            .entry(personhood_id.to_string())
            .or_default()
            .push(link.clone());

        Ok(link)
    }
}

// ============================================================================
// API State
// ============================================================================

/// Application state for personhood endpoints
#[derive(Clone)]
pub struct PersonhoodState {
    pub store: PersonhoodStore,
}

impl PersonhoodState {
    pub fn from_env() -> Self {
        Self {
            store: PersonhoodStore::from_env(),
        }
    }

    pub fn in_memory() -> Self {
        Self {
            store: PersonhoodStore::in_memory(),
        }
    }
}

// ============================================================================
// API Handlers
// ============================================================================

/// POST /api/personhood/bind-wallet
/// 
/// Binds a wallet to a personhood identity.
pub async fn bind_wallet_handler(
    State(state): State<PersonhoodState>,
    Json(req): Json<BindWalletRequest>,
) -> Result<Json<BindWalletResponse>, PersonhoodError> {
    let now = current_epoch_secs();

    // Validate input
    if req.challenge.personhood_id.trim().is_empty() {
        return Err(PersonhoodError::invalid_input("personhood_id cannot be empty"));
    }
    if req.challenge.wallet_binding_id.trim().is_empty() {
        return Err(PersonhoodError::invalid_input("wallet_binding_id cannot be empty"));
    }
    if req.challenge.version != 1 {
        return Err(PersonhoodError::invalid_input("unsupported challenge version"));
    }

    // Step 1: Validate challenge_json matches challenge fields
    if !validate_challenge_json(&req.challenge, &req.challenge_json) {
        return Err(PersonhoodError::invalid_input(
            "challenge_json does not match challenge fields",
        ));
    }

    // Step 2: Verify challenge freshness (10 minute window)
    let challenge_age = now.saturating_sub(req.challenge.issued_at / 1000); // Convert ms to seconds
    if challenge_age > CHALLENGE_VALIDITY_SECS {
        return Err(PersonhoodError::challenge_expired());
    }

    // Step 3: Verify signature based on wallet type
    let wallet_type = req.wallet_type.clone().unwrap_or(WalletType::Zcash);
    
    match wallet_type {
        WalletType::Passkey => {
            // Passkey uses ECDSA P-256 with WebAuthn assertion
            let webauthn = req.webauthn_assertion.as_ref().ok_or_else(|| {
                PersonhoodError::invalid_input("webauthn_assertion is required for passkey wallet type")
            })?;
            
            if !verify_webauthn_signature(
                &req.wallet_pubkey,
                &req.challenge_json,
                webauthn,
            ) {
                return Err(PersonhoodError::invalid_signature());
            }
        }
        WalletType::Zcash | WalletType::Solana | WalletType::Near => {
            // All these wallet types use Ed25519 signatures
            if !verify_ed25519_signature(&req.wallet_pubkey, &req.challenge_json, &req.signature) {
                return Err(PersonhoodError::invalid_signature());
            }
        }
    }

    // Step 4: Upsert personhood credential
    let credential = if let Some(existing) = state.store.get_credential(&req.challenge.personhood_id) {
        // Check if active
        if existing.status != PersonhoodStatus::Active {
            return Err(PersonhoodError::personhood_not_active());
        }
        // Update timestamps
        PersonhoodCredential {
            last_seen_at: now,
            last_bind_at: Some(now),
            ..existing
        }
    } else {
        // Create new credential
        PersonhoodCredential {
            personhood_id: req.challenge.personhood_id.clone(),
            status: PersonhoodStatus::Active,
            first_seen_at: now,
            last_seen_at: now,
            last_bind_at: Some(now),
        }
    };
    state.store.upsert_credential(credential).map_err(PersonhoodError::internal)?;

    // Step 5: Check for existing binding (idempotent)
    if state.store.link_exists(&req.challenge.personhood_id, &req.challenge.wallet_binding_id) {
        // Already bound - return success (idempotent)
        let active_count = state.store.get_active_links(&req.challenge.personhood_id).len();
        return Ok(Json(BindWalletResponse {
            status: "ok".to_string(),
            personhood_id: req.challenge.personhood_id,
            wallet_binding_id: req.challenge.wallet_binding_id,
            active_bindings_count: active_count,
        }));
    }

    // Step 6: Check binding limit
    let active_links = state.store.get_active_links(&req.challenge.personhood_id);
    if active_links.len() >= MAX_WALLETS_PER_PERSON {
        return Err(PersonhoodError::too_many_bindings());
    }

    // Step 7: Create new link
    state.store.create_link(&req.challenge.personhood_id, &req.challenge.wallet_binding_id)
        .map_err(PersonhoodError::internal)?;

    // Get final count
    let active_count = state.store.get_active_links(&req.challenge.personhood_id).len();

    Ok(Json(BindWalletResponse {
        status: "ok".to_string(),
        personhood_id: req.challenge.personhood_id,
        wallet_binding_id: req.challenge.wallet_binding_id,
        active_bindings_count: active_count,
    }))
}

/// GET /api/personhood/status?wallet_binding_id=...
///
/// Returns the personhood verification status for a wallet.
pub async fn status_handler(
    State(state): State<PersonhoodState>,
    Query(query): Query<StatusQuery>,
) -> Json<StatusResponse> {
    // Find link for this wallet
    let link = state.store.get_link_by_wallet(&query.wallet_binding_id);

    match link {
        Some(link) => {
            // Get credential to check status
            let credential = state.store.get_credential(&link.personhood_id);
            let is_active = credential
                .map(|c| c.status == PersonhoodStatus::Active)
                .unwrap_or(false);

            if is_active {
                let bindings_count = state.store.get_active_links(&link.personhood_id).len();
                Json(StatusResponse {
                    personhood_verified: true,
                    personhood_id: Some(link.personhood_id),
                    bindings_count_for_person: Some(bindings_count),
                })
            } else {
                // Personhood is revoked/blocked
                Json(StatusResponse {
                    personhood_verified: false,
                    personhood_id: None,
                    bindings_count_for_person: None,
                })
            }
        }
        None => {
            // Not bound
            Json(StatusResponse {
                personhood_verified: false,
                personhood_id: None,
                bindings_count_for_person: None,
            })
        }
    }
}

// ============================================================================
// Signature Verification
// ============================================================================

/// Validate that challenge_json matches the challenge fields.
/// This ensures the frontend didn't tamper with the JSON string.
fn validate_challenge_json(challenge: &BindWalletChallenge, challenge_json: &str) -> bool {
    // Parse the challenge_json and compare fields
    match serde_json::from_str::<BindWalletChallenge>(challenge_json) {
        Ok(parsed) => {
            parsed.personhood_id == challenge.personhood_id
                && parsed.wallet_binding_id == challenge.wallet_binding_id
                && parsed.issued_at == challenge.issued_at
                && parsed.version == challenge.version
        }
        Err(_) => false,
    }
}

/// Verify an Ed25519 signature over a message.
///
/// The frontend derives the signing key from the UFVK using:
/// `private_key = BLAKE2b-256("zkpf-personhood-signing-v1" || ufvk)`
///
/// This function verifies the signature using ed25519-dalek.
fn verify_ed25519_signature(pubkey_hex: &str, message: &str, signature_hex: &str) -> bool {
    // Decode public key (32 bytes = 64 hex chars)
    let pubkey_bytes = match hex::decode(pubkey_hex) {
        Ok(bytes) if bytes.len() == 32 => bytes,
        _ => {
            eprintln!("Invalid public key: expected 32 bytes, got {}", pubkey_hex.len() / 2);
            return false;
        }
    };

    let verifying_key = match Ed25519VerifyingKey::try_from(pubkey_bytes.as_slice()) {
        Ok(key) => key,
        Err(e) => {
            eprintln!("Failed to parse public key: {}", e);
            return false;
        }
    };

    // Decode signature (64 bytes = 128 hex chars)
    let signature_bytes = match hex::decode(signature_hex) {
        Ok(bytes) if bytes.len() == 64 => bytes,
        _ => {
            eprintln!("Invalid signature: expected 64 bytes, got {}", signature_hex.len() / 2);
            return false;
        }
    };

    let signature = match Ed25519Signature::try_from(signature_bytes.as_slice()) {
        Ok(sig) => sig,
        Err(e) => {
            eprintln!("Failed to parse signature: {}", e);
            return false;
        }
    };

    // Verify signature over the message bytes
    match verifying_key.verify(message.as_bytes(), &signature) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("Signature verification failed: {}", e);
            false
        }
    }
}

/// Verify a WebAuthn assertion using ECDSA P-256 (ES256).
///
/// WebAuthn signatures are computed over: SHA-256(authenticatorData || SHA-256(clientDataJSON))
/// The challenge in clientDataJSON must match our expected challenge.
///
/// Public key format: SEC1 uncompressed (65 bytes) or compressed (33 bytes), base64url or hex encoded.
fn verify_webauthn_signature(
    pubkey_encoded: &str,
    expected_challenge: &str,
    assertion: &WebAuthnAssertionData,
) -> bool {
    // Step 1: Decode the public key (try base64url first, then hex)
    let pubkey_bytes = if let Ok(bytes) = URL_SAFE_NO_PAD.decode(pubkey_encoded) {
        bytes
    } else if let Ok(bytes) = hex::decode(pubkey_encoded) {
        bytes
    } else {
        eprintln!("Failed to decode public key as base64url or hex");
        return false;
    };

    // Parse the P-256 public key from SEC1 format
    let verifying_key = match P256VerifyingKey::from_sec1_bytes(&pubkey_bytes) {
        Ok(key) => key,
        Err(e) => {
            eprintln!("Failed to parse P-256 public key: {}", e);
            return false;
        }
    };

    // Step 2: Decode authenticatorData
    let authenticator_data = match URL_SAFE_NO_PAD.decode(&assertion.authenticator_data) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to decode authenticatorData: {}", e);
            return false;
        }
    };

    // Step 3: Decode clientDataJSON
    let client_data_json_bytes = match URL_SAFE_NO_PAD.decode(&assertion.client_data_json) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to decode clientDataJSON: {}", e);
            return false;
        }
    };

    // Step 4: Parse clientDataJSON and verify the challenge
    let client_data_json_str = match std::str::from_utf8(&client_data_json_bytes) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("clientDataJSON is not valid UTF-8: {}", e);
            return false;
        }
    };

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct ClientData {
        challenge: String,
        /// Origin is parsed but not currently validated (could be added for stricter security)
        origin: String,
        #[serde(rename = "type")]
        type_: String,
    }

    let client_data: ClientData = match serde_json::from_str(client_data_json_str) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to parse clientDataJSON: {}", e);
            return false;
        }
    };

    // Verify the type is "webauthn.get" (assertion)
    if client_data.type_ != "webauthn.get" {
        eprintln!("Invalid WebAuthn type: expected 'webauthn.get', got '{}'", client_data.type_);
        return false;
    }

    // Verify the challenge matches our expected challenge
    // The challenge in clientDataJSON is base64url-encoded
    let expected_challenge_b64 = URL_SAFE_NO_PAD.encode(expected_challenge.as_bytes());
    if client_data.challenge != expected_challenge_b64 {
        eprintln!(
            "Challenge mismatch: expected '{}', got '{}'",
            expected_challenge_b64, client_data.challenge
        );
        return false;
    }

    // Step 5: Decode the signature (base64url encoded, may be DER or raw format)
    let signature_bytes = match URL_SAFE_NO_PAD.decode(&assertion.signature) {
        Ok(data) => data,
        Err(e) => {
            eprintln!("Failed to decode signature: {}", e);
            return false;
        }
    };

    // Try to parse as DER first, then as raw (r || s) format
    let signature = if let Ok(sig) = P256Signature::from_der(&signature_bytes) {
        sig
    } else if signature_bytes.len() == 64 {
        // Raw format: 32 bytes r + 32 bytes s
        match P256Signature::from_slice(&signature_bytes) {
            Ok(sig) => sig,
            Err(e) => {
                eprintln!("Failed to parse raw signature: {}", e);
                return false;
            }
        }
    } else {
        eprintln!(
            "Invalid signature format: not DER and not 64 bytes raw (got {} bytes)",
            signature_bytes.len()
        );
        return false;
    };

    // Step 6: Compute the signed data: SHA-256(authenticatorData || SHA-256(clientDataJSON))
    let client_data_hash = Sha256::digest(&client_data_json_bytes);
    let mut signed_data = Vec::with_capacity(authenticator_data.len() + 32);
    signed_data.extend_from_slice(&authenticator_data);
    signed_data.extend_from_slice(&client_data_hash);

    // Step 7: Verify the signature over signed_data
    // Note: The signature is over the raw bytes, not a hash - p256 handles the internal hashing
    match verifying_key.verify(&signed_data, &signature) {
        Ok(()) => {
            eprintln!("WebAuthn signature verified successfully");
            true
        }
        Err(e) => {
            eprintln!("WebAuthn signature verification failed: {}", e);
            false
        }
    }
}

/// Get current epoch in seconds
fn current_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs()
}

// ============================================================================
// Error Handling
// ============================================================================

#[derive(Debug)]
pub struct PersonhoodError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl PersonhoodError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    fn challenge_expired() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            CODE_CHALLENGE_EXPIRED,
            "Challenge has expired. Please try again.",
        )
    }

    fn invalid_signature() -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            CODE_INVALID_SIGNATURE,
            "Invalid wallet signature.",
        )
    }

    fn too_many_bindings() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            CODE_TOO_MANY_BINDINGS,
            format!(
                "This personhood has already been linked to {} wallets. Maximum allowed: {}.",
                MAX_WALLETS_PER_PERSON, MAX_WALLETS_PER_PERSON
            ),
        )
    }

    fn personhood_not_active() -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            CODE_PERSONHOOD_NOT_ACTIVE,
            "This personhood identity is no longer active.",
        )
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, CODE_INTERNAL_ERROR, message)
    }

    fn invalid_input(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, CODE_INVALID_INPUT, message)
    }
}

impl IntoResponse for PersonhoodError {
    fn into_response(self) -> axum::response::Response {
        let body = ErrorResponse {
            error: self.message,
            error_code: self.code.to_string(),
        };
        (self.status, Json(body)).into_response()
    }
}

// ============================================================================
// Router
// ============================================================================

/// Create the personhood API router
pub fn personhood_router() -> Router<PersonhoodState> {
    Router::new()
        .route("/api/personhood/bind-wallet", post(bind_wallet_handler))
        .route("/api/personhood/status", get(status_handler))
}

/// Create a standalone router with its own state (for merging into main app)
pub fn personhood_router_with_state() -> Router {
    let state = PersonhoodState::from_env();
    personhood_router().with_state(state)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use ed25519_dalek::SigningKey;
    use tower::ServiceExt;

    fn test_state() -> PersonhoodState {
        PersonhoodState::in_memory()
    }

    /// Generate a test Ed25519 keypair and return (private_key, public_key_hex)
    fn generate_test_keypair() -> (SigningKey, String) {
        let mut csprng = rand::rngs::OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
        let verifying_key = signing_key.verifying_key();
        let pubkey_hex = hex::encode(verifying_key.as_bytes());
        (signing_key, pubkey_hex)
    }

    /// Sign a message and return the hex-encoded signature
    fn sign_message(signing_key: &SigningKey, message: &str) -> String {
        use ed25519_dalek::Signer;
        let signature = signing_key.sign(message.as_bytes());
        hex::encode(signature.to_bytes())
    }

    /// Build canonical challenge JSON (must match frontend exactly)
    fn canonical_challenge_json(challenge: &BindWalletChallenge) -> String {
        serde_json::json!({
            "personhood_id": challenge.personhood_id,
            "wallet_binding_id": challenge.wallet_binding_id,
            "issued_at": challenge.issued_at,
            "version": challenge.version,
        }).to_string()
    }

    fn make_challenge(personhood_id: &str, wallet_binding_id: &str) -> BindWalletChallenge {
        BindWalletChallenge {
            personhood_id: personhood_id.to_string(),
            wallet_binding_id: wallet_binding_id.to_string(),
            issued_at: current_epoch_secs() * 1000, // Convert to ms
            version: 1,
        }
    }

    #[tokio::test]
    async fn test_happy_path_new_binding() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        let (signing_key, pubkey_hex) = generate_test_keypair();
        let challenge = make_challenge("person_123", "wallet_abc");
        let challenge_json = canonical_challenge_json(&challenge);
        let signature = sign_message(&signing_key, &challenge_json);

        let request = BindWalletRequest {
            challenge: challenge.clone(),
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: BindWalletResponse = serde_json::from_slice(&body).unwrap();
        
        assert_eq!(result.status, "ok");
        assert_eq!(result.personhood_id, "person_123");
        assert_eq!(result.wallet_binding_id, "wallet_abc");
        assert_eq!(result.active_bindings_count, 1);
    }

    #[tokio::test]
    async fn test_invalid_signature() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        let (_, pubkey_hex) = generate_test_keypair();
        let challenge = make_challenge("person_123", "wallet_abc");
        let challenge_json = canonical_challenge_json(&challenge);
        
        // Use a different key to sign (will fail verification)
        let (wrong_key, _) = generate_test_keypair();
        let signature = sign_message(&wrong_key, &challenge_json);

        let request = BindWalletRequest {
            challenge,
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        
        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: ErrorResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(result.error_code, CODE_INVALID_SIGNATURE);
    }

    #[tokio::test]
    async fn test_idempotent_rebind() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        let (signing_key, pubkey_hex) = generate_test_keypair();
        let challenge = make_challenge("person_123", "wallet_abc");
        let challenge_json = canonical_challenge_json(&challenge);
        let signature = sign_message(&signing_key, &challenge_json);

        let request = BindWalletRequest {
            challenge: challenge.clone(),
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        // First binding
        let response1 = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response1.status(), StatusCode::OK);

        // Second binding (same params) - should be idempotent
        let response2 = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response2.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response2.into_body(), usize::MAX).await.unwrap();
        let result: BindWalletResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(result.active_bindings_count, 1); // Still 1, not 2
    }

    #[tokio::test]
    async fn test_too_many_wallets() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        // Bind MAX_WALLETS_PER_PERSON wallets with proper signatures
        for i in 0..MAX_WALLETS_PER_PERSON {
            let (signing_key, pubkey_hex) = generate_test_keypair();
            let challenge = make_challenge("person_123", &format!("wallet_{}", i));
            let challenge_json = canonical_challenge_json(&challenge);
            let signature = sign_message(&signing_key, &challenge_json);

            let request = BindWalletRequest {
                challenge,
                challenge_json,
                signature,
                wallet_pubkey: pubkey_hex,
            };

            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/personhood/bind-wallet")
                        .header("Content-Type", "application/json")
                        .body(Body::from(serde_json::to_string(&request).unwrap()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
        }

        // Try to bind one more - should fail
        let (signing_key, pubkey_hex) = generate_test_keypair();
        let challenge = make_challenge("person_123", "wallet_extra");
        let challenge_json = canonical_challenge_json(&challenge);
        let signature = sign_message(&signing_key, &challenge_json);

        let request = BindWalletRequest {
            challenge,
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: ErrorResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(result.error_code, CODE_TOO_MANY_BINDINGS);
    }

    #[tokio::test]
    async fn test_expired_challenge() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        let (signing_key, pubkey_hex) = generate_test_keypair();
        
        // Create an expired challenge (issued 20 minutes ago)
        let challenge = BindWalletChallenge {
            personhood_id: "person_123".to_string(),
            wallet_binding_id: "wallet_abc".to_string(),
            issued_at: (current_epoch_secs() - 1200) * 1000, // 20 minutes ago in ms
            version: 1,
        };
        let challenge_json = canonical_challenge_json(&challenge);
        let signature = sign_message(&signing_key, &challenge_json);

        let request = BindWalletRequest {
            challenge,
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: ErrorResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(result.error_code, CODE_CHALLENGE_EXPIRED);
    }

    #[tokio::test]
    async fn test_status_unbound_wallet() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/personhood/status?wallet_binding_id=unknown_wallet")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: StatusResponse = serde_json::from_slice(&body).unwrap();
        assert!(!result.personhood_verified);
        assert!(result.personhood_id.is_none());
    }

    #[tokio::test]
    async fn test_status_bound_wallet() {
        let state = test_state();
        let app = personhood_router().with_state(state);

        // First, bind a wallet with proper signature
        let (signing_key, pubkey_hex) = generate_test_keypair();
        let challenge = make_challenge("person_456", "wallet_xyz");
        let challenge_json = canonical_challenge_json(&challenge);
        let signature = sign_message(&signing_key, &challenge_json);

        let request = BindWalletRequest {
            challenge,
            challenge_json,
            signature,
            wallet_pubkey: pubkey_hex,
        };

        let _ = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/personhood/bind-wallet")
                    .header("Content-Type", "application/json")
                    .body(Body::from(serde_json::to_string(&request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Now check status
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri("/api/personhood/status?wallet_binding_id=wallet_xyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let result: StatusResponse = serde_json::from_slice(&body).unwrap();
        assert!(result.personhood_verified);
        assert_eq!(result.personhood_id, Some("person_456".to_string()));
        assert_eq!(result.bindings_count_for_person, Some(1));
    }

    #[test]
    fn test_ed25519_verification() {
        let (signing_key, pubkey_hex) = generate_test_keypair();
        let message = r#"{"personhood_id":"test","wallet_binding_id":"wallet","issued_at":1234567890000,"version":1}"#;
        let signature = sign_message(&signing_key, message);

        assert!(verify_ed25519_signature(&pubkey_hex, message, &signature));

        // Wrong message should fail
        assert!(!verify_ed25519_signature(&pubkey_hex, "wrong message", &signature));

        // Wrong signature should fail
        let (other_key, _) = generate_test_keypair();
        let wrong_sig = sign_message(&other_key, message);
        assert!(!verify_ed25519_signature(&pubkey_hex, message, &wrong_sig));
    }
}
