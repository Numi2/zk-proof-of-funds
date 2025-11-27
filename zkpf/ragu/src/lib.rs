//! # ragu - Non-uniform Circuit Synthesis Framework
//!
//! `ragu` is a circuit synthesis framework designed for proof-carrying data (PCD)
//! and non-uniform recursive composition schemes like HyperNova. It provides:
//!
//! - **Zero-cost witness abstractions**: The `Maybe<T>` type eliminates runtime
//!   overhead from optional witness data through compile-time specialization.
//!
//! - **Flexible driver architecture**: Different synthesis contexts (proving,
//!   verifying, polynomial evaluation) use different drivers that share the
//!   same circuit code.
//!
//! - **Optimized for hot-path synthesis**: Circuit synthesis is a critical
//!   hot path in non-uniform PCD schemes. `ragu` is designed to minimize
//!   allocations and branching during synthesis.
//!
//! ## Key Components
//!
//! ### Maybe<T> - Zero-cost Optional Values
//!
//! Traditional SNARK toolkits use `Option<T>` for witness values, leading to:
//! - Runtime branching on discriminants
//! - Unnecessary memory for discriminant storage
//! - Error propagation boilerplate
//!
//! `ragu` uses a higher-kinded `Maybe<T>` abstraction that compiles down to
//! either `Always<T>` (transparent wrapper) or `Empty` (zero-sized type)
//! depending on the synthesis context.
//!
//! ```rust,ignore
//! // During proof generation:
//! let witness: Always<F> = Always(value);
//! let x = witness.take(); // No-op move
//!
//! // During verification:
//! let witness: Empty<F> = Empty::new();
//! // Closure is never called, eliminated by DCE
//! let _ = Empty::<F>::just(|| expensive_computation());
//! ```
//!
//! ### Driver - Synthesis Context Abstraction
//!
//! The `Driver` trait abstracts over the synthesis backend:
//!
//! - `ProvingDriver`: Generates constraints and collects witness data
//! - `VerifyingDriver`: Checks proofs without witness generation
//! - `CountingDriver`: Measures circuit size without allocation
//! - `PolynomialDriver`: Evaluates circuit polynomials for non-uniform schemes
//!
//! ```rust,ignore
//! fn my_gadget<D: Driver>(dr: &mut D, a: D::W, b: D::W) -> Result<D::W, Error> {
//!     // This works identically across all drivers
//!     let (_, _, c) = dr.mul(|| {
//!         let a_val = witness_a.take();
//!         let b_val = witness_b.take();
//!         Ok((a_val, b_val, a_val * b_val))
//!     })?;
//!     Ok(c)
//! }
//! ```
//!
//! ### Circuit - Three-Phase Synthesis
//!
//! The `Circuit` trait splits synthesis into three phases:
//!
//! 1. `input`: Transform instance data into circuit IO
//! 2. `main`: Core proving logic producing IO and auxiliary data
//! 3. `output`: Transform IO into public inputs
//!
//! This separation enables:
//! - Verification paths that skip witness generation
//! - Consistent public input computation across proving/verification
//! - Auxiliary data extraction for accumulator construction
//!
//! ## Example
//!
//! ```rust,ignore
//! use ragu::{Circuit, Driver, Error};
//! use ragu::maybe::{Maybe, Always};
//! use ragu::drivers::ProvingDriver;
//!
//! struct MultiplyCircuit;
//!
//! impl<F: Field> Circuit<F> for MultiplyCircuit {
//!     type Instance<'a> = (F, F, F); // (a, b, expected_c)
//!     type IO<'a, D: Driver<F = F>> = D::W;
//!     type Witness<'a> = (F, F);
//!     type Aux<'a> = ();
//!
//!     fn input<'i, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         input: Witness<D, Self::Instance<'i>>,
//!     ) -> Result<Self::IO<'i, D>, Error> {
//!         let instance = input.take();
//!         dr.constant(instance.2)
//!     }
//!
//!     fn main<'w, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         witness: Witness<D, Self::Witness<'w>>,
//!     ) -> Result<(Self::IO<'w, D>, Witness<D, Self::Aux<'w>>), Error> {
//!         let (_, _, c) = dr.mul(|| {
//!             let (a, b) = witness.take();
//!             Ok((a, b, a * b))
//!         })?;
//!         Ok((c, D::just(|| ())))
//!     }
//!
//!     fn output<'s, D: Driver<F = F>>(
//!         &self,
//!         dr: &mut D,
//!         io: Self::IO<'s, D>,
//!         output: &mut D::IO,
//!     ) -> Result<(), Error> {
//!         output.push(io)
//!     }
//! }
//! ```

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod circuit;
pub mod driver;
pub mod drivers;
pub mod error;
pub mod gadgets;
pub mod maybe;
pub mod sink;

// Re-exports for convenience
pub use circuit::{Circuit, ComposableCircuit, NonUniformCircuit, SimpleCircuit};
pub use driver::{Driver, Witness, WireValue};
pub use error::{Error, Result};
pub use maybe::{Always, AlwaysKind, Empty, EmptyKind, Maybe, MaybeKind};
pub use sink::Sink;

/// Prelude for common imports.
pub mod prelude {
    pub use crate::circuit::{Circuit, SimpleCircuit};
    pub use crate::driver::{Driver, Witness, WireValue};
    pub use crate::error::{Error, Result};
    pub use crate::maybe::{Always, Empty, Maybe, MaybeKind};
    pub use crate::sink::Sink;
}

