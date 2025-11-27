//! Arithmetic gadgets.

use crate::driver::{Driver, WireValue};
use crate::error::Error;
use crate::maybe::Maybe;
use ff::Field;

/// Multiply two wire values.
pub fn mul<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    let c_value = D::with(|| {
        let a_val = *a.value.snag();
        let b_val = *b.value.snag();
        Ok(a_val * b_val)
    })?;

    let (_, _, c_wire) = dr.mul(|| {
        let a_val = *a.value.snag();
        let b_val = *b.value.snag();
        Ok((a_val, b_val, a_val * b_val))
    })?;

    Ok(WireValue::new(c_wire, c_value))
}

/// Add two wire values.
pub fn add<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    let sum_wire = dr.add(|| [
        (a.wire.clone(), D::F::ONE),
        (b.wire.clone(), D::F::ONE),
    ])?;

    // Compute the result value
    let result_value = if D::has_witness() {
        D::just(|| *a.value.snag() + *b.value.snag())
    } else {
        D::just(|| D::F::ZERO)
    };

    Ok(WireValue::new(sum_wire, result_value))
}

/// Subtract two wire values (a - b).
pub fn sub<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    let _diff_value = D::just(|| {
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

    let result_value = if D::has_witness() {
        D::just(|| *a.value.snag() - *b.value.snag())
    } else {
        D::just(|| D::F::ZERO)
    };

    Ok(WireValue::new(diff_wire, result_value))
}

/// Compute the square of a wire value.
pub fn square<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    mul(dr, a, a)
}

/// Compute the inverse of a wire value.
///
/// Returns an error if the value is zero.
pub fn inverse<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    // Compute witness for inverse
    let inv_value = D::with(|| {
        let a_val = *a.value.snag();
        a_val
            .invert()
            .into_option()
            .ok_or(Error::DivisionByZero)
    })?;

    // Constrain a * inv = 1
    let (_, _, one_wire) = dr.mul(|| {
        let a_val = *a.value.snag();
        let inv_val = inv_value.take();
        Ok((a_val, inv_val, D::F::ONE))
    })?;

    // Enforce the output is 1
    dr.enforce_zero(|| [
        (one_wire, D::F::ONE),
        (D::ONE.clone(), -D::F::ONE),
    ])?;

    // Reconstruct the inverse wire value
    let inv_wire = dr.alloc(|| {
        let a_val = *a.value.snag();
        a_val
            .invert()
            .into_option()
            .ok_or(Error::DivisionByZero)
    })?;

    let final_value = D::with(|| {
        let a_val = *a.value.snag();
        a_val
            .invert()
            .into_option()
            .ok_or(Error::DivisionByZero)
    })?;

    Ok(WireValue::new(inv_wire, final_value))
}

/// Divide a by b (a / b).
///
/// Returns an error if b is zero.
pub fn div<D: Driver>(
    dr: &mut D,
    a: &WireValue<D>,
    b: &WireValue<D>,
) -> Result<WireValue<D>, Error> {
    let b_inv = inverse(dr, b)?;
    mul(dr, a, &b_inv)
}

/// Compute a linear combination: sum of (coefficient * wire_value).
pub fn linear_combination<D: Driver, I>(
    dr: &mut D,
    terms: I,
) -> Result<WireValue<D>, Error>
where
    I: IntoIterator<Item = (D::F, WireValue<D>)>,
{
    let terms: Vec<_> = terms.into_iter().collect();
    
    let sum_value = D::just(|| {
        if D::has_witness() {
            let mut sum = D::F::ZERO;
            for (coeff, wv) in &terms {
                sum += *coeff * *wv.value.snag();
            }
            sum
        } else {
            D::F::ZERO
        }
    });

    let lc_terms: Vec<_> = terms
        .iter()
        .map(|(coeff, wv)| (wv.wire.clone(), *coeff))
        .collect();

    let sum_wire = dr.add(|| lc_terms)?;

    Ok(WireValue::new(sum_wire, sum_value))
}

#[cfg(test)]
mod tests {
    // Tests would go here with a concrete field implementation
}

