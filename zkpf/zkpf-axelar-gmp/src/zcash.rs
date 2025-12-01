//! Zcash-specific types for cross-chain private credit rail
//!
//! This module provides Zcash-specific extensions for the Axelar GMP rail,
//! enabling shielded balance proofs to be exported as reusable cross-chain
//! credit credentials.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

use crate::{AxelarGmpError, PoFReceipt};

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/// Zcash chain identifier for Axelar (external chain via Amplifier)
pub const ZCASH_CHAIN_ID: &str = "zcash";

/// Zcash mainnet chain ID (for internal reference)
pub const ZCASH_MAINNET_ID: u64 = 0x7A636173; // "zcas" in hex

/// ZEC decimals (8 zatoshi = 1e-8 ZEC)
pub const ZEC_DECIMALS: u8 = 8;

/// 1 ZEC in zatoshis
pub const ZEC_IN_ZATOSHIS: u64 = 100_000_000;

// ═══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL TIERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Standard balance threshold tiers for Zcash credentials
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum ZecTier {
    /// ≥ 0.1 ZEC (entry level)
    Tier01 = 0,
    /// ≥ 1 ZEC (basic tier)
    Tier1 = 1,
    /// ≥ 10 ZEC (standard tier)
    Tier10 = 2,
    /// ≥ 100 ZEC (premium tier)
    Tier100 = 3,
    /// ≥ 1000 ZEC (whale tier)
    Tier1000 = 4,
    /// ≥ 10000 ZEC (institutional tier)
    Tier10000 = 5,
}

impl ZecTier {
    /// Get the minimum balance threshold in zatoshis for this tier
    pub fn threshold_zatoshis(&self) -> u64 {
        match self {
            Self::Tier01 => 10_000_000,        // 0.1 ZEC
            Self::Tier1 => 100_000_000,        // 1 ZEC
            Self::Tier10 => 1_000_000_000,     // 10 ZEC
            Self::Tier100 => 10_000_000_000,   // 100 ZEC
            Self::Tier1000 => 100_000_000_000, // 1000 ZEC
            Self::Tier10000 => 1_000_000_000_000, // 10000 ZEC
        }
    }

    /// Get the minimum balance threshold in ZEC for this tier
    pub fn threshold_zec(&self) -> f64 {
        self.threshold_zatoshis() as f64 / ZEC_IN_ZATOSHIS as f64
    }

    /// Get human-readable tier name
    pub fn name(&self) -> &'static str {
        match self {
            Self::Tier01 => "0.1+ ZEC",
            Self::Tier1 => "1+ ZEC",
            Self::Tier10 => "10+ ZEC",
            Self::Tier100 => "100+ ZEC",
            Self::Tier1000 => "1000+ ZEC",
            Self::Tier10000 => "10000+ ZEC",
        }
    }

    /// Get the tier from a balance in zatoshis
    pub fn from_balance(zatoshis: u64) -> Option<Self> {
        if zatoshis >= Self::Tier10000.threshold_zatoshis() {
            Some(Self::Tier10000)
        } else if zatoshis >= Self::Tier1000.threshold_zatoshis() {
            Some(Self::Tier1000)
        } else if zatoshis >= Self::Tier100.threshold_zatoshis() {
            Some(Self::Tier100)
        } else if zatoshis >= Self::Tier10.threshold_zatoshis() {
            Some(Self::Tier10)
        } else if zatoshis >= Self::Tier1.threshold_zatoshis() {
            Some(Self::Tier1)
        } else if zatoshis >= Self::Tier01.threshold_zatoshis() {
            Some(Self::Tier01)
        } else {
            None
        }
    }

    /// Convert tier value to u8
    pub fn as_u8(&self) -> u8 {
        *self as u8
    }
}

impl TryFrom<u8> for ZecTier {
    type Error = AxelarGmpError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Tier01),
            1 => Ok(Self::Tier1),
            2 => Ok(Self::Tier10),
            3 => Ok(Self::Tier100),
            4 => Ok(Self::Tier1000),
            5 => Ok(Self::Tier10000),
            _ => Err(AxelarGmpError::Decoding(format!("invalid tier: {}", value))),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZEC CREDENTIAL
// ═══════════════════════════════════════════════════════════════════════════════

/// A Zcash proof-of-funds credential for cross-chain consumption
///
/// This credential proves that a user controls at least a certain threshold
/// of ZEC in shielded funds, without revealing exact amounts or addresses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZecCredential {
    /// Anonymous account tag (derived from viewing key commitment)
    pub account_tag: [u8; 32],

    /// Minimum balance tier proven
    pub tier: ZecTier,

    /// Policy ID for the proof (defines the verification rules)
    pub policy_id: u64,

    /// State tree root at time of proof
    pub state_root: [u8; 32],

    /// Block height at time of proof
    pub block_height: u64,

    /// Timestamp when credential was issued
    pub issued_at: u64,

    /// Expiration timestamp
    pub expires_at: u64,

    /// ZK proof commitment (nullifier hash prevents double-use)
    pub proof_commitment: [u8; 32],

    /// Attestation hash (for cross-referencing)
    pub attestation_hash: [u8; 32],

    /// Optional: credential has been revoked
    #[serde(default)]
    pub revoked: bool,
}

impl ZecCredential {
    /// Create a new Zcash credential
    pub fn new(
        account_tag: [u8; 32],
        tier: ZecTier,
        policy_id: u64,
        state_root: [u8; 32],
        block_height: u64,
        validity_window_secs: u64,
        proof_commitment: [u8; 32],
        attestation_hash: [u8; 32],
    ) -> Self {
        let issued_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        Self {
            account_tag,
            tier,
            policy_id,
            state_root,
            block_height,
            issued_at,
            expires_at: issued_at + validity_window_secs,
            proof_commitment,
            attestation_hash,
            revoked: false,
        }
    }

    /// Check if the credential is currently valid
    pub fn is_valid(&self, current_timestamp: u64) -> bool {
        !self.revoked && current_timestamp < self.expires_at
    }

    /// Compute a unique credential ID
    pub fn credential_id(&self) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        hasher.update(self.account_tag);
        hasher.update(self.tier.as_u8().to_be_bytes());
        hasher.update(self.policy_id.to_be_bytes());
        hasher.update(self.proof_commitment);
        hasher.update(self.issued_at.to_be_bytes());
        hasher.finalize().into()
    }

    /// Convert to a PoF receipt for GMP transmission
    pub fn to_pof_receipt(&self) -> PoFReceipt {
        PoFReceipt::new(
            self.account_tag,
            self.policy_id,
            self.state_root,
            ZCASH_MAINNET_ID,
            self.attestation_hash,
            self.expires_at - self.issued_at,
            self.issued_at,
        )
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDIT LINE CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for credit lines based on ZEC credentials
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditLineConfig {
    /// Tier to credit multiplier mapping (in basis points, 10000 = 100%)
    pub tier_multipliers: Vec<(ZecTier, u32)>,

    /// Annual interest rate in basis points
    pub interest_rate_bps: u32,

    /// Maximum total credit line in destination token's smallest unit
    pub max_credit_cap: u64,

    /// Minimum tier required
    pub min_tier: ZecTier,

    /// Destination token symbol
    pub destination_token: String,

    /// Destination chain for this credit line
    pub destination_chain: String,
}

impl Default for CreditLineConfig {
    fn default() -> Self {
        Self {
            tier_multipliers: vec![
                (ZecTier::Tier01, 1000),   // 10% credit for 0.1+ ZEC
                (ZecTier::Tier1, 2500),    // 25% credit for 1+ ZEC
                (ZecTier::Tier10, 5000),   // 50% credit for 10+ ZEC
                (ZecTier::Tier100, 6500),  // 65% credit for 100+ ZEC
                (ZecTier::Tier1000, 7500), // 75% credit for 1000+ ZEC
                (ZecTier::Tier10000, 8500), // 85% credit for 10000+ ZEC
            ],
            interest_rate_bps: 500, // 5% annual
            max_credit_cap: u64::MAX,
            min_tier: ZecTier::Tier1,
            destination_token: "USDC".to_string(),
            destination_chain: "ethereum".to_string(),
        }
    }
}

impl CreditLineConfig {
    /// Get the credit multiplier for a tier
    pub fn get_multiplier(&self, tier: ZecTier) -> Option<u32> {
        self.tier_multipliers
            .iter()
            .find(|(t, _)| *t == tier)
            .map(|(_, m)| *m)
    }

    /// Calculate credit amount for a given tier and ZEC price
    /// Returns credit in the destination token's smallest unit
    pub fn calculate_credit(&self, tier: ZecTier, zec_price_cents: u64) -> Option<u64> {
        if tier < self.min_tier {
            return None;
        }

        let multiplier = self.get_multiplier(tier)?;
        let tier_value_cents = tier.threshold_zec() as u64 * zec_price_cents;
        let credit = (tier_value_cents * multiplier as u64) / 10000;

        Some(credit.min(self.max_credit_cap))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZCASH BRIDGE MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

/// Message types for Zcash → Axelar bridge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ZcashBridgeMessage {
    /// Broadcast a new ZEC credential
    CredentialBroadcast(ZecCredential),

    /// Revoke an existing credential
    CredentialRevoke {
        credential_id: [u8; 32],
        reason: RevocationReason,
    },

    /// Update credential (e.g., tier upgrade)
    CredentialUpdate {
        old_credential_id: [u8; 32],
        new_credential: ZecCredential,
    },
}

/// Reasons for credential revocation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum RevocationReason {
    /// User requested revocation
    UserRequested = 0,
    /// Balance dropped below threshold
    BalanceDropped = 1,
    /// Proof nullifier was reused (fraud attempt)
    FraudAttempt = 2,
    /// Credential expired and was cleaned up
    Expired = 3,
    /// Policy was updated and old credentials invalidated
    PolicyUpdate = 4,
}

impl ZcashBridgeMessage {
    /// Encode the message for GMP transmission
    pub fn encode(&self) -> Result<Vec<u8>, AxelarGmpError> {
        let json = serde_json::to_vec(self)?;
        Ok(json)
    }

    /// Decode a message from GMP payload
    pub fn decode(bytes: &[u8]) -> Result<Self, AxelarGmpError> {
        serde_json::from_slice(bytes).map_err(|e| AxelarGmpError::Decoding(e.to_string()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Standard policy IDs for Zcash credential tiers
pub mod policy_ids {
    /// Base policy ID for ZEC tier credentials
    pub const ZEC_TIER_BASE: u64 = 400000;

    /// Policy ID for Tier 0.1+ ZEC
    pub const ZEC_TIER_01: u64 = ZEC_TIER_BASE;
    /// Policy ID for Tier 1+ ZEC
    pub const ZEC_TIER_1: u64 = ZEC_TIER_BASE + 1;
    /// Policy ID for Tier 10+ ZEC
    pub const ZEC_TIER_10: u64 = ZEC_TIER_BASE + 2;
    /// Policy ID for Tier 100+ ZEC
    pub const ZEC_TIER_100: u64 = ZEC_TIER_BASE + 3;
    /// Policy ID for Tier 1000+ ZEC
    pub const ZEC_TIER_1000: u64 = ZEC_TIER_BASE + 4;
    /// Policy ID for Tier 10000+ ZEC
    pub const ZEC_TIER_10000: u64 = ZEC_TIER_BASE + 5;

    /// Credit line policies
    pub const CREDIT_LINE_BASE: u64 = 410000;

    /// Standard credit line (50% LTV)
    pub const CREDIT_LINE_STANDARD: u64 = CREDIT_LINE_BASE;
    /// Conservative credit line (25% LTV)
    pub const CREDIT_LINE_CONSERVATIVE: u64 = CREDIT_LINE_BASE + 1;
    /// Aggressive credit line (75% LTV)
    pub const CREDIT_LINE_AGGRESSIVE: u64 = CREDIT_LINE_BASE + 2;
}

/// Get the policy ID for a ZEC tier
pub fn tier_to_policy_id(tier: ZecTier) -> u64 {
    policy_ids::ZEC_TIER_BASE + tier.as_u8() as u64
}

/// Get the tier from a policy ID
pub fn policy_id_to_tier(policy_id: u64) -> Option<ZecTier> {
    if !(policy_ids::ZEC_TIER_BASE..=policy_ids::ZEC_TIER_BASE + 5).contains(&policy_id) {
        return None;
    }
    ZecTier::try_from((policy_id - policy_ids::ZEC_TIER_BASE) as u8).ok()
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_thresholds() {
        assert_eq!(ZecTier::Tier01.threshold_zatoshis(), 10_000_000);
        assert_eq!(ZecTier::Tier1.threshold_zatoshis(), 100_000_000);
        assert_eq!(ZecTier::Tier10.threshold_zatoshis(), 1_000_000_000);
        assert_eq!(ZecTier::Tier100.threshold_zatoshis(), 10_000_000_000);
        assert_eq!(ZecTier::Tier1000.threshold_zatoshis(), 100_000_000_000);
        assert_eq!(ZecTier::Tier10000.threshold_zatoshis(), 1_000_000_000_000);
    }

    #[test]
    fn test_tier_from_balance() {
        assert_eq!(ZecTier::from_balance(5_000_000), None); // < 0.1 ZEC
        assert_eq!(ZecTier::from_balance(10_000_000), Some(ZecTier::Tier01));
        assert_eq!(ZecTier::from_balance(50_000_000), Some(ZecTier::Tier01));
        assert_eq!(ZecTier::from_balance(100_000_000), Some(ZecTier::Tier1));
        assert_eq!(ZecTier::from_balance(1_000_000_000), Some(ZecTier::Tier10));
        assert_eq!(ZecTier::from_balance(15_000_000_000), Some(ZecTier::Tier100));
        assert_eq!(ZecTier::from_balance(500_000_000_000), Some(ZecTier::Tier1000));
        assert_eq!(ZecTier::from_balance(2_000_000_000_000), Some(ZecTier::Tier10000));
    }

    #[test]
    fn test_tier_ordering() {
        assert!(ZecTier::Tier01 < ZecTier::Tier1);
        assert!(ZecTier::Tier1 < ZecTier::Tier10);
        assert!(ZecTier::Tier10 < ZecTier::Tier100);
        assert!(ZecTier::Tier100 < ZecTier::Tier1000);
        assert!(ZecTier::Tier1000 < ZecTier::Tier10000);
    }

    #[test]
    fn test_credential_creation() {
        let cred = ZecCredential::new(
            [1u8; 32],
            ZecTier::Tier100,
            policy_ids::ZEC_TIER_100,
            [2u8; 32],
            1000000,
            86400,
            [3u8; 32],
            [4u8; 32],
        );

        assert_eq!(cred.tier, ZecTier::Tier100);
        assert!(cred.is_valid(cred.issued_at + 1000));
        assert!(!cred.is_valid(cred.expires_at + 1));
    }

    #[test]
    fn test_credit_line_calculation() {
        let config = CreditLineConfig::default();

        // At $50/ZEC, 100+ ZEC tier (65% credit) = 100 * 50 * 0.65 = $3250
        let credit = config.calculate_credit(ZecTier::Tier100, 5000);
        assert_eq!(credit, Some(325000)); // in cents

        // Tier below minimum returns None
        let credit = config.calculate_credit(ZecTier::Tier01, 5000);
        assert_eq!(credit, None);
    }

    #[test]
    fn test_policy_id_conversion() {
        assert_eq!(tier_to_policy_id(ZecTier::Tier01), 400000);
        assert_eq!(tier_to_policy_id(ZecTier::Tier1), 400001);
        assert_eq!(tier_to_policy_id(ZecTier::Tier10), 400002);
        assert_eq!(tier_to_policy_id(ZecTier::Tier100), 400003);
        assert_eq!(tier_to_policy_id(ZecTier::Tier1000), 400004);
        assert_eq!(tier_to_policy_id(ZecTier::Tier10000), 400005);

        assert_eq!(policy_id_to_tier(400000), Some(ZecTier::Tier01));
        assert_eq!(policy_id_to_tier(400003), Some(ZecTier::Tier100));
        assert_eq!(policy_id_to_tier(399999), None);
        assert_eq!(policy_id_to_tier(400006), None);
    }

    #[test]
    fn test_bridge_message_encoding() {
        let cred = ZecCredential::new(
            [1u8; 32],
            ZecTier::Tier10,
            policy_ids::ZEC_TIER_10,
            [2u8; 32],
            1000000,
            86400,
            [3u8; 32],
            [4u8; 32],
        );

        let msg = ZcashBridgeMessage::CredentialBroadcast(cred);
        let encoded = msg.encode().unwrap();
        let decoded = ZcashBridgeMessage::decode(&encoded).unwrap();

        match decoded {
            ZcashBridgeMessage::CredentialBroadcast(c) => {
                assert_eq!(c.tier, ZecTier::Tier10);
            }
            _ => panic!("wrong message type"),
        }
    }
}

