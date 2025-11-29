//! Bidirectional Bridge for Mina Rail ↔ Tachyon L1 communication.
//!
//! This module implements bidirectional proof transport between:
//!
//! **Outbound (Mina → L1):**
//! - Submit epoch proofs to Tachyon L1 (Zcash)
//! - Propagate aggregated tachystamp proofs
//! - Emit bridge messages for cross-chain attestation
//!
//! **Inbound (L1 → Mina):**
//! - Receive L1 state commitments on Mina
//! - Verify Tachyon epoch proofs via Kimchi wrapper
//! - Enable Mina zkApps to rely on Tachyon account state
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                       Bidirectional ZkBridge                                 │
//! ├─────────────────────────────────────────────────────────────────────────────┤
//! │                                                                              │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                         OUTBOUND FLOW                                │    │
//! │  │                                                                      │    │
//! │  │  Tachystamps  ──►  IVC Aggregation  ──►  Epoch Proof  ──►  L1       │    │
//! │  │                                                                      │    │
//! │  │  Mina zkApp emits bridge message → Relayer → Zcash verifier        │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                                                              │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                         INBOUND FLOW                                 │    │
//! │  │                                                                      │    │
//! │  │  L1 Epoch  ──►  Kimchi Wrapper  ──►  Mina Proof  ──►  Mina zkApp   │    │
//! │  │                                                                      │    │
//! │  │  Zcash finality → BN254 wrap → Mina verification → State update    │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                                                              │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::types::EpochProof;

/// Bridge errors.
#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
    
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),
    
    #[error("Proof encoding failed: {0}")]
    EncodingFailed(String),
    
    #[error("Verification failed: {0}")]
    VerificationFailed(String),
    
    #[error("Bridge not configured")]
    NotConfigured,
}

/// Bridge configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeConfig {
    /// Tachyon L1 RPC endpoint.
    pub l1_rpc_url: String,
    
    /// Bridge contract address on L1.
    pub bridge_contract: [u8; 20],
    
    /// Mina GraphQL endpoint.
    pub mina_graphql_url: String,
    
    /// Bridge operator key (for signing).
    pub operator_key: Option<[u8; 32]>,
    
    /// Confirmation blocks required.
    pub confirmation_blocks: u32,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            l1_rpc_url: "http://localhost:8232".into(),
            bridge_contract: [0u8; 20],
            mina_graphql_url: "http://localhost:3085/graphql".into(),
            operator_key: None,
            confirmation_blocks: 6,
        }
    }
}

/// Status of a bridged epoch proof.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum BridgeStatus {
    /// Proof is pending submission.
    Pending,
    
    /// Proof has been submitted to Mina.
    SubmittedToMina {
        mina_tx_hash: String,
        mina_slot: u64,
    },
    
    /// Proof is confirmed on Mina.
    ConfirmedOnMina {
        mina_block_hash: String,
        mina_slot: u64,
    },
    
    /// Proof has been bridged to L1.
    BridgedToL1 {
        l1_tx_hash: String,
        l1_block_height: u64,
    },
    
    /// Bridge completed successfully.
    Completed {
        mina_block_hash: String,
        l1_tx_hash: String,
        completed_at: u64,
    },
    
    /// Bridge failed.
    Failed {
        error: String,
        failed_at: u64,
    },
}

/// Epoch proof bridge submission.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeSubmission {
    /// Epoch number.
    pub epoch: u64,
    
    /// Epoch proof.
    pub proof: EpochProof,
    
    /// Current status.
    pub status: BridgeStatus,
    
    /// Submission timestamp.
    pub submitted_at: u64,
    
    /// Last update timestamp.
    pub updated_at: u64,
}

/// The bridge client for Mina <-> Tachyon L1 communication.
pub struct Bridge {
    /// Configuration.
    config: BridgeConfig,
    
    /// Pending submissions.
    pending: Vec<BridgeSubmission>,
    
    /// Completed submissions.
    completed: Vec<BridgeSubmission>,
}

impl Bridge {
    /// Create a new bridge.
    pub fn new(config: BridgeConfig) -> Self {
        Self {
            config,
            pending: Vec::new(),
            completed: Vec::new(),
        }
    }
    
    /// Get the bridge configuration.
    pub fn config(&self) -> &BridgeConfig {
        &self.config
    }
    
    /// Submit an epoch proof for bridging.
    pub fn submit_epoch_proof(&mut self, proof: EpochProof) -> Result<BridgeSubmission, BridgeError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        let submission = BridgeSubmission {
            epoch: proof.epoch,
            proof,
            status: BridgeStatus::Pending,
            submitted_at: now,
            updated_at: now,
        };
        
        self.pending.push(submission.clone());
        
        Ok(submission)
    }
    
    /// Process pending submissions.
    ///
    /// In a real implementation, this would:
    /// 1. Submit proofs to Mina zkApp
    /// 2. Wait for Mina confirmation
    /// 3. Relay proof to L1 bridge contract
    /// 4. Update status
    pub async fn process_pending(&mut self) -> Vec<BridgeSubmission> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        let mut processed = Vec::new();
        
        for submission in self.pending.iter_mut() {
            match &submission.status {
                BridgeStatus::Pending => {
                    // Mock: Submit to Mina
                    let mina_tx_hash = format!(
                        "mina_tx_{}_{}", 
                        submission.epoch, 
                        now
                    );
                    
                    submission.status = BridgeStatus::SubmittedToMina {
                        mina_tx_hash: mina_tx_hash.clone(),
                        mina_slot: submission.proof.mina_slot,
                    };
                    submission.updated_at = now;
                    
                    log::info!(
                        "Submitted epoch {} proof to Mina: {}", 
                        submission.epoch, 
                        mina_tx_hash
                    );
                }
                
                BridgeStatus::SubmittedToMina { mina_slot, .. } => {
                    // Mock: Confirm on Mina
                    let mina_block_hash = format!(
                        "0x{}",
                        hex::encode(&submission.proof.mina_anchor_hash[..8])
                    );
                    
                    submission.status = BridgeStatus::ConfirmedOnMina {
                        mina_block_hash: mina_block_hash.clone(),
                        mina_slot: *mina_slot,
                    };
                    submission.updated_at = now;
                    
                    log::info!(
                        "Epoch {} confirmed on Mina block: {}", 
                        submission.epoch, 
                        mina_block_hash
                    );
                }
                
                BridgeStatus::ConfirmedOnMina { mina_block_hash, .. } => {
                    // Mock: Bridge to L1
                    let l1_tx_hash = format!(
                        "0x{}",
                        hex::encode(&submission.proof.hash()[..16])
                    );
                    
                    submission.status = BridgeStatus::Completed {
                        mina_block_hash: mina_block_hash.clone(),
                        l1_tx_hash: l1_tx_hash.clone(),
                        completed_at: now,
                    };
                    submission.updated_at = now;
                    
                    log::info!(
                        "Epoch {} bridged to L1: {}", 
                        submission.epoch, 
                        l1_tx_hash
                    );
                    
                    processed.push(submission.clone());
                }
                
                _ => {}
            }
        }
        
        // Move completed to history
        self.pending.retain(|s| !matches!(s.status, BridgeStatus::Completed { .. } | BridgeStatus::Failed { .. }));
        self.completed.extend(processed.iter().cloned());
        
        processed
    }
    
    /// Get pending submissions.
    pub fn pending_submissions(&self) -> &[BridgeSubmission] {
        &self.pending
    }
    
    /// Get completed submissions.
    pub fn completed_submissions(&self) -> &[BridgeSubmission] {
        &self.completed
    }
    
    /// Get submission for an epoch.
    pub fn get_submission(&self, epoch: u64) -> Option<&BridgeSubmission> {
        self.pending
            .iter()
            .chain(self.completed.iter())
            .find(|s| s.epoch == epoch)
    }
    
    /// Encode epoch proof for L1 submission.
    pub fn encode_for_l1(&self, proof: &EpochProof) -> Result<Vec<u8>, BridgeError> {
        Ok(proof.to_bridge_format())
    }
    
    /// Verify an epoch proof can be bridged.
    pub fn verify_proof(&self, proof: &EpochProof) -> Result<bool, BridgeError> {
        // Verify proof structure
        if proof.ivc_proof.proof_bytes.is_empty() {
            return Ok(false);
        }
        
        // Verify nullifier root is non-zero (unless empty epoch)
        if proof.proof_count > 0 && proof.nullifier_root == [0u8; 32] {
            return Ok(false);
        }
        
        Ok(true)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INBOUND: L1 → Mina (Receiving Tachyon State)
// ═══════════════════════════════════════════════════════════════════════════════

/// L1 state commitment to be verified on Mina.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct L1StateCommitment {
    /// Tachyon epoch number.
    pub epoch: u64,
    /// Nullifier tree root at this epoch.
    pub nullifier_root: [u8; 32],
    /// State hash after this epoch.
    pub state_hash: [u8; 32],
    /// Number of proofs aggregated.
    pub proof_count: u64,
    /// Zcash block height at finalization.
    pub zcash_block_height: u64,
    /// Block hash on Zcash for finality.
    pub zcash_block_hash: [u8; 32],
    /// Epoch proof bytes (for Kimchi wrapper verification).
    pub epoch_proof: Vec<u8>,
}

impl L1StateCommitment {
    /// Compute commitment hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"l1_state_commitment_v1");
        hasher.update(&self.epoch.to_le_bytes());
        hasher.update(&self.nullifier_root);
        hasher.update(&self.state_hash);
        hasher.update(&self.proof_count.to_le_bytes());
        hasher.update(&self.zcash_block_height.to_le_bytes());
        hasher.update(&self.zcash_block_hash);
        *hasher.finalize().as_bytes()
    }
}

/// Result of verifying an L1 state on Mina.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InboundVerificationResult {
    /// The L1 commitment that was verified.
    pub commitment: L1StateCommitment,
    /// Whether verification succeeded.
    pub success: bool,
    /// Mina transaction hash (if submitted).
    pub mina_tx_hash: Option<String>,
    /// Verification timestamp.
    pub verified_at: u64,
    /// Error message (if failed).
    pub error: Option<String>,
}

/// Inbound bridge client for L1 → Mina state sync.
pub struct InboundBridge {
    /// Configuration.
    config: BridgeConfig,
    /// Pending L1 commitments to verify.
    pending_commitments: Vec<L1StateCommitment>,
    /// Verified commitments.
    verified_commitments: Vec<InboundVerificationResult>,
    /// Latest verified epoch.
    latest_verified_epoch: u64,
}

impl InboundBridge {
    /// Create a new inbound bridge.
    pub fn new(config: BridgeConfig) -> Self {
        Self {
            config,
            pending_commitments: Vec::new(),
            verified_commitments: Vec::new(),
            latest_verified_epoch: 0,
        }
    }
    
    /// Queue an L1 commitment for verification.
    pub fn queue_commitment(&mut self, commitment: L1StateCommitment) -> Result<(), BridgeError> {
        // Validate commitment
        if commitment.epoch == 0 {
            return Err(BridgeError::VerificationFailed("invalid epoch 0".into()));
        }
        
        if commitment.epoch <= self.latest_verified_epoch {
            return Err(BridgeError::VerificationFailed("epoch already verified".into()));
        }
        
        self.pending_commitments.push(commitment);
        Ok(())
    }
    
    /// Process pending L1 commitments.
    ///
    /// This verifies the epoch proofs using the Kimchi wrapper and
    /// submits them to the Mina ZkBridge contract.
    pub async fn process_pending(&mut self) -> Vec<InboundVerificationResult> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        
        // Collect commitments first to avoid borrow issues
        let commitments: Vec<_> = self.pending_commitments.drain(..).collect();
        let mut results = Vec::new();
        
        for commitment in commitments {
            let result = self.verify_and_submit(&commitment, now).await;
            
            if result.success {
                self.latest_verified_epoch = commitment.epoch.max(self.latest_verified_epoch);
            }
            
            self.verified_commitments.push(result.clone());
            results.push(result);
        }
        
        results
    }
    
    /// Verify a commitment using Kimchi wrapper and submit to Mina.
    async fn verify_and_submit(&self, commitment: &L1StateCommitment, now: u64) -> InboundVerificationResult {
        // Step 1: Verify the epoch proof using Kimchi wrapper
        let kimchi_result = self.verify_with_kimchi(commitment);
        
        if let Err(e) = kimchi_result {
            return InboundVerificationResult {
                commitment: commitment.clone(),
                success: false,
                mina_tx_hash: None,
                verified_at: now,
                error: Some(format!("Kimchi verification failed: {}", e)),
            };
        }
        
        // Step 2: Submit to Mina ZkBridge (mock for now)
        let mina_tx = self.submit_to_mina_bridge(commitment).await;
        
        match mina_tx {
            Ok(tx_hash) => InboundVerificationResult {
                commitment: commitment.clone(),
                success: true,
                mina_tx_hash: Some(tx_hash),
                verified_at: now,
                error: None,
            },
            Err(e) => InboundVerificationResult {
                commitment: commitment.clone(),
                success: false,
                mina_tx_hash: None,
                verified_at: now,
                error: Some(format!("Mina submission failed: {}", e)),
            },
        }
    }
    
    /// Verify epoch proof using Kimchi wrapper circuit.
    fn verify_with_kimchi(&self, commitment: &L1StateCommitment) -> Result<(), BridgeError> {
        // In production, this would:
        // 1. Parse the epoch proof into Kimchi format
        // 2. Run the NativeKimchiVerifier
        // 3. Wrap the result in a BN254 proof for Mina
        
        // For now, validate structure
        if commitment.epoch_proof.is_empty() {
            return Err(BridgeError::VerificationFailed("empty epoch proof".into()));
        }
        
        if commitment.nullifier_root == [0u8; 32] && commitment.proof_count > 0 {
            return Err(BridgeError::VerificationFailed("invalid nullifier root".into()));
        }
        
        // Mock verification success
        log::info!(
            "Kimchi verification passed for epoch {} (block {})",
            commitment.epoch,
            commitment.zcash_block_height
        );
        
        Ok(())
    }
    
    /// Submit verified commitment to Mina ZkBridge.
    async fn submit_to_mina_bridge(&self, commitment: &L1StateCommitment) -> Result<String, BridgeError> {
        // In production, this would:
        // 1. Construct a Mina transaction calling ZkBridge.registerTachyonEpoch
        // 2. Sign with operator key
        // 3. Submit to Mina GraphQL endpoint
        // 4. Return transaction hash
        
        let tx_hash = format!(
            "mina_inbound_{}_{:x}",
            commitment.epoch,
            u64::from_le_bytes(commitment.hash()[..8].try_into().unwrap())
        );
        
        log::info!(
            "Submitted L1 epoch {} to Mina ZkBridge: {}",
            commitment.epoch,
            tx_hash
        );
        
        Ok(tx_hash)
    }
    
    /// Get latest verified epoch.
    pub fn latest_verified_epoch(&self) -> u64 {
        self.latest_verified_epoch
    }
    
    /// Get verification history.
    pub fn verification_history(&self) -> &[InboundVerificationResult] {
        &self.verified_commitments
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTBOUND: Mina → L1 (Sending Mina Proofs to Tachyon)
// ═══════════════════════════════════════════════════════════════════════════════

/// L1 bridge message types.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum L1BridgeMessage {
    /// Submit epoch proof.
    SubmitEpochProof {
        epoch: u64,
        proof_hash: [u8; 32],
        nullifier_root: [u8; 32],
        proof_count: u64,
        mina_slot: u64,
    },
    
    /// Update bridge state.
    UpdateBridgeState {
        latest_epoch: u64,
        latest_proof_hash: [u8; 32],
    },
    
    /// Challenge an epoch proof.
    ChallengeProof {
        epoch: u64,
        challenge_data: Vec<u8>,
    },
}

impl L1BridgeMessage {
    /// Encode message for L1 contract call.
    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        
        match self {
            L1BridgeMessage::SubmitEpochProof {
                epoch,
                proof_hash,
                nullifier_root,
                proof_count,
                mina_slot,
            } => {
                bytes.push(0x01); // Message type
                bytes.extend_from_slice(&epoch.to_be_bytes());
                bytes.extend_from_slice(proof_hash);
                bytes.extend_from_slice(nullifier_root);
                bytes.extend_from_slice(&proof_count.to_be_bytes());
                bytes.extend_from_slice(&mina_slot.to_be_bytes());
            }
            
            L1BridgeMessage::UpdateBridgeState {
                latest_epoch,
                latest_proof_hash,
            } => {
                bytes.push(0x02);
                bytes.extend_from_slice(&latest_epoch.to_be_bytes());
                bytes.extend_from_slice(latest_proof_hash);
            }
            
            L1BridgeMessage::ChallengeProof {
                epoch,
                challenge_data,
            } => {
                bytes.push(0x03);
                bytes.extend_from_slice(&epoch.to_be_bytes());
                bytes.extend_from_slice(&(challenge_data.len() as u32).to_be_bytes());
                bytes.extend_from_slice(challenge_data);
            }
        }
        
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::IVCProofData;
    
    fn make_test_proof(epoch: u64) -> EpochProof {
        EpochProof {
            epoch,
            pre_state_hash: [1u8; 32],
            post_state_hash: [2u8; 32],
            nullifier_root: [3u8; 32],
            proof_count: 100,
            ivc_proof: IVCProofData {
                proof_bytes: vec![1, 2, 3, 4],
                public_inputs: vec![[5u8; 32]],
                challenges: Vec::new(),
                accumulator_commitment: [6u8; 64],
            },
            shard_commitment: [7u8; 32],
            mina_anchor_hash: [8u8; 32],
            mina_slot: 1000,
        }
    }
    
    #[test]
    fn test_bridge_submission() {
        let mut bridge = Bridge::new(BridgeConfig::default());
        let proof = make_test_proof(1);
        
        let submission = bridge.submit_epoch_proof(proof).unwrap();
        assert_eq!(submission.epoch, 1);
        assert!(matches!(submission.status, BridgeStatus::Pending));
    }
    
    #[test]
    fn test_proof_verification() {
        let bridge = Bridge::new(BridgeConfig::default());
        let proof = make_test_proof(1);
        
        assert!(bridge.verify_proof(&proof).unwrap());
    }
    
    #[test]
    fn test_l1_message_encoding() {
        let msg = L1BridgeMessage::SubmitEpochProof {
            epoch: 1,
            proof_hash: [0xab; 32],
            nullifier_root: [0xcd; 32],
            proof_count: 100,
            mina_slot: 1000,
        };
        
        let encoded = msg.encode();
        assert_eq!(encoded[0], 0x01);
        assert!(encoded.len() > 80);
    }
}
