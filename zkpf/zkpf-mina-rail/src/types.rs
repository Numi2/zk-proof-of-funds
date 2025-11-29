//! Core types for the Mina Recursive Rail.

use serde::{Deserialize, Serialize};

/// Configuration for the Mina Recursive Rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaRailConfig {
    /// Number of nullifier shards (determines parallelism).
    pub num_shards: usize,
    
    /// Maximum tachystamps per epoch.
    pub max_tachystamps_per_epoch: usize,
    
    /// Epoch duration in Mina slots.
    pub epoch_duration_slots: u64,
    
    /// Bridge contract address on Tachyon L1.
    pub tachyon_bridge_address: [u8; 20],
    
    /// Mina zkApp address for the rail (Base58-encoded public key).
    #[serde(with = "serde_bytes_55")]
    pub mina_app_address: [u8; 55],
    
    /// IVC tree depth (log2 of max proofs per aggregation).
    pub ivc_tree_depth: usize,
}

/// Custom serde for [u8; 55] since serde doesn't support arrays > 32.
mod serde_bytes_55 {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    
    pub fn serialize<S>(bytes: &[u8; 55], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        bytes.as_slice().serialize(serializer)
    }
    
    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 55], D::Error>
    where
        D: Deserializer<'de>,
    {
        let vec: Vec<u8> = Vec::deserialize(deserializer)?;
        if vec.len() != 55 {
            return Err(serde::de::Error::custom(format!(
                "expected 55 bytes, got {}",
                vec.len()
            )));
        }
        let mut arr = [0u8; 55];
        arr.copy_from_slice(&vec);
        Ok(arr)
    }
}

impl Default for MinaRailConfig {
    fn default() -> Self {
        Self {
            num_shards: 16,
            max_tachystamps_per_epoch: 10_000,
            epoch_duration_slots: 7200, // ~1 day at 3 min/slot
            tachyon_bridge_address: [0u8; 20],
            mina_app_address: [0u8; 55],
            ivc_tree_depth: 14, // 2^14 = 16k proofs max
        }
    }
}

/// State of the Mina Recursive Rail at a given epoch.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EpochState {
    /// Current epoch number.
    pub epoch: u64,
    
    /// Mina slot at epoch start.
    pub start_slot: u64,
    
    /// Mina slot at epoch end (if finalized).
    pub end_slot: Option<u64>,
    
    /// Merkle root of all nullifiers seen this epoch.
    pub nullifier_root: [u8; 32],
    
    /// Number of tachystamps processed.
    pub tachystamp_count: u64,
    
    /// Number of unique holders with proofs.
    pub holder_count: u64,
    
    /// IVC accumulator state.
    pub accumulator_hash: [u8; 32],
    
    /// Previous epoch's proof hash (for chain linking).
    pub previous_epoch_hash: [u8; 32],
}

impl EpochState {
    /// Create initial state for epoch 0.
    pub fn genesis() -> Self {
        Self {
            epoch: 0,
            start_slot: 0,
            end_slot: None,
            nullifier_root: [0u8; 32],
            tachystamp_count: 0,
            holder_count: 0,
            accumulator_hash: [0u8; 32],
            previous_epoch_hash: [0u8; 32],
        }
    }
    
    /// Compute the state hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"mina_rail_epoch_state_v1");
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.start_slot.to_le_bytes());
        hasher.update(&self.nullifier_root);
        hasher.update(&self.tachystamp_count.to_le_bytes());
        hasher.update(&self.accumulator_hash);
        hasher.update(&self.previous_epoch_hash);
        *hasher.finalize().as_bytes()
    }
    
    /// Transition to next epoch.
    pub fn next_epoch(&self, end_slot: u64) -> Self {
        Self {
            epoch: self.epoch + 1,
            start_slot: end_slot + 1,
            end_slot: None,
            nullifier_root: [0u8; 32],
            tachystamp_count: 0,
            holder_count: 0,
            accumulator_hash: [0u8; 32],
            previous_epoch_hash: self.hash(),
        }
    }
}

/// A finalized epoch proof ready for L1 verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EpochProof {
    /// The epoch number this proof covers.
    pub epoch: u64,
    
    /// State at epoch start.
    pub pre_state_hash: [u8; 32],
    
    /// State at epoch end.
    pub post_state_hash: [u8; 32],
    
    /// Final nullifier tree root.
    pub nullifier_root: [u8; 32],
    
    /// Number of proofs aggregated.
    pub proof_count: u64,
    
    /// The aggregated IVC proof.
    pub ivc_proof: IVCProofData,
    
    /// Commitment to the shard proofs (for audit).
    pub shard_commitment: [u8; 32],
    
    /// Mina block hash where this was anchored.
    pub mina_anchor_hash: [u8; 32],
    
    /// Mina slot at finalization.
    pub mina_slot: u64,
}

/// Serialized IVC proof data.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IVCProofData {
    /// Pickles proof bytes.
    pub proof_bytes: Vec<u8>,
    
    /// Public inputs to the final circuit.
    pub public_inputs: Vec<[u8; 32]>,
    
    /// Accumulated challenges.
    pub challenges: Vec<[u8; 32]>,
    
    /// Final accumulator commitment (64 bytes).
    #[serde(with = "serde_bytes_64")]
    pub accumulator_commitment: [u8; 64],
}

/// Custom serde for [u8; 64] since serde doesn't support arrays > 32.
mod serde_bytes_64 {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    
    pub fn serialize<S>(bytes: &[u8; 64], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        bytes.as_slice().serialize(serializer)
    }
    
    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 64], D::Error>
    where
        D: Deserializer<'de>,
    {
        let vec: Vec<u8> = Vec::deserialize(deserializer)?;
        if vec.len() != 64 {
            return Err(serde::de::Error::custom(format!(
                "expected 64 bytes, got {}",
                vec.len()
            )));
        }
        let mut arr = [0u8; 64];
        arr.copy_from_slice(&vec);
        Ok(arr)
    }
}

impl EpochProof {
    /// Compute the proof hash for chain linking.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"mina_rail_epoch_proof_v1");
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.pre_state_hash);
        hasher.update(&self.post_state_hash);
        hasher.update(&self.nullifier_root);
        hasher.update(&self.proof_count.to_le_bytes());
        hasher.update(&self.shard_commitment);
        *hasher.finalize().as_bytes()
    }
    
    /// Serialize for bridge transmission.
    pub fn to_bridge_format(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        // Magic bytes
        bytes.extend_from_slice(b"MREP"); // Mina Rail Epoch Proof
        
        // Version
        bytes.extend_from_slice(&1u32.to_be_bytes());
        
        // Epoch
        bytes.extend_from_slice(&self.epoch.to_be_bytes());
        
        // State hashes
        bytes.extend_from_slice(&self.pre_state_hash);
        bytes.extend_from_slice(&self.post_state_hash);
        
        // Nullifier root
        bytes.extend_from_slice(&self.nullifier_root);
        
        // Proof count
        bytes.extend_from_slice(&self.proof_count.to_be_bytes());
        
        // IVC proof length and data
        bytes.extend_from_slice(&(self.ivc_proof.proof_bytes.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&self.ivc_proof.proof_bytes);
        
        // Accumulator commitment
        bytes.extend_from_slice(&self.ivc_proof.accumulator_commitment);
        
        // Mina anchor
        bytes.extend_from_slice(&self.mina_anchor_hash);
        bytes.extend_from_slice(&self.mina_slot.to_be_bytes());
        
        bytes
    }
}

/// Nullifier shard assignment.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct ShardAssignment {
    /// Shard index (0 to num_shards-1).
    pub shard_id: usize,
    
    /// Range of nullifier prefixes assigned to this shard.
    pub prefix_start: u8,
    pub prefix_end: u8,
}

impl ShardAssignment {
    /// Create shard assignments for N shards.
    pub fn create_assignments(num_shards: usize) -> Vec<Self> {
        let shard_size = 256 / num_shards;
        
        (0..num_shards)
            .map(|i| ShardAssignment {
                shard_id: i,
                prefix_start: (i * shard_size) as u8,
                prefix_end: if i == num_shards - 1 {
                    255
                } else {
                    ((i + 1) * shard_size - 1) as u8
                },
            })
            .collect()
    }
    
    /// Check if a nullifier belongs to this shard.
    pub fn contains(&self, nullifier: &[u8; 32]) -> bool {
        let prefix = nullifier[0];
        prefix >= self.prefix_start && prefix <= self.prefix_end
    }
}

/// Aggregation tree node for tracking proof structure.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AggregationNode {
    /// Node depth in the tree (0 = leaf).
    pub depth: usize,
    
    /// Node index at this depth.
    pub index: usize,
    
    /// Hash of this node's content.
    pub hash: [u8; 32],
    
    /// Left child hash (if internal node).
    pub left_child: Option<[u8; 32]>,
    
    /// Right child hash (if internal node).
    pub right_child: Option<[u8; 32]>,
    
    /// Proof data for this node.
    pub proof_data: Option<Vec<u8>>,
}

impl AggregationNode {
    /// Create a leaf node.
    pub fn leaf(index: usize, hash: [u8; 32], proof_data: Vec<u8>) -> Self {
        Self {
            depth: 0,
            index,
            hash,
            left_child: None,
            right_child: None,
            proof_data: Some(proof_data),
        }
    }
    
    /// Create an internal node from two children.
    pub fn internal(
        depth: usize,
        index: usize,
        left: &AggregationNode,
        right: &AggregationNode,
        proof_data: Vec<u8>,
    ) -> Self {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"mina_rail_agg_node");
        hasher.update(&[depth as u8]);
        hasher.update(&left.hash);
        hasher.update(&right.hash);
        
        Self {
            depth,
            index,
            hash: *hasher.finalize().as_bytes(),
            left_child: Some(left.hash),
            right_child: Some(right.hash),
            proof_data: Some(proof_data),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_epoch_state_genesis() {
        let state = EpochState::genesis();
        assert_eq!(state.epoch, 0);
        assert_eq!(state.tachystamp_count, 0);
    }

    #[test]
    fn test_epoch_state_transition() {
        let state = EpochState::genesis();
        let next = state.next_epoch(100);
        
        assert_eq!(next.epoch, 1);
        assert_eq!(next.start_slot, 101);
        assert_eq!(next.previous_epoch_hash, state.hash());
    }

    #[test]
    fn test_shard_assignment() {
        let assignments = ShardAssignment::create_assignments(16);
        assert_eq!(assignments.len(), 16);
        
        // Check coverage
        let mut covered = [false; 256];
        for assign in &assignments {
            for prefix in assign.prefix_start..=assign.prefix_end {
                covered[prefix as usize] = true;
            }
        }
        assert!(covered.iter().all(|&c| c));
    }

    #[test]
    fn test_shard_contains() {
        let assignments = ShardAssignment::create_assignments(4);
        
        let mut nullifier = [0u8; 32];
        
        // Prefix 0 should be in shard 0
        nullifier[0] = 0;
        assert!(assignments[0].contains(&nullifier));
        
        // Prefix 200 should be in shard 3
        nullifier[0] = 200;
        assert!(assignments[3].contains(&nullifier));
    }
}

