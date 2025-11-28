//! State management for the Tachyon wallet.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::rails::RailId;
use crate::types::{ChainId, CurrencyCode, Epoch, WalletId};

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED BALANCE
// ═══════════════════════════════════════════════════════════════════════════════

/// Unified balance view across all chains and rails.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct UnifiedBalance {
    /// Per-currency totals across all chains.
    pub totals: HashMap<CurrencyCode, CurrencyBalance>,
    /// Per-chain breakdown.
    pub chains: HashMap<ChainId, ChainBalance>,
    /// Last update timestamp.
    pub last_updated: u64,
}

impl UnifiedBalance {
    /// Get the total balance for a specific currency across all chains.
    pub fn total_for(&self, currency: CurrencyCode) -> u128 {
        self.totals.get(&currency).map(|b| b.total).unwrap_or(0)
    }

    /// Get the spendable balance for a specific currency across all chains.
    pub fn spendable_for(&self, currency: CurrencyCode) -> u128 {
        self.totals.get(&currency).map(|b| b.spendable).unwrap_or(0)
    }

    /// Check if sufficient funds are available for a given threshold.
    pub fn has_sufficient(&self, currency: CurrencyCode, threshold: u128) -> bool {
        self.total_for(currency) >= threshold
    }
}

/// Currency balance across chains.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CurrencyBalance {
    /// Total balance.
    pub total: u128,
    /// Spendable balance (confirmed, unlocked).
    pub spendable: u128,
    /// Pending balance (unconfirmed).
    pub pending: u128,
}

/// Balance on a specific chain.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ChainBalance {
    /// Total balance.
    pub total: u128,
    /// Spendable balance.
    pub spendable: u128,
    /// Pending balance.
    pub pending: u128,
    /// Currency for this balance.
    pub currency: CurrencyCode,
    /// Block height at which balance was computed.
    pub block_height: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// State of proofs in the wallet.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProofState {
    /// Recent proofs generated, keyed by proof hash.
    pub recent_proofs: Vec<ProofRecord>,
    /// Pending attestations waiting for confirmation.
    pub pending_attestations: Vec<PendingAttestation>,
    /// Last successful proof per policy.
    pub last_proof_per_policy: HashMap<u64, ProofRecord>,
}

/// Record of a generated proof.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofRecord {
    /// Hash of the proof bundle.
    pub proof_hash: [u8; 32],
    /// Rail that generated the proof.
    pub rail_id: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Epoch at generation.
    pub epoch: u64,
    /// Generation timestamp.
    pub generated_at: u64,
    /// Expiration timestamp.
    pub expires_at: u64,
    /// Whether the proof was verified.
    pub verified: bool,
    /// Target chains for cross-chain attestation.
    pub target_chains: Vec<String>,
}

/// Pending cross-chain attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingAttestation {
    /// Attestation ID.
    pub attestation_id: [u8; 32],
    /// Source chain.
    pub source_chain: String,
    /// Target chain.
    pub target_chain: String,
    /// Axelar transaction hash (if applicable).
    pub axelar_tx_hash: Option<String>,
    /// Status.
    pub status: AttestationStatus,
    /// Created timestamp.
    pub created_at: u64,
}

/// Status of a cross-chain attestation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttestationStatus {
    /// Attestation is pending relay.
    Pending,
    /// Attestation is being relayed via Axelar.
    Relaying,
    /// Attestation has been confirmed on target chain.
    Confirmed,
    /// Attestation failed.
    Failed,
    /// Attestation has expired.
    Expired,
}

// ═══════════════════════════════════════════════════════════════════════════════
// WALLET STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Complete wallet state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletState {
    /// Wallet identifier.
    pub wallet_id: WalletId,
    /// Unified balance view.
    pub balance: UnifiedBalance,
    /// Proof state.
    pub proofs: ProofState,
    /// Per-rail sync status.
    pub rail_sync: HashMap<String, RailSyncState>,
    /// Wallet creation timestamp.
    pub created_at: u64,
    /// Last activity timestamp.
    pub last_activity: u64,
}

/// Sync state for a rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RailSyncState {
    /// Rail identifier.
    pub rail_id: String,
    /// Whether sync is complete.
    pub synced: bool,
    /// Current chain height.
    pub chain_height: u64,
    /// Scanned height.
    pub scanned_height: u64,
    /// Last sync timestamp.
    pub last_sync: u64,
    /// Error message if sync failed.
    pub error: Option<String>,
}

impl Default for CurrencyCode {
    fn default() -> Self {
        CurrencyCode::USD
    }
}

