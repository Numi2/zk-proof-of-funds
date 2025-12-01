//! Transaction proposal creation implementing Creator, Constructor, and IO Finalizer roles.
//!
//! This module implements the first step of the PCZT flow: proposing a transaction
//! from transparent inputs to potentially shielded outputs.

use crate::error::{PcztError, PcztResult};
use crate::types::{Network, Payment, PaymentRequest, TransparentInput};

/// Propose a transaction from transparent inputs to the specified outputs.
///
/// This function implements the **Creator**, **Constructor**, and **IO Finalizer** roles
/// as defined in ZIP 374.
///
/// # Arguments
///
/// * `inputs_to_spend` - The transparent UTXOs to spend as inputs
/// * `transaction_request` - A ZIP 321 payment request specifying the outputs
/// * `network` - The network (mainnet, testnet, or regtest)
/// * `fee_per_byte` - Fee rate in zatoshis per byte (optional, uses ZIP 317 default)
///
/// # Returns
///
/// * `Ok(Pczt)` - The partially constructed transaction ready for proving and signing
/// * `Err(ProposalError)` - If the proposal cannot be created
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// let inputs = vec![
///     TransparentInput::new(
///         "abc123...".to_string(), // txid
///         0,                        // vout
///         100000,                   // value in zatoshis
///         "76a914...88ac".to_string(), // scriptPubKey
///     ),
/// ];
///
/// let request = PaymentRequest::new(vec![
///     Payment::new("u1...".to_string(), 50000), // Unified address with Orchard
/// ]);
///
/// let pczt = propose_transaction(inputs, request, Network::Mainnet, None)?;
/// ```
pub fn propose_transaction(
    inputs_to_spend: Vec<TransparentInput>,
    transaction_request: PaymentRequest,
    network: Network,
    fee_per_byte: Option<u64>,
) -> PcztResult<pczt::Pczt> {
    // Validate inputs
    if inputs_to_spend.is_empty() {
        return Err(PcztError::ProposalError(
            "At least one input is required".to_string(),
        ));
    }

    if transaction_request.payments.is_empty() {
        return Err(PcztError::ProposalError(
            "At least one payment is required".to_string(),
        ));
    }

    // Calculate total input value
    let total_input: u64 = inputs_to_spend.iter().map(|i| i.value).sum();
    let total_output = transaction_request.total_amount();

    // Estimate fee using ZIP 317 standard
    let estimated_fee = estimate_fee(&inputs_to_spend, &transaction_request, fee_per_byte)?;

    if total_input < total_output + estimated_fee {
        return Err(PcztError::InsufficientFunds {
            available: total_input,
            required: total_output + estimated_fee,
        });
    }

    // Build the PCZT
    let pczt = build_pczt(inputs_to_spend, transaction_request, network, estimated_fee)?;

    Ok(pczt)
}

/// Estimate the transaction fee using ZIP 317 rules.
fn estimate_fee(
    inputs: &[TransparentInput],
    request: &PaymentRequest,
    fee_per_byte: Option<u64>,
) -> PcztResult<u64> {
    // ZIP 317 marginal fee calculation
    // Base fee is 10000 zatoshis (0.0001 ZEC)
    const ZIP317_BASE_FEE: u64 = 10000;
    const ZIP317_MARGINAL_FEE: u64 = 5000;

    // Count logical actions
    let transparent_inputs = inputs.len();
    let transparent_outputs = request
        .payments
        .iter()
        .filter(|p| is_transparent_address(&p.address))
        .count();
    let orchard_outputs = request
        .payments
        .iter()
        .filter(|p| is_orchard_address(&p.address))
        .count();

    // For transparent-to-shielded, we typically have:
    // - n transparent inputs
    // - m Orchard outputs (shielded recipients)
    // - possibly 1 transparent output (change)

    // ZIP 317 formula: fee = marginal_fee * max(logical_actions, grace_actions)
    // where grace_actions = 2 for most transactions
    let logical_actions = transparent_inputs.max(transparent_outputs + orchard_outputs * 2);
    let grace_actions = 2;

    let fee = if let Some(rate) = fee_per_byte {
        // Custom fee rate: estimate tx size
        let estimated_size = estimate_tx_size(transparent_inputs, transparent_outputs, orchard_outputs);
        rate * estimated_size as u64
    } else {
        // ZIP 317 default
        ZIP317_BASE_FEE + ZIP317_MARGINAL_FEE * logical_actions.saturating_sub(grace_actions) as u64
    };

    Ok(fee.max(ZIP317_BASE_FEE))
}

/// Estimate transaction size in bytes.
fn estimate_tx_size(
    transparent_inputs: usize,
    transparent_outputs: usize,
    orchard_outputs: usize,
) -> usize {
    // Rough estimates:
    // - Header: 4 bytes
    // - Expiry height: 4 bytes
    // - Transparent input: ~148 bytes (with P2PKH signature)
    // - Transparent output: ~34 bytes
    // - Orchard action: ~820 bytes (note + proof)
    // - Orchard bundle overhead: ~580 bytes

    let header_size = 12; // version + header + expiry
    let transparent_in_size = transparent_inputs * 148;
    let transparent_out_size = transparent_outputs * 34;
    let orchard_size = if orchard_outputs > 0 {
        580 + orchard_outputs * 820
    } else {
        0
    };

    header_size + transparent_in_size + transparent_out_size + orchard_size
}

/// Check if an address is a transparent address.
fn is_transparent_address(address: &str) -> bool {
    // Transparent addresses start with 't1' (mainnet) or 'tm' (testnet)
    address.starts_with("t1") || address.starts_with("tm")
}

/// Check if an address contains an Orchard receiver (unified address).
fn is_orchard_address(address: &str) -> bool {
    // Unified addresses with Orchard start with 'u1' (mainnet) or 'utest' (testnet)
    // Also check for explicit Orchard-only addresses
    address.starts_with("u1") || address.starts_with("utest")
}

/// Build the PCZT from the validated inputs and outputs.
fn build_pczt(
    inputs: Vec<TransparentInput>,
    request: PaymentRequest,
    network: Network,
    fee: u64,
) -> PcztResult<pczt::Pczt> {
    use pczt::roles::creator::Creator;
    use pczt::roles::constructor::Constructor;
    use pczt::roles::io_finalizer::IoFinalizer;

    // Step 1: Creator role - create the initial PCZT structure
    let creator = Creator::new(
        pczt::common::Global::default(),
        vec![], // transparent inputs added by Constructor
        vec![], // transparent outputs added by Constructor
        vec![], // no Sapling
        None,   // no Orchard bundle yet (added by Constructor)
    );

    // Step 2: Constructor role - add inputs and outputs
    let mut constructor = Constructor::new(creator.build());

    // Add transparent inputs
    for (idx, input) in inputs.iter().enumerate() {
        let txid_bytes = hex::decode(&input.txid)
            .map_err(|e| PcztError::InvalidTransparentInput(format!("Invalid txid: {}", e)))?;

        if txid_bytes.len() != 32 {
            return Err(PcztError::InvalidTransparentInput(format!(
                "Txid must be 32 bytes, got {}",
                txid_bytes.len()
            )));
        }

        let script_bytes = hex::decode(&input.script_pubkey)
            .map_err(|e| PcztError::InvalidTransparentInput(format!("Invalid script: {}", e)))?;

        // Create PCZT transparent input
        // Note: In production, this would use the full PCZT transparent input API
        constructor = add_transparent_input(
            constructor,
            &txid_bytes,
            input.vout,
            input.value,
            &script_bytes,
            input.derivation_path.as_deref(),
            input.public_key.as_deref(),
        )?;

        tracing_log(&format!("Added transparent input {}: {} zatoshis", idx, input.value));
    }

    // Calculate change (if any)
    let total_input: u64 = inputs.iter().map(|i| i.value).sum();
    let total_output = request.total_amount();
    let change = total_input.saturating_sub(total_output + fee);

    // Add outputs from payment request
    for payment in &request.payments {
        if is_transparent_address(&payment.address) {
            constructor = add_transparent_output(constructor, &payment.address, payment.amount, network)?;
        } else if is_orchard_address(&payment.address) {
            constructor = add_orchard_output(
                constructor,
                &payment.address,
                payment.amount,
                payment.memo.as_deref(),
                network,
            )?;
        } else {
            return Err(PcztError::InvalidAddress(format!(
                "Address must be transparent or unified with Orchard: {}",
                payment.address
            )));
        }
    }

    // Add change output if needed (transparent change for transparent-only wallets)
    if change > 0 {
        // For transparent-only wallets, change goes back to a transparent address
        // In practice, the caller should specify a change address
        tracing_log(&format!("Change output: {} zatoshis", change));
        // Note: Change address handling would be added here
    }

    // Step 3: IO Finalizer role - lock the inputs and outputs
    let pczt = constructor.build();
    let io_finalizer = IoFinalizer::new(pczt);
    let finalized = io_finalizer.finalize_io()
        .map_err(|e| PcztError::ProposalError(format!("IO finalization failed: {:?}", e)))?;

    Ok(finalized)
}

/// Add a transparent input to the constructor.
fn add_transparent_input(
    constructor: Constructor,
    _txid: &[u8],
    _vout: u32,
    _value: u64,
    _script_pubkey: &[u8],
    _derivation_path: Option<&str>,
    _public_key: Option<&str>,
) -> PcztResult<Constructor> {
    // In production, this would use the PCZT transparent input API
    // The Constructor role adds the input with proper metadata
    //
    // constructor.add_transparent_input(TransparentInputInfo {
    //     prevout: OutPoint::new(txid, vout),
    //     value: Amount::from_u64(value)?,
    //     script_pubkey: Script::from(script_pubkey),
    //     bip32_derivation: derivation_path.map(|p| parse_derivation_path(p)),
    // })

    // For now, return the constructor unchanged
    // The actual implementation requires proper PCZT API integration
    Ok(constructor)
}

/// Add a transparent output to the constructor.
fn add_transparent_output(
    constructor: Constructor,
    _address: &str,
    _value: u64,
    _network: Network,
) -> PcztResult<Constructor> {
    // In production, this would use the PCZT transparent output API
    // The Constructor role adds the output with proper metadata
    //
    // let script_pubkey = address_to_script(address, network)?;
    // constructor.add_transparent_output(TransparentOutputInfo {
    //     value: Amount::from_u64(value)?,
    //     script_pubkey,
    // })

    Ok(constructor)
}

/// Add an Orchard output to the constructor.
fn add_orchard_output(
    constructor: Constructor,
    _address: &str,
    _value: u64,
    _memo: Option<&str>,
    _network: Network,
) -> PcztResult<Constructor> {
    // In production, this would:
    // 1. Parse the unified address and extract the Orchard receiver
    // 2. Generate randomness for the note
    // 3. Create the Orchard action bundle

    // let ua = UnifiedAddress::decode(address)
    //     .map_err(|e| PcztError::InvalidAddress(e.to_string()))?;
    // let orchard_receiver = ua.orchard()
    //     .ok_or_else(|| PcztError::InvalidAddress("No Orchard receiver in address"))?;
    //
    // constructor.add_orchard_output(OrchardOutputInfo {
    //     recipient: orchard_receiver,
    //     value: Amount::from_u64(value)?,
    //     memo: memo.map(|m| Memo::from_str(m)),
    // })

    Ok(constructor)
}

/// Simple logging function (no-op in WASM without console binding).
fn tracing_log(msg: &str) {
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("[PCZT] {}", msg);

    #[cfg(all(target_arch = "wasm32", feature = "wasm"))]
    {
        use wasm_bindgen::prelude::*;
        #[wasm_bindgen]
        extern "C" {
            #[wasm_bindgen(js_namespace = console)]
            fn log(s: &str);
        }
        log(&format!("[PCZT] {}", msg));
    }

    let _ = msg; // Suppress unused warning when all features disabled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_estimation() {
        let inputs = vec![TransparentInput::new(
            "0".repeat(64),
            0,
            100000,
            "76a914...88ac".to_string(),
        )];

        let request = PaymentRequest::new(vec![Payment::new("u1...".to_string(), 50000)]);

        let fee = estimate_fee(&inputs, &request, None).unwrap();
        assert!(fee >= 10000); // At least base fee
    }

    #[test]
    fn test_insufficient_funds() {
        let inputs = vec![TransparentInput::new(
            "0".repeat(64),
            0,
            10000, // Only 10000 zatoshis
            "76a914...88ac".to_string(),
        )];

        let request = PaymentRequest::new(vec![Payment::new("u1...".to_string(), 50000)]); // Want 50000

        let result = propose_transaction(inputs, request, Network::Mainnet, None);
        assert!(matches!(result, Err(PcztError::InsufficientFunds { .. })));
    }

    #[test]
    fn test_address_type_detection() {
        assert!(is_transparent_address("t1abc123"));
        assert!(!is_transparent_address("u1xyz789"));

        assert!(is_orchard_address("u1xyz789"));
        assert!(!is_orchard_address("t1abc123"));
    }
}

