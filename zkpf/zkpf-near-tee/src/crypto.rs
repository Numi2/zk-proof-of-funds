//! Cryptographic operations within the TEE.

use serde::{Deserialize, Serialize};

use crate::attestation::TeeProvider;
use crate::error::NearTeeError;
use crate::types::KeyType;

// ═══════════════════════════════════════════════════════════════════════════════
// TEE KEY MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

/// Manages keys within the TEE.
pub struct TeeKeyManager {
    provider: TeeProvider,
    /// Derived keys indexed by key_id.
    keys: std::collections::HashMap<String, DerivedKey>,
    /// Master key (sealed in TEE).
    master_key: [u8; 32],
}

impl TeeKeyManager {
    /// Create a new key manager.
    pub fn new(provider: &TeeProvider) -> Result<Self, NearTeeError> {
        // In production, this would derive the master key from TEE-sealed storage
        let master_key = if *provider == TeeProvider::Mock {
            let mut key = [0u8; 32];
            use rand::Rng;
            rand::thread_rng().fill(&mut key);
            key
        } else {
            // Would use TEE-specific key derivation
            [0u8; 32]
        };

        Ok(Self {
            provider: *provider,
            keys: std::collections::HashMap::new(),
            master_key,
        })
    }

    /// Derive a new key.
    pub async fn derive_key(
        &mut self,
        derivation_path: &str,
        key_type: KeyType,
    ) -> Result<(Vec<u8>, String), NearTeeError> {
        let key_id = format!("{}:{:?}", derivation_path, key_type);

        // Check if already derived
        if let Some(key) = self.keys.get(&key_id) {
            return Ok((key.public_key.clone(), key_id));
        }

        // Derive key material
        let key_material = self.derive_key_material(derivation_path)?;

        // Generate keypair based on type
        let (public_key, private_key) = match key_type {
            KeyType::Ed25519 => self.generate_ed25519(&key_material)?,
            KeyType::X25519 => self.generate_x25519(&key_material)?,
            KeyType::Secp256k1 => self.generate_secp256k1(&key_material)?,
        };

        let derived = DerivedKey {
            key_type,
            public_key: public_key.clone(),
            private_key,
            derivation_path: derivation_path.to_string(),
        };

        self.keys.insert(key_id.clone(), derived);

        Ok((public_key, key_id))
    }

    /// Sign data with a derived key.
    pub async fn sign(
        &self,
        data_hash: &[u8; 32],
        key_id: &str,
    ) -> Result<Vec<u8>, NearTeeError> {
        let key = self
            .keys
            .get(key_id)
            .ok_or_else(|| NearTeeError::InvalidKeyMaterial(format!("key not found: {}", key_id)))?;

        match key.key_type {
            KeyType::Ed25519 => self.sign_ed25519(data_hash, &key.private_key),
            KeyType::Secp256k1 => self.sign_secp256k1(data_hash, &key.private_key),
            KeyType::X25519 => Err(NearTeeError::InvalidKeyMaterial(
                "X25519 keys cannot sign".into(),
            )),
        }
    }

    /// Encrypt data for a recipient.
    pub fn encrypt(&self, plaintext: &[u8], recipient_pubkey: &[u8]) -> Result<EncryptedPayload, NearTeeError> {
        // Generate ephemeral key for ECDH
        let mut ephemeral_secret = [0u8; 32];
        use rand::Rng;
        rand::thread_rng().fill(&mut ephemeral_secret);

        // In production, would use X25519 ECDH
        let shared_secret = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(&ephemeral_secret);
            hasher.update(recipient_pubkey);
            *hasher.finalize().as_bytes()
        };

        // Derive encryption key
        let encryption_key = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"tee_encryption_key_v1");
            hasher.update(&shared_secret);
            *hasher.finalize().as_bytes()
        };

        // Generate nonce
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill(&mut nonce);

        // In production, would use AES-GCM
        // For now, XOR with derived key stream (NOT SECURE - placeholder)
        let ciphertext: Vec<u8> = plaintext
            .iter()
            .enumerate()
            .map(|(i, &b)| b ^ encryption_key[i % 32])
            .collect();

        // Compute ephemeral public key (placeholder)
        let ephemeral_pubkey = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(&ephemeral_secret);
            hasher.finalize().as_bytes()[..32].to_vec()
        };

        Ok(EncryptedPayload {
            ciphertext,
            nonce: nonce.to_vec(),
            ephemeral_pubkey,
            tag: vec![0u8; 16], // Would be GCM tag
        })
    }

    // Internal key derivation

    fn derive_key_material(&self, path: &str) -> Result<[u8; 32], NearTeeError> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tee_key_derivation_v1");
        hasher.update(&self.master_key);
        hasher.update(path.as_bytes());
        Ok(*hasher.finalize().as_bytes())
    }

    fn generate_ed25519(&self, seed: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), NearTeeError> {
        // In production, would use ed25519-dalek
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ed25519_keygen");
        hasher.update(seed);
        let private_key = hasher.finalize().as_bytes().to_vec();

        let mut hasher = blake3::Hasher::new();
        hasher.update(&private_key);
        let public_key = hasher.finalize().as_bytes().to_vec();

        Ok((public_key, private_key))
    }

    fn generate_x25519(&self, seed: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), NearTeeError> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"x25519_keygen");
        hasher.update(seed);
        let private_key = hasher.finalize().as_bytes().to_vec();

        let mut hasher = blake3::Hasher::new();
        hasher.update(&private_key);
        let public_key = hasher.finalize().as_bytes().to_vec();

        Ok((public_key, private_key))
    }

    fn generate_secp256k1(&self, seed: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>), NearTeeError> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"secp256k1_keygen");
        hasher.update(seed);
        let private_key = hasher.finalize().as_bytes().to_vec();

        // Public key derivation (placeholder)
        let mut hasher = blake3::Hasher::new();
        hasher.update(&private_key);
        let public_key = hasher.finalize().as_bytes().to_vec();

        Ok((public_key, private_key))
    }

    fn sign_ed25519(&self, data: &[u8; 32], private_key: &[u8]) -> Result<Vec<u8>, NearTeeError> {
        // In production, would use ed25519-dalek
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ed25519_sign");
        hasher.update(private_key);
        hasher.update(data);
        Ok(hasher.finalize().as_bytes().to_vec())
    }

    fn sign_secp256k1(&self, data: &[u8; 32], private_key: &[u8]) -> Result<Vec<u8>, NearTeeError> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"secp256k1_sign");
        hasher.update(private_key);
        hasher.update(data);
        Ok(hasher.finalize().as_bytes().to_vec())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DERIVED KEY
// ═══════════════════════════════════════════════════════════════════════════════

/// A derived key stored in the TEE.
struct DerivedKey {
    key_type: KeyType,
    public_key: Vec<u8>,
    private_key: Vec<u8>,
    derivation_path: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENCRYPTED PAYLOAD
// ═══════════════════════════════════════════════════════════════════════════════

/// Encrypted payload for secure communication.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EncryptedPayload {
    /// Ciphertext.
    pub ciphertext: Vec<u8>,
    /// Nonce used for encryption.
    pub nonce: Vec<u8>,
    /// Ephemeral public key for key agreement.
    pub ephemeral_pubkey: Vec<u8>,
    /// Authentication tag.
    pub tag: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGNED MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

/// A signed message from the TEE.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignedMessage {
    /// Message content.
    pub message: Vec<u8>,
    /// Signature.
    pub signature: Vec<u8>,
    /// Public key used for signing.
    pub public_key: Vec<u8>,
    /// Key ID.
    pub key_id: String,
    /// Timestamp.
    pub timestamp: u64,
}

impl SignedMessage {
    /// Create a new signed message.
    pub fn new(
        message: Vec<u8>,
        signature: Vec<u8>,
        public_key: Vec<u8>,
        key_id: String,
    ) -> Self {
        Self {
            message,
            signature,
            public_key,
            key_id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time went backwards")
                .as_secs(),
        }
    }
}

