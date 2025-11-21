// zkpf/zkpf-circuit/src/gadgets/compare.rs
// Numan Thabit 2025

use halo2_base::{
    gates::{
        flex_gate::{GateChip, GateInstructions},
        range::{RangeChip, RangeInstructions},
    },
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

/// Enforce a >= b for 64-bit encoded values.
pub fn enforce_geq(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    range: &RangeChip<Fr>,
    a: AssignedValue<Fr>,
    b: AssignedValue<Fr>,
) {
    let lt = range.is_less_than(ctx, a, b, 64);
    gate.assert_is_const(ctx, &lt, &Fr::zero());
}

/// Enforce a <= b.
pub fn enforce_leq(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    range: &RangeChip<Fr>,
    a: AssignedValue<Fr>,
    b: AssignedValue<Fr>,
) {
    let lt = range.is_less_than(ctx, b, a, 64);
    gate.assert_is_const(ctx, &lt, &Fr::zero());
}
