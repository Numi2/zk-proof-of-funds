//! Counting driver for measuring circuit size without allocation.
//!
//! The `CountingDriver` is used to determine the size of a circuit
//! (number of wires, constraints, etc.) without actually allocating
//! memory for witnesses or constraints. This is useful for:
//!
//! - Pre-computing buffer sizes
//! - Verifying circuit complexity bounds
//! - Profiling and optimization

use crate::driver::Driver;
use crate::error::Error;
use crate::maybe::EmptyKind;
use crate::sink::{CountingSink as CountingSinkType, Sink};
use ff::Field;
use core::marker::PhantomData;

/// A wire in the counting driver.
///
/// This is a zero-sized type since we only need to count, not store values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct CountingWire(());

impl CountingWire {
    /// Create a new counting wire.
    pub const fn new() -> Self {
        CountingWire(())
    }
}

/// The counting driver tracks circuit statistics without allocating.
#[derive(Debug, Clone, Default)]
pub struct CountingDriver<F> {
    /// Number of multiplication constraints.
    pub num_mul: usize,
    /// Number of linear constraints.
    pub num_linear: usize,
    /// Number of wires allocated.
    pub num_wires: usize,
    /// Number of public inputs.
    pub num_public_inputs: usize,
    /// Phantom data for the field type.
    _marker: PhantomData<F>,
}

impl<F: Field> CountingDriver<F> {
    /// Create a new counting driver.
    pub const fn new() -> Self {
        CountingDriver {
            num_mul: 0,
            num_linear: 0,
            num_wires: 1, // ONE wire
            num_public_inputs: 0,
            _marker: PhantomData,
        }
    }

    /// Get the total number of constraints.
    pub const fn total_constraints(&self) -> usize {
        self.num_mul + self.num_linear
    }

    /// Get circuit statistics.
    pub const fn stats(&self) -> CountingStats {
        CountingStats {
            num_mul: self.num_mul,
            num_linear: self.num_linear,
            num_wires: self.num_wires,
            num_public_inputs: self.num_public_inputs,
        }
    }
}

/// Statistics collected by the counting driver.
#[derive(Debug, Clone, Copy, Default)]
pub struct CountingStats {
    /// Number of multiplication constraints.
    pub num_mul: usize,
    /// Number of linear constraints.
    pub num_linear: usize,
    /// Number of wires.
    pub num_wires: usize,
    /// Number of public inputs.
    pub num_public_inputs: usize,
}

impl CountingStats {
    /// Total number of constraints.
    pub const fn total_constraints(&self) -> usize {
        self.num_mul + self.num_linear
    }
}

impl<F: Field> Driver for CountingDriver<F> {
    type F = F;
    type W = CountingWire;
    type MaybeKind = EmptyKind;
    type IO = CountingSinkType;

    const ONE: Self::W = CountingWire(());

    fn mul(
        &mut self,
        _values: impl FnOnce() -> Result<(Self::F, Self::F, Self::F), Error>,
    ) -> Result<(Self::W, Self::W, Self::W), Error> {
        self.num_mul += 1;
        self.num_wires += 3;
        Ok((CountingWire::new(), CountingWire::new(), CountingWire::new()))
    }

    fn add<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<Self::W, Error> {
        // Count the terms (even though we don't store them)
        let _count = lc().into_iter().count();
        self.num_wires += 1;
        self.num_linear += 1;
        Ok(CountingWire::new())
    }

    fn enforce_zero<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<(), Error> {
        let _count = lc().into_iter().count();
        self.num_linear += 1;
        Ok(())
    }
}

impl<F: Field> Sink<CountingDriver<F>, CountingWire> for CountingSinkType {
    fn push(&mut self, _wire: CountingWire) -> Result<(), Error> {
        self.count += 1;
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        Ok(())
    }
}

// Note: Unit tests for CountingDriver are in tests/integration.rs
// to avoid duplicating the MockField implementation.

