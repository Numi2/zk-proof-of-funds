//! Range check gadgets.
//!
//! These gadgets implement range checks using bit decomposition.

use crate::driver::{Driver, WireValue};
use crate::error::Error;
use crate::maybe::Maybe;
use crate::gadgets::boolean::BoolWire;
use ff::{Field, PrimeField};

/// Decompose a field element into bits (little-endian).
///
/// Returns a vector of boolean wires representing the bits of the value.
/// The decomposition is constrained to equal the original value.
pub fn to_bits<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    num_bits: usize,
) -> Result<Vec<BoolWire<D>>, Error>
where
    D::F: PrimeField,
    crate::Witness<D, D::F>: Clone,
{
    let mut bits = Vec::with_capacity(num_bits);
    let mut bit_values = Vec::with_capacity(num_bits);

    // Compute bit decomposition in witness
    for i in 0..num_bits {
        let bit_value = D::just(|| {
            if D::has_witness() {
                let a_val = *a.value.snag();
                // Get the i-th bit
                let repr = a_val.to_repr();
                let bytes = repr.as_ref();
                let byte_idx = i / 8;
                let bit_idx = i % 8;
                if byte_idx < bytes.len() {
                    ((bytes[byte_idx] >> bit_idx) & 1) == 1
                } else {
                    false
                }
            } else {
                false
            }
        });
        bit_values.push(bit_value);
    }

    // Allocate boolean wires for each bit
    for bit_value in bit_values {
        let bit = BoolWire::alloc(dr, bit_value)?;
        bits.push(bit);
    }

    // Constrain: sum of (bit_i * 2^i) = a
    let mut lc_terms = Vec::with_capacity(num_bits + 1);
    let mut power_of_two = D::F::ONE;

    for bit in &bits {
        lc_terms.push((bit.wire.wire.clone(), power_of_two));
        power_of_two = power_of_two.double();
    }
    lc_terms.push((a.wire.clone(), -D::F::ONE));

    dr.enforce_zero(|| lc_terms)?;

    Ok(bits)
}

/// Recompose bits into a field element.
///
/// Takes a slice of boolean wires (little-endian) and returns
/// their combined value as a wire.
pub fn from_bits<D: Driver>(
    dr: &mut D,
    bits: &[BoolWire<D>],
) -> Result<WireValue<D>, Error> {
    let value = D::just(|| {
        if D::has_witness() {
            let mut result = D::F::ZERO;
            let mut power_of_two = D::F::ONE;
            for bit in bits {
                if *bit.wire.value.snag() == D::F::ONE {
                    result += power_of_two;
                }
                power_of_two = power_of_two.double();
            }
            result
        } else {
            D::F::ZERO
        }
    });

    let mut lc_terms = Vec::with_capacity(bits.len());
    let mut power_of_two = D::F::ONE;

    for bit in bits {
        lc_terms.push((bit.wire.wire.clone(), power_of_two));
        power_of_two = power_of_two.double();
    }

    let wire = dr.add(|| lc_terms)?;

    Ok(WireValue::new(wire, value))
}

/// Check that a value is within a range [0, 2^num_bits).
///
/// This is done by decomposing into bits and checking that
/// no more than num_bits are needed.
pub fn range_check<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    num_bits: usize,
) -> Result<(), Error>
where
    D::F: PrimeField,
    crate::Witness<D, D::F>: Clone,
{
    // Decomposing into bits implicitly checks the range
    // because the bits are constrained to sum to the original value
    let _ = to_bits(dr, a, num_bits)?;
    Ok(())
}

/// Check that a value is within a specific range [lower, upper].
///
/// Note: This is more expensive than a simple range check and
/// requires upper - lower + 1 < 2^(field_bits - 1).
pub fn range_check_bounded<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    lower: D::F,
    upper: D::F,
    num_bits: usize,
) -> Result<(), Error>
where
    D::F: PrimeField,
    crate::Witness<D, D::F>: Clone,
{
    // Check a - lower is in range [0, upper - lower]
    let shifted_value = D::just(|| {
        if D::has_witness() {
            *a.value.snag() - lower
        } else {
            D::F::ZERO
        }
    });

    let shifted_wire = dr.add(|| [
        (a.wire.clone(), D::F::ONE),
        (D::ONE.clone(), -lower),
    ])?;

    let shifted = WireValue::new(shifted_wire, shifted_value);
    range_check(dr, &shifted, num_bits)?;

    // Also check upper - a is in range (to ensure a <= upper)
    let upper_minus_a_value = D::just(|| {
        if D::has_witness() {
            upper - *a.value.snag()
        } else {
            upper
        }
    });

    let upper_minus_a_wire = dr.add(|| [
        (D::ONE.clone(), upper),
        (a.wire.clone(), -D::F::ONE),
    ])?;

    let upper_minus_a = WireValue::new(upper_minus_a_wire, upper_minus_a_value);
    range_check(dr, &upper_minus_a, num_bits)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    // Tests would go here
}

