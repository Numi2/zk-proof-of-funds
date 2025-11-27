//! Circuit definition trait.
//!
//! The `Circuit` trait defines a generalized interface for circuit synthesis
//! that splits the traditional `synthesize` method into three distinct phases:
//!
//! 1. **`input`**: Transform instance data into circuit IO representation
//! 2. **`main`**: Core proving logic that produces IO and auxiliary data
//! 3. **`output`**: Transform circuit IO into public inputs
//!
//! This separation enables several important optimizations and design patterns:
//!
//! - The verification path can skip `main` entirely and go directly from
//!   instance to public input via `input` → `output`
//! - Circuits can produce auxiliary data during proving that's needed for
//!   folding schemes and accumulator construction
//! - The same code paths are used for both proving and verification, ensuring
//!   consistency in public input computation
//!
//! # Dataflow
//!
//! ```text
//! Verification path:
//! Instance → input() → IO → output() → Public Input
//!
//! Proving path:
//! Witness → main() → (IO, Aux) → output() → Public Input
//!                       ↓
//!                    Aux data for accumulator
//! ```
//!
//! # Example
//!
//! ```rust,ignore
//! struct MyCircuit;
//!
//! impl<F: Field> Circuit<F> for MyCircuit {
//!     type Instance<'a> = &'a PublicData;
//!     type IO<'a, D: Driver<F = F>> = MyIO<D>;
//!     type Witness<'a> = &'a SecretData;
//!     type Aux<'a> = Accumulator;
//!
//!     fn input<'i, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         input: Witness<D, Self::Instance<'i>>,
//!     ) -> Result<Self::IO<'i, D>, Error> {
//!         // Process instance into IO
//!     }
//!
//!     fn main<'w, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         witness: Witness<D, Self::Witness<'w>>,
//!     ) -> Result<(Self::IO<'w, D>, Witness<D, Self::Aux<'w>>), Error> {
//!         // Synthesize constraints and produce IO + aux
//!     }
//!
//!     fn output<'s, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         io: Self::IO<'s, D>,
//!         output: &mut D::IO,
//!     ) -> Result<(), Error> {
//!         // Transform IO into public inputs
//!     }
//! }
//! ```

use crate::driver::{Driver, Witness};
use crate::error::Error;
use ff::Field;

/// A circuit that can be proven and verified.
///
/// The circuit is parameterized over a field `F` and defines four associated
/// types that govern its data flow.
pub trait Circuit<F: Field>: Sized {
    /// The public instance type that the verifier sees.
    ///
    /// This is typically a reference to external data that defines
    /// what the proof is about.
    type Instance<'instance>;

    /// The intermediate IO type that flows between `input`/`main` and `output`.
    ///
    /// This type is parameterized over the driver to allow different
    /// representations depending on whether we're proving or verifying.
    type IO<'source, D: Driver<F = F>>;

    /// The private witness type that the prover uses.
    ///
    /// This contains all secret data needed to construct the proof.
    type Witness<'witness>;

    /// Auxiliary data produced during proving.
    ///
    /// This is used for accumulator construction in folding schemes.
    /// It's wrapped in `Witness<D, _>` so it's only produced when
    /// the driver expects witness data (i.e., during proving).
    type Aux<'witness>;

    /// Transform instance data into circuit IO.
    ///
    /// This is called during verification to reconstruct the expected
    /// public inputs from the instance data. It's also useful for
    /// circuits where the instance directly determines the IO.
    ///
    /// # Arguments
    ///
    /// * `dr` - The synthesis driver
    /// * `input` - The instance data (wrapped in `Witness<D, _>` for
    ///   uniform handling across driver types)
    ///
    /// # Returns
    ///
    /// The circuit's IO representation.
    fn input<'instance, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        input: Witness<D, Self::Instance<'instance>>,
    ) -> Result<Self::IO<'instance, D>, Error>;

    /// The main proving logic.
    ///
    /// This method synthesizes all constraints and produces the circuit's
    /// IO representation along with any auxiliary data needed for
    /// accumulator construction.
    ///
    /// The witness data is only present during proving (when `D::MaybeKind`
    /// is `AlwaysKind`). During verification this method may not be called,
    /// or if called, the witness will be `Empty`.
    ///
    /// # Arguments
    ///
    /// * `dr` - The synthesis driver
    /// * `witness` - The private witness data
    ///
    /// # Returns
    ///
    /// A tuple of (IO, Aux) where:
    /// - IO is the circuit's IO representation
    /// - Aux is auxiliary data for the prover (e.g., accumulators)
    fn main<'witness, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        witness: Witness<D, Self::Witness<'witness>>,
    ) -> Result<(Self::IO<'witness, D>, Witness<D, Self::Aux<'witness>>), Error>;

    /// Transform IO into public inputs.
    ///
    /// This method takes the IO representation (from either `input` or
    /// `main`) and writes the public inputs to the driver's IO sink.
    ///
    /// The same code path is used regardless of whether we're proving
    /// or verifying, ensuring consistent public input computation.
    ///
    /// # Arguments
    ///
    /// * `dr` - The synthesis driver
    /// * `io` - The circuit's IO representation
    /// * `output` - The IO sink to write public inputs to
    fn output<'source, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        io: Self::IO<'source, D>,
        output: &mut D::IO,
    ) -> Result<(), Error>;

    // =========================================================================
    // Convenience methods
    // =========================================================================

    /// Synthesize the circuit for proving.
    ///
    /// This runs `main` followed by `output`.
    fn synthesize_prove<'witness, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        witness: Witness<D, Self::Witness<'witness>>,
        output: &mut D::IO,
    ) -> Result<Witness<D, Self::Aux<'witness>>, Error> {
        let (io, aux) = self.main(dr, witness)?;
        self.output(dr, io, output)?;
        Ok(aux)
    }

    /// Synthesize the circuit for verification.
    ///
    /// This runs `input` followed by `output`.
    fn synthesize_verify<'instance, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        instance: Witness<D, Self::Instance<'instance>>,
        output: &mut D::IO,
    ) -> Result<(), Error> {
        let io = self.input(dr, instance)?;
        self.output(dr, io, output)
    }
}

/// A simple circuit where the instance equals the witness.
///
/// This is useful for testing and for circuits that don't need
/// separate instance/witness types.
pub trait SimpleCircuit<F: Field>: Sized {
    /// The data type for both instance and witness.
    type Data<'a>;

    /// The IO type.
    type IO<'a, D: Driver<F = F>>;

    /// Synthesize the circuit.
    fn synthesize<'a, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        data: Witness<D, Self::Data<'a>>,
    ) -> Result<Self::IO<'a, D>, Error>;

    /// Write the IO to the output sink.
    fn write_output<'a, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        io: Self::IO<'a, D>,
        output: &mut D::IO,
    ) -> Result<(), Error>;
}

/// Blanket implementation to make `SimpleCircuit` usable as `Circuit`.
impl<F: Field, C: SimpleCircuit<F>> Circuit<F> for C {
    type Instance<'instance> = C::Data<'instance>;
    type IO<'source, D: Driver<F = F>> = C::IO<'source, D>;
    type Witness<'witness> = C::Data<'witness>;
    type Aux<'witness> = ();

    fn input<'instance, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        input: Witness<D, Self::Instance<'instance>>,
    ) -> Result<Self::IO<'instance, D>, Error> {
        self.synthesize(dr, input)
    }

    fn main<'witness, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        witness: Witness<D, Self::Witness<'witness>>,
    ) -> Result<(Self::IO<'witness, D>, Witness<D, Self::Aux<'witness>>), Error> {
        let io = self.synthesize(dr, witness)?;
        Ok((io, D::just(|| ())))
    }

    fn output<'source, D: Driver<F = F>>(
        &self,
        dr: &mut D,
        io: Self::IO<'source, D>,
        output: &mut D::IO,
    ) -> Result<(), Error> {
        self.write_output(dr, io, output)
    }
}

/// A circuit that can be composed with other circuits.
///
/// Composable circuits enable the construction of complex PCD trees
/// where each node is itself a circuit that verifies its children.
pub trait ComposableCircuit<F: Field>: Circuit<F> {
    /// The type of child circuits this circuit can compose with.
    type Child: Circuit<F>;

    /// The number of child proofs this circuit verifies.
    const NUM_CHILDREN: usize;

    /// Get the child circuit configuration.
    fn child(&self) -> &Self::Child;
}

/// A circuit that supports non-uniform composition.
///
/// Non-uniform circuits can transition between different circuit types
/// within the PCD tree, which is essential for protocols like HyperNova.
pub trait NonUniformCircuit<F: Field>: Circuit<F> {
    /// The selector type that identifies which sub-circuit to use.
    type Selector: Clone + Copy;

    /// Get the selector for this circuit instance.
    fn selector(&self) -> Self::Selector;

    /// The maximum number of circuit variants.
    const NUM_VARIANTS: usize;
}

#[cfg(test)]
mod tests {
    use super::*;

    // Test that the trait hierarchy compiles correctly
    struct DummyCircuit;

    // We can't implement the full traits without a concrete driver,
    // but we can verify the trait definitions compile.
    fn _assert_circuit_trait_compiles<F: Field, C: Circuit<F>>() {}
    fn _assert_simple_circuit_compiles<F: Field, C: SimpleCircuit<F>>() {}
    fn _assert_composable_compiles<F: Field, C: ComposableCircuit<F>>() {}
    fn _assert_nonuniform_compiles<F: Field, C: NonUniformCircuit<F>>() {}
}

