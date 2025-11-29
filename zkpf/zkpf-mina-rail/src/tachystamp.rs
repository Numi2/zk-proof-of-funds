//! Tachystamp ingestion and processing.
//!
//! This module handles the receipt, validation, and processing of tachystamps
//! from the Tachyon L1 chain.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::types::ShardAssignment;

/// Errors that can occur during tachystamp processing.
#[derive(Debug, Error)]
pub enum TachystampError {
    #[error("Invalid nullifier: {0}")]
    InvalidNullifier(String),
    
    #[error("Invalid proof format: {0}")]
    InvalidProofFormat(String),
    
    #[error("Proof verification failed: {0}")]
    ProofVerificationFailed(String),
    
    #[error("Duplicate nullifier: nullifier already used")]
    DuplicateNullifier,
    
    #[error("Epoch mismatch: expected {expected}, got {got}")]
    EpochMismatch { expected: u64, got: u64 },
    
    #[error("Policy validation failed: {0}")]
    PolicyValidation(String),
    
    #[error("Shard assignment error: {0}")]
    ShardAssignment(String),
}

/// A tachystamp submitted to the Mina Rail.
///
/// Tachystamps are proof-carrying data that attest to a holder's balance
/// at a specific epoch, bound to a nullifier that prevents double-counting.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tachystamp {
    /// Unique identifier assigned by the rail.
    pub id: String,
    
    /// Epoch this tachystamp is valid for.
    pub epoch: u64,
    
    /// Nullifier preventing double-counting.
    pub nullifier: [u8; 32],
    
    /// Commitment to the holder's identity.
    pub holder_commitment: [u8; 32],
    
    /// Policy ID that was verified.
    pub policy_id: u64,
    
    /// Balance threshold that was proven (in zatoshis).
    pub threshold: u64,
    
    /// Currency code (ZEC = 0x5A4543).
    pub currency_code: u32,
    
    /// Proof data from the ZKPF proof.
    pub proof_data: TachystampProof,
    
    /// L1 block height where this was emitted.
    pub l1_block_height: u64,
    
    /// L1 transaction hash.
    pub l1_tx_hash: [u8; 32],
    
    /// Submission timestamp (Unix millis).
    pub submitted_at: u64,
    
    /// Assigned shard ID.
    pub shard_id: usize,
}

/// Proof data embedded in a tachystamp.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TachystampProof {
    /// The proof bytes (compressed format).
    pub proof_bytes: Vec<u8>,
    
    /// Public inputs to the proof.
    pub public_inputs: Vec<[u8; 32]>,
    
    /// Verification key hash used.
    pub vk_hash: [u8; 32],
}

impl Tachystamp {
    /// Compute the tachystamp hash for aggregation.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tachystamp_v1");
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.nullifier);
        hasher.update(&self.holder_commitment);
        hasher.update(&self.policy_id.to_le_bytes());
        hasher.update(&self.threshold.to_le_bytes());
        hasher.update(&self.proof_data.vk_hash);
        *hasher.finalize().as_bytes()
    }
    
    /// Determine which shard this tachystamp belongs to.
    pub fn shard_index(&self, num_shards: usize) -> usize {
        // Use first byte of nullifier as prefix
        let prefix = self.nullifier[0] as usize;
        (prefix * num_shards) / 256
    }
    
    /// Validate the tachystamp structure.
    pub fn validate(&self) -> Result<(), TachystampError> {
        // Check nullifier is non-zero
        if self.nullifier == [0u8; 32] {
            return Err(TachystampError::InvalidNullifier(
                "nullifier cannot be zero".into(),
            ));
        }
        
        // Check holder commitment is non-zero
        if self.holder_commitment == [0u8; 32] {
            return Err(TachystampError::InvalidProofFormat(
                "holder commitment cannot be zero".into(),
            ));
        }
        
        // Check proof data exists
        if self.proof_data.proof_bytes.is_empty() {
            return Err(TachystampError::InvalidProofFormat(
                "proof bytes cannot be empty".into(),
            ));
        }
        
        // Check policy ID is valid
        if self.policy_id == 0 {
            return Err(TachystampError::PolicyValidation(
                "policy ID must be non-zero".into(),
            ));
        }
        
        Ok(())
    }
}

/// A shard of nullifiers with their aggregated proof.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NullifierShard {
    /// Shard index.
    pub shard_id: usize,
    
    /// Epoch this shard belongs to.
    pub epoch: u64,
    
    /// Nullifier prefix range.
    pub prefix_start: u8,
    pub prefix_end: u8,
    
    /// Merkle root of all nullifiers in this shard.
    pub nullifier_root: [u8; 32],
    
    /// Number of nullifiers in this shard.
    pub nullifier_count: u64,
    
    /// Accumulated value threshold sum.
    pub threshold_sum: u64,
    
    /// Holder count in this shard.
    pub holder_count: u64,
    
    /// Tachystamps in this shard.
    tachystamps: Vec<Tachystamp>,
    
    /// Whether the shard proof has been generated.
    is_proven: bool,
    
    /// The shard proof (if generated).
    proof: Option<ShardProof>,
}

impl NullifierShard {
    /// Create a new empty shard.
    pub fn new(shard_id: usize, epoch: u64, assignment: &ShardAssignment) -> Self {
        Self {
            shard_id,
            epoch,
            prefix_start: assignment.prefix_start,
            prefix_end: assignment.prefix_end,
            nullifier_root: [0u8; 32],
            nullifier_count: 0,
            threshold_sum: 0,
            holder_count: 0,
            tachystamps: Vec::new(),
            is_proven: false,
            proof: None,
        }
    }
    
    /// Add a tachystamp to this shard.
    pub fn add_tachystamp(&mut self, tachystamp: Tachystamp) -> Result<(), TachystampError> {
        // Validate epoch
        if tachystamp.epoch != self.epoch {
            return Err(TachystampError::EpochMismatch {
                expected: self.epoch,
                got: tachystamp.epoch,
            });
        }
        
        // Validate shard assignment
        let prefix = tachystamp.nullifier[0];
        if prefix < self.prefix_start || prefix > self.prefix_end {
            return Err(TachystampError::ShardAssignment(format!(
                "nullifier prefix {} not in range [{}, {}]",
                prefix, self.prefix_start, self.prefix_end
            )));
        }
        
        // Check for duplicate nullifier
        if self.tachystamps.iter().any(|t| t.nullifier == tachystamp.nullifier) {
            return Err(TachystampError::DuplicateNullifier);
        }
        
        // Update stats
        self.nullifier_count += 1;
        self.threshold_sum = self.threshold_sum.saturating_add(tachystamp.threshold);
        self.holder_count += 1; // Simplified: assume 1 holder per stamp
        
        // Add tachystamp
        self.tachystamps.push(tachystamp);
        
        // Recompute nullifier root
        self.recompute_nullifier_root();
        
        Ok(())
    }
    
    /// Check if a nullifier is in this shard.
    pub fn contains_nullifier(&self, nullifier: &[u8; 32]) -> bool {
        self.tachystamps.iter().any(|t| &t.nullifier == nullifier)
    }
    
    /// Get the number of tachystamps in this shard.
    pub fn tachystamp_count(&self) -> usize {
        self.tachystamps.len()
    }
    
    /// Get tachystamps in this shard.
    pub fn tachystamps(&self) -> &[Tachystamp] {
        &self.tachystamps
    }
    
    /// Check if the shard proof is generated.
    pub fn is_proven(&self) -> bool {
        self.is_proven
    }
    
    /// Get the shard proof.
    pub fn proof(&self) -> Option<&ShardProof> {
        self.proof.as_ref()
    }
    
    /// Set the shard proof.
    pub fn set_proof(&mut self, proof: ShardProof) {
        self.proof = Some(proof);
        self.is_proven = true;
    }
    
    /// Compute the shard hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"nullifier_shard_v1");
        hasher.update(&[self.shard_id as u8]);
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.nullifier_root);
        hasher.update(&self.nullifier_count.to_le_bytes());
        hasher.update(&self.threshold_sum.to_le_bytes());
        *hasher.finalize().as_bytes()
    }
    
    fn recompute_nullifier_root(&mut self) {
        if self.tachystamps.is_empty() {
            self.nullifier_root = [0u8; 32];
            return;
        }
        
        // Simple Merkle tree construction
        let mut leaves: Vec<[u8; 32]> = self
            .tachystamps
            .iter()
            .map(|t| {
                let mut hasher = blake3::Hasher::new();
                hasher.update(&t.nullifier);
                hasher.update(&t.hash());
                *hasher.finalize().as_bytes()
            })
            .collect();
        
        // Pad to power of 2
        while leaves.len().count_ones() != 1 {
            leaves.push([0u8; 32]);
        }
        
        // Build tree bottom-up
        while leaves.len() > 1 {
            let mut next_level = Vec::new();
            for chunk in leaves.chunks(2) {
                let mut hasher = blake3::Hasher::new();
                hasher.update(&chunk[0]);
                hasher.update(&chunk.get(1).copied().unwrap_or([0u8; 32]));
                next_level.push(*hasher.finalize().as_bytes());
            }
            leaves = next_level;
        }
        
        self.nullifier_root = leaves[0];
    }
}

/// Proof for a nullifier shard.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShardProof {
    /// Shard index.
    pub shard_id: usize,
    
    /// Epoch this proof covers.
    pub epoch: u64,
    
    /// Number of nullifiers proven.
    pub nullifier_count: u64,
    
    /// Nullifier root proven.
    pub nullifier_root: [u8; 32],
    
    /// Aggregated IVC proof bytes.
    pub proof_bytes: Vec<u8>,
    
    /// Public inputs to the proof.
    pub public_inputs: Vec<[u8; 32]>,
    
    /// Proof generation timestamp.
    pub generated_at: u64,
}

impl ShardProof {
    /// Compute the proof hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"shard_proof_v1");
        hasher.update(&[self.shard_id as u8]);
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.nullifier_count.to_le_bytes());
        hasher.update(&self.nullifier_root);
        hasher.update(&self.proof_bytes);
        *hasher.finalize().as_bytes()
    }
}

/// Incoming tachystamp submission request.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TachystampSubmission {
    /// Epoch for this tachystamp.
    pub epoch: u64,
    
    /// Nullifier (hex string).
    pub nullifier: String,
    
    /// Holder commitment (hex string).
    pub holder_commitment: String,
    
    /// Policy ID.
    pub policy_id: u64,
    
    /// Threshold in base units.
    pub threshold: u64,
    
    /// Currency code.
    pub currency_code: u32,
    
    /// Proof bytes (base64).
    pub proof_bytes: String,
    
    /// Public inputs (hex strings).
    pub public_inputs: Vec<String>,
    
    /// VK hash (hex string).
    pub vk_hash: String,
    
    /// L1 block height.
    pub l1_block_height: u64,
    
    /// L1 tx hash (hex string).
    pub l1_tx_hash: String,
}

impl TachystampSubmission {
    /// Convert to a Tachystamp with assigned ID and shard.
    pub fn into_tachystamp(
        self,
        id: String,
        shard_id: usize,
    ) -> Result<Tachystamp, TachystampError> {
        Ok(Tachystamp {
            id,
            epoch: self.epoch,
            nullifier: parse_hex_32(&self.nullifier)
                .map_err(|e| TachystampError::InvalidNullifier(e.to_string()))?,
            holder_commitment: parse_hex_32(&self.holder_commitment)
                .map_err(|e| TachystampError::InvalidProofFormat(e.to_string()))?,
            policy_id: self.policy_id,
            threshold: self.threshold,
            currency_code: self.currency_code,
            proof_data: TachystampProof {
                proof_bytes: base64_decode(&self.proof_bytes)
                    .map_err(|e| TachystampError::InvalidProofFormat(e.to_string()))?,
                public_inputs: self
                    .public_inputs
                    .iter()
                    .map(|s| parse_hex_32(s))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| TachystampError::InvalidProofFormat(e.to_string()))?,
                vk_hash: parse_hex_32(&self.vk_hash)
                    .map_err(|e| TachystampError::InvalidProofFormat(e.to_string()))?,
            },
            l1_block_height: self.l1_block_height,
            l1_tx_hash: parse_hex_32(&self.l1_tx_hash)
                .map_err(|e| TachystampError::InvalidProofFormat(e.to_string()))?,
            submitted_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            shard_id,
        })
    }
}

fn parse_hex_32(s: &str) -> Result<[u8; 32], String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() != 64 {
        return Err(format!("expected 64 hex chars, got {}", s.len()));
    }
    let bytes = hex::decode(s).map_err(|e| e.to_string())?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.decode(s).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    fn make_test_tachystamp(nullifier_prefix: u8) -> Tachystamp {
        let mut nullifier = [0u8; 32];
        nullifier[0] = nullifier_prefix;
        nullifier[1] = 1;
        
        Tachystamp {
            id: format!("test-{}", nullifier_prefix),
            epoch: 100,
            nullifier,
            holder_commitment: [1u8; 32],
            policy_id: 1,
            threshold: 1_000_000,
            currency_code: 0x5A4543,
            proof_data: TachystampProof {
                proof_bytes: vec![1, 2, 3, 4],
                public_inputs: vec![[2u8; 32]],
                vk_hash: [3u8; 32],
            },
            l1_block_height: 1000,
            l1_tx_hash: [4u8; 32],
            submitted_at: 1234567890,
            shard_id: 0,
        }
    }
    
    #[test]
    fn test_tachystamp_validation() {
        let ts = make_test_tachystamp(10);
        assert!(ts.validate().is_ok());
        
        // Zero nullifier should fail
        let mut invalid = ts.clone();
        invalid.nullifier = [0u8; 32];
        assert!(matches!(
            invalid.validate(),
            Err(TachystampError::InvalidNullifier(_))
        ));
    }
    
    #[test]
    fn test_shard_assignment() {
        let ts = make_test_tachystamp(100);
        assert_eq!(ts.shard_index(16), 6); // 100 * 16 / 256 = 6.25 -> 6
    }
    
    #[test]
    fn test_nullifier_shard() {
        let assignment = ShardAssignment {
            shard_id: 0,
            prefix_start: 0,
            prefix_end: 15,
        };
        let mut shard = NullifierShard::new(0, 100, &assignment);
        
        let ts = make_test_tachystamp(10);
        shard.add_tachystamp(ts.clone()).unwrap();
        
        assert_eq!(shard.tachystamp_count(), 1);
        assert!(shard.contains_nullifier(&ts.nullifier));
        
        // Adding duplicate should fail
        let result = shard.add_tachystamp(ts);
        assert!(matches!(result, Err(TachystampError::DuplicateNullifier)));
    }
}
