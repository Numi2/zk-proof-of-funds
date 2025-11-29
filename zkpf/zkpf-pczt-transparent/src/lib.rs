//! # PCZT Transparent-to-Shielded Library
//!
//! This library implements the PCZT (Partially Constructed Zcash Transaction) API
//! for transparent-only wallets that want to send to shielded (Orchard) recipients.
//!
//! Based on ZIP 374 and the `pczt` Rust crate specification.
//!
//! ## Overview
//!
//! This library enables Bitcoin-derived, transparent-only Zcash wallets to create
//! transactions that send to Orchard shielded addresses while using only transparent
//! inputs. The API is designed around the PCZT format which allows separation of
//! transaction construction, proving, signing, and finalization.
//!
//! ## Workflow
//!
//! ```text
//! propose_transaction → prove_transaction → get_sighash/append_signature → finalize_and_extract
//!                                          ↓
//!                               (optionally) verify_before_signing
//! ```
//!
//! ## Roles Implemented
//!
//! - **Creator**: Creates the initial PCZT structure
//! - **Constructor**: Adds inputs and outputs
//! - **IO Finalizer**: Finalizes inputs/outputs configuration
//! - **Prover**: Creates Orchard proofs (MUST use Rust via WASM)
//! - **Signer**: Provides sighash computation and signature application
//! - **Spend Finalizer**: Finalizes spends after signing
//! - **Transaction Extractor**: Extracts the final transaction bytes

mod error;
mod proposal;
mod prover;
mod signer;
mod types;
mod verifier;

pub use error::*;
pub use proposal::*;
pub use prover::*;
pub use signer::*;
pub use types::*;
pub use verifier::*;

#[cfg(feature = "wasm")]
mod wasm;

#[cfg(feature = "wasm")]
pub use wasm::*;

/// Parse a PCZT from its serialized byte representation.
///
/// # Arguments
/// * `pczt_bytes` - The serialized PCZT bytes
///
/// # Returns
/// * `Ok(Pczt)` - The parsed PCZT
/// * `Err(ParseError)` - If parsing fails
pub fn parse_pczt(pczt_bytes: &[u8]) -> Result<pczt::Pczt, PcztError> {
    pczt::Pczt::parse(pczt_bytes).map_err(|e| PcztError::ParseError(format!("{:?}", e)))
}

/// Serialize a PCZT to its byte representation.
///
/// # Arguments
/// * `pczt` - The PCZT to serialize
///
/// # Returns
/// The serialized bytes
pub fn serialize_pczt(pczt: &pczt::Pczt) -> Vec<u8> {
    pczt.serialize()
}

/// Combine multiple PCZTs that represent the same transaction.
///
/// This is used when signing or proving is done by separate processes
/// and the results need to be merged back together.
///
/// # Arguments
/// * `pczts` - Vector of PCZTs to combine
///
/// # Returns
/// * `Ok(Pczt)` - The combined PCZT
/// * `Err(CombineError)` - If combination fails
pub fn combine(pczts: Vec<pczt::Pczt>) -> Result<pczt::Pczt, PcztError> {
    use pczt::roles::combiner::Combiner;
    Combiner::new(pczts)
        .combine()
        .map_err(|e| PcztError::CombineError(format!("{:?}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_serialization() {
        // Create a minimal PCZT for testing serialization
        // In practice, PCZTs would come from propose_transaction
        let empty_pczt = pczt::Pczt::default();
        let serialized = serialize_pczt(&empty_pczt);
        let parsed = parse_pczt(&serialized).unwrap();
        let reserialized = serialize_pczt(&parsed);
        assert_eq!(serialized, reserialized);
    }
}

