//! Core types for the PCZT transparent-to-shielded library.

use serde::{Deserialize, Serialize};

/// A transparent UTXO input to be spent.
///
/// This represents a TxIn (transaction input) along with the corresponding
/// PrevTxOut (previous transaction output being spent).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransparentInput {
    /// The transaction ID of the UTXO being spent (32 bytes, big-endian hex)
    pub txid: String,
    /// The output index within the transaction
    pub vout: u32,
    /// The value of the UTXO in zatoshis
    pub value: u64,
    /// The scriptPubKey of the UTXO (hex encoded)
    pub script_pubkey: String,
    /// Optional: The full previous transaction output script (for P2SH)
    pub redeem_script: Option<String>,
    /// BIP32 derivation path for the key that can spend this UTXO (e.g., "m/44'/133'/0'/0/0")
    pub derivation_path: Option<String>,
    /// The compressed public key that can spend this UTXO (33 bytes, hex encoded)
    pub public_key: Option<String>,
}

impl TransparentInput {
    /// Create a new transparent input from basic UTXO information.
    pub fn new(txid: String, vout: u32, value: u64, script_pubkey: String) -> Self {
        Self {
            txid,
            vout,
            value,
            script_pubkey,
            redeem_script: None,
            derivation_path: None,
            public_key: None,
        }
    }

    /// Add BIP32 derivation information for signing.
    pub fn with_derivation(mut self, path: String, public_key: String) -> Self {
        self.derivation_path = Some(path);
        self.public_key = Some(public_key);
        self
    }
}

/// A transparent output for change or direct transparent sends.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransparentOutput {
    /// The value in zatoshis
    pub value: u64,
    /// The scriptPubKey (hex encoded)
    pub script_pubkey: String,
    /// Optional: The destination address (for verification)
    pub address: Option<String>,
}

impl TransparentOutput {
    /// Create a new transparent output.
    pub fn new(value: u64, script_pubkey: String) -> Self {
        Self {
            value,
            script_pubkey,
            address: None,
        }
    }

    /// Create from an address and value.
    pub fn from_address(address: String, value: u64) -> Self {
        // Note: In production, this would derive script_pubkey from address
        Self {
            value,
            script_pubkey: String::new(), // Will be populated during proposal
            address: Some(address),
        }
    }
}

/// The expected change outputs for verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpectedChange {
    /// Expected transparent change outputs
    pub transparent: Vec<TransparentOutput>,
    /// Expected shielded change (should typically be 0 for transparent-only senders)
    pub shielded_value: u64,
}

/// Network type for Zcash transactions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Network {
    /// Zcash mainnet
    Mainnet,
    /// Zcash testnet
    Testnet,
    /// Zcash regtest (for testing)
    Regtest,
}

impl Network {
    /// Get the coin type for BIP44 derivation.
    pub fn coin_type(&self) -> u32 {
        match self {
            Network::Mainnet => 133,
            Network::Testnet | Network::Regtest => 1,
        }
    }

    /// Get the human-readable prefix for addresses.
    pub fn hrp(&self) -> &'static str {
        match self {
            Network::Mainnet => "zs",
            Network::Testnet | Network::Regtest => "ztestsapling",
        }
    }
}

impl Default for Network {
    fn default() -> Self {
        Network::Mainnet
    }
}

/// A ZIP 321 payment request.
///
/// This is a simplified representation of a ZIP 321 URI payment request.
/// Full ZIP 321 parsing is handled internally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentRequest {
    /// The payments to make
    pub payments: Vec<Payment>,
}

/// A single payment within a payment request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    /// The recipient address (unified address with Orchard receiver, or transparent address)
    pub address: String,
    /// The amount in zatoshis
    pub amount: u64,
    /// Optional memo (for shielded outputs only, max 512 bytes)
    pub memo: Option<String>,
    /// Optional label for the payment
    pub label: Option<String>,
    /// Optional message for the payment
    pub message: Option<String>,
}

impl Payment {
    /// Create a new payment without a memo.
    pub fn new(address: String, amount: u64) -> Self {
        Self {
            address,
            amount,
            memo: None,
            label: None,
            message: None,
        }
    }

    /// Create a new payment with a memo.
    pub fn with_memo(address: String, amount: u64, memo: String) -> Self {
        Self {
            address,
            amount,
            memo: Some(memo),
            label: None,
            message: None,
        }
    }
}

impl PaymentRequest {
    /// Create a new payment request from a list of payments.
    pub fn new(payments: Vec<Payment>) -> Self {
        Self { payments }
    }

    /// Create a payment request from a ZIP 321 URI string.
    pub fn from_uri(_uri: &str) -> Result<Self, crate::PcztError> {
        // In production, parse the ZIP 321 URI
        // For now, we use the structured input directly
        Err(crate::PcztError::InvalidPaymentRequest(
            "ZIP 321 URI parsing not implemented - use structured input".to_string(),
        ))
    }

    /// Calculate the total amount of all payments.
    pub fn total_amount(&self) -> u64 {
        self.payments.iter().map(|p| p.amount).sum()
    }
}

/// The final transaction bytes ready for broadcast.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionBytes {
    /// The raw transaction bytes
    pub bytes: Vec<u8>,
    /// The transaction ID (computed from the bytes)
    pub txid: String,
}

impl TransactionBytes {
    /// Create new transaction bytes.
    pub fn new(bytes: Vec<u8>, txid: String) -> Self {
        Self { bytes, txid }
    }

    /// Get the transaction as a hex string.
    pub fn to_hex(&self) -> String {
        hex::encode(&self.bytes)
    }
}

/// Signature for a transparent input.
///
/// This represents an ECDSA signature over the sighash.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransparentSignature {
    /// The DER-encoded signature (including sighash type byte)
    pub signature: Vec<u8>,
    /// The compressed public key (33 bytes)
    pub public_key: Vec<u8>,
}

impl TransparentSignature {
    /// Create a new transparent signature.
    pub fn new(signature: Vec<u8>, public_key: Vec<u8>) -> Self {
        Self {
            signature,
            public_key,
        }
    }

    /// Create from hex-encoded strings.
    pub fn from_hex(signature_hex: &str, public_key_hex: &str) -> Result<Self, crate::PcztError> {
        let signature =
            hex::decode(signature_hex).map_err(|e| crate::PcztError::SignatureError(e.to_string()))?;
        let public_key =
            hex::decode(public_key_hex).map_err(|e| crate::PcztError::SignatureError(e.to_string()))?;
        Ok(Self::new(signature, public_key))
    }
}

/// The sighash for a transparent input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigHash {
    /// The 32-byte sighash
    pub hash: [u8; 32],
    /// The input index this sighash is for
    pub input_index: usize,
    /// The sighash type used
    pub sighash_type: u8,
}

impl SigHash {
    /// Create a new sighash.
    pub fn new(hash: [u8; 32], input_index: usize, sighash_type: u8) -> Self {
        Self {
            hash,
            input_index,
            sighash_type,
        }
    }

    /// Get the sighash as a hex string.
    pub fn to_hex(&self) -> String {
        hex::encode(self.hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transparent_input_creation() {
        let input = TransparentInput::new(
            "0".repeat(64),
            0,
            100000,
            "76a914...88ac".to_string(),
        )
        .with_derivation("m/44'/133'/0'/0/0".to_string(), "03...".to_string());

        assert!(input.derivation_path.is_some());
        assert!(input.public_key.is_some());
    }

    #[test]
    fn test_payment_request_total() {
        let request = PaymentRequest::new(vec![
            Payment::new("addr1".to_string(), 50000),
            Payment::new("addr2".to_string(), 30000),
        ]);

        assert_eq!(request.total_amount(), 80000);
    }

    #[test]
    fn test_network_coin_type() {
        assert_eq!(Network::Mainnet.coin_type(), 133);
        assert_eq!(Network::Testnet.coin_type(), 1);
    }
}

