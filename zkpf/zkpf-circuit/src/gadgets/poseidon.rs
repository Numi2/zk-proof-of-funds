// zkpf/zkpf-circuit/src/gadgets/poseidon.rs
// Numan Thabit 2025

use halo2_base::{
    gates::flex_gate::GateChip,
    poseidon::hasher::{spec::OptimizedPoseidonSpec, PoseidonHasher},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

// ============================================================
// Poseidon Hash Parameters - Canonical Source
// ============================================================
//
// These parameters define the Poseidon hash configuration used throughout
// the ZKPF system for hashing attestations, computing nullifiers, and
// deriving custodian pubkey hashes.
//
// The configuration uses the Poseidon permutation over the BN256 scalar field
// with the following security-relevant parameters:
//
// - T (width) = 6: Total state size (capacity + rate)
// - RATE = 5: Number of field elements absorbed per permutation
// - FULL_ROUNDS = 8: Full S-box rounds (4 at start, 4 at end)
// - PARTIAL_ROUNDS = 57: Partial S-box rounds (middle section)
//
// These parameters are chosen to provide ~128-bit security against
// algebraic attacks on the Poseidon sponge construction.
//
// IMPORTANT: All modules in the ZKPF system MUST use these same parameters
// to ensure hash compatibility. Changing these values will break proof
// verification and nullifier computation.

/// Poseidon state width (T parameter).
/// This is the total number of field elements in the permutation state.
pub const POSEIDON_T: usize = 6;

/// Poseidon absorption rate.
/// Number of field elements that can be absorbed per permutation call.
/// The capacity (T - RATE = 1) provides security margin.
pub const POSEIDON_RATE: usize = 5;

/// Number of full rounds in the Poseidon permutation.
/// Split evenly: 4 rounds at the beginning, 4 at the end.
pub const POSEIDON_FULL_ROUNDS: usize = 8;

/// Number of partial rounds in the Poseidon permutation.
/// These use a single S-box per round for efficiency while maintaining security.
pub const POSEIDON_PARTIAL_ROUNDS: usize = 57;

pub fn poseidon_hash3(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    a: AssignedValue<Fr>,
    b: AssignedValue<Fr>,
    c: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    hash_elements(ctx, gate, &[a, b, c])
}

pub fn poseidon_hash4(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    a: AssignedValue<Fr>,
    b: AssignedValue<Fr>,
    c: AssignedValue<Fr>,
    d: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    hash_elements(ctx, gate, &[a, b, c, d])
}

#[allow(clippy::too_many_arguments)]
pub fn hash_attestation(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    balance: AssignedValue<Fr>,
    attestation_id: AssignedValue<Fr>,
    currency: AssignedValue<Fr>,
    custodian: AssignedValue<Fr>,
    issued_at: AssignedValue<Fr>,
    valid_until: AssignedValue<Fr>,
    account_id_hash: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    hash_elements(
        ctx,
        gate,
        &[
            balance,
            attestation_id,
            currency,
            custodian,
            issued_at,
            valid_until,
            account_id_hash,
        ],
    )
}

pub fn hash_elements(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    inputs: &[AssignedValue<Fr>],
) -> AssignedValue<Fr> {
    let mut hasher = PoseidonHasher::<Fr, POSEIDON_T, POSEIDON_RATE>::new(poseidon_spec());
    hasher.initialize_consts(ctx, gate);
    hasher.hash_fix_len_array(ctx, gate, inputs)
}

fn poseidon_spec() -> OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE> {
    OptimizedPoseidonSpec::new::<POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, 0>()
}
