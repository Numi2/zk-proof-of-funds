//! Boolean gadgets.

use crate::driver::{Driver, Witness, WireValue};
use crate::error::Error;
use crate::maybe::Maybe;
use ff::Field;

/// A boolean wire value (constrained to be 0 or 1).
pub struct BoolWire<D: Driver> {
    /// The underlying wire value.
    pub wire: WireValue<D>,
}

impl<D: Driver> BoolWire<D> {
    /// Create a new boolean wire (must be already constrained).
    pub fn new_unchecked(wire: WireValue<D>) -> Self {
        BoolWire { wire }
    }

    /// Allocate a new boolean wire with constraint.
    pub fn alloc(dr: &mut D, value: Witness<D, bool>) -> Result<Self, Error>
    where
        Witness<D, D::F>: Clone,
    {
        let wire = dr.alloc(|| {
            if *value.snag() {
                Ok(D::F::ONE)
            } else {
                Ok(D::F::ZERO)
            }
        })?;

        let field_value = D::just(|| {
            if D::has_witness() {
                if *value.snag() {
                    D::F::ONE
                } else {
                    D::F::ZERO
                }
            } else {
                D::F::ZERO
            }
        });

        // Enforce boolean constraint: w * (1 - w) = 0
        let wire_value = WireValue::new(wire.clone(), field_value.clone());
        dr.enforce_boolean(&wire, field_value)?;

        Ok(BoolWire { wire: wire_value })
    }

    /// Get the underlying wire.
    pub fn wire(&self) -> &D::W {
        &self.wire.wire
    }

    /// Get the value as a field element.
    pub fn value(&self) -> &Witness<D, D::F> {
        &self.wire.value
    }

    /// Get the value as a boolean.
    pub fn bool_value(&self) -> Witness<D, bool> {
        D::just(|| {
            if D::has_witness() {
                *self.wire.value.snag() == D::F::ONE
            } else {
                false
            }
        })
    }
}

impl<D: Driver> Clone for BoolWire<D>
where
    Witness<D, D::F>: Clone,
{
    fn clone(&self) -> Self {
        BoolWire {
            wire: self.wire.clone(),
        }
    }
}

/// Boolean AND: a AND b = a * b
pub fn and<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
    b: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    let result_value = D::just(|| {
        if D::has_witness() {
            let a_val = *a.wire.value.snag();
            let b_val = *b.wire.value.snag();
            a_val * b_val
        } else {
            D::F::ZERO
        }
    });

    let (_, _, c) = dr.mul(|| {
        let a_val = *a.wire.value.snag();
        let b_val = *b.wire.value.snag();
        Ok((a_val, b_val, a_val * b_val))
    })?;

    Ok(BoolWire::new_unchecked(WireValue::new(c, result_value)))
}

/// Boolean OR: a OR b = a + b - a * b
pub fn or<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
    b: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    // First compute a * b
    let ab = and(dr, a, b)?;

    // Then compute a + b - ab
    let result_value = D::just(|| {
        if D::has_witness() {
            let a_val = *a.wire.value.snag();
            let b_val = *b.wire.value.snag();
            let ab_val = *ab.wire.value.snag();
            a_val + b_val - ab_val
        } else {
            D::F::ZERO
        }
    });

    let result_wire = dr.add(|| [
        (a.wire.wire.clone(), D::F::ONE),
        (b.wire.wire.clone(), D::F::ONE),
        (ab.wire.wire.clone(), -D::F::ONE),
    ])?;

    Ok(BoolWire::new_unchecked(WireValue::new(result_wire, result_value)))
}

/// Boolean NOT: NOT a = 1 - a
pub fn not<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    let result_value = D::just(|| {
        if D::has_witness() {
            D::F::ONE - *a.wire.value.snag()
        } else {
            D::F::ONE
        }
    });

    let result_wire = dr.add(|| [
        (D::ONE.clone(), D::F::ONE),
        (a.wire.wire.clone(), -D::F::ONE),
    ])?;

    Ok(BoolWire::new_unchecked(WireValue::new(result_wire, result_value)))
}

/// Boolean XOR: a XOR b = a + b - 2 * a * b
pub fn xor<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
    b: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    // Compute a * b
    let ab = and(dr, a, b)?;

    // Compute a + b - 2*ab
    let two = D::F::ONE + D::F::ONE;
    
    let result_value = D::just(|| {
        if D::has_witness() {
            let a_val = *a.wire.value.snag();
            let b_val = *b.wire.value.snag();
            let ab_val = *ab.wire.value.snag();
            a_val + b_val - two * ab_val
        } else {
            D::F::ZERO
        }
    });

    let result_wire = dr.add(|| [
        (a.wire.wire.clone(), D::F::ONE),
        (b.wire.wire.clone(), D::F::ONE),
        (ab.wire.wire.clone(), -two),
    ])?;

    Ok(BoolWire::new_unchecked(WireValue::new(result_wire, result_value)))
}

/// Boolean NAND: NOT (a AND b)
pub fn nand<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
    b: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    let ab = and(dr, a, b)?;
    not(dr, &ab)
}

/// Boolean NOR: NOT (a OR b)
pub fn nor<D: Driver>(
    dr: &mut D,
    a: &BoolWire<D>,
    b: &BoolWire<D>,
) -> Result<BoolWire<D>, Error> {
    let a_or_b = or(dr, a, b)?;
    not(dr, &a_or_b)
}

#[cfg(test)]
mod tests {
    // Tests would go here
}

