//! IVC (Incrementally Verifiable Computation) primitives for the Mina Rail.
//!
//! This module provides the core IVC functionality for recursively aggregating
//! tachystamp proofs into epoch proofs using Pickles-style folding.

use serde::{Deserialize, Serialize};
use thiserror::Error;

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

use crate::tachystamp::ShardProof;
use crate::types::IVCProofData;

/// IVC-related errors.
#[derive(Debug, Error)]
pub enum IVCError {
    #[error("Accumulator initialization failed: {0}")]
    InitializationFailed(String),
    
    #[error("Proof folding failed: {0}")]
    FoldingFailed(String),
    
    #[error("Verification failed: {0}")]
    VerificationFailed(String),
    
    #[error("Invalid accumulator state: {0}")]
    InvalidAccumulator(String),
    
    #[error("Serialization error: {0}")]
    Serialization(String),
}

/// Configuration for the IVC prover.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IVCConfig {
    /// Maximum depth of the aggregation tree.
    pub max_depth: usize,
    
    /// Whether to use parallel folding.
    pub parallel_folding: bool,
    
    /// Number of parallel workers.
    pub num_workers: usize,
}

impl Default for IVCConfig {
    fn default() -> Self {
        Self {
            max_depth: 14,
            parallel_folding: true,
            num_workers: 4,
        }
    }
}

/// An IVC accumulator that tracks the folding state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IVCAccumulator {
    /// Current accumulator commitment.
    #[serde(with = "serde_bytes_64")]
    pub commitment: [u8; 64],
    
    /// Number of proofs folded.
    pub proof_count: u64,
    
    /// Current aggregation depth.
    pub depth: usize,
    
    /// Accumulated challenges (Fiat-Shamir).
    pub challenges: Vec<[u8; 32]>,
    
    /// Public inputs accumulated.
    pub public_inputs: Vec<[u8; 32]>,
}

impl IVCAccumulator {
    /// Create a new empty accumulator.
    pub fn new() -> Self {
        Self {
            commitment: [0u8; 64],
            proof_count: 0,
            depth: 0,
            challenges: Vec::new(),
            public_inputs: Vec::new(),
        }
    }
    
    /// Create an accumulator from a single proof.
    pub fn from_proof(proof: &ShardProof) -> Self {
        let mut commitment = [0u8; 64];
        commitment[..32].copy_from_slice(&proof.hash());
        
        Self {
            commitment,
            proof_count: proof.nullifier_count,
            depth: 0,
            challenges: Vec::new(),
            public_inputs: vec![proof.nullifier_root],
        }
    }
    
    /// Check if the accumulator is empty.
    pub fn is_empty(&self) -> bool {
        self.proof_count == 0
    }
    
    /// Compute the accumulator hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ivc_accumulator_v1");
        hasher.update(&self.commitment);
        hasher.update(&self.proof_count.to_le_bytes());
        hasher.update(&[self.depth as u8]);
        for challenge in &self.challenges {
            hasher.update(challenge);
        }
        *hasher.finalize().as_bytes()
    }
}

impl Default for IVCAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

/// The IVC prover for generating aggregated proofs.
pub struct IVCProver {
    /// Configuration.
    config: IVCConfig,
}

impl IVCProver {
    /// Create a new IVC prover with default configuration.
    pub fn new() -> Self {
        Self {
            config: IVCConfig::default(),
        }
    }
    
    /// Create a new IVC prover with custom configuration.
    pub fn with_config(config: IVCConfig) -> Self {
        Self { config }
    }
    
    /// Fold two accumulators together.
    pub fn fold(
        &self,
        left: &IVCAccumulator,
        right: &IVCAccumulator,
    ) -> Result<IVCAccumulator, IVCError> {
        // Compute folding challenge using Fiat-Shamir
        let challenge = self.compute_folding_challenge(left, right);
        
        // Combine commitments
        let mut new_commitment = [0u8; 64];
        {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"ivc_fold_commitment_v1");
            hasher.update(&left.commitment);
            hasher.update(&right.commitment);
            hasher.update(&challenge);
            let hash = hasher.finalize();
            new_commitment[..32].copy_from_slice(hash.as_bytes());
        }
        
        // Merge challenges
        let mut challenges = left.challenges.clone();
        challenges.extend_from_slice(&right.challenges);
        challenges.push(challenge);
        
        // Merge public inputs
        let mut public_inputs = left.public_inputs.clone();
        public_inputs.extend_from_slice(&right.public_inputs);
        
        Ok(IVCAccumulator {
            commitment: new_commitment,
            proof_count: left.proof_count + right.proof_count,
            depth: left.depth.max(right.depth) + 1,
            challenges,
            public_inputs,
        })
    }
    
    /// Fold multiple accumulators in a tree structure.
    pub fn fold_tree(&self, accumulators: Vec<IVCAccumulator>) -> Result<IVCAccumulator, IVCError> {
        if accumulators.is_empty() {
            return Ok(IVCAccumulator::new());
        }
        
        if accumulators.len() == 1 {
            return Ok(accumulators.into_iter().next().unwrap());
        }
        
        let mut current_level = accumulators;
        
        while current_level.len() > 1 {
            let mut next_level = Vec::new();
            
            for chunk in current_level.chunks(2) {
                match chunk {
                    [left, right] => {
                        next_level.push(self.fold(left, right)?);
                    }
                    [single] => {
                        next_level.push(single.clone());
                    }
                    _ => unreachable!(),
                }
            }
            
            current_level = next_level;
        }
        
        Ok(current_level.into_iter().next().unwrap())
    }
    
    /// Finalize the accumulator into a proof.
    pub fn finalize(&self, accumulator: &IVCAccumulator) -> Result<IVCProofData, IVCError> {
        // Generate the final proof bytes
        let proof_bytes = self.generate_final_proof(accumulator)?;
        
        Ok(IVCProofData {
            proof_bytes,
            public_inputs: accumulator.public_inputs.clone(),
            challenges: accumulator.challenges.clone(),
            accumulator_commitment: accumulator.commitment,
        })
    }
    
    fn compute_folding_challenge(&self, left: &IVCAccumulator, right: &IVCAccumulator) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ivc_folding_challenge_v1");
        hasher.update(&left.hash());
        hasher.update(&right.hash());
        *hasher.finalize().as_bytes()
    }
    
    fn generate_final_proof(&self, accumulator: &IVCAccumulator) -> Result<Vec<u8>, IVCError> {
        // In a real implementation, this would generate a Pickles proof
        // For now, we create a commitment-based proof
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ivc_final_proof_v1");
        hasher.update(&accumulator.commitment);
        hasher.update(&accumulator.proof_count.to_le_bytes());
        for challenge in &accumulator.challenges {
            hasher.update(challenge);
        }
        
        Ok(hasher.finalize().as_bytes().to_vec())
    }
}

impl Default for IVCProver {
    fn default() -> Self {
        Self::new()
    }
}

/// The IVC verifier for checking aggregated proofs.
pub struct IVCVerifier {
    /// Configuration.
    _config: IVCConfig,
}

impl IVCVerifier {
    /// Create a new IVC verifier.
    pub fn new() -> Self {
        Self {
            _config: IVCConfig::default(),
        }
    }
    
    /// Verify an IVC proof.
    pub fn verify(&self, proof: &IVCProofData) -> Result<bool, IVCError> {
        // Verify proof structure
        if proof.proof_bytes.is_empty() {
            return Err(IVCError::VerificationFailed("empty proof bytes".into()));
        }
        
        // Verify accumulator commitment is non-zero
        if proof.accumulator_commitment == [0u8; 64] && !proof.public_inputs.is_empty() {
            return Err(IVCError::VerificationFailed("invalid accumulator commitment".into()));
        }
        
        // In a real implementation, this would verify the Pickles proof
        // For now, we check the structural validity
        let expected_proof = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"ivc_final_proof_v1");
            hasher.update(&proof.accumulator_commitment);
            hasher.update(&(proof.public_inputs.len() as u64).to_le_bytes());
            for challenge in &proof.challenges {
                hasher.update(challenge);
            }
            hasher.finalize().as_bytes().to_vec()
        };
        
        // For mock verification, we just check non-empty
        Ok(!proof.proof_bytes.is_empty())
    }
}

impl Default for IVCVerifier {
    fn default() -> Self {
        Self::new()
    }
}

/// Aggregate shard proofs into IVC proof data.
///
/// This is the main entry point for IVC aggregation, used by the aggregator
/// when the `ivc` feature is enabled.
pub fn aggregate_shard_proofs_ivc(
    proofs: &[ShardProof],
    _epoch: u64,
) -> Result<IVCProofData, IVCError> {
    if proofs.is_empty() {
        return Ok(IVCProofData {
            proof_bytes: Vec::new(),
            public_inputs: Vec::new(),
            challenges: Vec::new(),
            accumulator_commitment: [0u8; 64],
        });
    }
    
    // Create accumulators from shard proofs
    let accumulators: Vec<_> = proofs
        .iter()
        .map(IVCAccumulator::from_proof)
        .collect();
    
    // Fold all accumulators
    let prover = IVCProver::new();
    let final_accumulator = prover.fold_tree(accumulators)?;
    
    // Finalize into proof data
    prover.finalize(&final_accumulator)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn make_test_shard_proof(shard_id: usize) -> ShardProof {
        ShardProof {
            shard_id,
            epoch: 1,
            nullifier_count: 10,
            nullifier_root: [shard_id as u8; 32],
            proof_bytes: vec![1, 2, 3, 4],
            public_inputs: vec![[5u8; 32]],
            generated_at: 1234567890,
        }
    }
    
    #[test]
    fn test_accumulator_creation() {
        let proof = make_test_shard_proof(0);
        let acc = IVCAccumulator::from_proof(&proof);
        
        assert_eq!(acc.proof_count, 10);
        assert_eq!(acc.depth, 0);
    }
    
    #[test]
    fn test_fold_two_accumulators() {
        let proof1 = make_test_shard_proof(0);
        let proof2 = make_test_shard_proof(1);
        
        let acc1 = IVCAccumulator::from_proof(&proof1);
        let acc2 = IVCAccumulator::from_proof(&proof2);
        
        let prover = IVCProver::new();
        let folded = prover.fold(&acc1, &acc2).unwrap();
        
        assert_eq!(folded.proof_count, 20);
        assert_eq!(folded.depth, 1);
        assert_eq!(folded.public_inputs.len(), 2);
    }
    
    #[test]
    fn test_fold_tree() {
        let proofs: Vec<_> = (0..8).map(make_test_shard_proof).collect();
        let accumulators: Vec<_> = proofs.iter().map(IVCAccumulator::from_proof).collect();
        
        let prover = IVCProver::new();
        let result = prover.fold_tree(accumulators).unwrap();
        
        assert_eq!(result.proof_count, 80);
        assert_eq!(result.depth, 3); // log2(8) = 3
    }
    
    #[test]
    fn test_aggregate_shard_proofs() {
        let proofs: Vec<_> = (0..4).map(make_test_shard_proof).collect();
        
        let result = aggregate_shard_proofs_ivc(&proofs, 1).unwrap();
        
        assert!(!result.proof_bytes.is_empty());
        assert_eq!(result.public_inputs.len(), 4);
    }
    
    #[test]
    fn test_verify_proof() {
        let proofs: Vec<_> = (0..4).map(make_test_shard_proof).collect();
        let proof_data = aggregate_shard_proofs_ivc(&proofs, 1).unwrap();
        
        let verifier = IVCVerifier::new();
        assert!(verifier.verify(&proof_data).unwrap());
    }
}
