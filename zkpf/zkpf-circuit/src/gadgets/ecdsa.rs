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

pub fn verify_ecdsa_over_attestation(
    ctx: &mut Context<Fr>,
    range: &RangeChip<Fr>,
    att: &AttestationWitness,
    custodian_pubkey: &Secp256k1Pubkey,
) {
    let fp_chip = SecpFpChip::new(range, SECP_LIMB_BITS, SECP_NUM_LIMBS);
    let fq_chip = FqChip::new(range, SECP_LIMB_BITS, SECP_NUM_LIMBS);
    let ecc_chip = Secp256k1Chip::new(&fp_chip);

    let pk = load_pubkey(ctx, &ecc_chip, custodian_pubkey);
    let (r, s) = load_signature(ctx, &fq_chip, &att.signature);
    let msghash = load_scalar(ctx, &fq_chip, &att.message_hash);

    let verified = ecdsa_verify_no_pubkey_check::<Fr, Fp, Fq, Secp256k1Affine>(
        &ecc_chip, ctx, pk, r, s, msghash, 4, 4,
    );
    range.gate().assert_is_const(ctx, &verified, &Fr::one());
}

fn load_pubkey<'chip>(
    ctx: &mut Context<Fr>,
    ecc_chip: &Secp256k1Chip<'chip, Fr>,
    pk: &Secp256k1Pubkey,
) -> EcPoint<Fr, <SecpFpChip<'chip, Fr> as FieldChip<Fr>>::FieldPoint> {
    let x = fp_from_bytes(&pk.x);
    let y = fp_from_bytes(&pk.y);
    ecc_chip.load_private::<Secp256k1Affine>(ctx, (x, y))
}

fn load_signature<'chip>(
    ctx: &mut Context<Fr>,
    fq_chip: &FqChip<'chip, Fr>,
    sig: &EcdsaSignature,
) -> (ProperCrtUint<Fr>, ProperCrtUint<Fr>) {
    let r = fq_chip.load_private(ctx, fq_from_bytes(&sig.r));
    let s = fq_chip.load_private(ctx, fq_from_bytes(&sig.s));
    (r, s)
}

fn load_scalar<'chip>(
    ctx: &mut Context<Fr>,
    fq_chip: &FqChip<'chip, Fr>,
    bytes: &[u8; 32],
) -> ProperCrtUint<Fr> {
    fq_chip.load_private(ctx, fq_from_bytes(bytes))
}

fn fq_from_bytes(bytes: &[u8; 32]) -> Fq {
    let mut le_bytes = *bytes;
    le_bytes.reverse();
    let maybe = Fq::from_bytes(&le_bytes);
    if bool::from(maybe.is_some()) {
        maybe.unwrap()
    } else {
        panic!("invalid secp256k1 scalar encoding")
    }
}

fn fp_from_bytes(bytes: &[u8; 32]) -> Fp {
    let mut le_bytes = *bytes;
    le_bytes.reverse();
    let maybe = Fp::from_bytes(&le_bytes);
    if bool::from(maybe.is_some()) {
        maybe.unwrap()
    } else {
        panic!("invalid secp256k1 coordinate encoding")
    }
}
