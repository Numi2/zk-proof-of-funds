//! zkpf-zcash-orchard-wallet (stub)
//!
//! The full Orchard wallet backend (lightwalletd sync, SQLite plumbing, witness
//! derivation) is still under active development. For now, the crate exposes the
//! data structures that the rest of the stack depends on plus lightweight
//! placeholder functions so that the workspace builds cleanly.

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Placeholder network selector; kept for API compatibility with the eventual
/// production implementation.
#[derive(Clone, Debug)]
pub enum NetworkKind {
    Mainnet,
    Testnet,
}

impl NetworkKind {
    fn from_str(s: &str) -> Result<Self, WalletError> {
        match s.to_ascii_lowercase().as_str() {
            "mainnet" | "main" => Ok(NetworkKind::Mainnet),
            "testnet" | "test" => Ok(NetworkKind::Testnet),
            other => Err(WalletError::Backend(format!(
                "invalid Zcash network '{other}', expected 'mainnet' or 'testnet'"
            ))),
        }
    }
}

/// Minimal configuration block retained so callers do not need to change their
/// initialization code once the real backend lands.
#[derive(Clone, Debug)]
pub struct OrchardWalletConfig {
    pub network: NetworkKind,
    pub data_db_path: std::path::PathBuf,
    pub cache_db_path: std::path::PathBuf,
    pub lightwalletd_endpoint: String,
}

impl OrchardWalletConfig {
    pub fn from_env() -> Result<Self, WalletError> {
        fn get_env(name: &str) -> Result<String, WalletError> {
            std::env::var(name).map_err(|_| {
                WalletError::Backend(format!(
                    "missing required environment variable {name}"
                ))
            })
        }

        let network = NetworkKind::from_str(&get_env("ZKPF_ORCHARD_NETWORK")?)?;
        let data_db_path = std::path::PathBuf::from(get_env("ZKPF_ORCHARD_DATA_DB_PATH")?);
        let cache_db_path = std::path::PathBuf::from(get_env("ZKPF_ORCHARD_CACHE_DB_PATH")?);
        let lightwalletd_endpoint = get_env("ZKPF_ORCHARD_LIGHTWALLETD_ENDPOINT")?;

        Ok(Self {
            network,
            data_db_path,
            cache_db_path,
            lightwalletd_endpoint,
        })
    }
}

static GLOBAL_CONFIG: OnceCell<OrchardWalletConfig> = OnceCell::new();

/// Retained for API compatibility. For now this simply stores the provided
/// configuration and returns `Ok(())`.
pub fn init_global_wallet(config: OrchardWalletConfig) -> Result<(), WalletError> {
    GLOBAL_CONFIG
        .set(config)
        .map_err(|_| WalletError::Backend("Orchard wallet already initialized".into()))
}

/// Lightweight helper used by the rails binary to surface monitoring data.
pub fn wallet_tip_height() -> Result<u32, WalletError> {
    if GLOBAL_CONFIG.get().is_none() {
        return Err(WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() first".into(),
        ));
    }
    Ok(0)
}

/// Placeholder sync loop—returns `Ok(())` so callers can keep their scaffolding.
pub async fn sync_once() -> Result<(), WalletError> {
    if GLOBAL_CONFIG.get().is_none() {
        return Err(WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() first".into(),
        ));
    }
    Ok(())
}

/// Opaque wrapper around an Orchard UFVK string.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardFvk {
    pub encoded: String,
}

/// Serializable Merkle path representation used by the circuit wrapper.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardMerklePath {
    pub siblings: Vec<[u8; 32]>,
    pub position: u64,
}

/// Note witness metadata surfaced to the circuit layer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardNoteWitness {
    pub value_zats: u64,
    pub commitment: [u8; 32],
    pub merkle_path: OrchardMerklePath,
}

/// Snapshot of all Orchard notes discovered for an FVK at a specific height.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardSnapshot {
    pub height: u32,
    pub anchor: [u8; 32],
    pub notes: Vec<OrchardNoteWitness>,
}

/// Error surface kept intentionally small until the real backend lands.
#[derive(Debug, Error)]
pub enum WalletError {
    #[error("no Orchard anchor available at height {0}")]
    UnknownAnchor(u32),
    #[error("invalid Orchard full viewing key: {0}")]
    InvalidFvk(String),
    #[error("backend error: {0}")]
    Backend(String),
    #[error("Orchard wallet backend not implemented")]
    NotImplemented,
}

/// Reference implementation placeholder: returns `NotImplemented` so upstream
/// callers can gracefully detect the missing functionality.
pub fn build_snapshot_for_fvk(
    _fvk: &OrchardFvk,
    _height: u32,
) -> Result<OrchardSnapshot, WalletError> {
    Err(WalletError::NotImplemented)
}

