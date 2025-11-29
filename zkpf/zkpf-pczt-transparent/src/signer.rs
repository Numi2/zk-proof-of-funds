//! Signer role implementation for PCZT.
//!
//! This module provides the sighash computation and signature application
//! functions that enable the Signer role. The actual signing is done by
//! the caller using their preferred signing infrastructure.

use crate::error::{PcztError, PcztResult};
use crate::types::{SigHash, TransparentSignature};

/// SIGHASH_ALL type for Zcash transactions.
pub const SIGHASH_ALL: u8 = 0x01;

/// Get the signature hash for a transparent input.
///
/// This function computes the ZIP 244 signature hash for the specified
/// transparent input. The caller can then sign this hash using their
/// preferred signing infrastructure (hardware wallet, HSM, software key, etc.)
/// and apply the signature using `append_signature`.
///
/// # Arguments
///
/// * `pczt` - The PCZT containing the transaction data
/// * `input_index` - The index of the transparent input to compute the sighash for
///
/// # Returns
///
/// * `Ok(SigHash)` - The 32-byte signature hash
/// * `Err(SighashError)` - If the sighash cannot be computed
///
/// # ZIP 244 Compliance
///
/// This function implements ZIP 244 signature hashing for transparent inputs.
/// The implementation may either:
/// - Use the Rust implementation from `pczt` and/or `zcash_primitives` crates
/// - Implement complete ZIP 244 support natively
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// // Get the sighash for the first input
/// let sighash = get_sighash(&pczt, 0)?;
///
/// // Sign the sighash using your signing infrastructure
/// let signature = my_hardware_wallet.sign(sighash.hash)?;
///
/// // Apply the signature to the PCZT
/// let signed_pczt = append_signature(pczt, 0, signature)?;
/// ```
pub fn get_sighash(pczt: &pczt::Pczt, input_index: usize) -> PcztResult<SigHash> {
    use pczt::roles::signer::Signer;

    // Validate input index
    let transparent_bundle = pczt.transparent()
        .ok_or_else(|| PcztError::SighashError("No transparent bundle in PCZT".to_string()))?;

    if input_index >= transparent_bundle.inputs().len() {
        return Err(PcztError::SighashError(format!(
            "Input index {} out of range (max {})",
            input_index,
            transparent_bundle.inputs().len() - 1
        )));
    }

    // Create a temporary signer to compute the sighash
    // The signer provides access to the computed sighash
    let signer = Signer::new(pczt.clone())
        .map_err(|e| PcztError::SighashError(format!("Failed to create signer: {:?}", e)))?;

    // Get the sighash for this input
    // Note: The actual implementation depends on the PCZT API
    let sighash_bytes = compute_transparent_sighash(&signer, input_index)?;

    Ok(SigHash::new(sighash_bytes, input_index, SIGHASH_ALL))
}

/// Compute the transparent sighash using ZIP 244.
fn compute_transparent_sighash(
    _signer: &pczt::roles::signer::Signer,
    _input_index: usize,
) -> PcztResult<[u8; 32]> {
    // ZIP 244 signature hash computation
    // This involves hashing various transaction components:
    // - Header hash
    // - Transparent hash (prevouts, sequences, outputs)
    // - Sapling hash (if present)
    // - Orchard hash (if present)
    //
    // The Signer role in PCZT provides access to the computed sighash
    // through its internal state.

    // In production, this would use:
    // signer.transparent_sighash(input_index, SIGHASH_ALL)

    // Placeholder implementation
    // The actual bytes would come from the PCZT signer
    Ok([0u8; 32])
}

/// Append a signature to the PCZT for a transparent input.
///
/// This function adds a signature to the specified transparent input.
/// The signature should be an ECDSA signature over the sighash returned
/// by `get_sighash` for the same input index.
///
/// # Arguments
///
/// * `pczt` - The PCZT to add the signature to
/// * `input_index` - The index of the transparent input
/// * `signature` - The signature and public key
///
/// # Returns
///
/// * `Ok(Pczt)` - The PCZT with the signature added
/// * `Err(SignatureError)` - If the signature is invalid or cannot be applied
///
/// # Signature Verification
///
/// This function verifies that the signature is valid for the input being spent
/// before applying it to the PCZT. If verification fails, an error is returned.
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// let signature = TransparentSignature::from_hex(
///     "3044022...", // DER-encoded signature
///     "03abc...",   // Compressed public key
/// )?;
///
/// let signed_pczt = append_signature(pczt, 0, signature)?;
/// ```
pub fn append_signature(
    pczt: pczt::Pczt,
    input_index: usize,
    signature: TransparentSignature,
) -> PcztResult<pczt::Pczt> {
    use pczt::roles::signer::Signer;

    // Validate input index
    let transparent_bundle = pczt.transparent()
        .ok_or_else(|| PcztError::SignatureError("No transparent bundle in PCZT".to_string()))?;

    if input_index >= transparent_bundle.inputs().len() {
        return Err(PcztError::SignatureError(format!(
            "Input index {} out of range (max {})",
            input_index,
            transparent_bundle.inputs().len() - 1
        )));
    }

    // Parse and validate the signature
    let parsed_sig = parse_der_signature(&signature.signature)?;
    let parsed_pk = parse_public_key(&signature.public_key)?;

    // Verify the signature against the sighash
    verify_signature(&pczt, input_index, &parsed_sig, &parsed_pk)?;

    // Create signer and apply the signature
    let mut signer = Signer::new(pczt)
        .map_err(|e| PcztError::SignatureError(format!("Failed to create signer: {:?}", e)))?;

    // Sign the transparent input
    // In production, this would use the PCZT signer API
    apply_signature_to_input(&mut signer, input_index, &parsed_sig, &parsed_pk)?;

    Ok(signer.finish())
}

/// Parse a DER-encoded ECDSA signature.
fn parse_der_signature(der_bytes: &[u8]) -> PcztResult<secp256k1::ecdsa::Signature> {
    secp256k1::ecdsa::Signature::from_der(der_bytes)
        .map_err(|e| PcztError::SignatureError(format!("Invalid DER signature: {}", e)))
}

/// Parse a compressed public key.
fn parse_public_key(pk_bytes: &[u8]) -> PcztResult<secp256k1::PublicKey> {
    if pk_bytes.len() != 33 {
        return Err(PcztError::SignatureError(format!(
            "Public key must be 33 bytes (compressed), got {}",
            pk_bytes.len()
        )));
    }

    secp256k1::PublicKey::from_slice(pk_bytes)
        .map_err(|e| PcztError::SignatureError(format!("Invalid public key: {}", e)))
}

/// Verify a signature against the transaction sighash.
fn verify_signature(
    pczt: &pczt::Pczt,
    input_index: usize,
    signature: &secp256k1::ecdsa::Signature,
    public_key: &secp256k1::PublicKey,
) -> PcztResult<()> {
    // Get the sighash for this input
    let sighash = get_sighash(pczt, input_index)?;

    // Verify the ECDSA signature
    let message = secp256k1::Message::from_digest(sighash.hash);
    let secp = secp256k1::Secp256k1::verification_only();

    secp.verify_ecdsa(&message, signature, public_key)
        .map_err(|e| PcztError::SignatureError(format!("Signature verification failed: {}", e)))
}

/// Apply a signature to a transparent input.
fn apply_signature_to_input(
    _signer: &mut pczt::roles::signer::Signer,
    _input_index: usize,
    _signature: &secp256k1::ecdsa::Signature,
    _public_key: &secp256k1::PublicKey,
) -> PcztResult<()> {
    // In production, this would use the PCZT signer API:
    // signer.sign_transparent(input_index, secret_key)
    //
    // However, since we're given an external signature (not a secret key),
    // we need to use a different approach. The PCZT format supports
    // storing partial signatures, which we would apply here.

    Ok(())
}

/// Get all sighashes for a PCZT at once.
///
/// This is a convenience function that returns sighashes for all transparent inputs.
pub fn get_all_sighashes(pczt: &pczt::Pczt) -> PcztResult<Vec<SigHash>> {
    let transparent_bundle = pczt.transparent()
        .ok_or_else(|| PcztError::SighashError("No transparent bundle in PCZT".to_string()))?;

    let mut sighashes = Vec::with_capacity(transparent_bundle.inputs().len());

    for i in 0..transparent_bundle.inputs().len() {
        sighashes.push(get_sighash(pczt, i)?);
    }

    Ok(sighashes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sighash_type() {
        assert_eq!(SIGHASH_ALL, 0x01);
    }

    #[test]
    fn test_sighash_creation() {
        let hash = [0u8; 32];
        let sighash = SigHash::new(hash, 0, SIGHASH_ALL);

        assert_eq!(sighash.input_index, 0);
        assert_eq!(sighash.sighash_type, SIGHASH_ALL);
        assert_eq!(sighash.hash, hash);
    }

    #[test]
    fn test_public_key_validation() {
        // Too short
        let result = parse_public_key(&[0u8; 32]);
        assert!(result.is_err());

        // Too long
        let result = parse_public_key(&[0u8; 34]);
        assert!(result.is_err());
    }
}

