//! IO sinks for circuit public inputs and outputs.
//!
//! A `Sink` is an abstraction for how circuits communicate their public
//! inputs/outputs to the outside world. Different drivers use different
//! sink implementations to collect or verify these values.

use crate::driver::Driver;
use crate::error::Error;

/// A sink for circuit public inputs/outputs.
///
/// During proof generation, the sink collects the wire values that form
/// the public input. During verification, it may compare against expected
/// values or accumulate them for later verification.
pub trait Sink<D: Driver, W> {
    /// Push a wire value to the sink as a public input/output.
    fn push(&mut self, wire: W) -> Result<(), Error>;

    /// Push multiple wire values to the sink.
    fn push_many<I: IntoIterator<Item = W>>(&mut self, wires: I) -> Result<(), Error> {
        for wire in wires {
            self.push(wire)?;
        }
        Ok(())
    }

    /// Finalize the sink and return any collected public inputs.
    ///
    /// The return type depends on the specific sink implementation.
    fn finalize(self) -> Result<(), Error>;
}

/// A sink that collects public input field elements.
///
/// This is used during proof generation to collect the actual values
/// of the public inputs.
#[derive(Debug, Clone)]
pub struct CollectingSink<F> {
    /// The collected public input values.
    pub inputs: Vec<F>,
}

impl<F> CollectingSink<F> {
    /// Create a new empty collecting sink.
    pub fn new() -> Self {
        CollectingSink { inputs: Vec::new() }
    }

    /// Create a new collecting sink with the given capacity.
    pub fn with_capacity(capacity: usize) -> Self {
        CollectingSink {
            inputs: Vec::with_capacity(capacity),
        }
    }

    /// Get the collected inputs.
    pub fn into_inputs(self) -> Vec<F> {
        self.inputs
    }
}

impl<F> Default for CollectingSink<F> {
    fn default() -> Self {
        Self::new()
    }
}

/// A sink that verifies public inputs against expected values.
///
/// This is used during verification to check that the public inputs
/// from the circuit match the expected values in the proof.
#[derive(Debug, Clone)]
pub struct VerifyingSink<F> {
    /// The expected public input values.
    pub expected: Vec<F>,
    /// Current index into the expected values.
    pub index: usize,
}

impl<F> VerifyingSink<F> {
    /// Create a new verifying sink with the expected values.
    pub fn new(expected: Vec<F>) -> Self {
        VerifyingSink { expected, index: 0 }
    }
}

/// A sink that discards all values (used when we don't need public inputs).
#[derive(Debug, Clone, Copy, Default)]
pub struct DiscardSink;

impl DiscardSink {
    /// Create a new discard sink.
    pub const fn new() -> Self {
        DiscardSink
    }
}

/// A sink that counts the number of public inputs without storing them.
#[derive(Debug, Clone, Default)]
pub struct CountingSink {
    /// The number of public inputs pushed.
    pub count: usize,
}

impl CountingSink {
    /// Create a new counting sink.
    pub const fn new() -> Self {
        CountingSink { count: 0 }
    }

    /// Get the count.
    pub const fn count(&self) -> usize {
        self.count
    }
}

/// A sink that accumulates wire values into a polynomial evaluation.
///
/// This is used during verification when evaluating non-uniform circuit
/// polynomials. The sink accumulates the contributions from each public
/// input wire into a running polynomial evaluation.
#[derive(Debug, Clone)]
pub struct PolynomialSink<F> {
    /// The accumulated polynomial evaluation.
    pub accumulator: F,
    /// The evaluation point.
    pub point: F,
    /// Current power of the evaluation point.
    pub power: F,
}

impl<F: ff::Field> PolynomialSink<F> {
    /// Create a new polynomial sink at the given evaluation point.
    pub fn new(point: F) -> Self {
        PolynomialSink {
            accumulator: F::ZERO,
            point,
            power: F::ONE,
        }
    }

    /// Get the accumulated evaluation.
    pub fn evaluation(&self) -> F {
        self.accumulator
    }
}

/// Marker trait for sink types that are compatible with a specific driver.
pub trait DriverSink<D: Driver>: Sink<D, D::W> {}

impl<D: Driver, S: Sink<D, D::W>> DriverSink<D> for S {}

