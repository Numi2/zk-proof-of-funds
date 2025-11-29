//! Error types for circuit synthesis.
//!
//! Errors in ragu are kept minimal since the Maybe<T> abstraction eliminates
//! most witness-related failures at compile time.

use core::fmt;

/// Synthesis error that can occur during circuit construction.
///
/// Unlike traditional SNARK frameworks where missing witnesses produce runtime
/// errors, ragu's type system prevents most such errors. The remaining error
/// cases are genuine arithmetic failures (like division by zero) or constraint
/// system violations.
#[derive(Debug, Clone)]
pub enum Error {
    /// Division by zero during witness computation.
    DivisionByZero,

    /// A constraint that should be satisfiable was not.
    UnsatisfiedConstraint {
        /// Optional description of the constraint.
        message: &'static str,
    },

    /// The witness data was malformed or inconsistent.
    MalformedWitness {
        /// Description of what was wrong.
        message: &'static str,
    },

    /// An index was out of bounds during circuit synthesis.
    IndexOutOfBounds {
        /// The index that was accessed.
        index: usize,
        /// The length of the collection.
        length: usize,
    },

    /// A custom error with a message.
    Custom(&'static str),

    /// An IO error during proof serialization/deserialization.
    Io(&'static str),

    /// Verification failed.
    VerificationFailed,

    /// The circuit configuration is invalid.
    InvalidConfiguration(&'static str),

    /// A constraint was violated during verification.
    ConstraintViolation,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::DivisionByZero => write!(f, "division by zero"),
            Error::UnsatisfiedConstraint { message } => {
                write!(f, "unsatisfied constraint: {}", message)
            }
            Error::MalformedWitness { message } => {
                write!(f, "malformed witness: {}", message)
            }
            Error::IndexOutOfBounds { index, length } => {
                write!(f, "index {} out of bounds for length {}", index, length)
            }
            Error::Custom(msg) => write!(f, "{}", msg),
            Error::Io(msg) => write!(f, "IO error: {}", msg),
            Error::VerificationFailed => write!(f, "verification failed"),
            Error::InvalidConfiguration(msg) => {
                write!(f, "invalid configuration: {}", msg)
            }
            Error::ConstraintViolation => {
                write!(f, "constraint violation")
            }
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for Error {}

/// Result type alias for synthesis operations.
pub type Result<T> = core::result::Result<T, Error>;


