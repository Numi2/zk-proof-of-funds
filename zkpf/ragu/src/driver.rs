//! Circuit synthesis drivers.
//!
//! A `Driver` is a compile-time specialized context for how a circuit is
//! synthesized at runtime. Different drivers are used for different purposes:
//!
//! - **Proof generation**: The driver produces constraints and collects witness data.
//! - **Verification**: The driver evaluates polynomials to verify the proof.
//! - **Public input computation**: The driver extracts only the public inputs.
//!
//! The driver abstraction allows the same circuit code to be reused across
//! all these contexts while the compiler optimizes away irrelevant code paths.
//!
//! # Wire Types
//!
//! The `D::W` associated type represents an abstract wire. What a wire actually
//! represents depends on the driver:
//!
//! - During proof generation: A position in the witness
//! - During verification: A field element value from the proof
//! - During polynomial evaluation: A partially evaluated polynomial term
//!
//! # Example
//!
//! ```rust,ignore
//! fn my_gadget<D: Driver>(dr: &mut D, a: D::W, b: D::W) -> Result<D::W, Error> {
//!     // Multiply two wires
//!     let (a_out, b_out, c) = dr.mul(|| {
//!         // This closure is only called when we have a witness
//!         let a_val = a.value().take();
//!         let b_val = b.value().take();
//!         Ok((a_val, b_val, a_val * b_val))
//!     })?;
//!     
//!     // Create a linear combination: c + 1
//!     let c_plus_one = dr.add(|| [(c, D::F::ONE), (D::ONE, D::F::ONE)])?;
//!     
//!     // Enforce that c + 1 = some_expected_value
//!     dr.enforce_zero(|| [(c_plus_one, D::F::ONE), (expected, -D::F::ONE)])?;
//!     
//!     Ok(c)
//! }
//! ```

use crate::error::Error;
use crate::maybe::{Maybe, MaybeKind};
use crate::sink::Sink;
use ff::Field;

/// Type alias for the witness type of a driver.
///
/// This is `Always<T>` when the driver has witness data, or `Empty<T>` when it doesn't.
pub type Witness<D, T> = <<D as Driver>::MaybeKind as MaybeKind>::Rebind<T>;

/// A circuit synthesis driver.
///
/// The driver acts as a substitute for `ConstraintSystem<F>` with a more
/// flexible interface that enables compile-time specialization.
pub trait Driver: Sized {
    /// The field over which this driver operates.
    type F: Field;

    /// The abstract wire type.
    ///
    /// All you can do with a wire is clone it. The actual representation
    /// depends on the driver context.
    type W: Clone;

    /// The constant ONE wire.
    const ONE: Self::W;

    /// The kind of `Maybe<T>` used for witness values.
    ///
    /// - `AlwaysKind` during proof generation (witnesses are present)
    /// - `EmptyKind` during verification (witnesses are absent)
    type MaybeKind: MaybeKind;

    /// The IO sink type for collecting/verifying public inputs.
    type IO: Sink<Self, Self::W>;

    // =========================================================================
    // Constraint methods
    // =========================================================================

    /// Create a multiplication constraint.
    ///
    /// The closure provides the witness values for the two input wires and
    /// one output wire of a multiplication gate. The closure is only invoked
    /// when a witness is expected (i.e., during proof generation).
    ///
    /// Returns three new wires (a, b, c) where the constraint a * b = c is
    /// enforced by the underlying proving system.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let (a, b, c) = dr.mul(|| {
    ///     let x = witness_x.take();
    ///     let y = witness_y.take();
    ///     Ok((x, y, x * y))
    /// })?;
    /// ```
    fn mul(
        &mut self,
        values: impl FnOnce() -> Result<(Self::F, Self::F, Self::F), Error>,
    ) -> Result<(Self::W, Self::W, Self::W), Error>;

    /// Create a linear combination of wires.
    ///
    /// The closure provides an iterator of (wire, coefficient) pairs. This
    /// creates a "virtual" wire that represents the linear combination, which
    /// costs essentially nothing in the underlying proving system.
    ///
    /// The closure is only invoked when we do *not* have a witness (during
    /// constraint generation), since the value of the linear combination
    /// can be computed from its components.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// // Compute w = 2*a + 3*b - c
    /// let w = dr.add(|| [
    ///     (a.clone(), F::from(2)),
    ///     (b.clone(), F::from(3)),
    ///     (c.clone(), -F::ONE),
    /// ])?;
    /// ```
    fn add<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<Self::W, Error>;

    /// Enforce a linear constraint to be zero.
    ///
    /// The closure provides an iterator of (wire, coefficient) pairs. The
    /// driver enforces that the sum of wire * coefficient equals zero.
    ///
    /// Like `add`, the closure is only invoked when we do not have a witness.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// // Enforce a + b = c
    /// dr.enforce_zero(|| [
    ///     (a.clone(), F::ONE),
    ///     (b.clone(), F::ONE),
    ///     (c.clone(), -F::ONE),
    /// ])?;
    /// ```
    fn enforce_zero<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<(), Error>;

    // =========================================================================
    // Convenience methods
    // =========================================================================

    /// Create a `Maybe<T>` using the provided closure.
    ///
    /// This is a proxy to `Maybe<T>::just` using this driver's `MaybeKind`.
    #[inline(always)]
    fn just<R>(f: impl FnOnce() -> R) -> Witness<Self, R> {
        <Witness<Self, ()> as Maybe<()>>::just(f)
    }

    /// Create a `Maybe<T>` using the provided fallible closure.
    ///
    /// This is a proxy to `Maybe<T>::with` using this driver's `MaybeKind`.
    #[inline(always)]
    fn with<R>(f: impl FnOnce() -> Result<R, Error>) -> Result<Witness<Self, R>, Error> {
        <Witness<Self, ()> as Maybe<()>>::with(f)
    }

    /// Check if this driver expects witness values.
    #[inline(always)]
    fn has_witness() -> bool {
        Self::MaybeKind::HAS_VALUE
    }

    /// Allocate a new wire with the given witness value.
    ///
    /// This is a convenience method that creates a multiplication constraint
    /// with 1 * value = value, returning just the output wire.
    fn alloc(&mut self, value: impl FnOnce() -> Result<Self::F, Error>) -> Result<Self::W, Error> {
        let (_, _, w) = self.mul(|| {
            let v = value()?;
            Ok((Self::F::ONE, v, v))
        })?;
        Ok(w)
    }

    /// Allocate a constant wire.
    ///
    /// Returns a wire constrained to equal the given constant value.
    fn constant(&mut self, value: Self::F) -> Result<Self::W, Error> {
        self.add(|| [(Self::ONE.clone(), value)])
    }

    /// Enforce that two wires are equal.
    fn enforce_equal(&mut self, a: &Self::W, b: &Self::W) -> Result<(), Error> {
        self.enforce_zero(|| [(a.clone(), Self::F::ONE), (b.clone(), -Self::F::ONE)])
    }

    /// Compute the boolean NOT of a wire (assuming the wire is boolean).
    fn not(&mut self, a: &Self::W) -> Result<Self::W, Error> {
        // 1 - a
        self.add(|| [(Self::ONE.clone(), Self::F::ONE), (a.clone(), -Self::F::ONE)])
    }

    /// Enforce that a wire is boolean (0 or 1).
    ///
    /// Enforces: a * (1 - a) = 0
    fn enforce_boolean(&mut self, _a: &Self::W, value: Witness<Self, Self::F>) -> Result<(), Error> {
        // a * (1 - a) = 0
        // We need to compute (1 - a) and then enforce a * (1-a) = 0
        let one_minus_a = Self::just(|| {
            let a_val = value.view().take();
            Self::F::ONE - *a_val
        });

        let (_, _, should_be_zero) = self.mul(|| {
            let a_val = *value.snag();
            let one_minus_a_val = one_minus_a.take();
            Ok((a_val, one_minus_a_val, a_val * one_minus_a_val))
        })?;

        self.enforce_zero(|| [(should_be_zero, Self::F::ONE)])
    }
}

/// A wire value that may or may not have a concrete field element.
///
/// This wraps both the wire handle and its witness value (if available).
pub struct WireValue<D: Driver> {
    /// The abstract wire handle.
    pub wire: D::W,
    /// The witness value, if available.
    pub value: Witness<D, D::F>,
}

impl<D: Driver> Clone for WireValue<D>
where
    Witness<D, D::F>: Clone,
{
    fn clone(&self) -> Self {
        WireValue {
            wire: self.wire.clone(),
            value: self.value.clone(),
        }
    }
}

impl<D: Driver> WireValue<D> {
    /// Create a new wire value.
    pub fn new(wire: D::W, value: Witness<D, D::F>) -> Self {
        WireValue { wire, value }
    }

    /// Get a reference to the wire.
    pub fn wire(&self) -> &D::W {
        &self.wire
    }

    /// Get a reference to the value.
    pub fn value(&self) -> &Witness<D, D::F> {
        &self.value
    }
}

/// Extension trait for working with vectors of wire values.
pub trait WireValueVec<D: Driver> {
    /// Get a slice of the wire handles.
    fn wires(&self) -> Vec<D::W>;
}

impl<D: Driver> WireValueVec<D> for Vec<WireValue<D>> {
    fn wires(&self) -> Vec<D::W> {
        self.iter().map(|wv| wv.wire.clone()).collect()
    }
}

