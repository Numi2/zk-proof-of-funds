//! Proving driver for generating proofs with witness data.
//!
//! The `ProvingDriver` is used during proof generation. It:
//! - Allocates wires in the constraint system
//! - Collects witness values
//! - Records constraints (multiplication gates and linear constraints)
//!
//! Wire values are `Always<F>` since witnesses are always present during proving.

use crate::driver::Driver;
use crate::error::Error;
use crate::maybe::AlwaysKind;
use crate::sink::{CollectingSink, Sink};
use ff::Field;

/// A wire in the proving driver.
///
/// Represents a position in the witness vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ProvingWire {
    /// Index into the witness vector.
    pub index: usize,
}

impl ProvingWire {
    /// Create a new wire at the given index.
    pub const fn new(index: usize) -> Self {
        ProvingWire { index }
    }

    /// The constant ONE wire (always at index 0).
    pub const ONE: Self = ProvingWire { index: 0 };
}

/// A multiplication constraint: a * b = c
#[derive(Debug, Clone)]
pub struct MulConstraint {
    /// Left input wire.
    pub a: usize,
    /// Right input wire.
    pub b: usize,
    /// Output wire.
    pub c: usize,
}

/// A linear constraint: sum of (wire, coefficient) = 0
#[derive(Debug, Clone)]
pub struct LinearConstraint<F> {
    /// Terms in the linear combination.
    pub terms: Vec<(usize, F)>,
}

/// The proving driver collects constraints and witness data.
#[derive(Debug, Clone)]
pub struct ProvingDriver<F: Field> {
    /// The witness values.
    pub witness: Vec<F>,
    /// Multiplication constraints.
    pub mul_constraints: Vec<MulConstraint>,
    /// Linear constraints (all must equal zero).
    pub linear_constraints: Vec<LinearConstraint<F>>,
    /// Number of allocated wires.
    pub num_wires: usize,
}

impl<F: Field> ProvingDriver<F> {
    /// Create a new proving driver.
    pub fn new() -> Self {
        let mut driver = ProvingDriver {
            witness: Vec::new(),
            mul_constraints: Vec::new(),
            linear_constraints: Vec::new(),
            num_wires: 0,
        };
        // Allocate the ONE wire at index 0
        driver.witness.push(F::ONE);
        driver.num_wires = 1;
        driver
    }

    /// Create a new proving driver with the given capacity.
    pub fn with_capacity(num_constraints: usize, num_wires: usize) -> Self {
        let mut driver = ProvingDriver {
            witness: Vec::with_capacity(num_wires),
            mul_constraints: Vec::with_capacity(num_constraints),
            linear_constraints: Vec::new(),
            num_wires: 0,
        };
        driver.witness.push(F::ONE);
        driver.num_wires = 1;
        driver
    }

    /// Allocate a new wire with the given value.
    fn alloc_wire(&mut self, value: F) -> ProvingWire {
        let index = self.num_wires;
        self.witness.push(value);
        self.num_wires += 1;
        ProvingWire::new(index)
    }

    /// Get the witness value at the given wire.
    pub fn get_witness(&self, wire: ProvingWire) -> F {
        self.witness[wire.index]
    }

    /// Check that all constraints are satisfied.
    pub fn check_constraints(&self) -> Result<(), Error> {
        // Check multiplication constraints
        for mul in &self.mul_constraints {
            let a = self.witness[mul.a];
            let b = self.witness[mul.b];
            let c = self.witness[mul.c];
            if a * b != c {
                return Err(Error::UnsatisfiedConstraint {
                    message: "multiplication constraint failed",
                });
            }
        }

        // Check linear constraints
        for linear in &self.linear_constraints {
            let mut sum = F::ZERO;
            for &(wire_idx, coeff) in &linear.terms {
                sum += self.witness[wire_idx] * coeff;
            }
            if sum != F::ZERO {
                return Err(Error::UnsatisfiedConstraint {
                    message: "linear constraint failed",
                });
            }
        }

        Ok(())
    }

    /// Get statistics about the constraint system.
    pub fn stats(&self) -> DriverStats {
        DriverStats {
            num_wires: self.num_wires,
            num_mul_constraints: self.mul_constraints.len(),
            num_linear_constraints: self.linear_constraints.len(),
        }
    }
}

impl<F: Field> Default for ProvingDriver<F> {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about the constraint system.
#[derive(Debug, Clone, Copy)]
pub struct DriverStats {
    /// Number of wires allocated.
    pub num_wires: usize,
    /// Number of multiplication constraints.
    pub num_mul_constraints: usize,
    /// Number of linear constraints.
    pub num_linear_constraints: usize,
}

impl<F: Field> Driver for ProvingDriver<F> {
    type F = F;
    type W = ProvingWire;
    type MaybeKind = AlwaysKind;
    type IO = CollectingSink<F>;

    const ONE: Self::W = ProvingWire::ONE;

    fn mul(
        &mut self,
        values: impl FnOnce() -> Result<(Self::F, Self::F, Self::F), Error>,
    ) -> Result<(Self::W, Self::W, Self::W), Error> {
        let (a_val, b_val, c_val) = values()?;

        let a = self.alloc_wire(a_val);
        let b = self.alloc_wire(b_val);
        let c = self.alloc_wire(c_val);

        self.mul_constraints.push(MulConstraint {
            a: a.index,
            b: b.index,
            c: c.index,
        });

        Ok((a, b, c))
    }

    fn add<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<Self::W, Error> {
        // Compute the value of the linear combination
        let mut sum = F::ZERO;
        let terms: Vec<_> = lc()
            .into_iter()
            .map(|(wire, coeff)| {
                sum += self.witness[wire.index] * coeff;
                (wire.index, coeff)
            })
            .collect();

        // Allocate a new wire for the result
        let result = self.alloc_wire(sum);

        // Add constraint: lc - result = 0
        let mut constraint_terms = terms;
        constraint_terms.push((result.index, -F::ONE));
        self.linear_constraints.push(LinearConstraint {
            terms: constraint_terms,
        });

        Ok(result)
    }

    fn enforce_zero<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<(), Error> {
        let terms: Vec<_> = lc()
            .into_iter()
            .map(|(wire, coeff)| (wire.index, coeff))
            .collect();

        self.linear_constraints.push(LinearConstraint { terms });
        Ok(())
    }
}

/// IO sink for the proving driver.
impl<F: Field> Sink<ProvingDriver<F>, ProvingWire> for CollectingSink<F> {
    fn push(&mut self, wire: ProvingWire) -> Result<(), Error> {
        // This would need access to the driver to get the value
        // For now, we can't implement this correctly without passing the driver
        // In a real implementation, we'd store the wire indices and
        // resolve them later
        let _ = wire;
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        Ok(())
    }
}

/// A wrapper sink that has access to the driver for resolving wire values.
pub struct ProvingSink<'a, F: Field> {
    inner: CollectingSink<F>,
    driver: &'a ProvingDriver<F>,
}

impl<'a, F: Field> ProvingSink<'a, F> {
    /// Create a new proving sink.
    pub fn new(driver: &'a ProvingDriver<F>) -> Self {
        ProvingSink {
            inner: CollectingSink::new(),
            driver,
        }
    }

    /// Get the collected public inputs.
    pub fn into_inputs(self) -> Vec<F> {
        self.inner.inputs
    }
}

impl<F: Field> Sink<ProvingDriver<F>, ProvingWire> for ProvingSink<'_, F> {
    fn push(&mut self, wire: ProvingWire) -> Result<(), Error> {
        let value = self.driver.witness[wire.index];
        self.inner.inputs.push(value);
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        Ok(())
    }
}

// Note: Unit tests for ProvingDriver are in tests/integration.rs
// to avoid duplicating the MockField implementation.

