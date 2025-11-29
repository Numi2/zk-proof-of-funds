//! Payment types and requirements for x402
//! Numan Thabit
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{X402Error, X402Result, ZATOSHIS_PER_ZEC};

/// Zcash network selection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ZecNetwork {
    /// Zcash mainnet
    #[default]
    Mainnet,
    /// Zcash testnet
    Testnet,
}

impl ZecNetwork {
    /// Get string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            ZecNetwork::Mainnet => "mainnet",
            ZecNetwork::Testnet => "testnet",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "mainnet" | "main" => Some(ZecNetwork::Mainnet),
            "testnet" | "test" => Some(ZecNetwork::Testnet),
            _ => None,
        }
    }
}

impl std::fmt::Display for ZecNetwork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Payment scheme type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum PaymentScheme {
    /// Shielded Sapling payment (zs1... addresses)
    #[default]
    #[serde(rename = "zcash:sapling")]
    Sapling,
    /// Shielded Orchard payment (for future unified addresses)
    #[serde(rename = "zcash:orchard")]
    Orchard,
    /// Transparent payment (t1... addresses)
    #[serde(rename = "zcash:transparent")]
    Transparent,
    /// Unified address (can contain multiple receivers)
    #[serde(rename = "zcash:unified")]
    Unified,
}

impl PaymentScheme {
    /// Get string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            PaymentScheme::Sapling => "zcash:sapling",
            PaymentScheme::Orchard => "zcash:orchard",
            PaymentScheme::Transparent => "zcash:transparent",
            PaymentScheme::Unified => "zcash:unified",
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "zcash:sapling" | "sapling" => Some(PaymentScheme::Sapling),
            "zcash:orchard" | "orchard" => Some(PaymentScheme::Orchard),
            "zcash:transparent" | "transparent" => Some(PaymentScheme::Transparent),
            "zcash:unified" | "unified" => Some(PaymentScheme::Unified),
            _ => None,
        }
    }

    /// Detect payment scheme from address prefix
    pub fn from_address(address: &str) -> Option<Self> {
        if address.starts_with("zs1") || address.starts_with("zs") {
            Some(PaymentScheme::Sapling)
        } else if address.starts_with("t1") || address.starts_with("t3") {
            Some(PaymentScheme::Transparent)
        } else if address.starts_with("u1") {
            Some(PaymentScheme::Unified)
        } else {
            None
        }
    }
}

impl std::fmt::Display for PaymentScheme {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Payment requirements sent in HTTP 402 response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequirements {
    /// x402 protocol version
    pub version: String,
    /// Payment scheme (e.g., zcash:sapling)
    pub scheme: PaymentScheme,
    /// Destination address for payment
    pub address: String,
    /// Required amount in zatoshis
    pub amount_zatoshis: u64,
    /// Network (mainnet or testnet)
    pub network: ZecNetwork,
    /// When this payment requirement expires
    #[serde(with = "chrono::serde::ts_seconds")]
    pub expires_at: DateTime<Utc>,
    /// Minimum confirmations required for payment acceptance
    #[serde(default = "default_min_confirmations")]
    pub min_confirmations: u32,
    /// Resource being accessed
    pub resource: String,
    /// Optional description/memo
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Optional unique payment ID for tracking
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_id: Option<String>,
    /// Optional: suggested memo to include in transaction
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

fn default_min_confirmations() -> u32 {
    1
}

impl PaymentRequirements {
    /// Create new payment requirements with defaults
    pub fn new(address: String, amount_zatoshis: u64) -> Self {
        let scheme = PaymentScheme::from_address(&address).unwrap_or_default();
        Self {
            version: crate::X402_VERSION.to_string(),
            scheme,
            address,
            amount_zatoshis,
            network: ZecNetwork::Mainnet,
            expires_at: Utc::now() + Duration::minutes(15),
            min_confirmations: 1,
            resource: "/".to_string(),
            description: None,
            payment_id: None,
            memo: None,
        }
    }

    /// Get amount in ZEC
    pub fn amount_zec(&self) -> f64 {
        self.amount_zatoshis as f64 / ZATOSHIS_PER_ZEC as f64
    }

    /// Check if payment requirements have expired
    pub fn is_expired(&self) -> bool {
        Utc::now() > self.expires_at
    }

    /// Time remaining until expiration
    pub fn time_remaining(&self) -> Duration {
        self.expires_at - Utc::now()
    }

    /// Validate the payment requirements
    pub fn validate(&self) -> X402Result<()> {
        if self.address.is_empty() {
            return Err(X402Error::MissingField("address"));
        }
        if self.amount_zatoshis == 0 {
            return Err(X402Error::InvalidAmount("Amount must be greater than 0".into()));
        }
        if self.is_expired() {
            return Err(X402Error::PaymentExpired(self.expires_at.to_rfc3339()));
        }
        
        // Validate address format based on scheme
        match self.scheme {
            PaymentScheme::Sapling => {
                if !self.address.starts_with("zs1") && !self.address.starts_with("zs") {
                    return Err(X402Error::InvalidAddress(
                        "Sapling address must start with 'zs'".into()
                    ));
                }
            }
            PaymentScheme::Transparent => {
                if !self.address.starts_with("t1") && !self.address.starts_with("t3") {
                    return Err(X402Error::InvalidAddress(
                        "Transparent address must start with 't1' or 't3'".into()
                    ));
                }
            }
            PaymentScheme::Unified => {
                if !self.address.starts_with("u1") {
                    return Err(X402Error::InvalidAddress(
                        "Unified address must start with 'u1'".into()
                    ));
                }
            }
            PaymentScheme::Orchard => {
                // Orchard-only addresses are in unified format
                if !self.address.starts_with("u1") {
                    return Err(X402Error::InvalidAddress(
                        "Orchard address must be a unified address starting with 'u1'".into()
                    ));
                }
            }
        }
        
        Ok(())
    }

    /// Serialize to JSON string
    pub fn to_json(&self) -> X402Result<String> {
        serde_json::to_string(self).map_err(Into::into)
    }

    /// Deserialize from JSON string
    pub fn from_json(json: &str) -> X402Result<Self> {
        serde_json::from_str(json).map_err(Into::into)
    }
}

/// Payment proof sent by client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentProof {
    /// Transaction ID (txid) as hex string
    pub txid: String,
    /// Block height where transaction was mined (if confirmed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_height: Option<u32>,
    /// Number of confirmations (if known)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmations: Option<u32>,
    /// Output index for the payment (for multi-output transactions)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_index: Option<u32>,
    /// Payment ID for correlation (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_id: Option<String>,
}

impl PaymentProof {
    /// Create a new payment proof from a transaction ID
    pub fn new(txid: impl Into<String>) -> Self {
        Self {
            txid: txid.into(),
            block_height: None,
            confirmations: None,
            output_index: None,
            payment_id: None,
        }
    }

    /// Add block height
    pub fn with_block_height(mut self, height: u32) -> Self {
        self.block_height = Some(height);
        self
    }

    /// Add confirmations count
    pub fn with_confirmations(mut self, confirmations: u32) -> Self {
        self.confirmations = Some(confirmations);
        self
    }

    /// Add output index
    pub fn with_output_index(mut self, index: u32) -> Self {
        self.output_index = Some(index);
        self
    }

    /// Add payment ID
    pub fn with_payment_id(mut self, id: impl Into<String>) -> Self {
        self.payment_id = Some(id.into());
        self
    }

    /// Validate the payment proof
    pub fn validate(&self) -> X402Result<()> {
        // Validate txid is 64 hex characters (32 bytes)
        if self.txid.len() != 64 {
            return Err(X402Error::InvalidPaymentProof(
                format!("Invalid txid length: expected 64 chars, got {}", self.txid.len())
            ));
        }
        if !self.txid.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(X402Error::InvalidPaymentProof(
                "Transaction ID must be hexadecimal".into()
            ));
        }
        Ok(())
    }

    /// Serialize to JSON string
    pub fn to_json(&self) -> X402Result<String> {
        serde_json::to_string(self).map_err(Into::into)
    }

    /// Deserialize from JSON string
    pub fn from_json(json: &str) -> X402Result<Self> {
        serde_json::from_str(json).map_err(Into::into)
    }

    /// Encode as base64 for header transmission
    pub fn to_header_value(&self) -> X402Result<String> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        let json = self.to_json()?;
        Ok(STANDARD.encode(json.as_bytes()))
    }

    /// Decode from base64 header value
    pub fn from_header_value(value: &str) -> X402Result<Self> {
        use base64::{Engine, engine::general_purpose::STANDARD};
        
        // Try direct JSON first (for simple txid-only format)
        if let Ok(proof) = Self::from_json(value) {
            return Ok(proof);
        }
        
        // Try as raw txid
        if value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(Self::new(value));
        }
        
        // Try base64 encoded JSON
        let decoded = STANDARD.decode(value)?;
        let json = String::from_utf8(decoded)
            .map_err(|e| X402Error::InvalidPaymentProof(e.to_string()))?;
        Self::from_json(&json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_payment_scheme_detection() {
        assert_eq!(
            PaymentScheme::from_address("zs1xyxyxyxyxyxyx"),
            Some(PaymentScheme::Sapling)
        );
        assert_eq!(
            PaymentScheme::from_address("t1xyxyxyxyxyxyx"),
            Some(PaymentScheme::Transparent)
        );
        assert_eq!(
            PaymentScheme::from_address("u1xyxyxyxyxyxyx"),
            Some(PaymentScheme::Unified)
        );
        assert_eq!(
            PaymentScheme::from_address("invalid"),
            None
        );
    }

    #[test]
    fn test_payment_requirements_serialization() {
        let req = PaymentRequirements::new(
            "zs1test1234567890".to_string(),
            100_000_000, // 1 ZEC
        );
        
        let json = req.to_json().unwrap();
        let parsed = PaymentRequirements::from_json(&json).unwrap();
        
        assert_eq!(parsed.address, req.address);
        assert_eq!(parsed.amount_zatoshis, req.amount_zatoshis);
    }

    #[test]
    fn test_payment_proof_roundtrip() {
        let proof = PaymentProof::new("a".repeat(64))
            .with_confirmations(6)
            .with_block_height(1_000_000);
        
        let header = proof.to_header_value().unwrap();
        let decoded = PaymentProof::from_header_value(&header).unwrap();
        
        assert_eq!(decoded.txid, proof.txid);
        assert_eq!(decoded.confirmations, Some(6));
    }

    #[test]
    fn test_raw_txid_parsing() {
        let txid = "a".repeat(64);
        let proof = PaymentProof::from_header_value(&txid).unwrap();
        assert_eq!(proof.txid, txid);
    }
}

