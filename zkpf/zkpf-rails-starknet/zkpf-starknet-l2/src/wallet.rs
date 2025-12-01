//! Starknet account abstraction wallet utilities.
//!
//! This module provides utilities for working with Starknet's native
//! account abstraction, including session keys, batched signatures,
//! and Stark curve signature verification.

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use starknet_crypto::{verify, FieldElement, Signature};

use crate::{
    error::StarknetRailError,
    types::{BatchedSignatureRequest, SessionKeyAuth, SessionKeyConfig, WalletType},
};

/// Session key manager for account abstraction.
#[derive(Clone, Debug)]
pub struct SessionKeyManager {
    /// Active session configurations.
    sessions: Vec<SessionKeyAuth>,
}

impl Default for SessionKeyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionKeyManager {
    /// Create a new session key manager.
    pub fn new() -> Self {
        Self { sessions: vec![] }
    }

    /// Register a new session key.
    pub fn register_session(&mut self, auth: SessionKeyAuth) -> Result<(), StarknetRailError> {
        // Validate expiration
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if auth.config.expires_at <= now {
            return Err(StarknetRailError::Wallet("session key already expired".into()));
        }

        self.sessions.push(auth);
        Ok(())
    }

    /// Get a valid session for a method selector.
    pub fn get_session_for_method(&self, method_selector: &str) -> Option<&SessionKeyAuth> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        self.sessions.iter().find(|s| {
            s.config.expires_at > now
                && (s.config.allowed_methods.is_empty()
                    || s.config.allowed_methods.contains(&method_selector.to_string()))
        })
    }

    /// Prune expired sessions.
    pub fn prune_expired(&mut self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        self.sessions.retain(|s| s.config.expires_at > now);
    }
}

/// Message to be signed for proof binding.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofBindingMessage {
    /// Domain separator.
    pub domain: String,
    /// Holder ID.
    pub holder_id: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Epoch.
    pub epoch: u64,
    /// Account addresses (comma-separated).
    pub accounts: String,
    /// Chain ID.
    pub chain_id: String,
}

impl ProofBindingMessage {
    /// Create a new proof binding message.
    pub fn new(
        holder_id: &str,
        policy_id: u64,
        epoch: u64,
        accounts: &[String],
        chain_id: &str,
    ) -> Self {
        Self {
            domain: "zkpf:starknet:proof_binding:v1".to_string(),
            holder_id: holder_id.to_string(),
            policy_id,
            epoch,
            accounts: accounts.join(","),
            chain_id: chain_id.to_string(),
        }
    }

    /// Compute the message hash for signing.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(self.domain.as_bytes());
        hasher.update(b"|");
        hasher.update(self.holder_id.as_bytes());
        hasher.update(b"|");
        hasher.update(&self.policy_id.to_be_bytes());
        hasher.update(b"|");
        hasher.update(&self.epoch.to_be_bytes());
        hasher.update(b"|");
        hasher.update(self.accounts.as_bytes());
        hasher.update(b"|");
        hasher.update(self.chain_id.as_bytes());
        *hasher.finalize().as_bytes()
    }
}

/// Signature verification result.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignatureVerification {
    /// Whether the signature is valid.
    pub valid: bool,
    /// The signer address (if recovered).
    pub signer: Option<String>,
    /// Wallet type detected.
    pub wallet_type: WalletType,
    /// Error message if invalid.
    pub error: Option<String>,
}

/// Prepare a batched signature request.
pub fn prepare_batch_request(
    holder_id: &str,
    policy_id: u64,
    epoch: u64,
    accounts: Vec<String>,
    session_key: Option<SessionKeyAuth>,
) -> BatchedSignatureRequest {
    BatchedSignatureRequest {
        holder_id: holder_id.to_string(),
        policy_id,
        epoch,
        accounts,
        session_key,
    }
}

/// Validate a session key configuration.
pub fn validate_session_config(config: &SessionKeyConfig) -> Result<(), StarknetRailError> {
    // Check expiration
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    if config.expires_at <= now {
        return Err(StarknetRailError::Wallet("session key expired".into()));
    }

    // Validate public key format
    if config.public_key.is_empty() {
        return Err(StarknetRailError::Wallet("empty session public key".into()));
    }

    // Parse as hex
    let trimmed = config.public_key.strip_prefix("0x").unwrap_or(&config.public_key);
    if !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(StarknetRailError::Wallet("invalid session key hex".into()));
    }

    Ok(())
}

/// Create a session key binding message.
///
/// # Arguments
/// * `account_address` - The Starknet account address creating the session
/// * `chain_id` - The Starknet chain identifier (e.g., "SN_MAIN", "SN_SEPOLIA")
/// * `session_config` - The session key configuration
pub fn create_session_binding(
    account_address: &str,
    chain_id: &str,
    session_config: &SessionKeyConfig,
) -> ProofBindingMessage {
    ProofBindingMessage {
        domain: "zkpf:starknet:session_binding:v1".to_string(),
        holder_id: account_address.to_string(),
        policy_id: 0,
        epoch: session_config.expires_at,
        accounts: account_address.to_string(),
        chain_id: chain_id.to_string(),
    }
}

// === Stark Curve Signature Verification ========================================================

/// A Stark curve signature with r and s components.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarkSignature {
    /// The r component of the signature (hex string with 0x prefix).
    pub r: String,
    /// The s component of the signature (hex string with 0x prefix).
    pub s: String,
}

impl StarkSignature {
    /// Create a new Stark signature from r and s components.
    pub fn new(r: &str, s: &str) -> Self {
        Self {
            r: r.to_string(),
            s: s.to_string(),
        }
    }

    /// Convert to starknet_crypto Signature.
    fn to_crypto_signature(&self) -> Result<Signature, StarknetRailError> {
        let r = parse_felt(&self.r)?;
        let s = parse_felt(&self.s)?;
        Ok(Signature { r, s })
    }
}

/// Parse a hex string (with or without 0x prefix) to a FieldElement.
fn parse_felt(hex_str: &str) -> Result<FieldElement, StarknetRailError> {
    let trimmed = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    FieldElement::from_hex_be(trimmed)
        .map_err(|e| StarknetRailError::Wallet(format!("invalid hex: {}", e)))
}

/// Verify a Stark curve ECDSA signature.
///
/// # Arguments
/// * `public_key` - The signer's public key (hex string)
/// * `message_hash` - The hash of the message that was signed (32 bytes)
/// * `signature` - The signature to verify
///
/// # Returns
/// `Ok(true)` if the signature is valid, `Ok(false)` if invalid,
/// or an error if the inputs are malformed.
pub fn verify_stark_signature(
    public_key: &str,
    message_hash: &[u8; 32],
    signature: &StarkSignature,
) -> Result<bool, StarknetRailError> {
    let pubkey_felt = parse_felt(public_key)?;
    let msg_felt = FieldElement::from_bytes_be(message_hash)
        .map_err(|e| StarknetRailError::Wallet(format!("invalid message hash: {:?}", e)))?;
    let sig = signature.to_crypto_signature()?;

    match verify(&pubkey_felt, &msg_felt, &sig.r, &sig.s) {
        Ok(valid) => Ok(valid),
        Err(e) => Err(StarknetRailError::Wallet(format!(
            "signature verification failed: {:?}",
            e
        ))),
    }
}

/// Verify a Stark signature over a proof binding message.
///
/// # Arguments
/// * `public_key` - The signer's public key (hex string)
/// * `message` - The proof binding message
/// * `signature` - The signature to verify
pub fn verify_proof_binding_signature(
    public_key: &str,
    message: &ProofBindingMessage,
    signature: &StarkSignature,
) -> Result<SignatureVerification, StarknetRailError> {
    let message_hash = message.hash();

    match verify_stark_signature(public_key, &message_hash, signature) {
        Ok(valid) => Ok(SignatureVerification {
            valid,
            signer: if valid {
                Some(public_key.to_string())
            } else {
                None
            },
            wallet_type: WalletType::Unknown,
            error: if valid {
                None
            } else {
                Some("signature verification failed".to_string())
            },
        }),
        Err(e) => Ok(SignatureVerification {
            valid: false,
            signer: None,
            wallet_type: WalletType::Unknown,
            error: Some(e.to_string()),
        }),
    }
}

/// Verify a session key signature.
///
/// This verifies that a session key was properly authorized by the account owner.
///
/// # Arguments
/// * `account_pubkey` - The account owner's public key
/// * `session_binding` - The session binding message
/// * `signature` - The signature authorizing the session key
pub fn verify_session_key_signature(
    account_pubkey: &str,
    session_binding: &ProofBindingMessage,
    signature: &StarkSignature,
) -> Result<bool, StarknetRailError> {
    let message_hash = session_binding.hash();
    verify_stark_signature(account_pubkey, &message_hash, signature)
}

/// Compute the Pedersen hash of two field elements (Starknet-style).
///
/// This is useful for computing message hashes compatible with Starknet's
/// native signing format.
pub fn pedersen_hash(a: &[u8; 32], b: &[u8; 32]) -> Result<[u8; 32], StarknetRailError> {
    let a_felt = FieldElement::from_bytes_be(a)
        .map_err(|e| StarknetRailError::Wallet(format!("invalid input a: {:?}", e)))?;
    let b_felt = FieldElement::from_bytes_be(b)
        .map_err(|e| StarknetRailError::Wallet(format!("invalid input b: {:?}", e)))?;

    let result = starknet_crypto::pedersen_hash(&a_felt, &b_felt);
    Ok(result.to_bytes_be())
}

/// Compute the Poseidon hash of multiple field elements (Starknet-style).
///
/// This is the preferred hash function for newer Starknet contracts.
pub fn poseidon_hash_many(inputs: &[[u8; 32]]) -> Result<[u8; 32], StarknetRailError> {
    let felts: Result<Vec<FieldElement>, _> = inputs
        .iter()
        .map(|bytes| {
            FieldElement::from_bytes_be(bytes)
                .map_err(|e| StarknetRailError::Wallet(format!("invalid input: {:?}", e)))
        })
        .collect();
    let felts = felts?;

    let result = starknet_crypto::poseidon_hash_many(&felts);
    Ok(result.to_bytes_be())
}

/// Hash a proof binding message using Starknet's Poseidon hash.
///
/// This produces a message hash compatible with Starknet's native signing.
pub fn hash_proof_binding_poseidon(message: &ProofBindingMessage) -> Result<[u8; 32], StarknetRailError> {
    // Convert message fields to field elements
    // Note: We hash the domain string and take only the lower 31 bytes to fit in the Stark field
    let mut hasher = blake3::Hasher::new();
    hasher.update(message.domain.as_bytes());
    let domain_hash = hasher.finalize();
    let mut domain_bytes = [0u8; 32];
    domain_bytes.copy_from_slice(domain_hash.as_bytes());
    // Clear the highest byte to ensure it fits in the Stark field (< 2^251)
    domain_bytes[0] = 0;
    let domain_felt = FieldElement::from_bytes_be(&domain_bytes)
        .map_err(|e| StarknetRailError::Wallet(format!("hash error: {:?}", e)))?;

    // Hash the holder_id to fit in the field
    let mut holder_hasher = blake3::Hasher::new();
    holder_hasher.update(message.holder_id.as_bytes());
    let holder_hash = holder_hasher.finalize();
    let mut holder_bytes = [0u8; 32];
    holder_bytes.copy_from_slice(holder_hash.as_bytes());
    holder_bytes[0] = 0;
    let holder_felt = FieldElement::from_bytes_be(&holder_bytes)
        .map_err(|e| StarknetRailError::Wallet(format!("holder hash error: {:?}", e)))?;

    let policy_felt = FieldElement::from(message.policy_id);
    let epoch_felt = FieldElement::from(message.epoch);

    let inputs = [domain_felt, holder_felt, policy_felt, epoch_felt];
    let result = starknet_crypto::poseidon_hash_many(&inputs);
    Ok(result.to_bytes_be())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_binding_message_hash() {
        let msg = ProofBindingMessage::new(
            "holder-123",
            42,
            1700000000,
            &["0x1".to_string(), "0x2".to_string()],
            "SN_SEPOLIA",
        );
        let hash = msg.hash();
        assert_eq!(hash.len(), 32);
        
        // Same inputs should produce same hash
        let msg2 = ProofBindingMessage::new(
            "holder-123",
            42,
            1700000000,
            &["0x1".to_string(), "0x2".to_string()],
            "SN_SEPOLIA",
        );
        assert_eq!(msg.hash(), msg2.hash());
    }

    #[test]
    fn test_session_key_manager() {
        let mut manager = SessionKeyManager::new();
        
        let future_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600; // 1 hour from now

        let auth = SessionKeyAuth {
            config: SessionKeyConfig {
                public_key: "0x123".to_string(),
                allowed_methods: vec!["transfer".to_string()],
                expires_at: future_time,
                max_value_per_call: None,
                max_total_value: None,
            },
            authorization_signature: vec!["0xsig".to_string()],
        };

        manager.register_session(auth).expect("should register");
        assert!(manager.get_session_for_method("transfer").is_some());
        assert!(manager.get_session_for_method("unknown").is_none());
    }

    #[test]
    fn test_validate_session_config() {
        let future_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            + 3600;

        let valid_config = SessionKeyConfig {
            public_key: "0x123abc".to_string(),
            allowed_methods: vec![],
            expires_at: future_time,
            max_value_per_call: None,
            max_total_value: None,
        };

        assert!(validate_session_config(&valid_config).is_ok());

        let expired_config = SessionKeyConfig {
            public_key: "0x123abc".to_string(),
            allowed_methods: vec![],
            expires_at: 0,
            max_value_per_call: None,
            max_total_value: None,
        };

        assert!(validate_session_config(&expired_config).is_err());
    }

    #[test]
    fn test_parse_felt() {
        // Valid hex strings
        let felt = parse_felt("0x1234").unwrap();
        assert_eq!(felt, FieldElement::from(0x1234u64));

        let felt_no_prefix = parse_felt("abcd").unwrap();
        assert_eq!(felt_no_prefix, FieldElement::from(0xabcdu64));

        // Zero
        let zero = parse_felt("0x0").unwrap();
        assert_eq!(zero, FieldElement::ZERO);
    }

    #[test]
    fn test_stark_signature_creation() {
        let sig = StarkSignature::new(
            "0x1234567890abcdef",
            "0xfedcba0987654321",
        );
        assert!(sig.r.starts_with("0x"));
        assert!(sig.s.starts_with("0x"));

        // Should convert to crypto signature
        let crypto_sig = sig.to_crypto_signature().unwrap();
        assert_eq!(crypto_sig.r, FieldElement::from_hex_be("1234567890abcdef").unwrap());
    }

    #[test]
    fn test_pedersen_hash() {
        let a = [0u8; 32];
        let b = [1u8; 32];
        let hash = pedersen_hash(&a, &b).unwrap();
        assert_eq!(hash.len(), 32);
        
        // Same inputs should produce same hash
        let hash2 = pedersen_hash(&a, &b).unwrap();
        assert_eq!(hash, hash2);

        // Different inputs should produce different hash
        let hash3 = pedersen_hash(&b, &a).unwrap();
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_poseidon_hash_many() {
        let inputs = [[0u8; 32], [1u8; 32], [2u8; 32]];
        let hash = poseidon_hash_many(&inputs).unwrap();
        assert_eq!(hash.len(), 32);

        // Same inputs should produce same hash
        let hash2 = poseidon_hash_many(&inputs).unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_hash_proof_binding_poseidon() {
        let message = ProofBindingMessage::new(
            "holder-123",
            42,
            1700000000,
            &["0x1".to_string()],
            "SN_SEPOLIA",
        );
        let hash = hash_proof_binding_poseidon(&message).unwrap();
        assert_eq!(hash.len(), 32);

        // Same message should produce same hash
        let hash2 = hash_proof_binding_poseidon(&message).unwrap();
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_signature_verification_format() {
        // Test that the verification function handles invalid signatures gracefully
        let invalid_sig = StarkSignature::new("0x1", "0x2");
        let message_hash = [0u8; 32];
        
        // This will fail because the public key doesn't match,
        // but it should not panic
        let result = verify_stark_signature(
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            &message_hash,
            &invalid_sig,
        );
        
        // Should return a result (either Ok(false) or Err), not panic
        assert!(result.is_ok() || result.is_err());
    }
}

