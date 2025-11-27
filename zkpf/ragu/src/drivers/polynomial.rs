//! Polynomial evaluation driver for non-uniform circuits.
//!
//! This driver evaluates the circuit as a polynomial at specific points.
//! In non-uniform PCD schemes like HyperNova, we need to evaluate a
//! multivariate polynomial Q(τ, x, y, z) over different restrictions.
//!
//! The key insight is that circuit synthesis code can inadvertently
//! evaluate these polynomials on behalf of the backend, avoiding
//! extra heap allocations.

use crate::driver::Driver;
use crate::error::Error;
use crate::maybe::EmptyKind;
use crate::sink::{PolynomialSink, Sink};
use ff::Field;

/// A wire that accumulates polynomial terms.
///
/// During polynomial evaluation, each wire represents a partially
/// evaluated polynomial term rather than a concrete field element.
#[derive(Debug, Clone)]
pub struct PolynomialWire<F> {
    /// The accumulated coefficient.
    pub coefficient: F,
    /// The degree in the evaluation variable.
    pub degree: usize,
}

impl<F: Field> PolynomialWire<F> {
    /// Create a new polynomial wire.
    pub fn new(coefficient: F, degree: usize) -> Self {
        PolynomialWire { coefficient, degree }
    }

    /// Create a constant wire (degree 0).
    pub fn constant(value: F) -> Self {
        PolynomialWire {
            coefficient: value,
            degree: 0,
        }
    }

    /// The ONE wire.
    pub fn one() -> Self {
        PolynomialWire::constant(F::ONE)
    }

    /// Evaluate this wire at a point.
    pub fn evaluate(&self, point: F) -> F {
        let mut power = F::ONE;
        for _ in 0..self.degree {
            power *= point;
        }
        self.coefficient * power
    }
}

/// The polynomial evaluation driver.
///
/// This driver is used during verification of non-uniform circuits
/// to evaluate the circuit polynomial at specific points.
#[derive(Debug, Clone)]
pub struct PolynomialDriver<F: Field> {
    /// The evaluation point.
    point: F,
    /// Current maximum degree encountered.
    max_degree: usize,
    /// Coefficients collected during synthesis.
    coefficients: Vec<(F, usize)>,
}

impl<F: Field> PolynomialDriver<F> {
    /// Create a new polynomial driver for evaluation at the given point.
    pub fn new(point: F) -> Self {
        PolynomialDriver {
            point,
            max_degree: 0,
            coefficients: Vec::new(),
        }
    }

    /// Get the evaluation point.
    pub fn point(&self) -> F {
        self.point
    }

    /// Get the maximum degree encountered.
    pub fn max_degree(&self) -> usize {
        self.max_degree
    }

    /// Evaluate the accumulated polynomial at the point.
    pub fn evaluate(&self) -> F {
        let mut result = F::ZERO;
        let mut powers = vec![F::ONE; self.max_degree + 1];
        for i in 1..=self.max_degree {
            powers[i] = powers[i - 1] * self.point;
        }
        for &(coeff, degree) in &self.coefficients {
            result += coeff * powers[degree];
        }
        result
    }

    /// Add a term to the polynomial.
    fn add_term(&mut self, coefficient: F, degree: usize) {
        if degree > self.max_degree {
            self.max_degree = degree;
        }
        self.coefficients.push((coefficient, degree));
    }
}

impl<F: Field> Driver for PolynomialDriver<F> {
    type F = F;
    type W = PolynomialWire<F>;
    type MaybeKind = EmptyKind;
    type IO = PolynomialSink<F>;

    const ONE: Self::W = PolynomialWire {
        coefficient: F::ONE,
        degree: 0,
    };

    fn mul(
        &mut self,
        _values: impl FnOnce() -> Result<(Self::F, Self::F, Self::F), Error>,
    ) -> Result<(Self::W, Self::W, Self::W), Error> {
        // In polynomial mode, multiplication increases degree
        // We return symbolic wires that track degree
        let a = PolynomialWire::new(F::ONE, 1);
        let b = PolynomialWire::new(F::ONE, 1);
        let c = PolynomialWire::new(F::ONE, 2); // a * b has degree 2

        self.add_term(F::ONE, 2);
        Ok((a, b, c))
    }

    fn add<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<Self::W, Error> {
        let mut max_degree = 0;
        let mut sum_coeff = F::ZERO;

        for (wire, coeff) in lc() {
            if wire.degree > max_degree {
                max_degree = wire.degree;
            }
            sum_coeff += wire.coefficient * coeff;
            self.add_term(wire.coefficient * coeff, wire.degree);
        }

        Ok(PolynomialWire::new(sum_coeff, max_degree))
    }

    fn enforce_zero<L: IntoIterator<Item = (Self::W, Self::F)>>(
        &mut self,
        lc: impl FnOnce() -> L,
    ) -> Result<(), Error> {
        // In polynomial mode, we just accumulate the constraint polynomial
        for (wire, coeff) in lc() {
            self.add_term(wire.coefficient * coeff, wire.degree);
        }
        Ok(())
    }
}

impl<F: Field> Sink<PolynomialDriver<F>, PolynomialWire<F>> for PolynomialSink<F> {
    fn push(&mut self, wire: PolynomialWire<F>) -> Result<(), Error> {
        let evaluated = wire.evaluate(self.point);
        self.accumulator += evaluated * self.power;
        self.power *= self.point;
        Ok(())
    }

    fn finalize(self) -> Result<(), Error> {
        Ok(())
    }
}

/// A more sophisticated polynomial driver for multivariate evaluation.
///
/// This is used for evaluating Q(τ, x, y, z) with different variables
/// being bound at different times during the protocol.
#[derive(Debug, Clone)]
pub struct MultivariateDriver<F: Field> {
    /// Bound variable values (τ, x, y, z, etc.)
    bindings: Vec<F>,
    /// Which variables are currently bound.
    bound_mask: u64,
    /// Accumulated polynomial terms.
    terms: Vec<MultivariateTerm<F>>,
}

/// A term in a multivariate polynomial.
#[derive(Debug, Clone)]
pub struct MultivariateTerm<F> {
    /// Coefficient.
    pub coefficient: F,
    /// Exponents for each variable.
    pub exponents: Vec<usize>,
}

impl<F: Field> MultivariateDriver<F> {
    /// Create a new multivariate driver with the given bindings.
    pub fn new(bindings: Vec<F>) -> Self {
        MultivariateDriver {
            bindings,
            bound_mask: 0,
            terms: Vec::new(),
        }
    }

    /// Bind a variable to its value.
    pub fn bind(&mut self, var_index: usize) {
        self.bound_mask |= 1 << var_index;
    }

    /// Check if a variable is bound.
    pub fn is_bound(&self, var_index: usize) -> bool {
        (self.bound_mask & (1 << var_index)) != 0
    }

    /// Evaluate the polynomial with current bindings.
    pub fn evaluate(&self) -> F {
        let mut result = F::ZERO;
        for term in &self.terms {
            let mut value = term.coefficient;
            for (i, &exp) in term.exponents.iter().enumerate() {
                if self.is_bound(i) && exp > 0 {
                    let mut power = F::ONE;
                    for _ in 0..exp {
                        power *= self.bindings[i];
                    }
                    value *= power;
                }
            }
            result += value;
        }
        result
    }
}

// Note: Unit tests for PolynomialDriver are in tests/integration.rs
// to avoid duplicating the MockField implementation.

