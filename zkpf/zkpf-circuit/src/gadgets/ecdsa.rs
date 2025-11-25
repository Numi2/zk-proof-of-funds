// zkpf/zkpf-circuit/src/gadgets/ecdsa.rs
// Numan Thabit 2025

use halo2_base::{
    gates::{range::RangeChip, GateInstructions, RangeInstructions},
    Context,
};
use halo2_ecc::{
    bigint::ProperCrtUint,
    ecc::{ecdsa::ecdsa_verify_no_pubkey_check, EcPoint},
    fields::FieldChip,
    secp256k1::{FpChip as SecpFpChip, FqChip, Secp256k1Chip},
};
use halo2curves_axiom::{
    bn256::Fr,
    secp256k1::{Fp, Fq, Secp256k1Affine},
};

use crate::gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey};

const SECP_LIMB_BITS: usize = 88;
const SECP_NUM_LIMBS: usize = 3;

/// secp256k1 curve constant b = 7 (curve equation: y² = x³ + 7)
const SECP256K1_B: u64 = 7;

/// Errors that can occur during ECDSA verification in the circuit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EcdsaError {
    /// The public key x-coordinate is not a valid secp256k1 base field element.
    InvalidPubkeyX,
    /// The public key y-coordinate is not a valid secp256k1 base field element.
    InvalidPubkeyY,
    /// The public key point (x, y) does not lie on the secp256k1 curve.
    /// A valid point must satisfy y² = x³ + 7 (mod p).
    PubkeyNotOnCurve,
    /// The signature r component is not a valid secp256k1 scalar field element.
    InvalidSignatureR,
    /// The signature s component is not a valid secp256k1 scalar field element.
    InvalidSignatureS,
    /// The message hash is not a valid secp256k1 scalar field element.
    InvalidMessageHash,
}

impl std::fmt::Display for EcdsaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPubkeyX => write!(f, "invalid secp256k1 public key x-coordinate: value exceeds base field modulus"),
            Self::InvalidPubkeyY => write!(f, "invalid secp256k1 public key y-coordinate: value exceeds base field modulus"),
            Self::PubkeyNotOnCurve => write!(f, "public key is not on the secp256k1 curve: y² ≠ x³ + 7 (mod p)"),
            Self::InvalidSignatureR => write!(f, "invalid ECDSA signature r component: value exceeds scalar field modulus"),
            Self::InvalidSignatureS => write!(f, "invalid ECDSA signature s component: value exceeds scalar field modulus"),
            Self::InvalidMessageHash => write!(f, "invalid message hash: value exceeds secp256k1 scalar field modulus"),
        }
    }
}

impl std::error::Error for EcdsaError {}

/// Verify an ECDSA signature over an attestation within the circuit.
///
/// This function:
/// 1. Validates and loads the public key coordinates
/// 2. Verifies the public key lies on the secp256k1 curve (prevents invalid curve attacks)
/// 3. Validates and loads the signature components
/// 4. Verifies the ECDSA signature
///
/// # Errors
///
/// Returns an error if any of the cryptographic values are invalid:
///
/// - `EcdsaError::InvalidPubkeyX` - x-coordinate >= secp256k1 base field modulus
/// - `EcdsaError::InvalidPubkeyY` - y-coordinate >= secp256k1 base field modulus
/// - `EcdsaError::PubkeyNotOnCurve` - point (x, y) does not satisfy y² = x³ + 7
/// - `EcdsaError::InvalidSignatureR` - r >= secp256k1 scalar field modulus
/// - `EcdsaError::InvalidSignatureS` - s >= secp256k1 scalar field modulus
/// - `EcdsaError::InvalidMessageHash` - hash >= secp256k1 scalar field modulus
///
/// # Security
///
/// The on-curve check (y² = x³ + 7) is essential to prevent invalid curve attacks
/// where an attacker could supply points from weaker curves. This check is performed
/// both as pre-circuit validation (returning an error) and as an in-circuit constraint
/// (defense in depth).
pub fn verify_ecdsa_over_attestation(
    ctx: &mut Context<Fr>,
    range: &RangeChip<Fr>,
    att: &AttestationWitness,
    custodian_pubkey: &Secp256k1Pubkey,
) -> Result<(), EcdsaError> {
    let fp_chip = SecpFpChip::new(range, SECP_LIMB_BITS, SECP_NUM_LIMBS);
    let fq_chip = FqChip::new(range, SECP_LIMB_BITS, SECP_NUM_LIMBS);
    let ecc_chip = Secp256k1Chip::new(&fp_chip);

    // Parse and validate pubkey coordinates as field elements
    let (x_fp, y_fp) = parse_pubkey_coords(custodian_pubkey)?;

    // CRITICAL: Pre-circuit validation that the point is on the secp256k1 curve.
    // This check returns an error rather than panicking, ensuring consistent
    // error handling for all invalid inputs.
    validate_point_on_curve(&x_fp, &y_fp)?;

    // Load the validated pubkey into the circuit
    let pk = ecc_chip.load_private::<Secp256k1Affine>(ctx, (x_fp, y_fp));

    // In-circuit constraint for defense in depth - this ensures a malicious prover
    // cannot bypass the pre-circuit check by manipulating witness values.
    constrain_pubkey_on_curve(ctx, &fp_chip, &pk);

    let (r, s) = load_signature(ctx, &fq_chip, &att.signature)?;
    let msghash = load_scalar(ctx, &fq_chip, &att.message_hash)
        .map_err(|_| EcdsaError::InvalidMessageHash)?;

    let verified = ecdsa_verify_no_pubkey_check::<Fr, Fp, Fq, Secp256k1Affine>(
        &ecc_chip, ctx, pk, r, s, msghash, 4, 4,
    );
    range.gate().assert_is_const(ctx, &verified, &Fr::one());

    Ok(())
}

/// Parse public key coordinates from bytes, returning an error if invalid.
fn parse_pubkey_coords(pk: &Secp256k1Pubkey) -> Result<(Fp, Fp), EcdsaError> {
    let x = try_fp_from_bytes(&pk.x).map_err(|_| EcdsaError::InvalidPubkeyX)?;
    let y = try_fp_from_bytes(&pk.y).map_err(|_| EcdsaError::InvalidPubkeyY)?;
    Ok((x, y))
}

/// Validate that a point (x, y) lies on the secp256k1 curve: y² = x³ + 7 (mod p).
///
/// This is a pre-circuit check that returns an error rather than panicking,
/// ensuring consistent error handling in the `verify_ecdsa_over_attestation` function.
///
/// # Errors
///
/// Returns `EcdsaError::PubkeyNotOnCurve` if the point does not satisfy the curve equation.
fn validate_point_on_curve(x: &Fp, y: &Fp) -> Result<(), EcdsaError> {
    // Compute y² (left-hand side)
    let y_squared = y.square();

    // Compute x³ + 7 (right-hand side)
    let x_squared = x.square();
    let x_cubed = x_squared * x;
    let rhs = x_cubed + Fp::from(SECP256K1_B);

    // Check curve equation: y² = x³ + 7
    if y_squared != rhs {
        return Err(EcdsaError::PubkeyNotOnCurve);
    }

    Ok(())
}

/// Constrains that a public key point (x, y) lies on the secp256k1 curve.
///
/// The secp256k1 curve is defined by the equation: y² = x³ + 7 (mod p)
/// where p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
///
/// This is an in-circuit constraint that provides defense-in-depth. It ensures
/// that even if the pre-circuit validation is somehow bypassed, a malicious prover
/// cannot create a valid proof with an off-curve point.
///
/// Note: The pre-circuit validation in `validate_point_on_curve` provides the
/// user-friendly error. This constraint exists as a cryptographic backstop.
fn constrain_pubkey_on_curve<'chip>(
    ctx: &mut Context<Fr>,
    fp_chip: &SecpFpChip<'chip, Fr>,
    pk: &EcPoint<Fr, ProperCrtUint<Fr>>,
) {
    // Compute y² (left-hand side of curve equation)
    let y_squared = fp_chip.mul(ctx, pk.y.clone(), pk.y.clone());

    // Compute x² first
    let x_squared = fp_chip.mul(ctx, pk.x.clone(), pk.x.clone());
    // Compute x³ = x² * x
    let x_cubed = fp_chip.mul(ctx, x_squared, pk.x.clone());

    // Load curve constant b = 7
    let b = fp_chip.load_constant(ctx, Fp::from(SECP256K1_B));

    // Compute x³ + 7 (right-hand side of curve equation)
    let rhs = fp_chip.add_no_carry(ctx, x_cubed, b);
    let rhs = fp_chip.carry_mod(ctx, rhs);

    // Assert y² = x³ + 7 (mod p)
    // This constraint ensures the public key is a valid point on secp256k1
    fp_chip.assert_equal(ctx, y_squared, rhs);
}

fn load_signature(
    ctx: &mut Context<Fr>,
    fq_chip: &FqChip<'_, Fr>,
    sig: &EcdsaSignature,
) -> Result<(ProperCrtUint<Fr>, ProperCrtUint<Fr>), EcdsaError> {
    let r_val = try_fq_from_bytes(&sig.r).map_err(|_| EcdsaError::InvalidSignatureR)?;
    let s_val = try_fq_from_bytes(&sig.s).map_err(|_| EcdsaError::InvalidSignatureS)?;
    let r = fq_chip.load_private(ctx, r_val);
    let s = fq_chip.load_private(ctx, s_val);
    Ok((r, s))
}

fn load_scalar(
    ctx: &mut Context<Fr>,
    fq_chip: &FqChip<'_, Fr>,
    bytes: &[u8; 32],
) -> Result<ProperCrtUint<Fr>, EcdsaError> {
    let scalar = try_fq_from_bytes(bytes).map_err(|_| EcdsaError::InvalidMessageHash)?;
    Ok(fq_chip.load_private(ctx, scalar))
}

/// Error returned when a byte array cannot be converted to a valid field element.
#[derive(Debug, Clone, Copy)]
pub struct FieldElementError;

/// Try to convert big-endian bytes to a secp256k1 scalar field element (Fq).
///
/// Returns an error if the value is >= the scalar field modulus n, where:
/// n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
///
/// This is a stricter check than simply using `Fq::from_bytes`, ensuring the
/// input represents a valid scalar without modular reduction.
pub fn try_fq_from_bytes(bytes: &[u8; 32]) -> Result<Fq, FieldElementError> {
    let mut le_bytes = *bytes;
    le_bytes.reverse();
    Fq::from_bytes(&le_bytes)
        .into_option()
        .ok_or(FieldElementError)
}

/// Try to convert big-endian bytes to a secp256k1 base field element (Fp).
///
/// Returns an error if the value is >= the base field modulus p, where:
/// p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
///
/// This is a stricter check than simply using `Fp::from_bytes`, ensuring the
/// input represents a valid coordinate without modular reduction.
pub fn try_fp_from_bytes(bytes: &[u8; 32]) -> Result<Fp, FieldElementError> {
    let mut le_bytes = *bytes;
    le_bytes.reverse();
    Fp::from_bytes(&le_bytes)
        .into_option()
        .ok_or(FieldElementError)
}
