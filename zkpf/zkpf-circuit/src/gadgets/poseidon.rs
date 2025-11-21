// zkpf/zkpf-circuit/src/gadgets/poseidon.rs
// Numan Thabit 2025

use halo2_base::{
    gates::flex_gate::GateChip,
    poseidon::hasher::{spec::OptimizedPoseidonSpec, PoseidonHasher},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

const POSEIDON_T: usize = 6;
const POSEIDON_RATE: usize = 5;
const POSEIDON_FULL_ROUNDS: usize = 8;
const POSEIDON_PARTIAL_ROUNDS: usize = 57;

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
