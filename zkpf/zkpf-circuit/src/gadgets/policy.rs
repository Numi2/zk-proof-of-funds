// zkpf/zkpf-circuit/src/gadgets/policy.rs
// Numan Thabit 2025

use halo2_base::{
    gates::{flex_gate::GateChip, GateInstructions},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

/// Enforce that the attestation currency matches the required currency.
/// If `req_currency` is zero, any currency is accepted (wildcard).
pub fn enforce_currency(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    currency: AssignedValue<Fr>,
    req_currency: AssignedValue<Fr>,
) {
    let zero = ctx.load_constant(Fr::zero());
    let one = ctx.load_constant(Fr::one());

    let is_wildcard = gate.is_equal(ctx, req_currency, zero);
    let must_match = gate.sub(ctx, one, is_wildcard);
    let diff = gate.sub(ctx, currency, req_currency);
    let masked = gate.mul(ctx, diff, must_match);
    gate.assert_is_const(ctx, &masked, &Fr::zero());
}
