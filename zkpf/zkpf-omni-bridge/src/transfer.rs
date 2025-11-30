//! Transfer operations for Omni Bridge.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{BridgeResult, OmniBridgeError};
use crate::types::{BridgeAddress, BridgeAsset, BridgeChainId, BridgeFee, TransferDirection, TransferMetadata};

/// Request to initiate a bridge transfer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferRequest {
    /// Source chain.
    pub source_chain: BridgeChainId,
    /// Destination chain.
    pub destination_chain: BridgeChainId,
    /// Sender address.
    pub sender: BridgeAddress,
    /// Recipient address.
    pub recipient: BridgeAddress,
    /// Asset to transfer.
    pub asset: BridgeAsset,
    /// Amount to transfer (in smallest unit).
    pub amount: u128,
    /// Optional memo/message.
    pub memo: Option<String>,
    /// Deadline timestamp (Unix seconds).
    pub deadline: Option<u64>,
    /// Whether to use fast mode (higher fees, faster finality).
    pub fast_mode: bool,
}

impl TransferRequest {
    /// Create a new transfer request.
    pub fn new(
        source_chain: BridgeChainId,
        destination_chain: BridgeChainId,
        sender: BridgeAddress,
        recipient: BridgeAddress,
        asset: BridgeAsset,
        amount: u128,
    ) -> Self {
        Self {
            source_chain,
            destination_chain,
            sender,
            recipient,
            asset,
            amount,
            memo: None,
            deadline: None,
            fast_mode: false,
        }
    }

    /// Set the memo.
    pub fn with_memo(mut self, memo: impl Into<String>) -> Self {
        self.memo = Some(memo.into());
        self
    }

    /// Set the deadline.
    pub fn with_deadline(mut self, deadline: u64) -> Self {
        self.deadline = Some(deadline);
        self
    }

    /// Enable fast mode.
    pub fn with_fast_mode(mut self) -> Self {
        self.fast_mode = true;
        self
    }

    /// Compute a unique transfer ID.
    pub fn compute_id(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"omni_transfer_v1");
        hasher.update(self.source_chain.as_u64().to_be_bytes());
        hasher.update(self.destination_chain.as_u64().to_be_bytes());
        hasher.update(self.sender.as_str().as_bytes());
        hasher.update(self.recipient.as_str().as_bytes());
        hasher.update(self.asset.symbol().as_bytes());
        hasher.update(self.amount.to_be_bytes());
        
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        hasher.update(now.to_be_bytes());
        
        let result = hasher.finalize();
        let mut id = [0u8; 32];
        id.copy_from_slice(&result);
        id
    }

    /// Validate the transfer request.
    pub fn validate(&self) -> BridgeResult<()> {
        // Check source and destination are different
        if self.source_chain == self.destination_chain {
            return Err(OmniBridgeError::Config(
                "Source and destination chains must be different".into(),
            ));
        }

        // Validate sender address for source chain
        if !self.sender.is_valid_for_chain(&self.source_chain) {
            return Err(OmniBridgeError::InvalidAddress(format!(
                "Sender address {} not valid for {}",
                self.sender, self.source_chain
            )));
        }

        // Validate recipient address for destination chain
        if !self.recipient.is_valid_for_chain(&self.destination_chain) {
            return Err(OmniBridgeError::InvalidAddress(format!(
                "Recipient address {} not valid for {}",
                self.recipient, self.destination_chain
            )));
        }

        // Check amount is non-zero
        if self.amount == 0 {
            return Err(OmniBridgeError::InsufficientBalance { have: 0, need: 1 });
        }

        // Check deadline is in the future
        if let Some(deadline) = self.deadline {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            if deadline <= now {
                return Err(OmniBridgeError::Config("Deadline must be in the future".into()));
            }
        }

        Ok(())
    }

    /// Determine the transfer direction.
    pub fn direction(&self) -> TransferDirection {
        // NEAR is typically the hub, so:
        // - Transfers TO NEAR: Lock on source, mint on NEAR
        // - Transfers FROM NEAR: Burn on NEAR, unlock on destination
        match (&self.source_chain, &self.destination_chain) {
            (BridgeChainId::NearMainnet | BridgeChainId::NearTestnet, _) => {
                TransferDirection::BurnAndUnlock
            }
            (_, BridgeChainId::NearMainnet | BridgeChainId::NearTestnet) => {
                TransferDirection::LockAndMint
            }
            // For non-NEAR to non-NEAR, typically goes through NEAR as hub
            _ => TransferDirection::LockAndMint,
        }
    }
}

/// Result of a bridge transfer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferResult {
    /// Transfer ID.
    pub transfer_id: [u8; 32],
    /// Current status.
    pub status: TransferStatus,
    /// Transfer metadata.
    pub metadata: TransferMetadata,
    /// Estimated fees.
    pub estimated_fee: Option<BridgeFee>,
    /// Actual fees (after completion).
    pub actual_fee: Option<BridgeFee>,
    /// Error message if failed.
    pub error: Option<String>,
    /// Estimated completion time (Unix seconds).
    pub estimated_completion: Option<u64>,
}

impl TransferResult {
    /// Create a pending transfer result.
    pub fn pending(request: &TransferRequest) -> Self {
        let transfer_id = request.compute_id();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            transfer_id,
            status: TransferStatus::Pending,
            metadata: TransferMetadata {
                transfer_id,
                source_chain: request.source_chain.clone(),
                destination_chain: request.destination_chain.clone(),
                sender: request.sender.clone(),
                recipient: request.recipient.clone(),
                asset: request.asset.clone(),
                amount: request.amount,
                direction: request.direction(),
                created_at: now,
                completed_at: None,
                source_tx_hash: None,
                destination_tx_hash: None,
                wormhole_vaa: None,
            },
            estimated_fee: None,
            actual_fee: None,
            error: None,
            estimated_completion: None,
        }
    }

    /// Check if the transfer is complete.
    pub fn is_complete(&self) -> bool {
        matches!(self.status, TransferStatus::Completed)
    }

    /// Check if the transfer failed.
    pub fn is_failed(&self) -> bool {
        matches!(self.status, TransferStatus::Failed)
    }

    /// Update with source transaction.
    pub fn with_source_tx(mut self, tx_hash: String) -> Self {
        self.metadata.source_tx_hash = Some(tx_hash);
        self.status = TransferStatus::SourceConfirmed;
        self
    }

    /// Update with destination transaction.
    pub fn with_destination_tx(mut self, tx_hash: String) -> Self {
        self.metadata.destination_tx_hash = Some(tx_hash);
        self.status = TransferStatus::Completed;
        self.metadata.completed_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        );
        self
    }

    /// Mark as failed.
    pub fn with_error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self.status = TransferStatus::Failed;
        self
    }
}

/// Status of a bridge transfer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferStatus {
    /// Transfer is pending initiation.
    Pending,
    /// Source transaction submitted.
    SourceSubmitted,
    /// Source transaction confirmed.
    SourceConfirmed,
    /// Waiting for finality on source chain.
    WaitingFinality,
    /// Proof/VAA generated.
    ProofGenerated,
    /// Destination transaction submitted.
    DestinationSubmitted,
    /// Transfer completed successfully.
    Completed,
    /// Transfer failed.
    Failed,
    /// Transfer expired (deadline passed).
    Expired,
    /// Transfer refunded.
    Refunded,
}

impl TransferStatus {
    /// Get a human-readable description.
    pub fn description(&self) -> &str {
        match self {
            Self::Pending => "Pending initiation",
            Self::SourceSubmitted => "Source transaction submitted",
            Self::SourceConfirmed => "Source transaction confirmed",
            Self::WaitingFinality => "Waiting for finality",
            Self::ProofGenerated => "Cross-chain proof generated",
            Self::DestinationSubmitted => "Destination transaction submitted",
            Self::Completed => "Transfer completed",
            Self::Failed => "Transfer failed",
            Self::Expired => "Transfer expired",
            Self::Refunded => "Transfer refunded",
        }
    }

    /// Check if this is a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Expired | Self::Refunded
        )
    }
}

