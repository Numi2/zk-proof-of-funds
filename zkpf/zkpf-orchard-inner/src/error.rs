//! zkpf-orchard-inner/error
// Numan Thabtah 2025-11-22

use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum OrchardRailError {
    #[error("ZKPF_ORCHARD_MANIFEST_PATH not set")]
    MissingManifestEnv,

    #[error("Orchard manifest not found at {0:?}")]
    ManifestNotFound(PathBuf),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("TOML manifest parse error: {0}")]
    Toml(#[from] toml::de::Error),

    #[error("JSON manifest parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Halo2 parameter read error: {0}")]
    Params(String),

    #[error("Halo2 proving/verification error: {0}")]
    Plonk(String),

    #[error("Circuit version mismatch: expected {expected}, got {actual}")]
    CircuitVersionMismatch { expected: u32, actual: u32 },
}

impl From<halo2_proofs::poly::commitment::ParamsError> for OrchardRailError {
    fn from(e: halo2_proofs::poly::commitment::ParamsError) -> Self {
        OrchardRailError::Params(e.to_string())
    }
}

impl From<halo2_proofs::plonk::Error> for OrchardRailError {
    fn from(e: halo2_proofs::plonk::Error) -> Self {
        OrchardRailError::Plonk(e.to_string())
    }
}