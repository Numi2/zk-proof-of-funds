//! WASM bindings for the PCZT transparent-to-shielded library.
//!
//! This module provides JavaScript/TypeScript bindings via wasm-bindgen
//! for all the PCZT operations.

use wasm_bindgen::prelude::*;
use crate::error::PcztError;
use crate::types::*;

/// Initialize panic hook for better error messages in WASM.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// WASM-exposed PCZT wrapper.
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmPczt {
    inner: pczt::Pczt,
}

#[wasm_bindgen]
impl WasmPczt {
    /// Serialize the PCZT to bytes.
    #[wasm_bindgen]
    pub fn serialize(&self) -> Vec<u8> {
        self.inner.serialize()
    }

    /// Parse a PCZT from bytes.
    #[wasm_bindgen]
    pub fn parse(bytes: &[u8]) -> Result<WasmPczt, JsValue> {
        let inner = crate::parse_pczt(bytes)?;
        Ok(WasmPczt { inner })
    }

    /// Get a JSON representation of the PCZT for debugging.
    #[wasm_bindgen]
    pub fn to_json(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&PcztDebugInfo::from(&self.inner)).unwrap_or(JsValue::NULL)
    }

    /// Get the number of transparent inputs.
    #[wasm_bindgen]
    pub fn transparent_input_count(&self) -> usize {
        self.inner.transparent()
            .map(|b| b.inputs().len())
            .unwrap_or(0)
    }

    /// Get the number of transparent outputs.
    #[wasm_bindgen]
    pub fn transparent_output_count(&self) -> usize {
        self.inner.transparent()
            .map(|b| b.outputs().len())
            .unwrap_or(0)
    }

    /// Check if the PCZT has an Orchard bundle.
    #[wasm_bindgen]
    pub fn has_orchard(&self) -> bool {
        self.inner.orchard().is_some()
    }

    /// Get the number of Orchard actions.
    #[wasm_bindgen]
    pub fn orchard_action_count(&self) -> usize {
        self.inner.orchard()
            .map(|b| b.actions().len())
            .unwrap_or(0)
    }
}

impl From<pczt::Pczt> for WasmPczt {
    fn from(inner: pczt::Pczt) -> Self {
        WasmPczt { inner }
    }
}

impl From<WasmPczt> for pczt::Pczt {
    fn from(wasm: WasmPczt) -> Self {
        wasm.inner
    }
}

/// Debug information about a PCZT.
#[derive(serde::Serialize)]
struct PcztDebugInfo {
    transparent_inputs: usize,
    transparent_outputs: usize,
    orchard_actions: usize,
    has_proofs: bool,
}

impl From<&pczt::Pczt> for PcztDebugInfo {
    fn from(pczt: &pczt::Pczt) -> Self {
        PcztDebugInfo {
            transparent_inputs: pczt.transparent().map(|b| b.inputs().len()).unwrap_or(0),
            transparent_outputs: pczt.transparent().map(|b| b.outputs().len()).unwrap_or(0),
            orchard_actions: pczt.orchard().map(|b| b.actions().len()).unwrap_or(0),
            has_proofs: pczt.orchard().map(|b| b.zkproof().is_some()).unwrap_or(false),
        }
    }
}

/// WASM-exposed transparent input.
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmTransparentInput {
    inner: TransparentInput,
}

#[wasm_bindgen]
impl WasmTransparentInput {
    /// Create a new transparent input.
    #[wasm_bindgen(constructor)]
    pub fn new(
        txid: String,
        vout: u32,
        value: u64,
        script_pubkey: String,
    ) -> WasmTransparentInput {
        WasmTransparentInput {
            inner: TransparentInput::new(txid, vout, value, script_pubkey),
        }
    }

    /// Add derivation path and public key for signing.
    #[wasm_bindgen]
    pub fn with_derivation(self, path: String, public_key: String) -> WasmTransparentInput {
        WasmTransparentInput {
            inner: self.inner.with_derivation(path, public_key),
        }
    }

    /// Get the UTXO value in zatoshis.
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> u64 {
        self.inner.value
    }

    /// Get the transaction ID.
    #[wasm_bindgen(getter)]
    pub fn txid(&self) -> String {
        self.inner.txid.clone()
    }
}

/// WASM-exposed payment.
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmPayment {
    inner: Payment,
}

#[wasm_bindgen]
impl WasmPayment {
    /// Create a new payment without memo.
    #[wasm_bindgen(constructor)]
    pub fn new(address: String, amount: u64) -> WasmPayment {
        WasmPayment {
            inner: Payment::new(address, amount),
        }
    }

    /// Create a payment with a memo (for shielded recipients).
    #[wasm_bindgen]
    pub fn with_memo(address: String, amount: u64, memo: String) -> WasmPayment {
        WasmPayment {
            inner: Payment::with_memo(address, amount, memo),
        }
    }

    /// Get the recipient address.
    #[wasm_bindgen(getter)]
    pub fn address(&self) -> String {
        self.inner.address.clone()
    }

    /// Get the payment amount in zatoshis.
    #[wasm_bindgen(getter)]
    pub fn amount(&self) -> u64 {
        self.inner.amount
    }
}

/// WASM-exposed payment request.
#[wasm_bindgen]
pub struct WasmPaymentRequest {
    inner: PaymentRequest,
}

#[wasm_bindgen]
impl WasmPaymentRequest {
    /// Create a new payment request from a list of payments.
    #[wasm_bindgen(constructor)]
    pub fn new(payments: Vec<WasmPayment>) -> WasmPaymentRequest {
        WasmPaymentRequest {
            inner: PaymentRequest::new(
                payments.into_iter().map(|p| p.inner).collect(),
            ),
        }
    }

    /// Get the total amount of all payments.
    #[wasm_bindgen]
    pub fn total_amount(&self) -> u64 {
        self.inner.total_amount()
    }
}

/// WASM-exposed sighash.
#[wasm_bindgen]
pub struct WasmSigHash {
    inner: SigHash,
}

#[wasm_bindgen]
impl WasmSigHash {
    /// Get the 32-byte sighash.
    #[wasm_bindgen]
    pub fn hash(&self) -> Vec<u8> {
        self.inner.hash.to_vec()
    }

    /// Get the sighash as a hex string.
    #[wasm_bindgen]
    pub fn to_hex(&self) -> String {
        self.inner.to_hex()
    }

    /// Get the input index.
    #[wasm_bindgen(getter)]
    pub fn input_index(&self) -> usize {
        self.inner.input_index
    }
}

/// WASM-exposed transaction bytes.
#[wasm_bindgen]
pub struct WasmTransactionBytes {
    inner: TransactionBytes,
}

#[wasm_bindgen]
impl WasmTransactionBytes {
    /// Get the raw transaction bytes.
    #[wasm_bindgen]
    pub fn bytes(&self) -> Vec<u8> {
        self.inner.bytes.clone()
    }

    /// Get the transaction as a hex string.
    #[wasm_bindgen]
    pub fn to_hex(&self) -> String {
        self.inner.to_hex()
    }

    /// Get the transaction ID.
    #[wasm_bindgen(getter)]
    pub fn txid(&self) -> String {
        self.inner.txid.clone()
    }
}

/// Network type for WASM.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum WasmNetwork {
    Mainnet,
    Testnet,
    Regtest,
}

impl From<WasmNetwork> for Network {
    fn from(n: WasmNetwork) -> Self {
        match n {
            WasmNetwork::Mainnet => Network::Mainnet,
            WasmNetwork::Testnet => Network::Testnet,
            WasmNetwork::Regtest => Network::Regtest,
        }
    }
}

// ============================================================================
// PCZT API Functions
// ============================================================================

/// Propose a transaction from transparent inputs to the specified outputs.
///
/// This implements the Creator, Constructor, and IO Finalizer roles.
#[wasm_bindgen]
pub fn propose_transaction(
    inputs: Vec<WasmTransparentInput>,
    request: WasmPaymentRequest,
    network: WasmNetwork,
    fee_per_byte: Option<u64>,
) -> Result<WasmPczt, JsValue> {
    let inputs: Vec<TransparentInput> = inputs.into_iter().map(|i| i.inner).collect();
    let pczt = crate::propose_transaction(inputs, request.inner, network.into(), fee_per_byte)?;
    Ok(WasmPczt { inner: pczt })
}

/// Add Orchard proofs to the PCZT.
///
/// This implements the Prover role.
#[wasm_bindgen]
pub fn prove_transaction(pczt: WasmPczt) -> Result<WasmPczt, JsValue> {
    let proven = crate::prove_transaction(pczt.inner)?;
    Ok(WasmPczt { inner: proven })
}

/// Get the sighash for a transparent input.
#[wasm_bindgen]
pub fn get_sighash(pczt: &WasmPczt, input_index: usize) -> Result<WasmSigHash, JsValue> {
    let sighash = crate::get_sighash(&pczt.inner, input_index)?;
    Ok(WasmSigHash { inner: sighash })
}

/// Append a signature to the PCZT.
#[wasm_bindgen]
pub fn append_signature(
    pczt: WasmPczt,
    input_index: usize,
    signature_hex: &str,
    public_key_hex: &str,
) -> Result<WasmPczt, JsValue> {
    let signature = TransparentSignature::from_hex(signature_hex, public_key_hex)?;
    let signed = crate::append_signature(pczt.inner, input_index, signature)?;
    Ok(WasmPczt { inner: signed })
}

/// Verify the PCZT before signing.
#[wasm_bindgen]
pub fn verify_before_signing(
    pczt: &WasmPczt,
    request: &WasmPaymentRequest,
    expected_change_json: JsValue,
) -> Result<(), JsValue> {
    let expected_change: ExpectedChange = serde_wasm_bindgen::from_value(expected_change_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid expected_change: {}", e)))?;

    crate::verify_before_signing(&pczt.inner, &request.inner, &expected_change)?;
    Ok(())
}

/// Combine multiple PCZTs.
#[wasm_bindgen]
pub fn combine(pczts: Vec<WasmPczt>) -> Result<WasmPczt, JsValue> {
    let pczts: Vec<pczt::Pczt> = pczts.into_iter().map(|p| p.inner).collect();
    let combined = crate::combine(pczts)?;
    Ok(WasmPczt { inner: combined })
}

/// Finalize and extract the transaction.
#[wasm_bindgen]
pub fn finalize_and_extract(pczt: WasmPczt) -> Result<WasmTransactionBytes, JsValue> {
    let tx = crate::finalize_and_extract(pczt.inner)?;
    Ok(WasmTransactionBytes { inner: tx })
}

/// Parse a PCZT from bytes.
#[wasm_bindgen]
pub fn parse_pczt(bytes: &[u8]) -> Result<WasmPczt, JsValue> {
    WasmPczt::parse(bytes)
}

/// Serialize a PCZT to bytes.
#[wasm_bindgen]
pub fn serialize_pczt(pczt: &WasmPczt) -> Vec<u8> {
    pczt.serialize()
}

/// Get all sighashes for a PCZT.
#[wasm_bindgen]
pub fn get_all_sighashes(pczt: &WasmPczt) -> Result<Vec<WasmSigHash>, JsValue> {
    let sighashes = crate::get_all_sighashes(&pczt.inner)?;
    Ok(sighashes.into_iter().map(|s| WasmSigHash { inner: s }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn test_wasm_payment_creation() {
        let payment = WasmPayment::new("u1test...".to_string(), 50000);
        assert_eq!(payment.amount(), 50000);
        assert_eq!(payment.address(), "u1test...");
    }

    #[wasm_bindgen_test]
    fn test_wasm_input_creation() {
        let input = WasmTransparentInput::new(
            "0".repeat(64),
            0,
            100000,
            "76a914...88ac".to_string(),
        );
        assert_eq!(input.value(), 100000);
    }
}

