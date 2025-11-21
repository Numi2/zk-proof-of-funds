// zkpf/zkpf-circuit/src/gadgets/policy.rs
// Numan Thabit 2025

use halo2_base::{
    gates::{flex_gate::GateChip, GateInstructions},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

pub fn enforce_currency(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    currency: AssignedValue<Fr>,
    req_currency: AssignedValue<Fr>,
) {
    enforce_conditional_equality(ctx, gate, currency, req_currency);
}

pub fn enforce_custodian(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    custodian: AssignedValue<Fr>,
    req_custodian: AssignedValue<Fr>,
) {
    enforce_conditional_equality(ctx, gate, custodian, req_custodian);
}

fn enforce_conditional_equality(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    value: AssignedValue<Fr>,
    required: AssignedValue<Fr>,
) {
    let zero = ctx.load_constant(Fr::zero());
    let one = ctx.load_constant(Fr::one());

    let is_wildcard = gate.is_equal(ctx, required, zero);
    let must_match = gate.sub(ctx, one, is_wildcard);
    let diff = gate.sub(ctx, value, required);
    let masked = gate.mul(ctx, diff, must_match);
    gate.assert_is_const(ctx, &masked, &Fr::zero());
}
