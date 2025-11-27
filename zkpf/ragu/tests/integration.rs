//! Integration tests for the ragu crate.

use ff::Field;
use ragu::Circuit;
use ragu::driver::{Driver, Witness};
use ragu::drivers::{ProvingDriver, CountingDriver};
use ragu::maybe::{Always, Empty, AlwaysKind, EmptyKind, Maybe};
use ragu::Error;
use core::iter::{Sum, Product};

// =============================================================================
// Mock Field Implementation for Testing
// =============================================================================

/// A simple mock field for testing (wrapping u64 with modular arithmetic).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash)]
pub struct MockField(pub u64);

impl MockField {
    pub const MODULUS: u64 = 0xFFFF_FFFF_FFFF_FFC5; // Large prime
}

impl ff::Field for MockField {
    const ZERO: Self = MockField(0);
    const ONE: Self = MockField(1);

    fn random(mut rng: impl rand_core::RngCore) -> Self {
        MockField(rng.next_u64() % Self::MODULUS)
    }

    fn square(&self) -> Self {
        MockField((self.0 as u128 * self.0 as u128 % Self::MODULUS as u128) as u64)
    }

    fn double(&self) -> Self {
        MockField((self.0 * 2) % Self::MODULUS)
    }

    fn invert(&self) -> subtle::CtOption<Self> {
        if self.0 == 0 {
            subtle::CtOption::new(MockField(0), subtle::Choice::from(0))
        } else {
            // Simple modular inverse (not constant-time, just for testing)
            let mut result = MockField(1);
            let mut base = *self;
            let mut exp = Self::MODULUS - 2;
            while exp > 0 {
                if exp & 1 == 1 {
                    result = result * base;
                }
                base = base.square();
                exp >>= 1;
            }
            subtle::CtOption::new(result, subtle::Choice::from(1))
        }
    }

    fn sqrt_ratio(_num: &Self, _div: &Self) -> (subtle::Choice, Self) {
        (subtle::Choice::from(0), MockField(0))
    }
}

impl core::ops::Add for MockField {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        MockField((self.0 + rhs.0) % Self::MODULUS)
    }
}

impl core::ops::Add<&MockField> for MockField {
    type Output = Self;
    fn add(self, rhs: &Self) -> Self {
        self + *rhs
    }
}

impl core::ops::Sub for MockField {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        MockField((Self::MODULUS + self.0 - rhs.0) % Self::MODULUS)
    }
}

impl core::ops::Sub<&MockField> for MockField {
    type Output = Self;
    fn sub(self, rhs: &Self) -> Self {
        self - *rhs
    }
}

impl core::ops::Mul for MockField {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        MockField((self.0 as u128 * rhs.0 as u128 % Self::MODULUS as u128) as u64)
    }
}

impl core::ops::Mul<&MockField> for MockField {
    type Output = Self;
    fn mul(self, rhs: &Self) -> Self {
        self * *rhs
    }
}

impl core::ops::Neg for MockField {
    type Output = Self;
    fn neg(self) -> Self {
        MockField((Self::MODULUS - self.0) % Self::MODULUS)
    }
}

impl core::ops::AddAssign for MockField {
    fn add_assign(&mut self, rhs: Self) {
        *self = *self + rhs;
    }
}

impl core::ops::AddAssign<&MockField> for MockField {
    fn add_assign(&mut self, rhs: &Self) {
        *self = *self + *rhs;
    }
}

impl core::ops::SubAssign for MockField {
    fn sub_assign(&mut self, rhs: Self) {
        *self = *self - rhs;
    }
}

impl core::ops::SubAssign<&MockField> for MockField {
    fn sub_assign(&mut self, rhs: &Self) {
        *self = *self - *rhs;
    }
}

impl core::ops::MulAssign for MockField {
    fn mul_assign(&mut self, rhs: Self) {
        *self = *self * rhs;
    }
}

impl core::ops::MulAssign<&MockField> for MockField {
    fn mul_assign(&mut self, rhs: &Self) {
        *self = *self * *rhs;
    }
}

impl Sum for MockField {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(MockField(0), |a, b| a + b)
    }
}

impl<'a> Sum<&'a MockField> for MockField {
    fn sum<I: Iterator<Item = &'a Self>>(iter: I) -> Self {
        iter.fold(MockField(0), |a, b| a + *b)
    }
}

impl Product for MockField {
    fn product<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(MockField(1), |a, b| a * b)
    }
}

impl<'a> Product<&'a MockField> for MockField {
    fn product<I: Iterator<Item = &'a Self>>(iter: I) -> Self {
        iter.fold(MockField(1), |a, b| a * *b)
    }
}

impl subtle::ConditionallySelectable for MockField {
    fn conditional_select(a: &Self, b: &Self, choice: subtle::Choice) -> Self {
        if choice.into() { *b } else { *a }
    }
}

impl subtle::ConstantTimeEq for MockField {
    fn ct_eq(&self, other: &Self) -> subtle::Choice {
        subtle::Choice::from((self.0 == other.0) as u8)
    }
}

// =============================================================================
// Maybe<T> Tests
// =============================================================================

#[test]
fn test_maybe_always_basic() {
    let a: Always<i32> = Always(42);
    assert_eq!(a.take(), 42);

    let b: Always<i32> = <Always<()> as Maybe<()>>::just(|| 10 + 20);
    assert_eq!(b.take(), 30);

    let c = Always(5);
    let d = c.map(|x| x * 2);
    assert_eq!(d.take(), 10);
}

#[test]
fn test_maybe_empty_skips_closures() {
    // The closure should never be called for Empty
    let _: Empty<i32> = <Empty<()> as Maybe<()>>::just(|| panic!("should not be called"));
    let _: Empty<i32> = Empty::<i32>::new().map(|_: i32| panic!("should not be called"));
}

#[test]
fn test_maybe_with_fallible() {
    let result: core::result::Result<Always<i32>, Error> = <Always<()> as Maybe<()>>::with(|| Ok(42));
    assert_eq!(result.unwrap().take(), 42);

    let result: core::result::Result<Always<i32>, Error> = <Always<()> as Maybe<()>>::with(|| Err(Error::DivisionByZero));
    assert!(result.is_err());

    let result: core::result::Result<Empty<i32>, Error> = <Empty<()> as Maybe<()>>::with(|| Err(Error::DivisionByZero));
    assert!(result.is_ok()); // Empty doesn't call the closure
}

#[test]
fn test_maybe_view() {
    let a = Always(vec![1, 2, 3]);
    let view = a.view();
    assert_eq!(view.take(), &vec![1, 2, 3]);
}

#[test]
fn test_always_is_transparent() {
    assert_eq!(
        core::mem::size_of::<Always<u64>>(),
        core::mem::size_of::<u64>()
    );
    assert_eq!(
        core::mem::align_of::<Always<u64>>(),
        core::mem::align_of::<u64>()
    );
}

#[test]
fn test_empty_is_zst() {
    assert_eq!(core::mem::size_of::<Empty<u64>>(), 0);
    assert_eq!(core::mem::size_of::<Empty<[u8; 1024]>>(), 0);
}

// =============================================================================
// Driver Tests
// =============================================================================

#[test]
fn test_proving_driver_mul_constraint() {
    let mut driver = ProvingDriver::<MockField>::new();

    let (a, b, c) = driver
        .mul(|| Ok((MockField(3), MockField(4), MockField(12))))
        .unwrap();

    assert_eq!(driver.get_witness(a), MockField(3));
    assert_eq!(driver.get_witness(b), MockField(4));
    assert_eq!(driver.get_witness(c), MockField(12));

    assert!(driver.check_constraints().is_ok());
}

#[test]
fn test_proving_driver_bad_constraint() {
    let mut driver = ProvingDriver::<MockField>::new();

    // Create an incorrect multiplication
    let _ = driver
        .mul(|| Ok((MockField(3), MockField(4), MockField(13)))) // Wrong!
        .unwrap();

    assert!(driver.check_constraints().is_err());
}

#[test]
fn test_proving_driver_linear_combination() {
    let mut driver = ProvingDriver::<MockField>::new();

    // Allocate some wires
    let (a, _, _) = driver.mul(|| Ok((MockField(5), MockField(1), MockField(5)))).unwrap();
    let (b, _, _) = driver.mul(|| Ok((MockField(3), MockField(1), MockField(3)))).unwrap();

    // Create linear combination: 2*a + 3*b = 2*5 + 3*3 = 19
    let sum = driver.add(|| [
        (a, MockField(2)),
        (b, MockField(3)),
    ]).unwrap();

    assert_eq!(driver.get_witness(sum), MockField(19));
    assert!(driver.check_constraints().is_ok());
}

#[test]
fn test_counting_driver() {
    let mut driver = CountingDriver::<MockField>::new();

    // Initial state
    assert_eq!(driver.num_mul, 0);
    assert_eq!(driver.num_wires, 1); // ONE wire

    // Add some constraints
    let _ = driver.mul(|| unreachable!());
    assert_eq!(driver.num_mul, 1);
    assert_eq!(driver.num_wires, 4); // ONE + 3

    let _ = driver.mul(|| unreachable!());
    assert_eq!(driver.num_mul, 2);
    assert_eq!(driver.num_wires, 7);

    let _ = driver.add(|| [(ragu::drivers::counting::CountingWire::new(), MockField::ONE)]);
    assert_eq!(driver.num_linear, 1);
    assert_eq!(driver.num_wires, 8);

    let stats = driver.stats();
    assert_eq!(stats.total_constraints(), 3);
}

// =============================================================================
// Circuit Composition Tests
// =============================================================================

/// A simple circuit that multiplies two values.
struct MultiplyCircuit;

impl ragu::SimpleCircuit<MockField> for MultiplyCircuit {
    type Data<'a> = (MockField, MockField);
    type IO<'a, D: Driver<F = MockField>> = D::W;

    fn synthesize<'a, D: Driver<F = MockField>>(
        &self,
        dr: &mut D,
        data: Witness<D, Self::Data<'a>>,
    ) -> ragu::Result<Self::IO<'a, D>> {
        let (_, _, c) = dr.mul(|| {
            let (a, b) = data.take();
            Ok((a, b, a * b))
        })?;
        Ok(c)
    }

    fn write_output<'a, D: Driver<F = MockField>>(
        &self,
        _dr: &mut D,
        _io: Self::IO<'a, D>,
        _output: &mut D::IO,
    ) -> ragu::Result<()> {
        // For simplicity, we don't write anything to the output
        Ok(())
    }
}

#[test]
fn test_simple_circuit_proving() {
    let circuit = MultiplyCircuit;
    let mut driver = ProvingDriver::<MockField>::new();
    let mut sink = ragu::sink::CollectingSink::new();

    let witness = Always((MockField(7), MockField(8)));
    let result = circuit.synthesize_prove(&mut driver, witness, &mut sink);

    assert!(result.is_ok());
    assert!(driver.check_constraints().is_ok());
}

#[test]
fn test_simple_circuit_counting() {
    let circuit = MultiplyCircuit;
    let mut driver = CountingDriver::<MockField>::new();
    let mut sink = ragu::sink::CountingSink::new();

    let witness: Empty<(MockField, MockField)> = Empty::new();
    let result = circuit.synthesize_prove(&mut driver, witness, &mut sink);

    assert!(result.is_ok());
    assert_eq!(driver.num_mul, 1);
}

// =============================================================================
// Witness Generation Pattern Tests
// =============================================================================

/// Demonstrates the witness generation pattern from the blog post.
#[test]
fn test_witness_pattern() {
    struct WitnessDemo;

    impl WitnessDemo {
        fn compute_with_witness<D: Driver<F = MockField>>(
            witness: &Witness<D, Vec<MockField>>,
            i: usize,
        ) -> Witness<D, MockField> {
            D::just(|| {
                let values = witness.snag();
                values[i]
            })
        }
    }

    // Test with Always (proving mode)
    let witness: Always<Vec<MockField>> = Always(vec![MockField(1), MockField(2), MockField(3)]);
    let value = WitnessDemo::compute_with_witness::<ProvingDriver<MockField>>(&witness, 1);
    assert_eq!(value.take(), MockField(2));

    // Test with Empty (verification mode) - closure doesn't run
    let witness: Empty<Vec<MockField>> = Empty::new();
    let _value: Empty<MockField> = WitnessDemo::compute_with_witness::<CountingDriver<MockField>>(&witness, 1);
    // Empty value - no panic because closure wasn't called
}

// =============================================================================
// Higher-Kinded Type Tests
// =============================================================================

#[test]
fn test_maybe_kind_rebinding() {
    // Test that rebinding works correctly
    fn rebind_test<K: ragu::MaybeKind>() {
        let _: K::Rebind<i32>;
        let _: K::Rebind<String>;
        let _: K::Rebind<Vec<u8>>;
    }

    rebind_test::<AlwaysKind>();
    rebind_test::<EmptyKind>();
}

#[test]
fn test_vec_of_maybe_memory() {
    // Vec<Always<T>> should have same size as Vec<T>
    let v1: Vec<Always<u64>> = vec![Always(1), Always(2), Always(3)];
    let v2: Vec<u64> = vec![1, 2, 3];

    assert_eq!(
        core::mem::size_of_val(&v1),
        core::mem::size_of_val(&v2)
    );

    // Vec<Empty<T>> should have minimal size (zero elements allocated)
    let v3: Vec<Empty<[u8; 1024]>> = vec![Empty::new(); 100];
    // Empty is ZST so Vec won't allocate for elements
    assert_eq!(core::mem::size_of::<Empty<[u8; 1024]>>(), 0);
    assert_eq!(v3.len(), 100);
}

#[test]
fn test_slice_transmutation() {
    use ragu::maybe::MaybeSlice;

    let v: Vec<Always<u64>> = vec![Always(1), Always(2), Always(3)];
    let slice: Always<&[u64]> = v.as_slice().view_slice();
    assert_eq!(slice.take(), &[1u64, 2, 3]);
}

