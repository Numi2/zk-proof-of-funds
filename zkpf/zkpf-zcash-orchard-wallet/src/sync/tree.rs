//! Orchard note commitment tree management.
//!
//! This module wraps the incremental Merkle tree (shardtree) for efficient
//! witness generation and anchor computation.
//!
//! # Architecture
//!
//! The Orchard note commitment tree is a 32-level Merkle tree using the
//! Sinsemilla hash function (MerkleCRH^Orchard). This module uses the
//! `shardtree` crate for efficient storage and witness generation:
//!
//! - Shards: Tree is split into 2^16 shards for efficient storage
//! - Checkpoints: Tree state snapshots at block boundaries
//! - Witnesses: Authentication paths from leaf to root

use incrementalmerkletree::{Address, Level, Position, Retention};
use orchard::tree::MerkleHashOrchard;
use shardtree::store::{Checkpoint, ShardStore};
use shardtree::{LocatedPrunableTree, PrunableTree, ShardTree};
use std::collections::{BTreeMap, BTreeSet};
use tracing::debug;

use crate::WalletError;

/// Depth of the Orchard note commitment tree.
pub const ORCHARD_TREE_DEPTH: u8 = 32;

/// Shard depth for shardtree storage (checkpoints every 2^16 leaves).
pub const SHARD_DEPTH: u8 = 16;

/// Tree shard height (depth - shard_depth).
pub const SHARD_HEIGHT: u8 = ORCHARD_TREE_DEPTH - SHARD_DEPTH;

/// Maximum number of checkpoints to retain.
pub const MAX_CHECKPOINTS: usize = 100;

/// Orchard incremental Merkle tree wrapper.
///
/// Uses shardtree for efficient witness generation with O(log n) storage
/// and O(log n) witness computation.
pub struct OrchardTree {
    /// The underlying shard tree.
    tree: ShardTree<MemoryStore, 32, 16>,
    /// Current tree size (number of leaves).
    size: u64,
    /// Positions we've marked for witness generation.
    marked_positions: BTreeSet<u64>,
}

/// In-memory store for shardtree.
/// 
/// In production, this would be backed by SQLite for persistence.
pub struct MemoryStore {
    /// Stored shards indexed by their root address.
    shards: BTreeMap<Address, LocatedPrunableTree<MerkleHashOrchard>>,
    /// Checkpoints for rewinding (height -> checkpoint data).
    checkpoints: BTreeMap<u32, Checkpoint>,
    /// Tree cap (top of tree state).
    cap: PrunableTree<MerkleHashOrchard>,
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryStore {
    /// Create a new in-memory store.
    pub fn new() -> Self {
        Self {
            shards: BTreeMap::new(),
            checkpoints: BTreeMap::new(),
            cap: PrunableTree::empty(),
        }
    }
}

impl OrchardTree {
    /// Create a new empty tree.
    pub fn new() -> Self {
        Self {
            tree: ShardTree::new(MemoryStore::new(), MAX_CHECKPOINTS),
            size: 0,
            marked_positions: BTreeSet::new(),
        }
    }

    /// Append a note commitment to the tree.
    ///
    /// # Arguments
    /// * `commitment` - The note commitment (cmx) to append
    /// * `mark` - Whether to mark this position for witness generation
    ///
    /// # Returns
    /// The position of the appended commitment.
    pub fn append(
        &mut self,
        commitment: MerkleHashOrchard,
        mark: bool,
    ) -> Result<u64, WalletError> {
        let position = Position::from(self.size);
        let retention = if mark {
            Retention::Marked
        } else {
            Retention::Ephemeral
        };

        self.tree
            .batch_insert(position, [(commitment, retention)].into_iter())
            .map_err(|e| WalletError::Backend(format!("tree append failed: {e:?}")))?;

        let pos = self.size;
        self.size += 1;

        if mark {
            self.marked_positions.insert(pos);
        }

        debug!("Appended commitment at position {}, marked={}", pos, mark);
        Ok(pos)
    }

    /// Append multiple commitments (batch insert).
    ///
    /// # Arguments
    /// * `commitments` - Iterator of (commitment, should_mark) pairs
    ///
    /// # Returns
    /// The starting position of the batch.
    pub fn append_batch<I>(&mut self, commitments: I) -> Result<u64, WalletError>
    where
        I: IntoIterator<Item = (MerkleHashOrchard, bool)>,
    {
        let start_position = Position::from(self.size);

        let items: Vec<_> = commitments
            .into_iter()
            .map(|(cmx, mark)| {
                let pos = self.size;
                self.size += 1;
                if mark {
                    self.marked_positions.insert(pos);
                }
                (
                    cmx,
                    if mark {
                        Retention::Marked
                    } else {
                        Retention::Ephemeral
                    },
                )
            })
            .collect();

        let count = items.len();
        self.tree
            .batch_insert(start_position, items.into_iter())
            .map_err(|e| WalletError::Backend(format!("batch insert failed: {e:?}")))?;

        debug!("Appended {} commitments starting at position {}", count, u64::from(start_position));
        Ok(u64::from(start_position))
    }

    /// Create a checkpoint at the current position.
    ///
    /// Checkpoints allow efficient rewinding and witness computation
    /// for specific block heights.
    pub fn checkpoint(&mut self, height: u32) -> Result<(), WalletError> {
        self.tree
            .checkpoint(height)
            .map_err(|e| WalletError::Backend(format!("checkpoint failed: {e:?}")))?;

        debug!("Created checkpoint at height {}, tree size {}", height, self.size);
        Ok(())
    }

    /// Compute the Merkle root (anchor) at the current state.
    pub fn root(&self) -> Result<[u8; 32], WalletError> {
        // Get root at the most recent checkpoint
        let root = self
            .tree
            .root_at_checkpoint_depth(Some(0))
            .map_err(|e| WalletError::Backend(format!("root computation failed: {e:?}")))?
            .ok_or_else(|| WalletError::Backend("tree is empty, no root available".into()))?;

        Ok(root.to_bytes())
    }

    /// Compute a Merkle witness (authentication path) for a position.
    ///
    /// # Arguments
    /// * `position` - The position of the note in the tree
    /// * `checkpoint_height` - Height of the checkpoint to use (anchor)
    ///
    /// # Returns
    /// The 32 sibling hashes from leaf to root.
    pub fn witness(
        &self,
        position: u64,
        _checkpoint_height: u32,
    ) -> Result<[[u8; 32]; 32], WalletError> {
        let pos = Position::from(position);

        // Get witness at the most recent checkpoint
        let path = self
            .tree
            .witness_at_checkpoint_depth(pos, 0)
            .map_err(|e| WalletError::Backend(format!("witness computation failed: {e:?}")))?
            .ok_or_else(|| {
                WalletError::Backend(format!(
                    "no witness available for position {} - ensure the position is marked",
                    position
                ))
            })?;

        // Convert the path to [[u8; 32]; 32]
        let siblings: Vec<[u8; 32]> = path
            .path_elems()
            .iter()
            .map(|h| h.to_bytes())
            .collect();

        if siblings.len() != 32 {
            return Err(WalletError::Backend(format!(
                "unexpected path length: {} (expected 32)",
                siblings.len()
            )));
        }

        let mut result = [[0u8; 32]; 32];
        for (i, sib) in siblings.into_iter().enumerate() {
            result[i] = sib;
        }

        Ok(result)
    }

    /// Truncate the tree to a specific checkpoint, removing all data after it.
    pub fn truncate_to_checkpoint(&mut self, height: u32) -> Result<(), WalletError> {
        self.tree
            .truncate_to_checkpoint(&height)
            .map_err(|e| WalletError::Backend(format!("truncate failed: {e:?}")))?;

        debug!("Truncated tree to checkpoint {}", height);
        Ok(())
    }

    /// Get the current tree size.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Check if a position is marked for witness generation.
    pub fn is_marked(&self, position: u64) -> bool {
        self.marked_positions.contains(&position)
    }

    /// Get all marked positions.
    pub fn marked_positions(&self) -> &BTreeSet<u64> {
        &self.marked_positions
    }
}

impl Default for OrchardTree {
    fn default() -> Self {
        Self::new()
    }
}

// MemoryStore error type
#[derive(Debug)]
pub struct MemoryStoreError(String);

impl std::fmt::Display for MemoryStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for MemoryStoreError {}

// Implement the store trait for our MemoryStore
impl ShardStore for MemoryStore {
    type H = MerkleHashOrchard;
    type CheckpointId = u32;
    type Error = MemoryStoreError;

    fn get_shard(
        &self,
        shard_root: Address,
    ) -> Result<Option<LocatedPrunableTree<Self::H>>, Self::Error> {
        Ok(self.shards.get(&shard_root).cloned())
    }

    fn last_shard(&self) -> Result<Option<LocatedPrunableTree<Self::H>>, Self::Error> {
        Ok(self.shards.values().last().cloned())
    }

    fn put_shard(&mut self, subtree: LocatedPrunableTree<Self::H>) -> Result<(), Self::Error> {
        self.shards.insert(subtree.root_addr(), subtree);
        Ok(())
    }

    fn get_shard_roots(&self) -> Result<Vec<Address>, Self::Error> {
        Ok(self.shards.keys().cloned().collect())
    }

    fn truncate_shards(&mut self, shard_index: u64) -> Result<(), Self::Error> {
        // Remove all shards with index >= shard_index
        let addr = Address::from_parts(Level::from(SHARD_HEIGHT), shard_index);
        self.shards.retain(|a, _| *a < addr);
        Ok(())
    }

    fn get_cap(&self) -> Result<PrunableTree<Self::H>, Self::Error> {
        Ok(self.cap.clone())
    }

    fn put_cap(&mut self, cap: PrunableTree<Self::H>) -> Result<(), Self::Error> {
        self.cap = cap;
        Ok(())
    }

    fn min_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        Ok(self.checkpoints.keys().next().cloned())
    }

    fn max_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        Ok(self.checkpoints.keys().last().cloned())
    }

    fn add_checkpoint(
        &mut self, 
        checkpoint_id: Self::CheckpointId, 
        checkpoint: Checkpoint
    ) -> Result<(), Self::Error> {
        self.checkpoints.insert(checkpoint_id, checkpoint);
        Ok(())
    }

    fn checkpoint_count(&self) -> Result<usize, Self::Error> {
        Ok(self.checkpoints.len())
    }

    fn get_checkpoint_at_depth(
        &self, 
        depth: usize
    ) -> Result<Option<(Self::CheckpointId, Checkpoint)>, Self::Error> {
        let height = self.checkpoints.keys().rev().nth(depth).cloned();
        Ok(height.and_then(|h| {
            self.checkpoints.get(&h).map(|cp| (h, cp.clone()))
        }))
    }

    fn get_checkpoint(
        &self, 
        checkpoint_id: &Self::CheckpointId
    ) -> Result<Option<Checkpoint>, Self::Error> {
        Ok(self.checkpoints.get(checkpoint_id).cloned())
    }

    fn with_checkpoints<F>(&mut self, limit: usize, mut callback: F) -> Result<(), Self::Error>
    where
        F: FnMut(&Self::CheckpointId, &Checkpoint) -> Result<(), Self::Error>,
    {
        for (id, cp) in self.checkpoints.iter().take(limit) {
            callback(id, cp)?;
        }
        Ok(())
    }

    fn for_each_checkpoint<F>(&self, limit: usize, mut callback: F) -> Result<(), Self::Error>
    where
        F: FnMut(&Self::CheckpointId, &Checkpoint) -> Result<(), Self::Error>,
    {
        for (id, cp) in self.checkpoints.iter().rev().take(limit) {
            callback(id, cp)?;
        }
        Ok(())
    }

    fn update_checkpoint_with<F>(
        &mut self,
        checkpoint_id: &Self::CheckpointId,
        update: F,
    ) -> Result<bool, Self::Error>
    where
        F: Fn(&mut Checkpoint) -> Result<(), Self::Error>,
    {
        if let Some(cp) = self.checkpoints.get_mut(checkpoint_id) {
            update(cp)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    fn remove_checkpoint(&mut self, checkpoint_id: &Self::CheckpointId) -> Result<(), Self::Error> {
        self.checkpoints.remove(checkpoint_id);
        Ok(())
    }

    fn truncate_checkpoints_retaining(&mut self, checkpoint_id: &Self::CheckpointId) -> Result<(), Self::Error> {
        self.checkpoints.retain(|id, _| id <= checkpoint_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tree_new() {
        let tree = OrchardTree::new();
        assert_eq!(tree.size(), 0);
    }

    #[test]
    fn test_memory_store() {
        let store = MemoryStore::new();
        assert!(store.shards.is_empty());
        assert!(store.checkpoints.is_empty());
    }

    #[test]
    fn test_marked_positions_tracking() {
        let mut tree = OrchardTree::new();
        tree.marked_positions.insert(42);
        assert!(tree.is_marked(42));
        assert!(!tree.is_marked(43));
    }
}
