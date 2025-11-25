// zkpf/zkpf-circuit/src/gadgets/policy.rs
// Numan Thabit 2025

use halo2_base::{
    gates::{flex_gate::GateChip, GateInstructions},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

/// Sentinel value indicating "any currency is accepted" (wildcard).
/// 
/// We use `u32::MAX` (0xFFFFFFFF = 4294967295) rather than 0 because:
/// - ISO 4217 currency codes are 3-digit numbers (e.g., USD=840, EUR=978)
/// - 0 could theoretically be assigned to a currency in the future
/// - `u32::MAX` is unambiguously outside the valid ISO currency code range
///
/// # Security Note
/// If a custodian accidentally sets `currency_code_int = CURRENCY_WILDCARD`,
/// proofs for that attestation would pass any currency requirement. However,
/// this is far less likely than accidentally using 0 (which might be a default
/// or uninitialized value).
pub const CURRENCY_WILDCARD: u32 = u32::MAX;

/// Enforce that the attestation currency matches the required currency.
/// 
/// # Arguments
/// * `currency` - The currency code from the attestation (witness)
/// * `req_currency` - The required currency code from public inputs
///
/// # Currency Matching Rules
/// - If `req_currency == CURRENCY_WILDCARD` (0xFFFFFFFF), any currency is accepted
/// - Otherwise, `currency` must exactly equal `req_currency`
///
/// # Example
/// ```ignore
/// // Require USD (840)
/// enforce_currency(ctx, gate, currency, 840);
///
/// // Accept any currency  
/// enforce_currency(ctx, gate, currency, CURRENCY_WILDCARD);
/// ```
pub fn enforce_currency(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    currency: AssignedValue<Fr>,
    req_currency: AssignedValue<Fr>,
) {
    let wildcard = ctx.load_constant(Fr::from(CURRENCY_WILDCARD as u64));
    let one = ctx.load_constant(Fr::one());

    // Check if the required currency is the wildcard value
    let is_wildcard = gate.is_equal(ctx, req_currency, wildcard);
    // If not wildcard, we must enforce a match
    let must_match = gate.sub(ctx, one, is_wildcard);
    // Compute difference between actual and required currency
    let diff = gate.sub(ctx, currency, req_currency);
    // If must_match=1, this enforces diff=0 (exact match)
    // If must_match=0 (wildcard), any diff is allowed
    let masked = gate.mul(ctx, diff, must_match);
    gate.assert_is_const(ctx, &masked, &Fr::zero());
}
