//! Comparison gadgets.
//!
//! These gadgets implement comparison operations using bit decomposition.
//! Note: These are expensive in terms of constraints and should be used
//! sparingly.

use crate::driver::{Driver, WireValue};
use crate::error::Error;
use crate::maybe::Maybe;
use crate::gadgets::boolean::BoolWire;
use ff::{Field, PrimeField};

/// Check if two wire values are equal.
///
/// Returns a boolean wire that is 1 if a == b, 0 otherwise.
pub fn is_equal<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<BoolWire<D>, Error>
where
    D::F: PrimeField,
{
    // Compute a - b
    let diff_value = D::just(|| {
        if D::has_witness() {
            *a.value.snag() - *b.value.snag()
        } else {
            D::F::ZERO
        }
    });

    let diff_wire = dr.add(|| [
        (a.wire.clone(), D::F::ONE),
        (b.wire.clone(), -D::F::ONE),
    ])?;

    // Use the is_zero gadget
    is_zero(dr, &WireValue::new(diff_wire, diff_value))
}

/// Check if a wire value is zero.
///
/// Returns a boolean wire that is 1 if a == 0, 0 otherwise.
///
/// This uses the technique: if a != 0, then a has an inverse inv,
/// and we can compute: result = 1 - a * inv
pub fn is_zero<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
) -> Result<BoolWire<D>, Error>
where
    D::F: PrimeField,
{
    // Compute the inverse if non-zero, or 0 if zero
    let inv_value = D::just(|| {
        if D::has_witness() {
            let a_val = *a.value.snag();
            if a_val == D::F::ZERO {
                D::F::ZERO
            } else {
                a_val.invert().unwrap_or(D::F::ZERO)
            }
        } else {
            D::F::ZERO
        }
    });

    let _inv_wire = dr.alloc(|| {
        let a_val = *a.value.snag();
        if a_val == D::F::ZERO {
            Ok(D::F::ZERO)
        } else {
            Ok(a_val.invert().unwrap_or(D::F::ZERO))
        }
    })?;

    // Compute a * inv
    let a_times_inv_value = D::just(|| {
        if D::has_witness() {
            let a_val = *a.value.snag();
            let inv_val = inv_value.view().take();
            a_val * *inv_val
        } else {
            D::F::ZERO
        }
    });

    let (_, _, a_times_inv) = dr.mul(|| {
        let a_val = *a.value.snag();
        let inv_val = *inv_value.snag();
        Ok((a_val, inv_val, a_val * inv_val))
    })?;

    // result = 1 - a * inv
    // If a == 0: result = 1 - 0 = 1
    // If a != 0: result = 1 - 1 = 0
    let result_value = D::just(|| {
        if D::has_witness() {
            D::F::ONE - *a_times_inv_value.snag()
        } else {
            D::F::ONE
        }
    });

    let result_wire = dr.add(|| [
        (D::ONE.clone(), D::F::ONE),
        (a_times_inv.clone(), -D::F::ONE),
    ])?;

    // Constrain: a * result = 0
    // This ensures that if result = 1, then a must be 0
    let (_, _, zero_check) = dr.mul(|| {
        let a_val = *a.value.snag();
        let result_val = *result_value.snag();
        Ok((a_val, result_val, a_val * result_val))
    })?;

    dr.enforce_zero(|| [(zero_check, D::F::ONE)])?;

    // Constrain: a * inv + result = 1
    // This ensures that either a has an inverse (a != 0) or result = 1
    dr.enforce_zero(|| [
        (a_times_inv, D::F::ONE),
        (result_wire.clone(), D::F::ONE),
        (D::ONE.clone(), -D::F::ONE),
    ])?;

    Ok(BoolWire::new_unchecked(WireValue::new(result_wire, result_value)))
}

/// Check if a wire value is non-zero.
pub fn is_nonzero<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
) -> Result<BoolWire<D>, Error>
where
    D::F: PrimeField,
{
    let is_zero_result = is_zero(dr, a)?;
    crate::gadgets::boolean::not(dr, &is_zero_result)
}

/// Assert that two wire values are equal.
pub fn assert_equal<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<(), Error> {
    dr.enforce_zero(|| [
        (a.wire.clone(), D::F::ONE),
        (b.wire.clone(), -D::F::ONE),
    ])
}

/// Assert that a wire value is zero.
pub fn assert_zero<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
) -> Result<(), Error> {
    dr.enforce_zero(|| [(a.wire.clone(), D::F::ONE)])
}

/// Assert that a wire value equals a constant.
pub fn assert_constant<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    constant: D::F,
) -> Result<(), Error> {
    dr.enforce_zero(|| [
        (a.wire.clone(), D::F::ONE),
        (D::ONE.clone(), -constant),
    ])
}

#[cfg(test)]
mod tests {
    // Tests would go here
}

