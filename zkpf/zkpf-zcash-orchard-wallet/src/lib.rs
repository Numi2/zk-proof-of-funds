//! zkpf-zcash-orchard-wallet
//!
//! Zcash/Orchard-specific wallet + sync abstraction for the zkpf stack.
//!
//! At a high level this crate is responsible for:
//! - Owning the light-client wallet state (SQLite data DB + cache DB).
//! - Providing a global wallet handle that the Orchard rail can access.
//! - Exposing a stable API for building `OrchardSnapshot` values that the
//!   proving rail can consume.
//!
//! The heavy lifting (chain sync, Orchard cryptography, witness updates) is
//! delegated to the official Zcash Rust crates:
//! - `zcash_client_sqlite`
//! - `zcash_client_backend`
//! - `zcash_protocol`
//! - `zcash_keys`
//!
//! This file wires up a global wallet handle and configuration; the snapshot
//! construction logic can then be incrementally extended to use more of the
//! Zcash light client stack as needed.

use once_cell::sync::OnceCell;
use rand::rngs::OsRng;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use std::{
    env,
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        RwLock,
    },
};

use async_trait::async_trait;
use incrementalmerkletree::Position;
use orchard::note::{ExtractedNoteCommitment, Note as OrchardNote};
use orchard::tree::Anchor as OrchardAnchor;
use orchard::tree::MerkleHashOrchard;
use shardtree::error::{QueryError, ShardTreeError};
use std::sync::Mutex;
use zcash_client_backend::data_api::chain::{self, BlockCache, BlockSource, ScanRange};
use zcash_client_backend::data_api::{WalletCommitmentTrees, WalletRead, WalletTest};
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_client_backend::proto::service::compact_tx_streamer_client::CompactTxStreamerClient;
use zcash_client_backend::sync;
use zcash_client_sqlite::chain::init::init_cache_database;
use zcash_client_sqlite::error::SqliteClientError;
use zcash_client_sqlite::util::SystemClock;
use zcash_client_sqlite::wallet::init::init_wallet_db;
use zcash_client_sqlite::{BlockDb, WalletDb};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{self, BlockHeight, Network};

/// Wrapper type for the concrete wallet database we use.
///
/// This matches the example types used in the upstream `zcash_client_sqlite`
/// documentation:
///
/// ```ignore
/// let mut db = WalletDb::for_path(path, Network::TestNetwork, SystemClock, OsRng)?;
/// init_wallet_db(&mut db, None)?;
/// ```
type OrchardWalletDb = WalletDb<Connection, Network, SystemClock, OsRng>;

/// Internal state held by the global Orchard wallet handle.
struct WalletHandle {
    /// Zcash network parameters (mainnet / testnet).
    params: Network,
    /// Wallet data database (accounts, notes, witnesses, etc.).
    data_db: OrchardWalletDb,
    /// Cache database for compact blocks.
    cache_db: BlockDb,
    /// Latest chain height the wallet believes it has reached.
    wallet_tip_height: AtomicU32,
    /// Endpoint for the lightwalletd gRPC service used for syncing.
    lightwalletd_endpoint: String,
}

static GLOBAL_WALLET: OnceCell<RwLock<WalletHandle>> = OnceCell::new();

/// Public network selector used by the rail to configure the wallet backend.
#[derive(Clone, Debug)]
pub enum NetworkKind {
    Mainnet,
    Testnet,
}

impl NetworkKind {
    fn to_network(&self) -> Network {
        match self {
            NetworkKind::Mainnet => Network::MainNetwork,
            NetworkKind::Testnet => Network::TestNetwork,
        }
    }

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

/// Configuration for the Orchard wallet backend.
///
/// This is typically loaded from environment variables once at process startup.
#[derive(Clone, Debug)]
pub struct OrchardWalletConfig {
    pub network: NetworkKind,
    pub data_db_path: PathBuf,
    pub cache_db_path: PathBuf,
    /// gRPC endpoint for a `lightwalletd` instance (or equivalent block source).
    pub lightwalletd_endpoint: String,
}

impl OrchardWalletConfig {
    /// Load configuration from environment variables.
    ///
    /// Expected variables:
    /// - `ZKPF_ORCHARD_NETWORK` = `mainnet` | `testnet`
    /// - `ZKPF_ORCHARD_DATA_DB_PATH`
    /// - `ZKPF_ORCHARD_CACHE_DB_PATH`
    /// - `ZKPF_ORCHARD_LIGHTWALLETD_ENDPOINT`
    pub fn from_env() -> Result<Self, WalletError> {
        fn get_env(name: &str) -> Result<String, WalletError> {
            env::var(name).map_err(|_| {
                WalletError::Backend(format!(
                    "missing required environment variable {name}"
                ))
            })
        }

        let network_str = get_env("ZKPF_ORCHARD_NETWORK")?;
        let network = NetworkKind::from_str(&network_str)?;

        let data_db_path = PathBuf::from(get_env("ZKPF_ORCHARD_DATA_DB_PATH")?);
        let cache_db_path = PathBuf::from(get_env("ZKPF_ORCHARD_CACHE_DB_PATH")?);
        let lightwalletd_endpoint = get_env("ZKPF_ORCHARD_LIGHTWALLETD_ENDPOINT")?;

        Ok(Self {
            network,
            data_db_path,
            cache_db_path,
            lightwalletd_endpoint,
        })
    }
}

impl WalletHandle {
    fn new(config: OrchardWalletConfig) -> Result<Self, WalletError> {
        let params = config.network.to_network();

        // Open / initialize the cache DB for CompactBlocks.
        let cache_db = BlockDb::for_path(&config.cache_db_path)
            .map_err(|e| WalletError::Backend(format!("failed to open cache DB: {e}")))?;
        init_cache_database(&cache_db)
            .map_err(|e| WalletError::Backend(format!("failed to init cache DB: {e}")))?;

        // Open / initialize the data DB for wallet state.
        let mut data_db = OrchardWalletDb::for_path(
            &config.data_db_path,
            params,
            SystemClock,
            OsRng,
        )
        .map_err(|e| WalletError::Backend(format!("failed to open data DB: {e}")))?;

        // For now we don't take a seed; this will initialize schema and run any
        // non-seed migrations. If a seed is required, surface a clear error so
        // callers can decide how to handle it.
        if let Err(e) = init_wallet_db(&mut data_db, None) {
            return Err(WalletError::Backend(format!(
                "failed to initialize wallet DB (seed may be required): {e}"
            )));
        }

        // Initialize tip height from the wallet's current view of the chain.
        let tip = data_db
            .chain_height()
            .map_err(|e| WalletError::Backend(format!("failed to query wallet chain height: {e}")))?;

        Ok(Self {
            params,
            data_db,
            cache_db,
            wallet_tip_height: AtomicU32::new(tip.map(|h| u32::from(h)).unwrap_or(0)),
            lightwalletd_endpoint: config.lightwalletd_endpoint,
        })
    }

    fn chain_height(&self) -> Result<Option<BlockHeight>, WalletError> {
        self.data_db
            .chain_height()
            .map_err(|e| WalletError::Backend(format!("failed to query wallet chain height: {e}")))
    }

    fn update_cached_tip(&self) -> Result<(), WalletError> {
        if let Some(h) = self.chain_height()? {
            self.wallet_tip_height.store(u32::from(h), Ordering::SeqCst);
        }
        Ok(())
    }

    /// Perform a single sync step against `lightwalletd`, updating both the wallet
    /// data DB and the cached tip height.
    async fn sync_step(&mut self) -> Result<(), WalletError> {
        // Build a fresh in-memory block cache for this sync pass.
        let cache = InMemoryBlockCache::new();

        // Connect to the configured lightwalletd endpoint.
        let endpoint = self.lightwalletd_endpoint.clone();
        let mut client = CompactTxStreamerClient::connect(endpoint.clone())
            .await
            .map_err(|e| WalletError::Backend(format!("failed to connect to lightwalletd at {endpoint}: {e}")))?;

        // Run the standard librustzcash sync loop. This will:
        // - Download Orchard + Sapling subtree roots.
        // - Update the wallet's view of the chain tip.
        // - Populate the commitment trees and note witnesses via scan_cached_blocks.
        //
        // We use a conservative batch size; callers control frequency via the outer loop.
        let batch_size: u32 = 100;
        sync::run(
            &mut client,
            &self.params,
            &cache,
            &mut self.data_db,
            batch_size,
        )
        .await
        .map_err(|e| WalletError::Backend(format!("wallet sync error: {e}")))?;

        // Refresh the cached tip height after a successful sync.
        self.update_cached_tip()?;
        Ok(())
    }
}

fn with_global_wallet<R>(f: impl FnOnce(&mut WalletHandle) -> Result<R, WalletError>) -> Result<R, WalletError> {
    let cell = GLOBAL_WALLET.get().ok_or_else(|| {
        WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() at process startup"
                .to_string(),
        )
    })?;

    let mut guard = cell
        .write()
        .map_err(|_| WalletError::Backend("Orchard wallet handle is poisoned".into()))?;

    f(&mut *guard)
}

/// Initialize the global Orchard wallet backend.
///
/// This should be called once, at process startup, before any calls to
/// [`build_snapshot_for_fvk`]. The rail binary is responsible for loading
/// configuration (for example via [`OrchardWalletConfig::from_env`]) and
/// then invoking this function.
pub fn init_global_wallet(config: OrchardWalletConfig) -> Result<(), WalletError> {
    let handle = WalletHandle::new(config)?;

    GLOBAL_WALLET
        .set(RwLock::new(handle))
        .map_err(|_| WalletError::Backend("Orchard wallet already initialized".into()))
}

/// Return the wallet's current best-known chain height (as cached in the global
/// wallet handle).
///
/// This is primarily useful for monitoring and metrics; callers that need a
/// strong guarantee should rely on [`build_snapshot_for_fvk`] returning
/// [`WalletError::UnknownAnchor`] when a requested height is not yet available.
pub fn wallet_tip_height() -> Result<u32, WalletError> {
    let cell = GLOBAL_WALLET.get().ok_or_else(|| {
        WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() at process startup"
                .to_string(),
        )
    })?;
    let guard = cell
        .read()
        .map_err(|_| WalletError::Backend("Orchard wallet handle is poisoned".into()))?;
    Ok(guard.wallet_tip_height.load(Ordering::SeqCst))
}

/// Perform a single, non-blocking "sync" step.
///
/// In a full implementation this function would:
/// - Discover the remote chain tip via a `lightwalletd` client.
/// - Fetch new compact blocks into the cache DB (`BlockDb`).
/// - Call `zcash_client_backend::data_api::chain::scan_cached_blocks` to update
///   wallet state and note commitment trees.
///
/// For now it simply refreshes the cached wallet tip height from the underlying
/// `WalletDb`, giving callers a stable hook around which to build a background
/// sync loop.
pub async fn sync_once() -> Result<(), WalletError> {
    let cell = GLOBAL_WALLET.get().ok_or_else(|| {
        WalletError::Backend(
            "Orchard wallet not initialized; call init_global_wallet() at process startup"
                .to_string(),
        )
    })?;
    let mut guard = cell
        .write()
        .map_err(|_| WalletError::Backend("Orchard wallet handle is poisoned".into()))?;
    guard.sync_step().await
}

/// Simple in-memory `BlockCache` used to back the librustzcash sync pipeline.
///
/// This avoids having to manage an on-disk compact block cache; all necessary
/// blocks are kept only for the duration of a sync pass.
struct InMemoryBlockCache {
    blocks: std::sync::Arc<Mutex<Vec<CompactBlock>>>,
}

impl InMemoryBlockCache {
    fn new() -> Self {
        Self {
            blocks: std::sync::Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl BlockSource for InMemoryBlockCache {
    type Error = ();

    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), chain::error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), chain::error::Error<WalletErrT, Self::Error>>,
    {
        let blocks = self.blocks.lock().expect("block cache mutex poisoned");
        let mut filtered: Vec<CompactBlock> = blocks
            .iter()
            .filter(|block| {
                if let Some(start) = from_height {
                    let h = BlockHeight::from_u32(block.height as u32);
                    h >= start
                } else {
                    true
                }
            })
            .cloned()
            .collect();

        if let Some(max) = limit {
            if filtered.len() > max {
                filtered.truncate(max);
            }
        }

        for block in filtered {
            with_block(block)?;
        }

        Ok(())
    }
}

#[async_trait]
impl BlockCache for InMemoryBlockCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let blocks = self.blocks.lock().expect("block cache mutex poisoned");
        let candidate_blocks: Vec<&CompactBlock> = match range {
            Some(r) => blocks
                .iter()
                .filter(|block| {
                    let h = BlockHeight::from_u32(block.height as u32);
                    r.block_range().contains(&h)
                })
                .collect(),
            None => blocks.iter().collect(),
        };

        let highest = candidate_blocks
            .into_iter()
            .max_by_key(|block| block.height);

        Ok(highest.map(|block| BlockHeight::from_u32(block.height as u32)))
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let blocks = self.blocks.lock().expect("block cache mutex poisoned");
        let result = blocks
            .iter()
            .filter(|block| {
                let h = BlockHeight::from_u32(block.height as u32);
                range.block_range().contains(&h)
            })
            .cloned()
            .collect();
        Ok(result)
    }

    async fn insert(&self, mut compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut blocks = self.blocks.lock().expect("block cache mutex poisoned");
        blocks.append(&mut compact_blocks);
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut blocks = self.blocks.lock().expect("block cache mutex poisoned");
        blocks.retain(|block| {
            let h = BlockHeight::from_u32(block.height as u32);
            !range.block_range().contains(&h)
        });
        Ok(())
    }
}

/// Newtype wrapper for an Orchard full viewing key.
///
/// In a real deployment this should carry either:
/// - the raw FVK bytes, or
/// - a Bech32-encoded FVK string.
///
/// This crate deliberately treats it as opaque to avoid depending directly on specific
/// Zcash crate versions in the core interface.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardFvk {
    /// Opaque representation of the FVK (e.g. bytes or Bech32 string).
    pub encoded: String,
}

/// Serializable Merkle path type for Orchard notes.
///
/// This is a minimal stand-in for the richer types provided by `orchard` and friends.
/// A production implementation should bridge from the Orchard Merkle path representation
/// to this flattened form.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardMerklePath {
    /// Sibling hashes from leaf to root, encoded as 32-byte big-endian digests.
    pub siblings: Vec<[u8; 32]>,
    /// Index of the leaf in the tree (from the perspective of the Orchard circuit).
    pub position: u64,
}

/// A single Orchard note witness at a particular chain height.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardNoteWitness {
    /// Note value in zatoshi.
    pub value_zats: u64,
    /// Orchard note commitment (cm) as a 32-byte value.
    pub commitment: [u8; 32],
    /// Merkle path proving inclusion of `commitment` under `OrchardSnapshot.anchor`.
    pub merkle_path: OrchardMerklePath,
}

/// A snapshot of all discovered Orchard notes for a given FVK at a specific height.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardSnapshot {
    /// Block height used as the snapshot boundary.
    pub height: u32,
    /// Orchard tree anchor (Merkle root) at `height`, 32 bytes.
    pub anchor: [u8; 32],
    /// All notes discovered for the FVK up to and including `height`.
    pub notes: Vec<OrchardNoteWitness>,
}

/// Errors that can occur while building snapshots or interacting with the wallet backend.
#[derive(Debug, Error)]
pub enum WalletError {
    /// The requested height does not correspond to a known Orchard anchor.
    #[error("no Orchard anchor available at height {0}")]
    UnknownAnchor(u32),

    /// The provided FVK could not be parsed or decoded.
    #[error("invalid Orchard full viewing key: {0}")]
    InvalidFvk(String),

    /// Underlying storage or network error.
    #[error("backend error: {0}")]
    Backend(String),

    /// Placeholder for unimplemented functionality in this reference crate.
    #[error("Orchard wallet backend not implemented")]
    NotImplemented,
}

impl From<ShardTreeError<SqliteClientError>> for WalletError {
    fn from(err: ShardTreeError<SqliteClientError>) -> Self {
        WalletError::Backend(format!("Orchard commitment tree error: {err:?}"))
    }
}

/// Primary interface the prover rail needs: given an Orchard FVK and a target height,
/// return a snapshot of all owned notes at that height.
///
/// # Production expectations
///
/// A real implementation should:
/// - Use `zcash_client_backend` and related crates to ingest compact blocks,
///   maintain the Orchard note commitment tree, and derive incremental witnesses.
/// - Validate that `height` corresponds to a known Orchard anchor and return
///   [`WalletError::UnknownAnchor`] otherwise.
/// - Treat `fvk` as sensitive (never log it; only store if designed as a keystore).
pub fn build_snapshot_for_fvk(fvk: &OrchardFvk, height: u32) -> Result<OrchardSnapshot, WalletError> {
    // Height is included in the signature so callers can rely on UnknownAnchor vs other errors.
    let snapshot_height = height;

    with_global_wallet(|wallet| {
        // Parse the provided FVK as a Unified Full Viewing Key. For now we treat
        // `OrchardFvk.encoded` as a UFVK string (ZIP-316, e.g. "uview...").
        let ufvk = UnifiedFullViewingKey::decode(&wallet.params, &fvk.encoded)
            .map_err(|_e| WalletError::InvalidFvk(fvk.encoded.clone()))?;

        if ufvk.orchard().is_none() {
            return Err(WalletError::InvalidFvk(
                "provided UFVK has no Orchard component".to_string(),
            ));
        }

        // Basic sanity check: ensure the wallet believes it is synced to at least
        // the requested height. A future implementation will drive sync forward
        // here if needed.
        let tip = wallet.chain_height()?;
        if let Some(tip_height) = tip {
            if snapshot_height > u32::from(tip_height) {
                return Err(WalletError::UnknownAnchor(snapshot_height));
            }
        } else {
            return Err(WalletError::Backend(
                "wallet chain height is unknown; cannot build Orchard snapshot".into(),
            ));
        }

        // Look up the account corresponding to this UFVK. For now we require that
        // the account has already been imported into the wallet; automatic import
        // (with a correctly-initialised birthday) can be added in a follow-up.
        let account = wallet
            .data_db
            .get_account_for_ufvk(&ufvk)
            .map_err(|e| WalletError::Backend(format!("wallet UFVK lookup failed: {e}")))?
            .ok_or_else(|| WalletError::Backend("UFVK not found in wallet accounts".into()))?;
        let account_id = account.id();

        // Fetch all Orchard notes known to the wallet, then filter down to the
        // requested account and snapshot height. We first collect the note
        // metadata (value, cmx, position); we will attach Merkle witnesses in a
        // second pass via the Orchard commitment tree.
        let all_notes = wallet
            .data_db
            .get_notes(zcash_protocol::ShieldedProtocol::Orchard)
            .map_err(|e| WalletError::Backend(format!("wallet get_notes failed: {e}")))?;

        struct NoteMeta {
            value_zats: u64,
            cmx_bytes: [u8; 32],
            position: Position,
        }

        let mut note_metas = Vec::new();

        for note in all_notes.into_iter() {
            if note.account_id() != &account_id {
                continue;
            }
            if let Some(h) = note.mined_height() {
                if u32::from(h) > snapshot_height {
                    continue;
                }
            } else {
                // Ignore notes that have not yet been mined.
                continue;
            }

            // The generic `NoteT` here is `orchard::note::Note` under the Orchard
            // protocol, so we can safely map it and reconstruct its extracted
            // note commitment (cmx).
            let note_value_zats = note
                .note_value()
                .map_err(|e| WalletError::Backend(format!("invalid Orchard note value: {e}")))?;

            // SAFETY: For Orchard notes, `note.note()` is `&orchard::note::Note`.
            let cmx_bytes: [u8; 32] = {
                let onote: &OrchardNote = note.note();
                let cmx = ExtractedNoteCommitment::from(onote.commitment());
                (&cmx).into()
            };

            let position = note.note_commitment_tree_position();

            note_metas.push(NoteMeta {
                value_zats: note_value_zats.into(),
                cmx_bytes,
                position,
            });
        }

        // If there are no qualifying notes, we still return an empty snapshot at
        // the requested height, as long as the Orchard tree has a well-defined
        // anchor there. This lets the rail distinguish between "no funds" and
        // "unknown anchor".
        let mut anchor_bytes = [0u8; 32];
        let mut witnesses = Vec::new();

        wallet
            .data_db
            .with_orchard_tree_mut::<_, _, WalletError>(|orchard_tree| {
                let block_height = BlockHeight::from_u32(snapshot_height);

                // Derive the Orchard anchor at the requested height.
                let root_opt = orchard_tree
                    .root_at_checkpoint_id(&block_height)
                    .map_err(WalletError::from)?;

                let root = match root_opt {
                    Some(root) => root,
                    None => return Err(WalletError::UnknownAnchor(snapshot_height)),
                };

                let anchor = OrchardAnchor::from(root);
                anchor_bytes = anchor.to_bytes();

                for meta in note_metas.iter() {
                    let witness_opt = orchard_tree
                        .witness_at_checkpoint_id_caching(meta.position, &block_height)
                        .map_err(WalletError::from)?;

                    let merkle_path = match witness_opt {
                        Some(path) => path,
                        None => return Err(WalletError::UnknownAnchor(snapshot_height)),
                    };

                    let siblings: Vec<[u8; 32]> = merkle_path
                        .path_elems()
                        .iter()
                        .map(MerkleHashOrchard::to_bytes)
                        .collect();

                    let pos_u64: u64 = meta.position.into();

                    witnesses.push(OrchardNoteWitness {
                        value_zats: meta.value_zats,
                        commitment: meta.cmx_bytes,
                        merkle_path: OrchardMerklePath {
                            siblings,
                            position: pos_u64,
                        },
                    });
                }

                Ok(())
            })?;

        Ok(OrchardSnapshot {
            height: snapshot_height,
            anchor: anchor_bytes,
            notes: witnesses,
        })
    })
}


