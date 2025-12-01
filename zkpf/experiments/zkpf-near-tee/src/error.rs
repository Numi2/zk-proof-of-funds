//! Error types for the NEAR TEE agent.

use thiserror::Error;

/// Errors that can occur in the NEAR TEE agent.
#[derive(Debug, Error)]
pub enum NearTeeError {
    // ═══════════════════════════════════════════════════════════════════════════════
    // TEE ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("TEE not available: {0}")]
    TeeNotAvailable(String),

    #[error("TEE attestation failed: {0}")]
    AttestationFailed(String),

    #[error("TEE attestation expired")]
    AttestationExpired,

    #[error("TEE attestation invalid: {0}")]
    AttestationInvalid(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // CRYPTO ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("key derivation failed: {0}")]
    KeyDerivation(String),

    #[error("encryption failed: {0}")]
    Encryption(String),

    #[error("decryption failed: {0}")]
    Decryption(String),

    #[error("signature verification failed")]
    SignatureVerification,

    #[error("invalid key material: {0}")]
    InvalidKeyMaterial(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // INFERENCE ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("inference failed: {0}")]
    InferenceFailed(String),

    #[error("model not loaded: {0}")]
    ModelNotLoaded(String),

    #[error("inference timeout after {0}s")]
    InferenceTimeout(u64),

    #[error("privacy filter blocked output: {0}")]
    PrivacyFilterBlocked(String),

    #[error("token limit exceeded: {current} > {max}")]
    TokenLimitExceeded { current: usize, max: usize },

    // ═══════════════════════════════════════════════════════════════════════════════
    // NEAR ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("NEAR RPC error: {0}")]
    NearRpc(String),

    #[error("NEAR transaction failed: {0}")]
    NearTransaction(String),

    #[error("NEAR account not found: {0}")]
    AccountNotFound(String),

    #[error("insufficient NEAR balance for gas")]
    InsufficientGas,

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONFIGURATION ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("missing required config: {0}")]
    MissingConfig(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("internal error: {0}")]
    Internal(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl From<serde_json::Error> for NearTeeError {
    fn from(err: serde_json::Error) -> Self {
        NearTeeError::Serialization(err.to_string())
    }
}

