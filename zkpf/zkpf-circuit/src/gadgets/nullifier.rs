// zkpf/zkpf-circuit/src/gadgets/nullifier.rs
// Numan Thabit 2025

use halo2_base::{gates::flex_gate::GateChip, AssignedValue, Context};
use halo2curves_axiom::bn256::Fr;

use crate::gadgets::poseidon::poseidon_hash4;

pub fn compute_nullifier(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    account_id_hash: AssignedValue<Fr>,
    verifier_scope: AssignedValue<Fr>,
    policy_id: AssignedValue<Fr>,
    epoch: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    poseidon_hash4(ctx, gate, account_id_hash, verifier_scope, policy_id, epoch)
}
