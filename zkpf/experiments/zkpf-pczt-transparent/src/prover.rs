//! Prover role implementation for PCZT.
//!
//! This module implements the Prover role as specified in ZIP 374.
//! The proving operation MUST be implemented using the Rust `pczt` crate
//! as it is not feasible to implement proving directly in the host language.

use crate::error::{PcztError, PcztResult};

/// Add Orchard proofs to the PCZT.
///
/// This function implements the **Prover** role as defined in ZIP 374.
/// It adds the required zero-knowledge proofs to the PCZT for any shielded
/// Orchard recipients.
///
/// **Important**: This function MUST be implemented using the `pczt` Rust crate.
/// Proving cannot be feasibly implemented in other languages due to the
/// computational complexity and cryptographic requirements.
///
/// # Arguments
///
/// * `pczt` - The PCZT that needs proofs added
///
/// # Returns
///
/// * `Ok(Pczt)` - The PCZT with proofs added
/// * `Err(ProverError)` - If proof generation fails
///
/// # Performance
///
/// Proof generation is computationally intensive and may take several seconds.
/// In WASM environments, consider running this in a Web Worker to avoid
/// blocking the main thread.
///
/// # Example
///
/// ```rust,ignore
/// use zkpf_pczt_transparent::*;
///
/// // After propose_transaction and (optionally) in parallel with signing
/// let proven_pczt = prove_transaction(pczt)?;
/// ```
pub fn prove_transaction(pczt: pczt::Pczt) -> PcztResult<pczt::Pczt> {
    use pczt::roles::prover::Prover;

    // The Orchard proving key is embedded/bundled in the library
    // This is loaded lazily to avoid startup cost
    let proving_key = load_orchard_proving_key()?;

    // Create the prover and add Orchard proofs
    let prover = Prover::new(pczt);

    let proven = prover
        .create_orchard_proof(&proving_key)
        .map_err(|e| PcztError::ProverError(format!("Failed to create Orchard proof: {:?}", e)))?
        .finish();

    Ok(proven)
}

/// Load the Orchard proving key.
///
/// The proving key is large (~40MB) and is either:
/// 1. Bundled in the binary (for native builds)
/// 2. Loaded from a separate file/URL (for WASM builds)
fn load_orchard_proving_key() -> PcztResult<orchard::circuit::ProvingKey> {
    // Use the built/bundled proving key
    // This is the standard approach used by other Zcash wallets
    Ok(orchard::circuit::ProvingKey::build())
}

/// Prover status for progress tracking.
#[derive(Debug, Clone)]
pub struct ProverStatus {
    /// Current phase of proving
    pub phase: ProverPhase,
    /// Progress percentage (0-100)
    pub progress: u8,
    /// Estimated time remaining in milliseconds
    pub estimated_remaining_ms: Option<u64>,
}

/// Phases of the proving process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProverPhase {
    /// Loading the proving key
    LoadingKey,
    /// Preparing witness data
    PreparingWitness,
    /// Generating the proof
    Proving,
    /// Verifying the proof
    Verifying,
    /// Complete
    Complete,
}

/// Async version of prove_transaction with progress callback.
///
/// This is useful for UI updates during the proving process.
#[cfg(feature = "wasm")]
pub async fn prove_transaction_with_progress<F>(
    pczt: pczt::Pczt,
    progress_callback: F,
) -> PcztResult<pczt::Pczt>
where
    F: Fn(ProverStatus) + 'static,
{
    // Report loading phase
    progress_callback(ProverStatus {
        phase: ProverPhase::LoadingKey,
        progress: 0,
        estimated_remaining_ms: Some(5000),
    });

    let proving_key = load_orchard_proving_key()?;

    // Report proving phase
    progress_callback(ProverStatus {
        phase: ProverPhase::Proving,
        progress: 20,
        estimated_remaining_ms: Some(3000),
    });

    let prover = pczt::roles::prover::Prover::new(pczt);

    let proven = prover
        .create_orchard_proof(&proving_key)
        .map_err(|e| PcztError::ProverError(format!("Failed to create Orchard proof: {:?}", e)))?
        .finish();

    // Report complete
    progress_callback(ProverStatus {
        phase: ProverPhase::Complete,
        progress: 100,
        estimated_remaining_ms: None,
    });

    Ok(proven)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prover_status() {
        let status = ProverStatus {
            phase: ProverPhase::Proving,
            progress: 50,
            estimated_remaining_ms: Some(2000),
        };
        assert_eq!(status.phase, ProverPhase::Proving);
        assert_eq!(status.progress, 50);
    }
}

