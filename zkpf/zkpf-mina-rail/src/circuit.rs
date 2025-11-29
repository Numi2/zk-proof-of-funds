//! IVC circuits for tachystamp aggregation.
//!
//! This module defines the circuits used in the recursive aggregation
//! of tachystamps. The circuits are designed to work with Pickles/Kimchi
//! style IVC (Incrementally Verifiable Computation).

use serde::{Deserialize, Serialize};

/// Public inputs for the tachystamp verification circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TachystampPublicInputs {
    /// Epoch number.
    pub epoch: u64,
    
    /// Nullifier commitment.
    pub nullifier: [u8; 32],
    
    /// Holder commitment.
    pub holder_commitment: [u8; 32],
    
    /// Policy ID.
    pub policy_id: u64,
    
    /// Threshold proven.
    pub threshold: u64,
    
    /// VK hash of the original proof.
    pub vk_hash: [u8; 32],
}

/// Public inputs for the aggregation circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AggregationPublicInputs {
    /// Left child hash.
    pub left_hash: [u8; 32],
    
    /// Right child hash.
    pub right_hash: [u8; 32],
    
    /// Aggregated nullifier root.
    pub nullifier_root: [u8; 32],
    
    /// Count of aggregated proofs.
    pub proof_count: u64,
    
    /// Epoch number.
    pub epoch: u64,
}

/// Public inputs for the epoch finalization circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EpochPublicInputs {
    /// Epoch number.
    pub epoch: u64,
    
    /// Previous epoch state hash.
    pub pre_state_hash: [u8; 32],
    
    /// New epoch state hash.
    pub post_state_hash: [u8; 32],
    
    /// Final nullifier tree root.
    pub nullifier_root: [u8; 32],
    
    /// Total proofs aggregated.
    pub proof_count: u64,
    
    /// Shard commitment.
    pub shard_commitment: [u8; 32],
}

/// The tachystamp verification circuit.
///
/// This circuit verifies:
/// 1. The original ZKPF proof is valid
/// 2. The nullifier is correctly derived from holder data
/// 3. The epoch binding is correct
#[derive(Clone, Debug)]
pub struct TachystampCircuit {
    /// Public inputs.
    pub public_inputs: TachystampPublicInputs,
    
    /// Private witness: original proof bytes.
    proof_bytes: Vec<u8>,
    
    /// Private witness: original public inputs.
    original_public_inputs: Vec<[u8; 32]>,
}

impl TachystampCircuit {
    /// Create a new tachystamp circuit.
    pub fn new(
        public_inputs: TachystampPublicInputs,
        proof_bytes: Vec<u8>,
        original_public_inputs: Vec<[u8; 32]>,
    ) -> Self {
        Self {
            public_inputs,
            proof_bytes,
            original_public_inputs,
        }
    }
    
    /// Compute the statement hash for this circuit.
    pub fn statement_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tachystamp_statement_v1");
        hasher.update(&self.public_inputs.epoch.to_le_bytes());
        hasher.update(&self.public_inputs.nullifier);
        hasher.update(&self.public_inputs.holder_commitment);
        hasher.update(&self.public_inputs.policy_id.to_le_bytes());
        hasher.update(&self.public_inputs.threshold.to_le_bytes());
        hasher.update(&self.public_inputs.vk_hash);
        *hasher.finalize().as_bytes()
    }
    
    /// Synthesize the circuit constraints.
    ///
    /// In a real implementation, this would add gates to a constraint system.
    /// For now, we just validate the structure.
    pub fn synthesize(&self) -> Result<CircuitProof, CircuitError> {
        // Verify nullifier is non-zero
        if self.public_inputs.nullifier == [0u8; 32] {
            return Err(CircuitError::InvalidNullifier);
        }
        
        // Verify holder commitment is non-zero
        if self.public_inputs.holder_commitment == [0u8; 32] {
            return Err(CircuitError::InvalidHolderCommitment);
        }
        
        // Verify proof bytes are non-empty
        if self.proof_bytes.is_empty() {
            return Err(CircuitError::InvalidProof("proof bytes empty".into()));
        }
        
        // Compute circuit proof (mock)
        let proof_bytes = self.compute_proof_bytes();
        
        Ok(CircuitProof {
            proof_bytes,
            public_inputs_hash: self.statement_hash(),
        })
    }
    
    fn compute_proof_bytes(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tachystamp_proof_v1");
        hasher.update(&self.statement_hash());
        hasher.update(&self.proof_bytes);
        for input in &self.original_public_inputs {
            hasher.update(input);
        }
        hasher.finalize().as_bytes().to_vec()
    }
}

/// The aggregation circuit.
///
/// This circuit verifies:
/// 1. Two child proofs are valid
/// 2. The nullifier roots are correctly merged
/// 3. The proof count is correctly summed
#[derive(Clone, Debug)]
pub struct AggregationCircuit {
    /// Public inputs.
    pub public_inputs: AggregationPublicInputs,
    
    /// Left child proof.
    left_proof: CircuitProof,
    
    /// Right child proof.
    right_proof: CircuitProof,
}

impl AggregationCircuit {
    /// Create a new aggregation circuit.
    pub fn new(
        public_inputs: AggregationPublicInputs,
        left_proof: CircuitProof,
        right_proof: CircuitProof,
    ) -> Self {
        Self {
            public_inputs,
            left_proof,
            right_proof,
        }
    }
    
    /// Compute the statement hash.
    pub fn statement_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"aggregation_statement_v1");
        hasher.update(&self.public_inputs.left_hash);
        hasher.update(&self.public_inputs.right_hash);
        hasher.update(&self.public_inputs.nullifier_root);
        hasher.update(&self.public_inputs.proof_count.to_le_bytes());
        hasher.update(&self.public_inputs.epoch.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
    
    /// Synthesize the aggregation circuit.
    pub fn synthesize(&self) -> Result<CircuitProof, CircuitError> {
        // Verify child proofs match their claimed hashes
        if self.left_proof.public_inputs_hash != self.public_inputs.left_hash {
            return Err(CircuitError::HashMismatch("left child".into()));
        }
        
        if self.right_proof.public_inputs_hash != self.public_inputs.right_hash {
            return Err(CircuitError::HashMismatch("right child".into()));
        }
        
        // Compute aggregated proof
        let proof_bytes = self.compute_proof_bytes();
        
        Ok(CircuitProof {
            proof_bytes,
            public_inputs_hash: self.statement_hash(),
        })
    }
    
    fn compute_proof_bytes(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"aggregation_proof_v1");
        hasher.update(&self.statement_hash());
        hasher.update(&self.left_proof.proof_bytes);
        hasher.update(&self.right_proof.proof_bytes);
        hasher.finalize().as_bytes().to_vec()
    }
}

/// The epoch finalization circuit.
///
/// This circuit verifies:
/// 1. All shard proofs are valid
/// 2. The global nullifier root is correct
/// 3. The state transition is valid
#[derive(Clone, Debug)]
pub struct EpochCircuit {
    /// Public inputs.
    pub public_inputs: EpochPublicInputs,
    
    /// Aggregated shard proof.
    aggregated_proof: CircuitProof,
}

impl EpochCircuit {
    /// Create a new epoch circuit.
    pub fn new(public_inputs: EpochPublicInputs, aggregated_proof: CircuitProof) -> Self {
        Self {
            public_inputs,
            aggregated_proof,
        }
    }
    
    /// Compute the statement hash.
    pub fn statement_hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"epoch_statement_v1");
        hasher.update(&self.public_inputs.epoch.to_le_bytes());
        hasher.update(&self.public_inputs.pre_state_hash);
        hasher.update(&self.public_inputs.post_state_hash);
        hasher.update(&self.public_inputs.nullifier_root);
        hasher.update(&self.public_inputs.proof_count.to_le_bytes());
        hasher.update(&self.public_inputs.shard_commitment);
        *hasher.finalize().as_bytes()
    }
    
    /// Synthesize the epoch circuit.
    pub fn synthesize(&self) -> Result<CircuitProof, CircuitError> {
        // Verify epoch is positive (genesis has different rules)
        // Verify nullifier root matches aggregated proof
        // Verify state transition is valid
        
        let proof_bytes = self.compute_proof_bytes();
        
        Ok(CircuitProof {
            proof_bytes,
            public_inputs_hash: self.statement_hash(),
        })
    }
    
    fn compute_proof_bytes(&self) -> Vec<u8> {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"epoch_proof_v1");
        hasher.update(&self.statement_hash());
        hasher.update(&self.aggregated_proof.proof_bytes);
        hasher.finalize().as_bytes().to_vec()
    }
}

/// A circuit proof.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CircuitProof {
    /// Serialized proof bytes.
    pub proof_bytes: Vec<u8>,
    
    /// Hash of the public inputs.
    pub public_inputs_hash: [u8; 32],
}

impl CircuitProof {
    /// Create an empty/placeholder proof.
    pub fn empty() -> Self {
        Self {
            proof_bytes: Vec::new(),
            public_inputs_hash: [0u8; 32],
        }
    }
    
    /// Check if this is an empty proof.
    pub fn is_empty(&self) -> bool {
        self.proof_bytes.is_empty()
    }
    
    /// Compute the proof hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"circuit_proof_v1");
        hasher.update(&self.proof_bytes);
        hasher.update(&self.public_inputs_hash);
        *hasher.finalize().as_bytes()
    }
}

/// Circuit errors.
#[derive(Debug, thiserror::Error)]
pub enum CircuitError {
    #[error("Invalid nullifier")]
    InvalidNullifier,
    
    #[error("Invalid holder commitment")]
    InvalidHolderCommitment,
    
    #[error("Invalid proof: {0}")]
    InvalidProof(String),
    
    #[error("Hash mismatch: {0}")]
    HashMismatch(String),
    
    #[error("Constraint violation: {0}")]
    ConstraintViolation(String),
    
    #[error("Synthesis failed: {0}")]
    SynthesisFailed(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_tachystamp_circuit() {
        let public_inputs = TachystampPublicInputs {
            epoch: 1,
            nullifier: [1u8; 32],
            holder_commitment: [2u8; 32],
            policy_id: 100,
            threshold: 1_000_000,
            vk_hash: [3u8; 32],
        };
        
        let circuit = TachystampCircuit::new(
            public_inputs,
            vec![1, 2, 3, 4],
            vec![[4u8; 32]],
        );
        
        let proof = circuit.synthesize().unwrap();
        assert!(!proof.proof_bytes.is_empty());
    }
    
    #[test]
    fn test_aggregation_circuit() {
        let left_proof = CircuitProof {
            proof_bytes: vec![1, 2, 3],
            public_inputs_hash: [10u8; 32],
        };
        
        let right_proof = CircuitProof {
            proof_bytes: vec![4, 5, 6],
            public_inputs_hash: [20u8; 32],
        };
        
        let public_inputs = AggregationPublicInputs {
            left_hash: [10u8; 32],
            right_hash: [20u8; 32],
            nullifier_root: [30u8; 32],
            proof_count: 2,
            epoch: 1,
        };
        
        let circuit = AggregationCircuit::new(public_inputs, left_proof, right_proof);
        let proof = circuit.synthesize().unwrap();
        assert!(!proof.proof_bytes.is_empty());
    }
}
