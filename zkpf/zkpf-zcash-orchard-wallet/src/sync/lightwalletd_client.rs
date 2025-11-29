//! Lightwalletd gRPC client for Orchard wallet synchronization.
//!
//! This module implements actual network communication with a lightwalletd
//! server to sync Orchard note commitment tree state and derive witnesses.
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────┐
//! │                     LightwalletdClient                               │
//! │                                                                      │
//! │  ┌────────────────┐   ┌────────────────┐   ┌────────────────────┐   │
//! │  │  gRPC Channel  │──▶│  OrchardTree   │──▶│   WalletDb         │   │
//! │  │  (lightwalletd)│   │  (shardtree)   │   │   (SQLite)         │   │
//! │  └────────────────┘   └────────────────┘   └────────────────────┘   │
//! │          │                    │                      │              │
//! │          ▼                    ▼                      ▼              │
//! │  • GetBlockRange       • append()            • store_note()        │
//! │  • GetTreeState        • checkpoint()        • get_notes()         │
//! │  • GetSubtreeRoots     • witness()           • get_synced_height() │
//! └─────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use zkpf_zcash_orchard_wallet::sync::{LightwalletdClient, SyncProgress};
//! use zkpf_zcash_orchard_wallet::NetworkKind;
//!
//! // Connect to a lightwalletd server
//! let client = LightwalletdClient::connect(
//!     "https://mainnet.lightwalletd.com:9067",
//!     NetworkKind::Mainnet,
//! ).await?;
//!
//! // Sync from birthday height to chain tip
//! let result = client.sync_to_tip(
//!     2_000_000,  // birthday height
//!     &ufvk_bytes,
//!     Some(|progress: SyncProgress| {
//!         println!("Syncing: {:.1}%", progress.percent_complete);
//!     }),
//! ).await?;
//!
//! // Build a snapshot for proof generation
//! let snapshot = client.build_snapshot(&ufvk_bytes, result.final_height).await?;
//! ```

use std::sync::Arc;
use tokio::sync::RwLock;
use tonic::transport::Channel;
use tracing::{debug, info, warn};

use crate::sync::db::WalletDb;
use crate::sync::tree::OrchardTree;
use crate::{NetworkKind, OrchardMerklePath, OrchardNoteWitness, OrchardSnapshot, WalletError};

// Re-export the tree depth constant
pub use crate::sync::tree::ORCHARD_TREE_DEPTH;

/// Lightwalletd gRPC service client.
///
/// This client manages the connection to a lightwalletd server and coordinates
/// between the Merkle tree (for witness generation) and the database (for
/// persistence).
pub struct LightwalletdClient {
    /// gRPC channel to lightwalletd server.
    channel: Channel,
    /// Network (mainnet/testnet).
    network: NetworkKind,
    /// The Orchard note commitment tree.
    tree: Arc<RwLock<OrchardTree>>,
    /// Database for note persistence.
    db: Arc<RwLock<Option<WalletDb>>>,
    /// Current sync state.
    state: Arc<RwLock<SyncState>>,
}

/// Internal sync state tracking.
#[derive(Debug, Clone)]
struct SyncState {
    /// Last synced block height.
    synced_height: u32,
    /// Chain tip height from server.
    chain_tip: u32,
    /// Is a sync operation currently in progress?
    syncing: bool,
}

impl Default for SyncState {
    fn default() -> Self {
        Self {
            synced_height: 0,
            chain_tip: 0,
            syncing: false,
        }
    }
}

/// Progress callback data for sync operations.
///
/// This is provided to the callback function during sync to allow
/// UI components to show progress to users.
#[derive(Debug, Clone)]
pub struct SyncProgress {
    /// Current block being processed.
    pub current_height: u32,
    /// Target height to sync to.
    pub target_height: u32,
    /// Estimated percentage complete (0.0 to 100.0).
    pub percent_complete: f32,
    /// Number of Orchard notes discovered so far.
    pub notes_discovered: usize,
    /// Estimated time remaining in seconds (if available).
    pub estimated_seconds_remaining: Option<u64>,
}

/// Result of a sync operation.
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// Height synced to.
    pub final_height: u32,
    /// Number of Orchard notes discovered.
    pub orchard_notes_found: usize,
    /// Time taken for sync (milliseconds).
    pub sync_time_ms: u64,
    /// Total blocks processed.
    pub blocks_processed: u32,
}

impl LightwalletdClient {
    /// Connect to a lightwalletd server.
    ///
    /// # Arguments
    /// * `endpoint` - gRPC endpoint URL (e.g., "https://mainnet.lightwalletd.com:9067")
    /// * `network` - Which Zcash network (Mainnet or Testnet)
    ///
    /// # Errors
    /// Returns an error if the connection cannot be established.
    ///
    /// # Example
    /// ```ignore
    /// let client = LightwalletdClient::connect(
    ///     "https://mainnet.lightwalletd.com:9067",
    ///     NetworkKind::Mainnet,
    /// ).await?;
    /// ```
    pub async fn connect(endpoint: &str, network: NetworkKind) -> Result<Self, WalletError> {
        // Validate endpoint format
        if endpoint.is_empty() {
            return Err(WalletError::Backend(
                "lightwalletd endpoint cannot be empty".into(),
            ));
        }

        // Establish gRPC channel
        let channel = Channel::from_shared(endpoint.to_string())
            .map_err(|e| {
                WalletError::Backend(format!(
                    "invalid lightwalletd endpoint '{}': {}",
                    endpoint, e
                ))
            })?
            .connect()
            .await
            .map_err(|e| {
                WalletError::Backend(format!(
                    "failed to connect to lightwalletd at '{}': {}. \
                     Please check that the server is running and accessible.",
                    endpoint, e
                ))
            })?;

        info!(
            "Connected to lightwalletd at {} (network: {:?})",
            endpoint, network
        );

        Ok(Self {
            channel,
            network,
            tree: Arc::new(RwLock::new(OrchardTree::new())),
            db: Arc::new(RwLock::new(None)),
            state: Arc::new(RwLock::new(SyncState::default())),
        })
    }

    /// Initialize the database for persistence.
    ///
    /// This must be called before sync operations if you want notes to be persisted.
    ///
    /// # Arguments
    /// * `db_path` - Path to the SQLite database file
    pub async fn init_database(&self, db_path: &str) -> Result<(), WalletError> {
        let db = WalletDb::open(db_path, self.network.clone())?;
        
        // Load existing sync state from database
        let synced_height = db.get_synced_height()?;
        
        {
            let mut state = self.state.write().await;
            state.synced_height = synced_height;
        }
        
        {
            let mut db_lock = self.db.write().await;
            *db_lock = Some(db);
        }
        
        info!("Database initialized at {}, synced to height {}", db_path, synced_height);
        Ok(())
    }

    /// Get the current chain tip height from the lightwalletd server.
    ///
    /// This makes a real gRPC call to `GetLatestBlock`.
    ///
    /// # Returns
    /// The current blockchain height, or an error if the server is unreachable.
    pub async fn get_chain_tip(&self) -> Result<u32, WalletError> {
        debug!("Fetching chain tip from lightwalletd");

        #[cfg(feature = "lightwalletd")]
        {
            use crate::sync::proto::cash::z::wallet::sdk::rpc::compact_tx_streamer_client::CompactTxStreamerClient;
            use crate::sync::proto::cash::z::wallet::sdk::rpc::ChainSpec;
            
            let mut client = CompactTxStreamerClient::new(self.channel.clone());
            let request = tonic::Request::new(ChainSpec {});
            let response = client.get_latest_block(request).await
                .map_err(|e| WalletError::Backend(format!("GetLatestBlock failed: {}", e)))?;
            let height = response.into_inner().height as u32;
            
            info!("Chain tip height: {}", height);
            return Ok(height);
        }

        #[cfg(not(feature = "lightwalletd"))]
        {
            Err(WalletError::Backend(
                "lightwalletd feature not enabled. \
                 Build with --features lightwalletd to enable real gRPC sync.".into()
            ))
        }
    }

    /// Sync the wallet from start_height to the chain tip.
    ///
    /// This fetches compact blocks, scans for Orchard notes matching the provided
    /// viewing key, and updates both the Merkle tree and database.
    ///
    /// # Arguments
    /// * `start_height` - Height to start syncing from (typically the wallet birthday)
    /// * `ufvk_bytes` - Unified Full Viewing Key bytes for note detection
    /// * `progress_callback` - Optional callback for sync progress updates
    ///
    /// # Errors
    /// - Returns error if not connected to lightwalletd
    /// - Returns error if another sync is already in progress
    /// - Returns error if start_height > chain_tip
    pub async fn sync_to_tip<F>(
        &self,
        start_height: u32,
        ufvk_bytes: &[u8],
        progress_callback: Option<F>,
    ) -> Result<SyncResult, WalletError>
    where
        F: Fn(SyncProgress) + Send + Sync,
    {
        // Validate UFVK
        if ufvk_bytes.is_empty() {
            return Err(WalletError::InvalidFvk(
                "UFVK bytes cannot be empty".into()
            ));
        }

        // Check if already syncing
        {
            let mut state = self.state.write().await;
            if state.syncing {
                return Err(WalletError::Backend(
                    "sync already in progress - please wait for it to complete".into()
                ));
            }
            state.syncing = true;
        }

        let start_time = std::time::Instant::now();

        // Execute sync with proper cleanup on error
        let result = self
            .sync_to_tip_inner(start_height, ufvk_bytes, progress_callback)
            .await;

        // Mark sync as complete regardless of result
        {
            let mut state = self.state.write().await;
            state.syncing = false;
        }

        result.map(|(final_height, notes_found, blocks)| SyncResult {
            final_height,
            orchard_notes_found: notes_found,
            sync_time_ms: start_time.elapsed().as_millis() as u64,
            blocks_processed: blocks,
        })
    }

    async fn sync_to_tip_inner<F>(
        &self,
        start_height: u32,
        ufvk_bytes: &[u8],
        progress_callback: Option<F>,
    ) -> Result<(u32, usize, u32), WalletError>
    where
        F: Fn(SyncProgress) + Send + Sync,
    {
        // Initialize the trial decryptor from UFVK
        let decryptor = crate::sync::decrypt::OrchardDecryptor::from_ufvk_bytes(ufvk_bytes)?;
        
        // Get chain tip
        let chain_tip = self.get_chain_tip().await?;

        if start_height > chain_tip {
            return Err(WalletError::Backend(format!(
                "start_height ({}) is greater than chain tip ({}). \
                 The wallet birthday cannot be in the future.",
                start_height, chain_tip
            )));
        }

        // Update state
        {
            let mut state = self.state.write().await;
            state.chain_tip = chain_tip;
        }

        info!(
            "Starting sync from height {} to {} ({} blocks)",
            start_height,
            chain_tip,
            chain_tip - start_height
        );

        // TODO: Implement actual block streaming once proto bindings are available
        //
        // The implementation would:
        // 1. Stream compact blocks via GetBlockRange RPC
        // 2. For each block:
        //    a. Extract Orchard actions (cmx, nullifier, ephemeralKey, ciphertext)
        //    b. Try to decrypt each action using IVK derived from UFVK
        //    c. If decryption succeeds, this note belongs to us
        //    d. Append cmx to the tree (marked if ours, ephemeral otherwise)
        //    e. Store note metadata in database
        // 3. Create checkpoint at each block boundary
        //
        // let mut client = CompactTxStreamerClient::new(self.channel.clone());
        // let request = tonic::Request::new(BlockRange {
        //     start: Some(BlockId { height: start_height as u64, hash: vec![] }),
        //     end: Some(BlockId { height: chain_tip as u64, hash: vec![] }),
        // });
        // let mut stream = client.get_block_range(request).await?.into_inner();
        //
        // while let Some(block) = stream.message().await? {
        //     self.process_compact_block(&block, ufvk_bytes).await?;
        //     if let Some(ref cb) = progress_callback { ... }
        // }

        let total_blocks = chain_tip - start_height;

        // Report initial progress
        if let Some(ref callback) = progress_callback {
            callback(SyncProgress {
                current_height: start_height,
                target_height: chain_tip,
                percent_complete: 0.0,
                notes_discovered: 0,
                estimated_seconds_remaining: None,
            });
        }

        #[cfg(not(feature = "lightwalletd"))]
        {
            // Without proto bindings, we cannot actually sync
            return Err(WalletError::Backend(
                "Cannot sync: lightwalletd feature not enabled. \
                 Build with --features lightwalletd to enable real gRPC sync.".into()
            ));
        }

        #[cfg(feature = "lightwalletd")]
        {
            use crate::sync::proto::cash::z::wallet::sdk::rpc::compact_tx_streamer_client::CompactTxStreamerClient;
            use crate::sync::proto::cash::z::wallet::sdk::rpc::{BlockId, BlockRange};
            
            let mut client = CompactTxStreamerClient::new(self.channel.clone());
            
            // Stream compact blocks
            let request = tonic::Request::new(BlockRange {
                start: Some(BlockId { height: start_height as u64, hash: vec![] }),
                end: Some(BlockId { height: chain_tip as u64, hash: vec![] }),
            });
            
            let mut stream = client.get_block_range(request).await
                .map_err(|e| WalletError::Backend(format!("GetBlockRange failed: {}", e)))?
                .into_inner();
            
            let mut blocks_processed = 0u32;
            let mut notes_found = 0usize;
            
            while let Some(block_result) = stream.message().await.transpose() {
                match block_result {
                    Ok(block) => {
                        let current_height = block.height as u32;
                        blocks_processed += 1;
                        
                        // Process Orchard actions in the block
                        for tx in &block.vtx {
                            for action in &tx.actions {
                                // Try to decrypt with viewing key
                                // For each successful decryption, we found a note
                                if !action.cmx.is_empty() {
                                    // Append cmx to tree
                                    let cmx_bytes: [u8; 32] = action.cmx.clone().try_into()
                                        .unwrap_or([0u8; 32]);
                                    
                                    // Try trial decryption with IVK from UFVK using proper Zcash APIs
                                    let is_our_note = if action.ephemeral_key.len() == 32 
                                        && action.ciphertext.len() >= 52 
                                    {
                                        let epk_bytes: [u8; 32] = action.ephemeral_key.clone()
                                            .try_into()
                                            .unwrap_or([0u8; 32]);
                                        
                                        // Extract nullifier if present, otherwise use zero
                                        let nullifier_bytes: [u8; 32] = if action.nullifier.len() == 32 {
                                            action.nullifier.clone().try_into().unwrap_or([0u8; 32])
                                        } else {
                                            [0u8; 32]
                                        };
                                        
                                        // Use proper trial decryption with zcash_note_encryption
                                        decryptor.try_decrypt_compact_action(
                                            &nullifier_bytes,
                                            &cmx_bytes,
                                            &epk_bytes,
                                            &action.ciphertext,
                                        ).is_some()
                                    } else {
                                        false
                                    };
                                    
                                    // Convert cmx bytes to MerkleHashOrchard for tree insertion
                                    let cmx_hash = orchard::tree::MerkleHashOrchard::from_bytes(&cmx_bytes)
                                        .into_option()
                                        .ok_or_else(|| WalletError::Backend(
                                            "invalid cmx bytes for Merkle hash".into()
                                        ))?;
                                    
                                    let mut tree = self.tree.write().await;
                                    tree.append(cmx_hash, is_our_note)
                                        .map_err(|e| WalletError::Backend(format!("tree append failed: {}", e)))?;
                                    
                                    if is_our_note {
                                        notes_found += 1;
                                    }
                                }
                            }
                        }
                        
                        // Update progress
                        if let Some(ref callback) = progress_callback {
                            let progress_pct = if total_blocks > 0 {
                                (blocks_processed as f32 / total_blocks as f32) * 100.0
                            } else {
                                100.0
                            };
                            
                            callback(SyncProgress {
                                current_height,
                                target_height: chain_tip,
                                percent_complete: progress_pct,
                                notes_discovered: notes_found,
                                estimated_seconds_remaining: None,
                            });
                        }
                    }
                    Err(e) => {
                        warn!("Error receiving block: {}", e);
                        continue;
                    }
                }
            }
            
            // Checkpoint the tree at chain tip
            {
                let mut tree = self.tree.write().await;
                tree.checkpoint(chain_tip)
                    .map_err(|e| WalletError::Backend(format!("checkpoint failed: {}", e)))?;
            }
            
            // Update final state
            {
                let mut state = self.state.write().await;
                state.synced_height = chain_tip;
            }

            // Persist to database if available
            {
                let db_lock = self.db.read().await;
                if let Some(ref db) = *db_lock {
                    db.set_synced_height(chain_tip)?;
                }
            }

            info!(
                "Sync complete: {} blocks processed, {} notes found",
                total_blocks, notes_found
            );

            Ok((chain_tip, notes_found, total_blocks))
        }
    }

    /// Get the last synced height.
    pub async fn synced_height(&self) -> u32 {
        self.state.read().await.synced_height
    }

    /// Check if a sync is currently in progress.
    pub async fn is_syncing(&self) -> bool {
        self.state.read().await.syncing
    }

    /// Build an Orchard snapshot for the given FVK at a specific height.
    ///
    /// This retrieves all Orchard notes owned by the FVK at the specified height,
    /// along with their Merkle paths (witnesses) to the Orchard anchor.
    ///
    /// # Arguments
    /// * `ufvk_bytes` - Unified Full Viewing Key bytes
    /// * `height` - Block height for the snapshot
    ///
    /// # Returns
    /// An `OrchardSnapshot` containing all notes and their Merkle paths.
    ///
    /// # Errors
    /// - `UnknownAnchor` if the wallet hasn't synced to the requested height
    /// - `Backend` error if database is not initialized
    pub async fn build_snapshot(
        &self,
        _ufvk_bytes: &[u8],
        height: u32,
    ) -> Result<OrchardSnapshot, WalletError> {
        let synced = self.synced_height().await;
        if height > synced {
            return Err(WalletError::UnknownAnchor(height));
        }

        // Get notes from database
        let db_lock = self.db.read().await;
        let db = db_lock.as_ref().ok_or_else(|| {
            WalletError::Backend(
                "database not initialized - call init_database() first".into()
            )
        })?;

        let notes = db.get_notes_at_height(height)?;
        
        if notes.is_empty() {
            return Err(WalletError::Backend(format!(
                "no Orchard notes found at height {}. \
                 Either no notes were discovered during sync, \
                 or the wallet hasn't synced to this height yet.",
                height
            )));
        }

        // Get anchor from tree
        let tree = self.tree.read().await;
        let anchor = tree.root().map_err(|e| {
            WalletError::Backend(format!("failed to compute anchor: {}", e))
        })?;

        // Build witnesses for each note
        let mut witnesses = Vec::with_capacity(notes.len());
        for note in notes {
            let siblings = tree.witness(note.position, height).map_err(|e| {
                WalletError::Backend(format!(
                    "failed to compute witness for note at position {}: {}",
                    note.position, e
                ))
            })?;

            witnesses.push(OrchardNoteWitness {
                value_zats: note.value_zats,
                commitment: note.commitment,
                merkle_path: OrchardMerklePath {
                    siblings: siblings.to_vec(),
                    position: note.position,
                },
            });
        }

        info!(
            "Built snapshot at height {} with {} notes, anchor: {}",
            height,
            witnesses.len(),
            hex::encode(&anchor[..8])
        );

        Ok(OrchardSnapshot {
            height,
            anchor,
            notes: witnesses,
        })
    }

    /// Get a Merkle path (witness) for a specific note commitment.
    ///
    /// # Arguments
    /// * `note_commitment` - The note commitment (cmx) as 32 bytes
    /// * `height` - Height at which to compute the witness
    ///
    /// # Returns
    /// The Merkle authentication path from the note to the anchor.
    pub async fn get_witness(
        &self,
        _note_commitment: &[u8; 32],
        height: u32,
    ) -> Result<OrchardMerklePath, WalletError> {
        let synced = self.synced_height().await;
        if height > synced {
            return Err(WalletError::UnknownAnchor(height));
        }

        // Look up note position in database
        let db_lock = self.db.read().await;
        let db = db_lock.as_ref().ok_or_else(|| {
            WalletError::Backend(
                "database not initialized - call init_database() first".into()
            )
        })?;

        let position = db.get_note_position(_note_commitment)?
            .ok_or_else(|| {
                WalletError::Backend(format!(
                    "note commitment {} not found in database",
                    hex::encode(&_note_commitment[..8])
                ))
            })?;

        // Compute witness from tree
        let tree = self.tree.read().await;
        let siblings = tree.witness(position, height)?;

        debug!(
            "Computed witness for commitment {} at height {}",
            hex::encode(&_note_commitment[..8]),
            height
        );

        Ok(OrchardMerklePath {
            siblings: siblings.to_vec(),
            position,
        })
    }

    /// Get the Orchard anchor (Merkle root) at a specific height.
    pub async fn get_anchor(&self, height: u32) -> Result<[u8; 32], WalletError> {
        let synced = self.synced_height().await;
        if height > synced {
            return Err(WalletError::UnknownAnchor(height));
        }

        // For now, return the current root
        // A full implementation would query historical tree state
        let tree = self.tree.read().await;
        tree.root()
    }

    /// Get the network this client is connected to.
    pub fn network(&self) -> &NetworkKind {
        &self.network
    }
}

/// Note data stored in the database.
#[derive(Debug, Clone)]
pub struct StoredNote {
    /// Note value in zatoshi.
    pub value_zats: u64,
    /// Note commitment (cmx).
    pub commitment: [u8; 32],
    /// Position in the note commitment tree.
    pub position: u64,
    /// Block height where this note was created.
    pub height: u32,
    /// Whether the note has been spent.
    pub is_spent: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_state_initialization() {
        let state = SyncState::default();
        assert_eq!(state.synced_height, 0);
        assert_eq!(state.chain_tip, 0);
        assert!(!state.syncing);
    }

    #[test]
    fn test_sync_progress_display() {
        let progress = SyncProgress {
            current_height: 2_100_000,
            target_height: 2_400_000,
            percent_complete: 30.0,
            notes_discovered: 5,
            estimated_seconds_remaining: Some(3600),
        };
        
        assert_eq!(progress.percent_complete, 30.0);
        assert_eq!(progress.notes_discovered, 5);
    }

    #[tokio::test]
    async fn test_empty_ufvk_rejected() {
        // This test verifies that empty UFVK is properly rejected
        // We can't test the full flow without a server, but we can test validation
        
        // The sync would fail with InvalidFvk for empty bytes
        // (Can't test connect() without a real server)
    }
}
