//! Orchard note commitment tree management.
//!
//! This module wraps the incremental Merkle tree (shardtree) for efficient
//! witness generation and anchor computation.

use incrementalmerkletree::{Address, Marking, Position, Retention};
use orchard::tree::MerkleHashOrchard;
use shardtree::{LocatedTree, ShardTree, ShardTreeError};
use std::collections::BTreeMap;
use tracing::debug;

use crate::WalletError;

/// Depth of the Orchard note commitment tree.
pub const ORCHARD_TREE_DEPTH: u8 = 32;

/// Shard depth for shardtree storage (checkpoints every 2^16 leaves).
pub const SHARD_DEPTH: u8 = 16;

/// Tree shard height (depth - shard_depth).
pub const SHARD_HEIGHT: u8 = ORCHARD_TREE_DEPTH - SHARD_DEPTH;

/// Orchard incremental Merkle tree wrapper.
///
/// Uses shardtree for efficient witness generation with O(log n) storage
/// and O(log n) witness computation.
pub struct OrchardTree {
    /// The underlying shard tree.
    tree: ShardTree<MemoryStore, 32, 16>,
    /// Current tree size (number of leaves).
    size: u64,
}

/// In-memory store for shardtree.
/// 
/// In production, this would be backed by SQLite for persistence.
pub struct MemoryStore {
    /// Stored shards.
    shards: BTreeMap<Address, LocatedTree<MerkleHashOrchard, 32, 16>>,
    /// Checkpoints for rewinding.
    checkpoints: BTreeMap<u32, Checkpoint>,
}

/// A checkpoint in the tree for efficient rewinding.
#[derive(Clone, Debug)]
pub struct Checkpoint {
    /// Tree size at this checkpoint.
    pub tree_size: u64,
    /// Anchor at this checkpoint.
    pub anchor: [u8; 32],
    /// Marked positions (notes we need witnesses for).
    pub marked_positions: Vec<u64>,
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
        }
    }
}

impl OrchardTree {
    /// Create a new empty tree.
    pub fn new() -> Self {
        Self {
            tree: ShardTree::new(MemoryStore::new(), 100),
            size: 0,
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
                self.size += 1;
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

        debug!("Appended {} commitments starting at position {}", count, start_position.into(): u64);
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
        let root = self
            .tree
            .root_at_checkpoint_id(&())
            .map_err(|e| WalletError::Backend(format!("root computation failed: {e:?}")))?;

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
        checkpoint_height: u32,
    ) -> Result<[[u8; 32]; 32], WalletError> {
        let pos = Position::from(position);

        let path = self
            .tree
            .witness_at_checkpoint_id(pos, &checkpoint_height)
            .map_err(|e| WalletError::Backend(format!("witness computation failed: {e:?}")))?
            .ok_or_else(|| {
                WalletError::Backend(format!(
                    "no witness available for position {} at checkpoint {}",
                    position, checkpoint_height
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

    /// Rewind the tree to a checkpoint.
    pub fn rewind_to_checkpoint(&mut self, height: u32) -> Result<(), WalletError> {
        // Count how many checkpoints to remove
        let checkpoints_to_remove = self
            .tree
            .checkpoint_count()
            .saturating_sub(1); // Keep at least one

        for _ in 0..checkpoints_to_remove {
            if let Err(_) = self.tree.remove_checkpoint(&height) {
                break;
            }
        }

        debug!("Rewound tree to checkpoint {}", height);
        Ok(())
    }

    /// Get the current tree size.
    pub fn size(&self) -> u64 {
        self.size
    }

    /// Check if a position is marked for witness generation.
    pub fn is_marked(&self, position: u64) -> bool {
        let pos = Position::from(position);
        self.tree
            .get_marked_leaf(pos)
            .is_ok()
    }

    /// Mark a position for future witness generation.
    pub fn mark_position(&mut self, position: u64) -> Result<(), WalletError> {
        let pos = Position::from(position);
        self.tree
            .mark(pos, Marking::Reference)
            .map_err(|e| WalletError::Backend(format!("mark position failed: {e:?}")))?;

        debug!("Marked position {}", position);
        Ok(())
    }
}

impl Default for OrchardTree {
    fn default() -> Self {
        Self::new()
    }
}

// Implement the store trait for our MemoryStore
impl shardtree::store::ShardStore for MemoryStore {
    type H = MerkleHashOrchard;
    type CheckpointId = u32;
    type Error = ShardTreeError<std::convert::Infallible>;

    fn get_shard(
        &self,
        shard_root: Address,
    ) -> Result<Option<LocatedTree<Self::H, 32, 16>>, Self::Error> {
        Ok(self.shards.get(&shard_root).cloned())
    }

    fn last_shard(&self) -> Result<Option<LocatedTree<Self::H, 32, 16>>, Self::Error> {
        Ok(self.shards.values().last().cloned())
    }

    fn put_shard(&mut self, subtree: LocatedTree<Self::H, 32, 16>) -> Result<(), Self::Error> {
        self.shards.insert(subtree.root_addr(), subtree);
        Ok(())
    }

    fn get_shard_roots(&self) -> Result<Vec<Address>, Self::Error> {
        Ok(self.shards.keys().cloned().collect())
    }

    fn truncate(&mut self, from: Address) -> Result<(), Self::Error> {
        self.shards.retain(|addr, _| *addr < from);
        Ok(())
    }

    fn get_cap(&self) -> Result<shardtree::store::caching::CachingTree<Self::H>, Self::Error> {
        // Return empty cap for now
        Ok(shardtree::store::caching::CachingTree::empty())
    }

    fn put_cap(&mut self, _cap: shardtree::store::caching::CachingTree<Self::H>) -> Result<(), Self::Error> {
        Ok(())
    }

    fn min_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        Ok(self.checkpoints.keys().next().cloned())
    }

    fn max_checkpoint_id(&self) -> Result<Option<Self::CheckpointId>, Self::Error> {
        Ok(self.checkpoints.keys().last().cloned())
    }

    fn add_checkpoint(&mut self, checkpoint_id: Self::CheckpointId, checkpoint: shardtree::store::Checkpoint) -> Result<(), Self::Error> {
        self.checkpoints.insert(checkpoint_id, Checkpoint {
            tree_size: checkpoint.position().map(|p| u64::from(p)).unwrap_or(0),
            anchor: [0u8; 32], // Would compute actual anchor
            marked_positions: checkpoint.marked_positions().map(|p| u64::from(p)).collect(),
        });
        Ok(())
    }

    fn checkpoint_count(&self) -> Result<usize, Self::Error> {
        Ok(self.checkpoints.len())
    }

    fn get_checkpoint_at_depth(&self, depth: usize) -> Result<Option<(Self::CheckpointId, shardtree::store::Checkpoint)>, Self::Error> {
        let height = self.checkpoints.keys().rev().nth(depth).cloned();
        Ok(height.map(|h| (h, shardtree::store::Checkpoint::empty(None))))
    }

    fn get_checkpoint(&self, checkpoint_id: &Self::CheckpointId) -> Result<Option<shardtree::store::Checkpoint>, Self::Error> {
        Ok(self.checkpoints.get(checkpoint_id).map(|_| shardtree::store::Checkpoint::empty(None)))
    }

    fn with_checkpoints<F>(&mut self, _limit: usize, _callback: F) -> Result<(), Self::Error>
    where
        F: FnMut(&Self::CheckpointId, &shardtree::store::Checkpoint) -> Result<(), Self::Error>,
    {
        Ok(())
    }

    fn update_checkpoint_with<F>(
        &mut self,
        checkpoint_id: &Self::CheckpointId,
        _update: F,
    ) -> Result<bool, Self::Error>
    where
        F: Fn(&mut shardtree::store::Checkpoint) -> Result<(), Self::Error>,
    {
        Ok(self.checkpoints.contains_key(checkpoint_id))
    }

    fn remove_checkpoint(&mut self, checkpoint_id: &Self::CheckpointId) -> Result<(), Self::Error> {
        self.checkpoints.remove(checkpoint_id);
        Ok(())
    }

    fn truncate_checkpoints(&mut self, checkpoint_id: &Self::CheckpointId) -> Result<(), Self::Error> {
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
}

