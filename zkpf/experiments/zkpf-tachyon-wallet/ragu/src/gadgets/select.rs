//! Selection gadgets for conditional logic.

use crate::driver::{Driver, WireValue};
use crate::error::Error;
use crate::maybe::Maybe;
use crate::gadgets::boolean::BoolWire;
use ff::Field;

/// Conditional selection: if condition then a else b.
///
/// Returns a if condition is true (1), b otherwise.
/// Formula: result = condition * a + (1 - condition) * b
///        = condition * (a - b) + b
pub fn select<D: Driver>(
    dr: &mut D,
    condition: &BoolWire<D>,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    // Compute condition * (a - b) using multiplication constraint
    // The diff_value is computed inline in the mul closure
    let (_, _, cond_diff_wire) = dr.mul(|| {
        let cond_val = *condition.wire.value.snag();
        let a_val = *a.value.snag();
        let b_val = *b.value.snag();
        let diff_val = a_val - b_val;
        Ok((cond_val, diff_val, cond_val * diff_val))
    })?;

    // Compute result = condition * (a - b) + b
    let result_value = D::just(|| {
        if D::has_witness() {
            let cond_val = *condition.wire.value.snag();
            let a_val = *a.value.snag();
            let b_val = *b.value.snag();
            cond_val * (a_val - b_val) + b_val
        } else {
            D::F::ZERO
        }
    });

    let result_wire = dr.add(|| [
        (cond_diff_wire, D::F::ONE),
        (b.wire.clone(), D::F::ONE),
    ])?;

    Ok(WireValue::new(result_wire, result_value))
}

/// Select from multiple values based on a selector index.
///
/// The selector must be decomposed into bits, and each bit is used
/// to progressively narrow down the selection.
pub fn select_from_vec<D: Driver>(
    dr: &mut D,
    selector_bits: &[BoolWire<D>],
    values: Vec<WireValue<D>>,
) -> Result<WireValue<D>, Error>
where
    crate::Witness<D, D::F>: Clone,
{
    if values.is_empty() {
        return Err(Error::InvalidConfiguration("select_from_vec: empty values"));
    }

    if values.len() == 1 {
        return Ok(values.into_iter().next().unwrap());
    }

    // Check that we have enough bits
    let required_bits = (values.len() as f64).log2().ceil() as usize;
    if selector_bits.len() < required_bits {
        return Err(Error::InvalidConfiguration(
            "select_from_vec: not enough selector bits",
        ));
    }

    // Pad values to power of 2 if needed
    let padded_len = 1 << selector_bits.len();
    let last_value = values.last().unwrap().clone();
    let mut padded_values = values;
    while padded_values.len() < padded_len {
        // Pad with the last value
        padded_values.push(last_value.clone());
    }

    // Use a tree selection
    let mut current = padded_values;
    for bit in selector_bits {
        let mut next = Vec::with_capacity(current.len() / 2);
        let mut chunks_iter = current.into_iter();
        while let (Some(first), second) = (chunks_iter.next(), chunks_iter.next()) {
            if let Some(second) = second {
                let selected = select(dr, bit, &second, &first)?;
                next.push(selected);
            } else {
                next.push(first);
            }
        }
        current = next;
    }

    Ok(current.into_iter().next().unwrap())
}

/// Assert that the condition is true (1).
pub fn assert_true<D: Driver>(
    dr: &mut D,
    condition: &BoolWire<D>,
) -> Result<(), Error> {
    dr.enforce_zero(|| [
        (condition.wire.wire.clone(), D::F::ONE),
        (D::ONE.clone(), -D::F::ONE),
    ])
}

/// Assert that the condition is false (0).
pub fn assert_false<D: Driver>(
    dr: &mut D,
    condition: &BoolWire<D>,
) -> Result<(), Error> {
    dr.enforce_zero(|| [(condition.wire.wire.clone(), D::F::ONE)])
}

/// If condition, then enforce a == b.
pub fn conditional_enforce_equal<D: Driver>(
    dr: &mut D,
    condition: &BoolWire<D>,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<(), Error> {
    // condition * (a - b) = 0
    let (_, _, product) = dr.mul(|| {
        let cond_val = *condition.wire.value.snag();
        let a_val = *a.value.snag();
        let b_val = *b.value.snag();
        let diff_val = a_val - b_val;
        Ok((cond_val, diff_val, cond_val * diff_val))
    })?;

    dr.enforce_zero(|| [(product, D::F::ONE)])
}

#[cfg(test)]
mod tests {
    // Tests would go here
}

