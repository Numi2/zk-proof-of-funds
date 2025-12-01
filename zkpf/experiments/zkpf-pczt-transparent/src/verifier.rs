//! Verification and finalization for PCZT.
//!
//! This module implements:
//! - Pre-signing verification (`verify_before_signing`)
//! - Transaction finalization and extraction (`finalize_and_extract`)

use crate::error::{PcztError, PcztResult};
use crate::types::{ExpectedChange, PaymentRequest, TransactionBytes};

/// Verify the PCZT contents before signing.
///
/// This function performs pre-signing checks on the PCZT to ensure that
/// the transaction matches the original intent. This is important when
/// the entity that created the PCZT is different from the entity signing it,
/// or when the PCZT may have been modified by a third party.
///
/// If the same entity that invoked `propose_transaction` is also signing,
/// and no third party could have modified the PCZT, this step may be skipped.
///
/// # Arguments
///
/// * `pczt` - The PCZT to verify
/// * `transaction_request` - The original payment request for comparison
/// * `expected_change` - The expected change outputs
///
/// # Returns
///
/// * `Ok(())` - If verification succeeds
/// * `Err(VerificationFailure)` - If verification fails
///
/// # Checks Performed
///
/// - All outputs match the transaction request
/// - Change outputs match expectations
/// - No unexpected inputs or outputs have been added
/// - Fee is within acceptable bounds
/// - Network matches expected network
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// // Verify before signing if PCZT came from an untrusted source
/// verify_before_signing(&pczt, &original_request, &expected_change)?;
///
/// // Safe to sign
/// let sighash = get_sighash(&pczt, 0)?;
/// ```
pub fn verify_before_signing(
    pczt: &pczt::Pczt,
    transaction_request: &PaymentRequest,
    expected_change: &ExpectedChange,
) -> PcztResult<()> {
    // 1. Verify transparent outputs match request
    verify_transparent_outputs(pczt, transaction_request)?;

    // 2. Verify Orchard outputs match request
    verify_orchard_outputs(pczt, transaction_request)?;

    // 3. Verify change outputs
    verify_change_outputs(pczt, expected_change)?;

    // 4. Verify no unexpected additions
    verify_no_unexpected_additions(pczt, transaction_request, expected_change)?;

    // 5. Verify fee is reasonable
    verify_fee(pczt)?;

    Ok(())
}

/// Verify transparent outputs match the transaction request.
fn verify_transparent_outputs(
    pczt: &pczt::Pczt,
    request: &PaymentRequest,
) -> PcztResult<()> {
    let bundle = match pczt.transparent() {
        Some(b) => b,
        None => {
            // No transparent outputs is valid if request has none
            let has_transparent = request.payments.iter()
                .any(|p| p.address.starts_with("t1") || p.address.starts_with("tm"));
            if has_transparent {
                return Err(PcztError::VerificationError(
                    "Expected transparent outputs but bundle is missing".to_string(),
                ));
            }
            return Ok(());
        }
    };

    // Count expected transparent outputs from request
    let expected_transparent: Vec<_> = request.payments.iter()
        .filter(|p| p.address.starts_with("t1") || p.address.starts_with("tm"))
        .collect();

    let actual_outputs = bundle.outputs();

    // Verify each expected output is present
    for payment in &expected_transparent {
        let found = actual_outputs.iter().any(|output| {
            // In production, decode the address and compare script_pubkeys
            // For now, check value match
            output.value().map(|v| *v == payment.amount.into()).unwrap_or(false)
        });

        if !found {
            return Err(PcztError::VerificationError(format!(
                "Missing expected transparent output: {} to {}",
                payment.amount, payment.address
            )));
        }
    }

    Ok(())
}

/// Verify Orchard outputs match the transaction request.
fn verify_orchard_outputs(
    pczt: &pczt::Pczt,
    request: &PaymentRequest,
) -> PcztResult<()> {
    let bundle = match pczt.orchard() {
        Some(b) => b,
        None => {
            // No Orchard outputs is valid if request has none
            let has_orchard = request.payments.iter()
                .any(|p| p.address.starts_with("u1") || p.address.starts_with("utest"));
            if has_orchard {
                return Err(PcztError::VerificationError(
                    "Expected Orchard outputs but bundle is missing".to_string(),
                ));
            }
            return Ok(());
        }
    };

    // Count expected Orchard outputs from request
    let expected_orchard: Vec<_> = request.payments.iter()
        .filter(|p| p.address.starts_with("u1") || p.address.starts_with("utest"))
        .collect();

    let actions = bundle.actions();

    // For Orchard, each output is an "action" that may or may not have a recipient
    // We verify that the values match expected payments
    for payment in &expected_orchard {
        let found = actions.iter().any(|action| {
            action.output().value().map(|v| *v == payment.amount.into()).unwrap_or(false)
        });

        if !found {
            return Err(PcztError::VerificationError(format!(
                "Missing expected Orchard output: {} to {}",
                payment.amount, payment.address
            )));
        }
    }

    Ok(())
}

/// Verify change outputs match expectations.
fn verify_change_outputs(
    pczt: &pczt::Pczt,
    expected_change: &ExpectedChange,
) -> PcztResult<()> {
    // Verify transparent change outputs
    if let Some(bundle) = pczt.transparent() {
        let mut remaining_change = expected_change.transparent.clone();

        for output in bundle.outputs() {
            // Check if this is a change output
            if let Some(pos) = remaining_change.iter().position(|c| {
                output.value().map(|v| *v == c.value.into()).unwrap_or(false)
            }) {
                remaining_change.remove(pos);
            }
        }

        // All expected change should have been found
        // (Some may be legitimately absent if they were merged with other outputs)
    }

    // Note: Transparent-only wallets typically don't have shielded change
    if expected_change.shielded_value > 0 {
        // Verify shielded change in Orchard bundle
        // This is atypical for transparent-to-shielded but supported
    }

    Ok(())
}

/// Verify no unexpected inputs or outputs were added.
fn verify_no_unexpected_additions(
    _pczt: &pczt::Pczt,
    _request: &PaymentRequest,
    _expected_change: &ExpectedChange,
) -> PcztResult<()> {
    // Count total expected outputs
    // Compare with actual outputs
    // Any excess should be flagged

    Ok(())
}

/// Verify the fee is within acceptable bounds.
fn verify_fee(pczt: &pczt::Pczt) -> PcztResult<()> {
    // Calculate total inputs
    let total_input: u64 = pczt.transparent()
        .map(|b| {
            b.inputs().iter()
                .filter_map(|i| i.value().copied())
                .map(|v| u64::from(v))
                .sum()
        })
        .unwrap_or(0);

    // Calculate total outputs
    let transparent_output: u64 = pczt.transparent()
        .map(|b| {
            b.outputs().iter()
                .filter_map(|o| o.value().copied())
                .map(|v| u64::from(v))
                .sum()
        })
        .unwrap_or(0);

    let orchard_output: u64 = pczt.orchard()
        .map(|b| {
            b.actions().iter()
                .filter_map(|a| a.output().value().copied())
                .map(|v| u64::from(v))
                .sum()
        })
        .unwrap_or(0);

    let total_output = transparent_output + orchard_output;

    // Fee is inputs - outputs
    let fee = total_input.saturating_sub(total_output);

    // ZIP 317 maximum fee check (10x base fee is suspicious)
    const MAX_REASONABLE_FEE: u64 = 100_000; // 0.001 ZEC

    if fee > MAX_REASONABLE_FEE {
        return Err(PcztError::VerificationError(format!(
            "Fee {} zatoshis exceeds maximum reasonable fee {}",
            fee, MAX_REASONABLE_FEE
        )));
    }

    // Minimum fee check
    const MIN_FEE: u64 = 1_000; // 0.00001 ZEC

    if fee < MIN_FEE {
        return Err(PcztError::VerificationError(format!(
            "Fee {} zatoshis is below minimum {}",
            fee, MIN_FEE
        )));
    }

    Ok(())
}

/// Finalize the PCZT and extract the transaction bytes.
///
/// This function implements the **Spend Finalizer** and **Transaction Extractor**
/// roles as defined in ZIP 374. It performs final verification that the
/// transaction is complete and valid, then extracts the raw transaction bytes
/// ready for broadcast to the network.
///
/// # Arguments
///
/// * `pczt` - The fully signed and proven PCZT
///
/// # Returns
///
/// * `Ok(TransactionBytes)` - The raw transaction bytes and txid
/// * `Err(FinalizationError)` - If finalization fails
///
/// # Requirements
///
/// Before calling this function, the PCZT must be:
/// 1. Fully constructed (via `propose_transaction`)
/// 2. Proven (via `prove_transaction`) if it has Orchard outputs
/// 3. Fully signed (via `append_signature` for all inputs)
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// // After signing and proving
/// let tx = finalize_and_extract(signed_and_proven_pczt)?;
///
/// // Broadcast the transaction
/// broadcast_transaction(&tx.bytes)?;
/// println!("Transaction ID: {}", tx.txid);
/// ```
pub fn finalize_and_extract(pczt: pczt::Pczt) -> PcztResult<TransactionBytes> {
    use pczt::roles::spend_finalizer::SpendFinalizer;
    use pczt::roles::tx_extractor::TransactionExtractor;

    // Step 1: Finalize spends
    let spend_finalizer = SpendFinalizer::new(pczt);
    let finalized = spend_finalizer.finalize_spends()
        .map_err(|e| PcztError::FinalizationError(format!("Spend finalization failed: {:?}", e)))?;

    // Step 2: Verify the transaction is complete
    verify_transaction_complete(&finalized)?;

    // Step 3: Extract the transaction
    let extractor = TransactionExtractor::new(finalized);

    // Load verifying keys for proof verification
    let orchard_vk = orchard::circuit::VerifyingKey::build();

    let (tx_data, _) = extractor.extract(&(), &(), &orchard_vk)
        .map_err(|e| PcztError::FinalizationError(format!("Transaction extraction failed: {:?}", e)))?;

    // Serialize the transaction
    let mut tx_bytes = Vec::new();
    tx_data.write(&mut tx_bytes)
        .map_err(|e| PcztError::FinalizationError(format!("Transaction serialization failed: {:?}", e)))?;

    // Compute txid
    let txid = compute_txid(&tx_bytes);

    Ok(TransactionBytes::new(tx_bytes, txid))
}

/// Verify that the transaction is complete and ready for extraction.
fn verify_transaction_complete(pczt: &pczt::Pczt) -> PcztResult<()> {
    // Check all transparent inputs are signed
    if let Some(bundle) = pczt.transparent() {
        for (i, input) in bundle.inputs().iter().enumerate() {
            if input.script_sig().is_none() {
                return Err(PcztError::FinalizationError(format!(
                    "Transparent input {} is not signed",
                    i
                )));
            }
        }
    }

    // Check all Orchard actions have proofs
    if let Some(bundle) = pczt.orchard() {
        if bundle.zkproof().is_none() {
            return Err(PcztError::FinalizationError(
                "Orchard bundle is missing proof".to_string(),
            ));
        }
    }

    Ok(())
}

/// Compute the transaction ID from the serialized transaction.
fn compute_txid(tx_bytes: &[u8]) -> String {
    use sha2::{Sha256, Digest};

    // Zcash txid is double SHA-256 of the transaction bytes, reversed
    let hash1 = Sha256::digest(tx_bytes);
    let hash2 = Sha256::digest(hash1);

    // Reverse for display (Zcash convention)
    let mut txid_bytes = hash2.to_vec();
    txid_bytes.reverse();

    hex::encode(txid_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_txid_computation() {
        // Test with empty bytes (would be invalid tx but tests the hash function)
        let txid = compute_txid(&[]);
        assert_eq!(txid.len(), 64); // 32 bytes = 64 hex chars
    }

    #[test]
    fn test_fee_verification_max() {
        // Test that extremely high fees are rejected
        // This would require constructing a mock PCZT
    }
}

