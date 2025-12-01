//! Higher-kinded Maybe<T> abstraction for zero-cost witness handling.
//!
//! This module provides a compile-time abstraction over `Option<T>` that
//! eliminates runtime branching, unnecessary allocations, and error propagation
//! in circuit synthesis code.
//!
//! # The Problem with Option<T>
//!
//! Traditional SNARK toolkits use `Option<T>` to represent witness values that
//! might exist at runtime. This leads to several problems:
//!
//! 1. **Runtime overhead**: The compiler cannot optimize away the `Option`
//!    discriminant or branching even when we statically know the variant.
//!
//! 2. **Error propagation**: Missing witnesses require error handling code
//!    paths that are never actually taken during synthesis.
//!
//! 3. **Memory waste**: `Vec<Option<T>>` allocates space for discriminants
//!    and cannot be optimized to `Vec<T>` even when all elements are `Some`.
//!
//! # The Solution: Maybe<T>
//!
//! `Maybe<T>` is an "indexed monad" where the concrete type is either:
//!
//! - `Always<T>`: Transparently wraps `T`, guaranteed to contain a value
//! - `Empty`: Zero-sized type mimicking `()`, never contains a value
//!
//! The choice between these types is determined at compile time by the
//! synthesis driver, enabling the compiler to eliminate dead code paths.
//!
//! # Example
//!
//! ```rust,ignore
//! // During proof generation, witness values are Always<T>
//! let value: Always<F> = Always(field_element);
//! let x = value.take(); // Simple move, no branching
//!
//! // During verification, witness values are Empty
//! let value: Empty = Empty;
//! // value.take() would not compile - prevented at compile time!
//! ```

use crate::error::Error;

/// Kind marker for `Maybe<T>` types.
///
/// This trait enables higher-kinded type emulation in Rust by allowing
/// rebinding of the inner type while preserving the "always" or "empty"
/// nature of the container.
pub trait MaybeKind: Copy + Clone {
    /// Rebind this kind to wrap a different type.
    type Rebind<T>: Maybe<T, Kind = Self>;

    /// Whether this kind always contains a value.
    const HAS_VALUE: bool;
}

/// The core `Maybe<T>` trait providing Option-like operations with
/// compile-time variant selection.
pub trait Maybe<T>: Sized {
    /// The kind of this Maybe (Always or Empty).
    type Kind: MaybeKind;

    /// Create a `Maybe<R>` by invoking the closure if the backing store
    /// is `Always`, or returning an empty `Maybe<R>` if it's `Empty`.
    ///
    /// In the `Empty` case, the closure is not called and cannot survive
    /// dead code elimination. The resulting `Empty` is zero-sized.
    fn just<R>(f: impl FnOnce() -> R) -> <Self::Kind as MaybeKind>::Rebind<R>;

    /// Like `just` but allows the closure to return a `Result`.
    ///
    /// If the closure returns an error, it propagates upward. This is used
    /// for operations that might fail for reasons other than missing witnesses
    /// (e.g., division by zero).
    fn with<R>(
        f: impl FnOnce() -> Result<R, Error>,
    ) -> Result<<Self::Kind as MaybeKind>::Rebind<R>, Error>;

    /// Extract the contained value.
    ///
    /// For `Always<T>`, this is a no-op move.
    /// For `Empty`, this is a compile error - you cannot call `take()` on
    /// an `Empty` because the type system prevents it.
    fn take(self) -> T;

    /// Map a function over the contained value.
    ///
    /// For `Always<T>`, applies the function and returns `Always<U>`.
    /// For `Empty`, the function is never called and returns `Empty`.
    fn map<U, F>(self, f: F) -> <Self::Kind as MaybeKind>::Rebind<U>
    where
        F: FnOnce(T) -> U;

    /// Like `map` but the function returns a `Maybe<U>`.
    fn and_then<U, F>(self, f: F) -> <Self::Kind as MaybeKind>::Rebind<U>
    where
        F: FnOnce(T) -> <Self::Kind as MaybeKind>::Rebind<U>;

    /// Get a view (reference) to the contained value.
    ///
    /// Returns `Always<&T>` or `Empty` depending on the backing kind.
    fn view(&self) -> <Self::Kind as MaybeKind>::Rebind<&T>;

    /// Get a mutable view to the contained value.
    fn view_mut(&mut self) -> <Self::Kind as MaybeKind>::Rebind<&mut T>;

    /// Convenience method to get a reference to the value.
    ///
    /// Equivalent to `self.view().take()` but avoids the intermediate type.
    fn snag(&self) -> &T {
        // This default implementation works but concrete types override
        // for better codegen
        unsafe { core::mem::transmute_copy(&self.view()) }
    }

    /// Convenience method to get a mutable reference.
    fn snag_mut(&mut self) -> &mut T {
        unsafe { core::mem::transmute_copy(&self.view_mut()) }
    }

    /// Zip two `Maybe` values together.
    fn zip<U>(self, other: <Self::Kind as MaybeKind>::Rebind<U>) -> <Self::Kind as MaybeKind>::Rebind<(T, U)>;

    /// Convert to a standard `Option<T>`.
    fn into_option(self) -> Option<T>;

    /// Check if this Maybe contains a value (compile-time constant).
    fn has_value() -> bool {
        Self::Kind::HAS_VALUE
    }
}

// =============================================================================
// Always<T> - Contains a value
// =============================================================================

/// A `Maybe<T>` that always contains a value.
///
/// This is a transparent wrapper around `T` with no runtime overhead.
/// When the synthesis driver knows witnesses are present, all `Maybe<T>`
/// types become `Always<T>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(transparent)]
pub struct Always<T>(pub T);

/// Kind marker for `Always<T>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct AlwaysKind;

impl MaybeKind for AlwaysKind {
    type Rebind<T> = Always<T>;
    const HAS_VALUE: bool = true;
}

impl<T> Maybe<T> for Always<T> {
    type Kind = AlwaysKind;

    #[inline(always)]
    fn just<R>(f: impl FnOnce() -> R) -> Always<R> {
        Always(f())
    }

    #[inline(always)]
    fn with<R>(f: impl FnOnce() -> Result<R, Error>) -> Result<Always<R>, Error> {
        f().map(Always)
    }

    #[inline(always)]
    fn take(self) -> T {
        self.0
    }

    #[inline(always)]
    fn map<U, F>(self, f: F) -> Always<U>
    where
        F: FnOnce(T) -> U,
    {
        Always(f(self.0))
    }

    #[inline(always)]
    fn and_then<U, F>(self, f: F) -> Always<U>
    where
        F: FnOnce(T) -> Always<U>,
    {
        f(self.0)
    }

    #[inline(always)]
    fn view(&self) -> Always<&T> {
        Always(&self.0)
    }

    #[inline(always)]
    fn view_mut(&mut self) -> Always<&mut T> {
        Always(&mut self.0)
    }

    #[inline(always)]
    fn snag(&self) -> &T {
        &self.0
    }

    #[inline(always)]
    fn snag_mut(&mut self) -> &mut T {
        &mut self.0
    }

    #[inline(always)]
    fn zip<U>(self, other: Always<U>) -> Always<(T, U)> {
        Always((self.0, other.0))
    }

    #[inline(always)]
    fn into_option(self) -> Option<T> {
        Some(self.0)
    }
}

impl<T> Always<T> {
    /// Create a new `Always<T>` containing the given value.
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Always(value)
    }

    /// Get a reference to the inner value.
    #[inline(always)]
    pub const fn inner(&self) -> &T {
        &self.0
    }

    /// Get a mutable reference to the inner value.
    #[inline(always)]
    pub fn inner_mut(&mut self) -> &mut T {
        &mut self.0
    }

    /// Unwrap the inner value.
    #[inline(always)]
    pub fn into_inner(self) -> T {
        self.0
    }
}

impl<T> From<T> for Always<T> {
    #[inline(always)]
    fn from(value: T) -> Self {
        Always(value)
    }
}

impl<T> AsRef<T> for Always<T> {
    #[inline(always)]
    fn as_ref(&self) -> &T {
        &self.0
    }
}

impl<T> AsMut<T> for Always<T> {
    #[inline(always)]
    fn as_mut(&mut self) -> &mut T {
        &mut self.0
    }
}

impl<T: Default> Default for Always<T> {
    #[inline(always)]
    fn default() -> Self {
        Always(T::default())
    }
}

// =============================================================================
// Empty - Never contains a value
// =============================================================================

/// A `Maybe<T>` that never contains a value.
///
/// This is a zero-sized type with no runtime overhead. When the synthesis
/// driver knows witnesses are absent (e.g., during verification), all
/// `Maybe<T>` types become `Empty`.
///
/// Note: `Empty` is generic over `T` only for type system compatibility.
/// It never actually stores or produces a `T`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Empty<T>(core::marker::PhantomData<T>);

/// Kind marker for `Empty`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct EmptyKind;

impl MaybeKind for EmptyKind {
    type Rebind<T> = Empty<T>;
    const HAS_VALUE: bool = false;
}

impl<T> Empty<T> {
    /// Create a new empty value.
    #[inline(always)]
    pub const fn new() -> Self {
        Empty(core::marker::PhantomData)
    }

    /// Rebind this empty to a different type.
    ///
    /// This is a no-op since `Empty` is zero-sized regardless of `T`.
    #[inline(always)]
    pub const fn rebind<U>(self) -> Empty<U> {
        Empty(core::marker::PhantomData)
    }
}

impl<T> Maybe<T> for Empty<T> {
    type Kind = EmptyKind;

    #[inline(always)]
    fn just<R>(_f: impl FnOnce() -> R) -> Empty<R> {
        Empty::new()
    }

    #[inline(always)]
    fn with<R>(_f: impl FnOnce() -> Result<R, Error>) -> Result<Empty<R>, Error> {
        Ok(Empty::new())
    }

    /// # Panics
    ///
    /// This method always panics because `Empty` never contains a value.
    /// In practice, the type system should prevent you from calling this
    /// in contexts where `Empty` is used.
    #[inline(always)]
    fn take(self) -> T {
        unreachable!("Empty::take() called - this indicates a bug in circuit synthesis")
    }

    #[inline(always)]
    fn map<U, F>(self, _f: F) -> Empty<U>
    where
        F: FnOnce(T) -> U,
    {
        Empty::new()
    }

    #[inline(always)]
    fn and_then<U, F>(self, _f: F) -> Empty<U>
    where
        F: FnOnce(T) -> Empty<U>,
    {
        Empty::new()
    }

    #[inline(always)]
    fn view(&self) -> Empty<&T> {
        Empty::new()
    }

    #[inline(always)]
    fn view_mut(&mut self) -> Empty<&mut T> {
        Empty::new()
    }

    /// # Panics
    ///
    /// Always panics - see `take()`.
    #[inline(always)]
    fn snag(&self) -> &T {
        unreachable!("Empty::snag() called - this indicates a bug in circuit synthesis")
    }

    /// # Panics
    ///
    /// Always panics - see `take()`.
    #[inline(always)]
    fn snag_mut(&mut self) -> &mut T {
        unreachable!("Empty::snag_mut() called - this indicates a bug in circuit synthesis")
    }

    #[inline(always)]
    fn zip<U>(self, _other: Empty<U>) -> Empty<(T, U)> {
        Empty::new()
    }

    #[inline(always)]
    fn into_option(self) -> Option<T> {
        None
    }
}

// =============================================================================
// Collection support
// =============================================================================

/// Extension trait for working with collections of `Maybe<T>` values.
pub trait MaybeSlice<T> {
    /// The kind of Maybe values in this slice.
    type Kind: MaybeKind;

    /// View the slice as a Maybe of a slice.
    ///
    /// For `[Always<T>]`, this returns `Always<&[T]>` with zero overhead.
    /// For `[Empty<T>]`, this returns `Empty`.
    fn view_slice(&self) -> <Self::Kind as MaybeKind>::Rebind<&[T]>;
}

impl<T> MaybeSlice<T> for [Always<T>] {
    type Kind = AlwaysKind;

    #[inline(always)]
    fn view_slice(&self) -> Always<&[T]> {
        // SAFETY: Always<T> is repr(transparent) so [Always<T>] has the
        // same layout as [T]
        Always(unsafe { core::slice::from_raw_parts(self.as_ptr() as *const T, self.len()) })
    }
}

impl<T> MaybeSlice<T> for [Empty<T>] {
    type Kind = EmptyKind;

    #[inline(always)]
    fn view_slice(&self) -> Empty<&[T]> {
        Empty::new()
    }
}

/// Extension trait for Vec of Maybe values.
pub trait MaybeVec<T>: Sized {
    /// The kind of Maybe values in this vec.
    type Kind: MaybeKind;

    /// Convert a `Vec<Maybe<T>>` into `Maybe<Vec<T>>`.
    ///
    /// For `Vec<Always<T>>`, returns `Always<Vec<T>>` by transmuting.
    /// For `Vec<Empty<T>>`, returns `Empty` (the vec is deallocated).
    fn into_maybe(self) -> <Self::Kind as MaybeKind>::Rebind<Vec<T>>;
}

impl<T> MaybeVec<T> for Vec<Always<T>> {
    type Kind = AlwaysKind;

    #[inline(always)]
    fn into_maybe(self) -> Always<Vec<T>> {
        // SAFETY: Always<T> is repr(transparent) so Vec<Always<T>> has the
        // same layout as Vec<T>
        Always(unsafe {
            let mut me = core::mem::ManuallyDrop::new(self);
            Vec::from_raw_parts(me.as_mut_ptr() as *mut T, me.len(), me.capacity())
        })
    }
}

impl<T> MaybeVec<T> for Vec<Empty<T>> {
    type Kind = EmptyKind;

    #[inline(always)]
    fn into_maybe(self) -> Empty<Vec<T>> {
        // Vec<Empty<T>> never allocates because Empty is ZST
        drop(self);
        Empty::new()
    }
}

// Note: Tuple types are already covered by the generic impl for Always<T>

// =============================================================================
// Iterator support
// =============================================================================

/// Iterator over `Maybe<T>` values that unwraps `Always<T>` values.
pub struct AlwaysIter<I>(I);

impl<I, T> Iterator for AlwaysIter<I>
where
    I: Iterator<Item = Always<T>>,
{
    type Item = T;

    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        self.0.next().map(|a| a.0)
    }

    #[inline(always)]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.0.size_hint()
    }
}

impl<I, T> ExactSizeIterator for AlwaysIter<I>
where
    I: ExactSizeIterator<Item = Always<T>>,
{
    #[inline(always)]
    fn len(&self) -> usize {
        self.0.len()
    }
}

/// Extension trait for iterators over `Always<T>`.
pub trait IntoAlwaysIter: Sized {
    /// The item type after unwrapping.
    type Item;
    /// The resulting iterator type.
    type Iter: Iterator<Item = Self::Item>;

    /// Convert an iterator over `Always<T>` to an iterator over `T`.
    fn into_always_iter(self) -> Self::Iter;
}

impl<I, T> IntoAlwaysIter for I
where
    I: Iterator<Item = Always<T>>,
{
    type Item = T;
    type Iter = AlwaysIter<I>;

    #[inline(always)]
    fn into_always_iter(self) -> AlwaysIter<I> {
        AlwaysIter(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_is_transparent() {
        assert_eq!(core::mem::size_of::<Always<u64>>(), core::mem::size_of::<u64>());
        assert_eq!(core::mem::align_of::<Always<u64>>(), core::mem::align_of::<u64>());
    }

    #[test]
    fn empty_is_zst() {
        assert_eq!(core::mem::size_of::<Empty<u64>>(), 0);
        assert_eq!(core::mem::size_of::<Empty<[u8; 1024]>>(), 0);
    }

    #[test]
    fn always_operations() {
        let a: Always<i32> = Always(42);
        assert_eq!(a.take(), 42);

        let b: Always<i32> = <Always<()> as Maybe<()>>::just(|| 10 + 20);
        assert_eq!(b.take(), 30);

        let c: Always<i32> = Always(5);
        let d = c.map(|x| x * 2);
        assert_eq!(d.take(), 10);
    }

    #[test]
    fn empty_operations() {
        let _: Empty<i32> = <Empty<()> as Maybe<()>>::just(|| panic!("should not be called"));
        let _: Empty<i32> = Empty::<i32>::new().map(|_: i32| panic!("should not be called"));
    }

    #[test]
    fn vec_of_always_does_not_waste_memory() {
        let v: Vec<Always<u64>> = vec![Always(1), Always(2), Always(3)];
        // Vec<Always<u64>> should have same size as Vec<u64>
        assert_eq!(
            core::mem::size_of_val(&v),
            core::mem::size_of::<Vec<u64>>()
        );
    }

    #[test]
    fn slice_transmutation() {
        let v: Vec<Always<u64>> = vec![Always(1), Always(2), Always(3)];
        let slice: Always<&[u64]> = v.as_slice().view_slice();
        assert_eq!(slice.take(), &[1u64, 2, 3]);
    }
}

