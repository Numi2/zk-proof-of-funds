//! zkpf-zcash-orchard-wallet (stub)
//!
//! The full Orchard wallet backend (lightwalletd sync, SQLite plumbing, witness
//! derivation) is still under active development. For now, the crate exposes the
//! data structures that the rest of the stack depends on plus lightweight
//! placeholder functions so that the workspace builds cleanly.

use blake3::Hasher;
use once_cell::sync::OnceCell;
use orchard::tree::{Anchor, MerkleHashOrchard, MerklePath};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

const SNAPSHOT_DIR_ENV: &str = "ZKPF_ORCHARD_SNAPSHOT_DIR";

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
                WalletError::Backend(format!("missing required environment variable {name}"))
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

pub fn build_snapshot_for_fvk(
    fvk: &OrchardFvk,
    height: u32,
) -> Result<OrchardSnapshot, WalletError> {
    // Ensure the global config was initialised so we can derive a default
    // snapshot directory and respect the configured network.
    let cfg = GLOBAL_CONFIG.get().ok_or_else(|| {
        WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() first".into(),
        )
    })?;

    // Resolve the base directory for snapshot JSON files:
    // - Prefer ZKPF_ORCHARD_SNAPSHOT_DIR when set.
    // - Otherwise fall back to the configured data_db_path, which operators can
    //   point at a directory of exported snapshots.
    let base_dir: PathBuf = std::env::var(SNAPSHOT_DIR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| cfg.data_db_path.clone());

    // Derive a stable, privacy-preserving filename from the FVK and height.
    let fvk_hash = {
        let mut hasher = Hasher::new();
        hasher.update(fvk.encoded.as_bytes());
        let hash = hasher.finalize();
        // Keep filenames reasonably short while remaining collision-resistant
        // for practical purposes by truncating to 16 hex chars.
        hash.to_hex()[0..16].to_string()
    };

    let network_tag = match cfg.network {
        NetworkKind::Mainnet => "main",
        NetworkKind::Testnet => "test",
    };

    let file_name = format!("orchard-snapshot-{network_tag}-{fvk_hash}-{height}.json");
    let path = base_dir.join(file_name);

    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            // Upstream callers interpret this as "no anchor available at this
            // height", which matches the semantics of a missing snapshot file.
            return Err(WalletError::UnknownAnchor(height));
        }
        Err(err) => {
            return Err(WalletError::Backend(format!(
                "failed to read Orchard snapshot from {}: {err}",
                path.display()
            )));
        }
    };

    let snapshot: OrchardSnapshot = serde_json::from_slice(&bytes).map_err(|err| {
        WalletError::Backend(format!(
            "failed to parse Orchard snapshot JSON from {}: {err}",
            path.display()
        ))
    })?;

    // Basic sanity checks so obviously mismatched snapshots are rejected early.
    if snapshot.height != height {
        return Err(WalletError::Backend(format!(
            "snapshot height mismatch: expected {}, got {} (file {})",
            height,
            snapshot.height,
            path.display()
        )));
    }

    if snapshot.notes.is_empty() {
        return Err(WalletError::Backend(format!(
            "Orchard snapshot at height {} contains no notes (file {})",
            height,
            path.display()
        )));
    }

    Ok(snapshot)
}

/// Convert a high-level `OrchardSnapshot` (using byte encodings) into the
/// canonical Orchard PoF snapshot representation used by the inner circuit.
///
/// This helper assumes that:
/// - `anchor` is a valid Orchard anchor encoding, and
/// - each `OrchardMerklePath.siblings` vector encodes a full Orchard Merkle
///   authentication path for the corresponding note commitment.
pub fn snapshot_to_pof_snapshot(
    snapshot: &OrchardSnapshot,
) -> Result<zkpf_orchard_pof_circuit::OrchardPofSnapshot, WalletError> {
    let anchor = Anchor::from_bytes(snapshot.anchor)
        .into_option()
        .ok_or_else(|| WalletError::Backend("invalid Orchard anchor bytes".into()))?;

    let mut notes = Vec::with_capacity(snapshot.notes.len());

    for note_witness in snapshot.notes.iter() {
        // Convert the Merkle path into Orchard's canonical type.
        let auth_path: Vec<MerkleHashOrchard> = note_witness
            .merkle_path
            .siblings
            .iter()
            .map(|sib| {
                MerkleHashOrchard::from_bytes(sib)
                    .into_option()
                    .ok_or_else(|| {
                        WalletError::Backend("invalid Orchard Merkle path element".into())
                    })
            })
            .collect::<Result<_, _>>()?;

        let auth_path: [MerkleHashOrchard; 32] = auth_path
            .into_iter()
            .collect::<Vec<_>>()
            .try_into()
            .map_err(|_| {
                WalletError::Backend("expected 32 siblings in Orchard Merkle path".into())
            })?;

        let merkle_path =
            MerklePath::from_parts(
                note_witness.merkle_path.position.try_into().map_err(|_| {
                    WalletError::Backend("invalid Orchard Merkle path position".into())
                })?,
                auth_path,
            );

        notes.push(zkpf_orchard_pof_circuit::OrchardPofNoteSnapshot {
            note: None,
            value_zats: orchard::value::NoteValue::from_raw(note_witness.value_zats),
            cmx: orchard::note::ExtractedNoteCommitment::from_bytes(&note_witness.commitment)
                .into_option()
                .ok_or_else(|| {
                    WalletError::Backend("invalid Orchard extracted note commitment".into())
                })?,
            position: note_witness.merkle_path.position,
            merkle_path,
        });
    }

    Ok(zkpf_orchard_pof_circuit::OrchardPofSnapshot {
        height: snapshot.height,
        anchor,
        notes,
    })
}
