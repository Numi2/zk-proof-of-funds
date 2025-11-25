//! Starknet account abstraction wallet utilities.
//!
//! This module provides utilities for working with Starknet's native
//! account abstraction, including session keys and batched signatures.

use blake3::Hasher;
use serde::{Deserialize, Serialize};

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
}

