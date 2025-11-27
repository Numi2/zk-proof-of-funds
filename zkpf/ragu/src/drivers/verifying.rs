//! Verifying driver for verification without witness data.
//!
//! The `VerifyingDriver` is used during proof verification. It:
//! - Does not allocate witnesses
//! - Evaluates polynomials based on provided proof values
//! - Uses `Empty` for witness types since no witness data is present
//!
//! This driver is typically used in two contexts:
//! 1. Standard verification where we check the proof against public inputs
//! 2. Non-uniform circuit polynomial evaluation

use crate::driver::Driver;
use crate::error::Error;
use crate::maybe::EmptyKind;
use crate::sink::{DiscardSink, Sink, VerifyingSink};
use ff::Field;

/// A wire in the verifying driver.
///
/// During verification, wires represent field element values read
/// directly from the proof rather than positions in a witness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerifyingWire<F> {
    /// The value of this wire.
    pub value: F,
}

impl<F: Field> VerifyingWire<F> {
    /// Create a new wire with the given value.
    pub const fn new(value: F) -> Self {
        VerifyingWire { value }
    }

    /// Get the value of this wire.
    pub const fn value(&self) -> F {
        self.value
    }
}

/// The verifying driver checks proofs without generating witnesses.
#[derive(Debug, Clone)]
pub struct VerifyingDriver<F: Field> {
    /// Values provided by the proof for verification.
    proof_values: Vec<F>,
    /// Current index into proof values.
    index: usize,
    /// Whether to perform runtime constraint checking.
    check_constraints: bool,
}

impl<F: Field> VerifyingDriver<F> {
    /// Create a new verifying driver with the given proof values.
    pub fn new(proof_values: Vec<F>) -> Self {
        VerifyingDriver {
            proof_values,
            index: 0,
            check_constraints: true,
        }
    }

    /// Create a verifying driver that doesn't check constraints.
    ///
    /// This is useful for polynomial evaluation where we only care
    /// about computing values, not checking satisfiability.
    pub fn without_checking(proof_values: Vec<F>) -> Self {
        VerifyingDriver {
            proof_values,
            index: 0,
            check_constraints: false,
        }
    }

    /// Read the next value from the proof.
    fn next_value(&mut self) -> Result<F, Error> {
        if self.index >= self.proof_values.len() {
            return Err(Error::MalformedWitness {
                message: "ran out of proof values",
            });
        }
        let value = self.proof_values[self.index];
        self.index += 1;
        Ok(value)
    }

    /// Check if all proof values have been consumed.
    pub fn all_consumed(&self) -> bool {
        self.index == self.proof_values.len()
    }
}

impl<F: Field> Driver for VerifyingDriver<F> {
    type F = F;
    type W = VerifyingWire<F>;
    type MaybeKind = EmptyKind;
    type IO = DiscardSink;

    const ONE: Self::W = VerifyingWire { value: F::ONE };

    fn mul(
        &mut self,
        _values: impl FnOnce() -> Result<(Self::F, Self::F, Self::F), Error>,
    ) -> Result<(Self::W, Self::W, Self::W), Error> {
        // Read values from the proof
        let a = self.next_value()?;
        let b = self.next_value()?;
        let c = self.next_value()?;

        // Optionally check the constraint
        if self.check_constraints && a * b != c {
            return Err(Error::UnsatisfiedConstraint {
                message: "multiplication constraint failed during verification",
            });
        }

        Ok((
            VerifyingWire::new(a),
            VerifyingWire::new(b),
            VerifyingWire::new(c),
        ))
    }

    fn add<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<Self::W, Error> {
        // Compute the value of the linear combination
        let mut sum = F::ZERO;
        for (wire, coeff) in lc() {
            sum += wire.value * coeff;
        }
        Ok(VerifyingWire::new(sum))
    }

    fn enforce_zero<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<(), Error> {
        if self.check_constraints {
            let mut sum = F::ZERO;
            for (wire, coeff) in lc() {
                sum += wire.value * coeff;
            }
            if sum != F::ZERO {
                return Err(Error::UnsatisfiedConstraint {
                    message: "linear constraint failed during verification",
                });
            }
        }
        Ok(())
    }
}

impl<F: Field> Sink<VerifyingDriver<F>, VerifyingWire<F>> for DiscardSink {
    fn push(&mut self, _wire: VerifyingWire<F>) -> Result<(), Error> {
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        Ok(())
    }
}

impl<F: Field> Sink<VerifyingDriver<F>, VerifyingWire<F>> for VerifyingSink<F>
where
    F: PartialEq,
{
    fn push(&mut self, wire: VerifyingWire<F>) -> Result<(), Error> {
        if self.index >= self.expected.len() {
            return Err(Error::MalformedWitness {
                message: "too many public inputs",
            });
        }

        if wire.value != self.expected[self.index] {
            return Err(Error::VerificationFailed);
        }

        self.index += 1;
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        if self.index != self.expected.len() {
            return Err(Error::MalformedWitness {
                message: "not enough public inputs",
            });
        }
        Ok(())
    }
}

/// A verifying driver with a verifying sink.
pub struct VerifyingContext<F: Field> {
    /// The driver.
    pub driver: VerifyingDriver<F>,
    /// The sink that checks public inputs.
    pub sink: VerifyingSink<F>,
}

impl<F: Field + PartialEq> VerifyingContext<F> {
    /// Create a new verifying context.
    pub fn new(proof_values: Vec<F>, expected_public_inputs: Vec<F>) -> Self {
        VerifyingContext {
            driver: VerifyingDriver::new(proof_values),
            sink: VerifyingSink::new(expected_public_inputs),
        }
    }

    /// Finalize verification.
    pub fn finalize(self) -> Result<(), Error> {
        if !self.driver.all_consumed() {
            return Err(Error::MalformedWitness {
                message: "not all proof values consumed",
            });
        }
        self.sink.finalize()
    }
}

