//! State management for Mina zkApp attestations.
//!
//! This module provides structures and functions for managing the on-chain
//! state of the zkpf verifier zkApp, including attestation storage and
//! Merkle tree operations.

use blake3::Hasher;
use serde::{Deserialize, Serialize};

use crate::{
    error::MinaRailError,
    types::{MinaAddress, MinaNetwork},
    MinaAttestation, ZkAppState,
};

/// Attestation Merkle tree for efficient storage and proofs.
#[derive(Clone, Debug)]
pub struct AttestationTree {
    /// Root hash of the tree.
    root: [u8; 32],
    /// Depth of the tree (max 32).
    depth: u8,
    /// Number of leaves in the tree.
    leaf_count: u64,
    /// Leaves indexed by attestation ID.
    leaves: std::collections::HashMap<[u8; 32], AttestationLeaf>,
}

/// A leaf in the attestation Merkle tree.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationLeaf {
    /// Index in the tree.
    pub index: u64,
    /// Attestation data.
    pub attestation: MinaAttestation,
    /// Hash of the leaf.
    pub leaf_hash: [u8; 32],
}

impl AttestationTree {
    /// Create a new empty attestation tree.
    pub fn new(depth: u8) -> Self {
        Self {
            root: compute_empty_root(depth),
            depth,
            leaf_count: 0,
            leaves: std::collections::HashMap::new(),
        }
    }

    /// Get the root hash.
    pub fn root(&self) -> [u8; 32] {
        self.root
    }

    /// Get the number of leaves.
    pub fn leaf_count(&self) -> u64 {
        self.leaf_count
    }

    /// Insert an attestation into the tree.
    pub fn insert(&mut self, attestation: MinaAttestation) -> Result<[u8; 32], MinaRailError> {
        let leaf_hash = compute_attestation_hash(&attestation);
        let index = self.leaf_count;

        let leaf = AttestationLeaf {
            index,
            attestation: attestation.clone(),
            leaf_hash,
        };

        self.leaves.insert(attestation.attestation_id, leaf);
        self.leaf_count += 1;

        // Recompute root (simplified - real impl would update incrementally)
        self.recompute_root();

        Ok(leaf_hash)
    }

    /// Get an attestation by ID.
    pub fn get(&self, attestation_id: &[u8; 32]) -> Option<&MinaAttestation> {
        self.leaves.get(attestation_id).map(|l| &l.attestation)
    }

    /// Generate a Merkle proof for an attestation.
    pub fn prove(&self, attestation_id: &[u8; 32]) -> Option<MerkleProof> {
        let leaf = self.leaves.get(attestation_id)?;

        // Generate sibling path (simplified - real impl would compute actual path)
        let mut path = Vec::with_capacity(self.depth as usize);
        let mut current_index = leaf.index;

        for _ in 0..self.depth {
            let sibling_index = current_index ^ 1;
            let sibling_hash = self.get_node_hash(sibling_index);
            path.push(MerklePathElement {
                sibling_hash,
                is_left: current_index % 2 == 1,
            });
            current_index /= 2;
        }

        Some(MerkleProof {
            leaf_hash: leaf.leaf_hash,
            leaf_index: leaf.index,
            path,
            root: self.root,
        })
    }

    /// Verify an attestation exists at the given root.
    pub fn verify_proof(proof: &MerkleProof) -> bool {
        let mut current_hash = proof.leaf_hash;

        for element in &proof.path {
            current_hash = if element.is_left {
                hash_pair(&element.sibling_hash, &current_hash)
            } else {
                hash_pair(&current_hash, &element.sibling_hash)
            };
        }

        current_hash == proof.root
    }

    fn recompute_root(&mut self) {
        if self.leaf_count == 0 {
            self.root = compute_empty_root(self.depth);
            return;
        }

        // Simplified root computation - real impl would use a sparse Merkle tree
        let mut hasher = Hasher::new();
        hasher.update(b"mina_attestation_root_v1");
        for leaf in self.leaves.values() {
            hasher.update(&leaf.leaf_hash);
        }
        self.root = *hasher.finalize().as_bytes();
    }

    fn get_node_hash(&self, _index: u64) -> [u8; 32] {
        // Simplified - return empty hash for non-existent nodes
        [0u8; 32]
    }
}

/// Merkle proof for attestation inclusion.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MerkleProof {
    /// Hash of the leaf being proven.
    pub leaf_hash: [u8; 32],
    /// Index of the leaf in the tree.
    pub leaf_index: u64,
    /// Sibling path from leaf to root.
    pub path: Vec<MerklePathElement>,
    /// Root hash this proof is valid against.
    pub root: [u8; 32],
}

/// Element in a Merkle path.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MerklePathElement {
    /// Hash of the sibling node.
    pub sibling_hash: [u8; 32],
    /// Whether the sibling is on the left.
    pub is_left: bool,
}

/// In-memory state store for development/testing.
#[derive(Clone, Debug)]
pub struct StateStore {
    /// Network identifier.
    network: MinaNetwork,
    /// zkApp address.
    zkapp_address: MinaAddress,
    /// Current state.
    state: ZkAppState,
    /// Attestation tree.
    tree: AttestationTree,
    /// Pending attestations (not yet committed to tree).
    pending: Vec<MinaAttestation>,
}

impl StateStore {
    /// Create a new state store.
    pub fn new(network: MinaNetwork, zkapp_address: MinaAddress) -> Self {
        Self {
            network,
            zkapp_address,
            state: ZkAppState {
                attestation_root: compute_empty_root(20),
                attestation_count: 0,
                last_updated_slot: 0,
                admin_pubkey_hash: [0u8; 32],
            },
            tree: AttestationTree::new(20),
            pending: Vec::new(),
        }
    }

    /// Get current state.
    pub fn state(&self) -> &ZkAppState {
        &self.state
    }

    /// Get the attestation tree.
    pub fn tree(&self) -> &AttestationTree {
        &self.tree
    }

    /// Add a pending attestation.
    pub fn add_pending(&mut self, attestation: MinaAttestation) {
        self.pending.push(attestation);
    }

    /// Commit pending attestations to the tree.
    pub fn commit(&mut self, slot: u64) -> Result<[u8; 32], MinaRailError> {
        for attestation in self.pending.drain(..) {
            self.tree.insert(attestation)?;
        }

        self.state.attestation_root = self.tree.root();
        self.state.attestation_count = self.tree.leaf_count();
        self.state.last_updated_slot = slot;

        Ok(self.state.attestation_root)
    }

    /// Query an attestation.
    pub fn query(
        &self,
        holder_binding: &[u8; 32],
        policy_id: u64,
        epoch: u64,
    ) -> Option<&MinaAttestation> {
        let attestation_id = compute_query_id(holder_binding, policy_id, epoch);
        self.tree.get(&attestation_id)
    }

    /// Generate a proof for an attestation query.
    pub fn prove_query(
        &self,
        holder_binding: &[u8; 32],
        policy_id: u64,
        epoch: u64,
    ) -> Option<MerkleProof> {
        let attestation_id = compute_query_id(holder_binding, policy_id, epoch);
        self.tree.prove(&attestation_id)
    }

    /// Check if an attestation is valid (exists and not expired).
    pub fn is_valid(
        &self,
        holder_binding: &[u8; 32],
        policy_id: u64,
        epoch: u64,
        current_slot: u64,
    ) -> bool {
        if let Some(attestation) = self.query(holder_binding, policy_id, epoch) {
            attestation.is_valid && attestation.expires_at_slot > current_slot
        } else {
            false
        }
    }
}

// === Helper functions ===

fn compute_empty_root(depth: u8) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_empty_root_v1");
    hasher.update(&[depth]);
    *hasher.finalize().as_bytes()
}

fn compute_attestation_hash(attestation: &MinaAttestation) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_attestation_leaf_v1");
    hasher.update(&attestation.attestation_id);
    hasher.update(&attestation.holder_binding);
    hasher.update(&attestation.policy_id.to_be_bytes());
    hasher.update(&attestation.epoch.to_be_bytes());
    hasher.update(&attestation.mina_slot.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn compute_query_id(holder_binding: &[u8; 32], policy_id: u64, epoch: u64) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_attestation_id_v1");
    hasher.update(holder_binding);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_merkle_node_v1");
    hasher.update(left);
    hasher.update(right);
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_attestation() -> MinaAttestation {
        MinaAttestation {
            attestation_id: [1u8; 32],
            holder_binding: [2u8; 32],
            policy_id: 100,
            epoch: 1_700_000_000,
            mina_slot: 500_000,
            expires_at_slot: 507_200,
            source_rails: vec!["STARKNET_L2".to_string()],
            is_valid: true,
        }
    }

    #[test]
    fn test_attestation_tree_insert() {
        let mut tree = AttestationTree::new(20);
        let attestation = sample_attestation();

        let hash = tree.insert(attestation).expect("insert should succeed");
        assert_ne!(hash, [0u8; 32]);
        assert_eq!(tree.leaf_count(), 1);
    }

    #[test]
    fn test_attestation_tree_get() {
        let mut tree = AttestationTree::new(20);
        let attestation = sample_attestation();
        let id = attestation.attestation_id;

        tree.insert(attestation).expect("insert should succeed");

        let retrieved = tree.get(&id);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().policy_id, 100);
    }

    #[test]
    fn test_state_store_query() {
        let mut store = StateStore::new(
            MinaNetwork::Testnet,
            MinaAddress::new("B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
        );

        // The attestation_id is computed from holder_binding, policy_id, and epoch
        let mut attestation = sample_attestation();
        // Recompute attestation_id to match the query
        attestation.attestation_id = compute_query_id(
            &attestation.holder_binding,
            attestation.policy_id,
            attestation.epoch,
        );

        store.add_pending(attestation.clone());
        store.commit(500_000).expect("commit should succeed");

        let result = store.query(&attestation.holder_binding, 100, 1_700_000_000);
        assert!(result.is_some());
    }

    #[test]
    fn test_is_valid_checks_expiration() {
        let mut store = StateStore::new(
            MinaNetwork::Testnet,
            MinaAddress::new("B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
        );

        let mut attestation = sample_attestation();
        attestation.attestation_id = compute_query_id(
            &attestation.holder_binding,
            attestation.policy_id,
            attestation.epoch,
        );

        store.add_pending(attestation.clone());
        store.commit(500_000).expect("commit should succeed");

        // Not expired
        assert!(store.is_valid(&attestation.holder_binding, 100, 1_700_000_000, 505_000));

        // Expired
        assert!(!store.is_valid(&attestation.holder_binding, 100, 1_700_000_000, 510_000));
    }
}

