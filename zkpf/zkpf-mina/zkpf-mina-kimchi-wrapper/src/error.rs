//! Error types for the Kimchi wrapper circuit.

use thiserror::Error;

/// Errors that can occur in the Kimchi wrapper circuit.
#[derive(Debug, Error)]
pub enum KimchiWrapperError {
    /// Invalid input data.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Kimchi verification failed.
    #[error("Kimchi verification failed: {0}")]
    KimchiVerificationFailed(String),

    /// Proof generation failed.
    #[error("proof generation failed: {0}")]
    ProofGenerationFailed(String),

    /// Serialization error.
    #[error("serialization error: {0}")]
    Serialization(String),

    /// Artifact loading error.
    #[error("artifact loading error: {0}")]
    ArtifactLoading(String),

    /// Circuit synthesis error.
    #[error("circuit synthesis error: {0}")]
    Synthesis(String),

    /// Foreign field arithmetic error.
    #[error("foreign field arithmetic error: {0}")]
    ForeignField(String),

    /// Pasta curve operation error.
    #[error("Pasta curve error: {0}")]
    PastaCurve(String),

    /// Not implemented.
    #[error("not implemented: {0}")]
    NotImplemented(String),
}

impl From<std::io::Error> for KimchiWrapperError {
    fn from(err: std::io::Error) -> Self {
        KimchiWrapperError::ArtifactLoading(err.to_string())
    }
}

impl From<serde_json::Error> for KimchiWrapperError {
    fn from(err: serde_json::Error) -> Self {
        KimchiWrapperError::Serialization(err.to_string())
    }
}

impl From<anyhow::Error> for KimchiWrapperError {
    fn from(err: anyhow::Error) -> Self {
        KimchiWrapperError::InvalidInput(err.to_string())
    }
}

