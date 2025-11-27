//! Common circuit gadgets.
//!
//! This module provides reusable gadgets for common operations:
//!
//! - Arithmetic operations (add, sub, mul, div)
//! - Comparison operations (lt, lte, eq)
//! - Boolean operations (and, or, not, xor)
//! - Range checks
//! - Conditional selection

pub mod arithmetic;
pub mod boolean;
pub mod comparison;
pub mod range;
pub mod select;

pub use arithmetic::*;
pub use boolean::*;
pub use comparison::*;
pub use range::*;
pub use select::*;

