//! Recursive aggregation of tachystamps.
//!
//! This module implements the IVC-based aggregation of tachystamps into
//! shard proofs and epoch proofs using Pickles/Kimchi-style recursion.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::tachystamp::{NullifierShard, ShardProof, Tachystamp, TachystampError, TachystampSubmission};
use crate::types::{AggregationNode, EpochProof, EpochState, IVCProofData, MinaRailConfig, ShardAssignment};

/// Errors from the aggregator.
#[derive(Debug, Error)]
pub enum AggregatorError {
    #[error("Tachystamp error: {0}")]
    Tachystamp(#[from] TachystampError),
    
    #[error("Epoch already finalized: {0}")]
    EpochFinalized(u64),
    
    #[error("Epoch not found: {0}")]
    EpochNotFound(u64),
    
    #[error("Shard not found: {0}")]
    ShardNotFound(usize),
    
    #[error("Aggregation in progress")]
    AggregationInProgress,
    
    #[error("Not enough proofs to aggregate")]
    NotEnoughProofs,
    
    #[error("IVC proof generation failed: {0}")]
    IVCProofFailed(String),
    
    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),
}

/// Aggregator for a single nullifier shard.
#[derive(Debug)]
pub struct ShardAggregator {
    /// Shard configuration.
    pub shard_id: usize,
    
    /// Shard assignment.
    assignment: ShardAssignment,
    
    /// Current epoch.
    current_epoch: u64,
    
    /// Shard data for current epoch.
    current_shard: NullifierShard,
    
    /// Historical shard proofs.
    historical_proofs: HashMap<u64, ShardProof>,
}

impl ShardAggregator {
    /// Create a new shard aggregator.
    pub fn new(shard_id: usize, assignment: ShardAssignment, epoch: u64) -> Self {
        Self {
            shard_id,
            assignment,
            current_epoch: epoch,
            current_shard: NullifierShard::new(shard_id, epoch, &assignment),
            historical_proofs: HashMap::new(),
        }
    }
    
    /// Add a tachystamp to this shard.
    pub fn add_tachystamp(&mut self, tachystamp: Tachystamp) -> Result<(), AggregatorError> {
        if tachystamp.epoch != self.current_epoch {
            return Err(AggregatorError::InvalidStateTransition(format!(
                "tachystamp epoch {} != current epoch {}",
                tachystamp.epoch, self.current_epoch
            )));
        }
        
        self.current_shard.add_tachystamp(tachystamp)?;
        Ok(())
    }
    
    /// Check if a nullifier is in this shard.
    pub fn contains_nullifier(&self, nullifier: &[u8; 32]) -> bool {
        self.current_shard.contains_nullifier(nullifier)
    }
    
    /// Get tachystamp count for current epoch.
    pub fn tachystamp_count(&self) -> usize {
        self.current_shard.tachystamp_count()
    }
    
    /// Get the nullifier root for current epoch.
    pub fn nullifier_root(&self) -> [u8; 32] {
        self.current_shard.nullifier_root
    }
    
    /// Check if shard proof is generated.
    pub fn is_proven(&self) -> bool {
        self.current_shard.is_proven()
    }
    
    /// Get the current shard proof.
    pub fn proof(&self) -> Option<&ShardProof> {
        self.current_shard.proof()
    }
    
    /// Generate the shard proof using IVC.
    pub fn generate_proof(&mut self) -> Result<ShardProof, AggregatorError> {
        if self.current_shard.tachystamp_count() == 0 {
            return Err(AggregatorError::NotEnoughProofs);
        }
        
        // Build aggregation tree for tachystamps in this shard
        let leaves: Vec<AggregationNode> = self
            .current_shard
            .tachystamps()
            .iter()
            .enumerate()
            .map(|(i, ts)| {
                AggregationNode::leaf(i, ts.hash(), ts.proof_data.proof_bytes.clone())
            })
            .collect();
        
        // Aggregate proofs bottom-up
        let root = self.aggregate_tree(leaves)?;
        
        // Create shard proof
        let proof = ShardProof {
            shard_id: self.shard_id,
            epoch: self.current_epoch,
            nullifier_count: self.current_shard.nullifier_count,
            nullifier_root: self.current_shard.nullifier_root,
            proof_bytes: root.proof_data.unwrap_or_default(),
            public_inputs: vec![
                self.current_shard.nullifier_root,
                self.current_shard.hash(),
            ],
            generated_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };
        
        self.current_shard.set_proof(proof.clone());
        
        Ok(proof)
    }
    
    /// Finalize the current epoch and transition to next.
    pub fn finalize_epoch(&mut self, _end_slot: u64) -> Result<ShardProof, AggregatorError> {
        // Ensure proof is generated
        let proof = if self.current_shard.is_proven() {
            self.current_shard.proof().unwrap().clone()
        } else {
            self.generate_proof()?
        };
        
        // Store historical proof
        self.historical_proofs.insert(self.current_epoch, proof.clone());
        
        // Transition to next epoch
        let next_epoch = self.current_epoch + 1;
        self.current_epoch = next_epoch;
        self.current_shard = NullifierShard::new(self.shard_id, next_epoch, &self.assignment);
        
        Ok(proof)
    }
    
    /// Get historical proof for an epoch.
    pub fn get_historical_proof(&self, epoch: u64) -> Option<&ShardProof> {
        self.historical_proofs.get(&epoch)
    }
    
    fn aggregate_tree(&self, mut nodes: Vec<AggregationNode>) -> Result<AggregationNode, AggregatorError> {
        if nodes.is_empty() {
            return Err(AggregatorError::NotEnoughProofs);
        }
        
        // Pad to power of 2
        while nodes.len().count_ones() != 1 {
            let index = nodes.len();
            nodes.push(AggregationNode::leaf(
                index,
                [0u8; 32],
                Vec::new(),
            ));
        }
        
        let mut depth = 0;
        while nodes.len() > 1 {
            depth += 1;
            let mut next_level = Vec::new();
            
            for (i, chunk) in nodes.chunks(2).enumerate() {
                let left = &chunk[0];
                let right = &chunk.get(1).cloned().unwrap_or_else(|| {
                    AggregationNode::leaf(0, [0u8; 32], Vec::new())
                });
                
                // Aggregate the two proofs
                let aggregated_proof = self.aggregate_pair(left, right)?;
                
                next_level.push(AggregationNode::internal(
                    depth,
                    i,
                    left,
                    right,
                    aggregated_proof,
                ));
            }
            
            nodes = next_level;
        }
        
        Ok(nodes.into_iter().next().unwrap())
    }
    
    fn aggregate_pair(&self, left: &AggregationNode, right: &AggregationNode) -> Result<Vec<u8>, AggregatorError> {
        // In a real implementation, this would use Pickles/Kimchi IVC
        // For now, we compute a commitment to the aggregation
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"ivc_aggregate_v1");
        hasher.update(&left.hash);
        hasher.update(&right.hash);
        if let Some(ref proof) = left.proof_data {
            hasher.update(proof);
        }
        if let Some(ref proof) = right.proof_data {
            hasher.update(proof);
        }
        
        Ok(hasher.finalize().as_bytes().to_vec())
    }
}

/// Status of a shard in the rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShardStatus {
    /// Shard ID.
    pub shard_id: usize,
    
    /// Number of tachystamps.
    pub tachystamp_count: u64,
    
    /// Nullifier root.
    pub nullifier_root: [u8; 32],
    
    /// Whether proof is generated.
    pub is_proof_generated: bool,
    
    /// Proof hash (if generated).
    pub proof_hash: Option<[u8; 32]>,
}

/// Main aggregator for the Mina Recursive Rail.
pub struct EpochAggregator {
    /// Configuration.
    config: MinaRailConfig,
    
    /// Shard assignments.
    _shard_assignments: Vec<ShardAssignment>,
    
    /// Per-shard aggregators.
    shards: Vec<Arc<RwLock<ShardAggregator>>>,
    
    /// Current epoch.
    current_epoch: u64,
    
    /// Current epoch state.
    current_state: EpochState,
    
    /// Historical epoch proofs.
    historical_proofs: HashMap<u64, EpochProof>,
    
    /// Tachystamp ID counter.
    tachystamp_counter: u64,
    
    /// Global nullifier set (epoch -> nullifiers).
    nullifier_set: HashMap<u64, std::collections::HashSet<[u8; 32]>>,
}

impl EpochAggregator {
    /// Create a new epoch aggregator.
    pub fn new(config: MinaRailConfig) -> Self {
        let shard_assignments = ShardAssignment::create_assignments(config.num_shards);
        
        let shards: Vec<_> = shard_assignments
            .iter()
            .enumerate()
            .map(|(i, assignment)| {
                Arc::new(RwLock::new(ShardAggregator::new(i, *assignment, 0)))
            })
            .collect();
        
        Self {
            config,
            _shard_assignments: shard_assignments,
            shards,
            current_epoch: 0,
            current_state: EpochState::genesis(),
            historical_proofs: HashMap::new(),
            tachystamp_counter: 0,
            nullifier_set: HashMap::new(),
        }
    }
    
    /// Get the current epoch.
    pub fn current_epoch(&self) -> u64 {
        self.current_epoch
    }
    
    /// Get the current epoch state.
    pub fn current_state(&self) -> &EpochState {
        &self.current_state
    }
    
    /// Get the config.
    pub fn config(&self) -> &MinaRailConfig {
        &self.config
    }
    
    /// Submit a tachystamp.
    pub fn submit_tachystamp(
        &mut self,
        submission: TachystampSubmission,
    ) -> Result<SubmitResult, AggregatorError> {
        // Generate ID
        self.tachystamp_counter += 1;
        let id = format!("ts-{}-{}", self.current_epoch, self.tachystamp_counter);
        
        // Determine shard
        let nullifier = parse_hex_32(&submission.nullifier)
            .map_err(|e| AggregatorError::Tachystamp(TachystampError::InvalidNullifier(e)))?;
        let shard_id = self.shard_for_nullifier(&nullifier);
        
        // Check for duplicate nullifier globally
        if let Some(nullifiers) = self.nullifier_set.get(&self.current_epoch) {
            if nullifiers.contains(&nullifier) {
                return Err(AggregatorError::Tachystamp(TachystampError::DuplicateNullifier));
            }
        }
        
        // Convert to tachystamp
        let tachystamp = submission.into_tachystamp(id.clone(), shard_id)?;
        tachystamp.validate()?;
        
        // Add to shard
        let shard = &self.shards[shard_id];
        let mut shard_guard = shard.write().unwrap();
        shard_guard.add_tachystamp(tachystamp)?;
        
        // Track nullifier globally
        self.nullifier_set
            .entry(self.current_epoch)
            .or_default()
            .insert(nullifier);
        
        // Update state
        self.current_state.tachystamp_count += 1;
        
        // Get queue position
        let queue_position = shard_guard.tachystamp_count();
        
        Ok(SubmitResult {
            success: true,
            tachystamp_id: id,
            shard_id,
            epoch: self.current_epoch,
            queue_position,
            error: None,
        })
    }
    
    /// Check if a nullifier is used in the current epoch.
    pub fn is_nullifier_used(&self, nullifier: &[u8; 32]) -> bool {
        if let Some(nullifiers) = self.nullifier_set.get(&self.current_epoch) {
            return nullifiers.contains(nullifier);
        }
        false
    }
    
    /// Get shard status.
    pub fn shard_statuses(&self) -> Vec<ShardStatus> {
        self.shards
            .iter()
            .map(|shard| {
                let guard = shard.read().unwrap();
                ShardStatus {
                    shard_id: guard.shard_id,
                    tachystamp_count: guard.tachystamp_count() as u64,
                    nullifier_root: guard.nullifier_root(),
                    is_proof_generated: guard.is_proven(),
                    proof_hash: guard.proof().map(|p| p.hash()),
                }
            })
            .collect()
    }
    
    /// Get total tachystamp count.
    pub fn total_tachystamp_count(&self) -> u64 {
        self.shards
            .iter()
            .map(|s| s.read().unwrap().tachystamp_count() as u64)
            .sum()
    }
    
    /// Get aggregation progress (0-100).
    pub fn aggregation_progress(&self) -> u8 {
        let proven = self.shards
            .iter()
            .filter(|s| s.read().unwrap().is_proven())
            .count();
        
        ((proven * 100) / self.shards.len()) as u8
    }
    
    /// Generate shard proof.
    pub fn generate_shard_proof(&self, shard_id: usize) -> Result<ShardProof, AggregatorError> {
        if shard_id >= self.shards.len() {
            return Err(AggregatorError::ShardNotFound(shard_id));
        }
        
        let mut shard = self.shards[shard_id].write().unwrap();
        shard.generate_proof()
    }
    
    /// Generate all shard proofs.
    pub fn generate_all_shard_proofs(&self) -> Result<Vec<ShardProof>, AggregatorError> {
        let mut proofs = Vec::new();
        
        for (i, shard) in self.shards.iter().enumerate() {
            let mut guard = shard.write().unwrap();
            if guard.tachystamp_count() > 0 && !guard.is_proven() {
                match guard.generate_proof() {
                    Ok(proof) => proofs.push(proof),
                    Err(e) => {
                        log::warn!("Failed to generate proof for shard {}: {}", i, e);
                    }
                }
            } else if guard.is_proven() {
                if let Some(proof) = guard.proof() {
                    proofs.push(proof.clone());
                }
            }
        }
        
        Ok(proofs)
    }
    
    /// Finalize the current epoch.
    pub fn finalize_epoch(&mut self, mina_slot: u64) -> Result<EpochProof, AggregatorError> {
        // Generate all shard proofs first
        let shard_proofs = self.generate_all_shard_proofs()?;
        
        // Aggregate shard proofs into epoch proof
        let epoch_proof = self.aggregate_epoch_proof(shard_proofs, mina_slot)?;
        
        // Store historical proof
        self.historical_proofs.insert(self.current_epoch, epoch_proof.clone());
        
        // Finalize each shard
        for shard in &self.shards {
            let mut guard = shard.write().unwrap();
            let _ = guard.finalize_epoch(mina_slot);
        }
        
        // Transition to next epoch
        self.current_state.end_slot = Some(mina_slot);
        self.current_state = self.current_state.next_epoch(mina_slot);
        self.current_epoch = self.current_state.epoch;
        
        Ok(epoch_proof)
    }
    
    /// Get historical epoch proof.
    pub fn get_epoch_proof(&self, epoch: u64) -> Option<&EpochProof> {
        self.historical_proofs.get(&epoch)
    }
    
    /// Get epoch state.
    pub fn get_epoch_state(&self, epoch: u64) -> Option<EpochState> {
        if epoch == self.current_epoch {
            return Some(self.current_state.clone());
        }
        
        // Reconstruct historical state from proof
        self.historical_proofs.get(&epoch).map(|proof| {
            EpochState {
                epoch,
                start_slot: 0,
                end_slot: Some(proof.mina_slot),
                nullifier_root: proof.nullifier_root,
                tachystamp_count: proof.proof_count,
                holder_count: 0,
                accumulator_hash: proof.post_state_hash,
                previous_epoch_hash: proof.pre_state_hash,
            }
        })
    }
    
    /// Get latest finalized epoch.
    pub fn latest_finalized_epoch(&self) -> Option<u64> {
        self.historical_proofs.keys().max().copied()
    }
    
    fn shard_for_nullifier(&self, nullifier: &[u8; 32]) -> usize {
        let prefix = nullifier[0] as usize;
        (prefix * self.config.num_shards) / 256
    }
    
    fn aggregate_epoch_proof(
        &self,
        shard_proofs: Vec<ShardProof>,
        mina_slot: u64,
    ) -> Result<EpochProof, AggregatorError> {
        // Compute combined nullifier root from shard roots
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"epoch_nullifier_root_v1");
        for proof in &shard_proofs {
            hasher.update(&proof.nullifier_root);
        }
        let nullifier_root = *hasher.finalize().as_bytes();
        
        // Compute shard commitment
        let mut shard_hasher = blake3::Hasher::new();
        shard_hasher.update(b"shard_commitment_v1");
        for proof in &shard_proofs {
            shard_hasher.update(&proof.hash());
        }
        let shard_commitment = *shard_hasher.finalize().as_bytes();
        
        // Aggregate proofs using IVC tree
        let proof_count: u64 = shard_proofs.iter().map(|p| p.nullifier_count).sum();
        
        // Build aggregated IVC proof
        let aggregated_proof = self.aggregate_shard_proofs(&shard_proofs)?;
        
        // Compute pre/post state hashes
        let pre_state_hash = self.current_state.previous_epoch_hash;
        let post_state_hash = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"post_state_v1");
            hasher.update(&self.current_epoch.to_le_bytes());
            hasher.update(&nullifier_root);
            hasher.update(&proof_count.to_le_bytes());
            *hasher.finalize().as_bytes()
        };
        
        // Create mock Mina anchor
        let mina_anchor_hash = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"mina_anchor_v1");
            hasher.update(&self.current_epoch.to_le_bytes());
            hasher.update(&mina_slot.to_le_bytes());
            *hasher.finalize().as_bytes()
        };
        
        Ok(EpochProof {
            epoch: self.current_epoch,
            pre_state_hash,
            post_state_hash,
            nullifier_root,
            proof_count,
            ivc_proof: aggregated_proof,
            shard_commitment,
            mina_anchor_hash,
            mina_slot,
        })
    }
    
    fn aggregate_shard_proofs(&self, proofs: &[ShardProof]) -> Result<IVCProofData, AggregatorError> {
        // Use real IVC aggregation when available
        #[cfg(feature = "ivc")]
        {
            return crate::ivc::aggregate_shard_proofs_ivc(proofs, self.current_epoch)
                .map_err(|e| AggregatorError::IVCProofFailed(e.to_string()));
        }
        
        // Fallback: Build aggregation tree from shard proofs
        #[cfg(not(feature = "ivc"))]
        {
            let leaves: Vec<AggregationNode> = proofs
                .iter()
                .enumerate()
                .map(|(i, p)| AggregationNode::leaf(i, p.hash(), p.proof_bytes.clone()))
                .collect();
            
            // Aggregate bottom-up
            let root = if leaves.is_empty() {
                // Empty epoch
                return Ok(IVCProofData {
                    proof_bytes: Vec::new(),
                    public_inputs: Vec::new(),
                    challenges: Vec::new(),
                    accumulator_commitment: [0u8; 64],
                });
            } else {
                self.aggregate_proof_tree(leaves)?
            };
            
            // Extract IVC proof data
            let mut accumulator = [0u8; 64];
            accumulator[..32].copy_from_slice(&root.hash);
            
            Ok(IVCProofData {
                proof_bytes: root.proof_data.unwrap_or_default(),
                public_inputs: proofs.iter().map(|p| p.nullifier_root).collect(),
                challenges: Vec::new(),
                accumulator_commitment: accumulator,
            })
        }
    }
    
    fn aggregate_proof_tree(&self, mut nodes: Vec<AggregationNode>) -> Result<AggregationNode, AggregatorError> {
        if nodes.is_empty() {
            return Err(AggregatorError::NotEnoughProofs);
        }
        
        // Pad to power of 2
        while nodes.len().count_ones() != 1 || nodes.len() < 2 {
            let index = nodes.len();
            nodes.push(AggregationNode::leaf(index, [0u8; 32], Vec::new()));
            if nodes.len() >= 256 {
                break;
            }
        }
        
        let mut depth = 0;
        while nodes.len() > 1 {
            depth += 1;
            let mut next_level = Vec::new();
            
            for (i, chunk) in nodes.chunks(2).enumerate() {
                let left = &chunk[0];
                let right = chunk.get(1).unwrap_or(left);
                
                // IVC folding
                let folded_proof = {
                    let mut hasher = blake3::Hasher::new();
                    hasher.update(b"ivc_fold_v1");
                    hasher.update(&left.hash);
                    hasher.update(&right.hash);
                    if let Some(ref proof) = left.proof_data {
                        hasher.update(proof);
                    }
                    if let Some(ref proof) = right.proof_data {
                        hasher.update(proof);
                    }
                    hasher.finalize().as_bytes().to_vec()
                };
                
                next_level.push(AggregationNode::internal(depth, i, left, right, folded_proof));
            }
            
            nodes = next_level;
        }
        
        Ok(nodes.into_iter().next().unwrap())
    }
}

/// Result of submitting a tachystamp.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubmitResult {
    pub success: bool,
    pub tachystamp_id: String,
    pub shard_id: usize,
    pub epoch: u64,
    pub queue_position: usize,
    pub error: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;
    
    fn make_submission(nullifier_prefix: u8) -> TachystampSubmission {
        let mut nullifier = [0u8; 32];
        nullifier[0] = nullifier_prefix;
        nullifier[1] = rand::random();
        
        TachystampSubmission {
            epoch: 0,
            nullifier: format!("0x{}", hex::encode(nullifier)),
            holder_commitment: format!("0x{}", hex::encode([1u8; 32])),
            policy_id: 1,
            threshold: 1_000_000,
            currency_code: 0x5A4543,
            proof_bytes: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, [1, 2, 3, 4]),
            public_inputs: vec![format!("0x{}", hex::encode([2u8; 32]))],
            vk_hash: format!("0x{}", hex::encode([3u8; 32])),
            l1_block_height: 1000,
            l1_tx_hash: format!("0x{}", hex::encode([4u8; 32])),
        }
    }
    
    #[test]
    fn test_epoch_aggregator() {
        let config = MinaRailConfig::default();
        let aggregator = EpochAggregator::new(config);
        
        assert_eq!(aggregator.current_epoch(), 0);
        assert_eq!(aggregator.total_tachystamp_count(), 0);
    }
    
    #[test]
    fn test_submit_tachystamp() {
        let config = MinaRailConfig {
            num_shards: 4,
            ..Default::default()
        };
        let mut aggregator = EpochAggregator::new(config);
        
        let submission = make_submission(100);
        let result = aggregator.submit_tachystamp(submission).unwrap();
        
        assert!(result.success);
        assert_eq!(result.epoch, 0);
        assert_eq!(aggregator.total_tachystamp_count(), 1);
    }
    
    #[test]
    fn test_duplicate_nullifier() {
        let config = MinaRailConfig {
            num_shards: 4,
            ..Default::default()
        };
        let mut aggregator = EpochAggregator::new(config);
        
        let submission = make_submission(100);
        aggregator.submit_tachystamp(submission.clone()).unwrap();
        
        // Duplicate should fail
        let result = aggregator.submit_tachystamp(submission);
        assert!(matches!(result, Err(AggregatorError::Tachystamp(TachystampError::DuplicateNullifier))));
    }
}
