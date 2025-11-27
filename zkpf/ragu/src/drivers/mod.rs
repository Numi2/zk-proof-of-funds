//! Concrete driver implementations.
//!
//! This module provides ready-to-use drivers for common synthesis contexts:
//!
//! - [`proving`]: Driver for proof generation with witness data
//! - [`verifying`]: Driver for verification without witness data
//! - [`counting`]: Driver for counting constraints without allocation
//! - [`polynomial`]: Driver for polynomial evaluation in non-uniform circuits

pub mod proving;
pub mod verifying;
pub mod counting;
pub mod polynomial;

pub use proving::ProvingDriver;
pub use verifying::VerifyingDriver;
pub use counting::CountingDriver;
pub use polynomial::PolynomialDriver;

