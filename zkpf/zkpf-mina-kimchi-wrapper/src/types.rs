//! Type definitions for the Mina Proof of State wrapper.
//!
//! This module contains locked constants for the Mina Proof of State circuit
//! as defined in lambdaclass/mina_bridge. These values MUST NOT change
//! as they are part of the verification protocol.

use serde::{Deserialize, Serialize};

use crate::CANDIDATE_CHAIN_LENGTH;

// ============================================================================
// PROOF OF STATE LOCKED CONSTANTS
// ============================================================================
// These constants define the fixed parameters for the Mina Proof of State
// Kimchi circuit. They are derived from the circuit definition and MUST
// match the prover's configuration exactly.

/// Domain size for Mina Proof of State circuit.
/// This is 2^16 = 65536 rows in the constraint system.
pub const PROOF_OF_STATE_DOMAIN_SIZE: u64 = 1 << 16;

/// Log2 of domain size (used for IPA rounds).
pub const PROOF_OF_STATE_DOMAIN_LOG2: usize = 16;

/// Number of public inputs in the Proof of State circuit.
/// = 1 (bridge_tip_state_hash) + 16 (candidate_state_hashes) + 16 (candidate_ledger_hashes)
pub const PROOF_OF_STATE_NUM_PUBLIC_INPUTS: usize = 33;

/// Number of witness columns in Kimchi (w_0 to w_14).
pub const KIMCHI_WITNESS_COLUMNS: usize = 15;

/// Number of sigma polynomials for permutation argument.
/// In Kimchi, this equals the number of witness columns.
pub const KIMCHI_SIGMA_COLUMNS: usize = KIMCHI_WITNESS_COLUMNS;

/// Number of quotient polynomial chunks (domain_size / max_constraint_degree).
pub const KIMCHI_QUOTIENT_CHUNKS: usize = 7;

/// Kimchi maximum constraint degree.
pub const KIMCHI_MAX_DEGREE: usize = 8;

/// Number of IPA rounds = log2(domain_size).
pub const IPA_ROUNDS: usize = PROOF_OF_STATE_DOMAIN_LOG2;

// ============================================================================
// PASTA CURVE CONSTANTS
// ============================================================================

/// Pallas curve: y² = x³ + 5 over Fp
/// Base field modulus Fp:
/// 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001
pub const PALLAS_MODULUS_BYTES: [u8; 32] = [
    0x01, 0x00, 0x00, 0x00, 0xed, 0x30, 0x2d, 0x99,
    0x1b, 0xf9, 0x4c, 0x09, 0xfc, 0x98, 0x46, 0x22,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
];

/// Vesta curve: y² = x³ + 5 over Fq (where Fq = |Pallas|)
/// Base field modulus Fq:
/// 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001
pub const VESTA_MODULUS_BYTES: [u8; 32] = [
    0x01, 0x00, 0x00, 0x00, 0x21, 0xeb, 0x46, 0x8c,
    0xdd, 0xa8, 0x94, 0x09, 0xfc, 0x98, 0x46, 0x22,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40,
];

/// Domain generator ω for domain size 2^16 in Pallas scalar field.
/// This is a primitive 2^16-th root of unity.
/// ω = g^((p-1)/2^16) where g is a generator of F_p^*.
/// Value: 0x2bce74deac30ebda362120830561f81aea322bf2b7bb7f7f
pub const DOMAIN_GENERATOR_BYTES: [u8; 32] = [
    0x7f, 0x7f, 0xbb, 0xb7, 0xf2, 0x2b, 0x32, 0xea,
    0x1a, 0xf8, 0x61, 0x05, 0x83, 0x20, 0x21, 0x36,
    0xda, 0xeb, 0x30, 0xac, 0xde, 0x74, 0xce, 0x2b,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// Pallas generator point G (for commitments).
/// x = 1, y = sqrt(6) in Fp
pub const PALLAS_GENERATOR_X: [u8; 32] = [
    0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// Pallas generator point G y-coordinate.
/// y = sqrt(1 + 5) = sqrt(6) in Fp
/// Actual value: 0x1b74b5a30a12937c53dca917f9dc6636f11a9b6e7a3c4f3b...
pub const PALLAS_GENERATOR_Y: [u8; 32] = [
    0x3b, 0x4f, 0x3c, 0x7a, 0x6e, 0x9b, 0x1a, 0xf1,
    0x36, 0x66, 0xdc, 0xf9, 0x17, 0xa9, 0xdc, 0x53,
    0x7c, 0x93, 0x12, 0x0a, 0xa3, 0xb5, 0x74, 0x1b,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// Full Kimchi proof data for Mina Proof of State.
///
/// This structure contains all the data needed to verify a Mina Proof of State,
/// as defined in the lambdaclass/mina_bridge specification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaProofOfStateProof {
    /// The Kimchi proof bytes for the candidate tip state.
    /// This is a Pickles/Kimchi state proof verifying the recursive state SNARK.
    pub candidate_tip_proof: Vec<u8>,

    /// Candidate chain state bodies (16 states).
    /// Each state contains the full state body for consensus verification.
    pub candidate_chain_states: Vec<MinaStateBody>,

    /// The previous bridge tip state (for continuity verification).
    pub bridge_tip_state: MinaStateBody,

    /// Optional: auxiliary witness data for consensus checks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consensus_witness: Option<ConsensusWitness>,
}

/// Mina protocol state body.
///
/// Contains the essential fields of a Mina protocol state needed for
/// verification and consensus checks.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaStateBody {
    /// State hash (Poseidon hash of all state fields).
    pub state_hash: [u8; 32],

    /// Ledger hash (Merkle root of the account tree).
    pub ledger_hash: [u8; 32],

    /// Blockchain length (height).
    pub blockchain_length: u32,

    /// Global slot number.
    pub global_slot: u64,

    /// Timestamp (milliseconds since epoch).
    pub timestamp: u64,

    /// Previous state hash for chain linking.
    pub previous_state_hash: [u8; 32],

    /// Snarked ledger hash (committed ledger state).
    pub snarked_ledger_hash: [u8; 32],

    /// Genesis state hash (chain identifier).
    pub genesis_state_hash: [u8; 32],

    /// Staking epoch data ledger hash.
    pub staking_epoch_ledger_hash: [u8; 32],

    /// Next epoch data ledger hash.
    pub next_epoch_ledger_hash: [u8; 32],

    /// Min window density for short-range fork checks.
    pub min_window_density: u32,

    /// Sub window densities for long-range fork checks.
    #[serde(default)]
    pub sub_window_densities: Vec<u32>,
}

/// Auxiliary witness data for consensus verification.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ConsensusWitness {
    /// VRF outputs for slot checks.
    pub vrf_outputs: Vec<[u8; 32]>,

    /// Block producer keys for each candidate state.
    pub block_producers: Vec<[u8; 32]>,

    /// Coinbase amounts for each candidate state.
    pub coinbase_amounts: Vec<u64>,

    /// Transaction commitment for each candidate state.
    pub transaction_commitments: Vec<[u8; 32]>,
}

/// Verifier index for the Kimchi circuit.
///
/// This is a fixed parameter that identifies the specific Mina Proof of State
/// circuit being verified.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KimchiVerifierIndex {
    /// Domain size (number of rows in the constraint system).
    pub domain_size: u64,

    /// Log2 of domain size.
    pub domain_log2: usize,

    /// Commitment to the circuit gates.
    pub circuit_commitment: [u8; 32],

    /// SRS commitment (Structured Reference String).
    pub srs_commitment: [u8; 32],

    /// Circuit version identifier.
    pub version: String,

    /// Number of public inputs.
    pub num_public_inputs: usize,

    /// Number of witness columns.
    pub num_witness_cols: usize,
}

impl Default for KimchiVerifierIndex {
    fn default() -> Self {
        Self::proof_of_state()
    }
}

impl KimchiVerifierIndex {
    /// Create verifier index for Mina Proof of State circuit.
    ///
    /// This uses the locked constants defined at the top of this module.
    pub fn proof_of_state() -> Self {
        Self {
            domain_size: PROOF_OF_STATE_DOMAIN_SIZE,
            domain_log2: PROOF_OF_STATE_DOMAIN_LOG2,
            circuit_commitment: [0u8; 32], // TODO: Load from artifacts
            srs_commitment: [0u8; 32],     // TODO: Load from artifacts
            version: "mina_proof_of_state_v1".to_string(),
            num_public_inputs: PROOF_OF_STATE_NUM_PUBLIC_INPUTS,
            num_witness_cols: KIMCHI_WITNESS_COLUMNS,
        }
    }

    /// Validate that the verifier index matches expected Proof of State constants.
    pub fn validate_proof_of_state(&self) -> Result<(), String> {
        if self.domain_size != PROOF_OF_STATE_DOMAIN_SIZE {
            return Err(format!(
                "domain_size mismatch: expected {}, got {}",
                PROOF_OF_STATE_DOMAIN_SIZE, self.domain_size
            ));
        }
        if self.num_public_inputs != PROOF_OF_STATE_NUM_PUBLIC_INPUTS {
            return Err(format!(
                "num_public_inputs mismatch: expected {}, got {}",
                PROOF_OF_STATE_NUM_PUBLIC_INPUTS, self.num_public_inputs
            ));
        }
        if self.num_witness_cols != KIMCHI_WITNESS_COLUMNS {
            return Err(format!(
                "num_witness_cols mismatch: expected {}, got {}",
                KIMCHI_WITNESS_COLUMNS, self.num_witness_cols
            ));
        }
        Ok(())
    }
}

/// Full verifier index with all polynomial commitments.
///
/// This contains everything needed for Kimchi verification.
/// In production, this would be loaded from serialized artifacts.
#[derive(Clone, Debug)]
pub struct FullVerifierIndex {
    /// Basic verifier index parameters.
    pub index: KimchiVerifierIndex,

    /// Domain generator ω (primitive n-th root of unity).
    pub domain_generator: [u8; 32],

    /// Gate selector polynomial commitments.
    /// Each commitment is a Pallas point (x, y) as 64 bytes.
    pub gate_selector_commitments: Vec<[u8; 64]>,

    /// Sigma polynomial commitments for permutation argument.
    /// One commitment per witness column.
    pub sigma_commitments: Vec<[u8; 64]>,

    /// SRS elements G_0, G_1, ..., G_{n-1} for IPA.
    /// Each element is a Pallas point.
    pub srs_g: Vec<[u8; 64]>,

    /// SRS blinding element H for IPA.
    pub srs_h: [u8; 64],
}

impl Default for FullVerifierIndex {
    fn default() -> Self {
        Self::proof_of_state_placeholder()
    }
}

impl FullVerifierIndex {
    /// Create a placeholder for Proof of State (for testing).
    ///
    /// In production, use `load_from_artifacts()` instead.
    pub fn proof_of_state_placeholder() -> Self {
        Self {
            index: KimchiVerifierIndex::proof_of_state(),
            domain_generator: DOMAIN_GENERATOR_BYTES,
            gate_selector_commitments: vec![[0u8; 64]; 21], // Kimchi has ~21 gate types
            sigma_commitments: vec![[0u8; 64]; KIMCHI_SIGMA_COLUMNS],
            srs_g: vec![[0u8; 64]; PROOF_OF_STATE_DOMAIN_SIZE as usize],
            srs_h: [0u8; 64],
        }
    }

    /// Load verifier index from artifacts.
    ///
    /// # Arguments
    /// * `path` - Path to the directory containing verifier artifacts
    ///
    /// # Returns
    /// * Loaded verifier index or error
    pub fn load_from_artifacts(_path: &std::path::Path) -> Result<Self, crate::KimchiWrapperError> {
        // TODO: Implement artifact loading
        // The artifacts would contain:
        // - verifier_index.json (basic parameters)
        // - gate_selectors.bin (polynomial commitments)
        // - sigma.bin (permutation polynomial commitments)
        // - srs.bin (structured reference string)
        Err(crate::KimchiWrapperError::NotImplemented(
            "artifact loading not yet implemented".into(),
        ))
    }
}

/// Result of wrapper circuit verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WrapperVerificationResult {
    /// Whether the proof verified successfully.
    pub valid: bool,

    /// The computed Mina digest (if valid).
    pub mina_digest: Option<[u8; 32]>,

    /// Error message (if invalid).
    pub error: Option<String>,

    /// Verification time in milliseconds.
    pub verification_time_ms: u64,
}

/// Configuration for the wrapper circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WrapperConfig {
    /// Circuit size parameter k (rows = 2^k).
    pub k: u32,

    /// Number of lookup bits.
    pub lookup_bits: usize,

    /// Whether to use mock mode (skip actual Kimchi verification).
    pub mock_mode: bool,

    /// Verifier index for Kimchi circuit.
    pub verifier_index: KimchiVerifierIndex,
}

impl Default for WrapperConfig {
    fn default() -> Self {
        Self {
            k: 20, // 2^20 rows for foreign-field arithmetic
            lookup_bits: 19,
            mock_mode: cfg!(feature = "mock"),
            verifier_index: KimchiVerifierIndex::default(),
        }
    }
}

/// Candidate chain segment from the Mina Proof of State.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CandidateChainSegment {
    /// State hashes for the 16-block segment.
    pub state_hashes: [[u8; 32]; CANDIDATE_CHAIN_LENGTH],

    /// Ledger hashes for the 16-block segment.
    pub ledger_hashes: [[u8; 32]; CANDIDATE_CHAIN_LENGTH],

    /// Full state bodies (for detailed verification).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_bodies: Option<Vec<MinaStateBody>>,
}

impl CandidateChainSegment {
    /// Extract from a full proof.
    pub fn from_proof(proof: &MinaProofOfStateProof) -> Result<Self, crate::KimchiWrapperError> {
        if proof.candidate_chain_states.len() != CANDIDATE_CHAIN_LENGTH {
            return Err(crate::KimchiWrapperError::InvalidInput(format!(
                "expected {} candidate states, got {}",
                CANDIDATE_CHAIN_LENGTH,
                proof.candidate_chain_states.len()
            )));
        }

        let mut state_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
        let mut ledger_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];

        for (i, state) in proof.candidate_chain_states.iter().enumerate() {
            state_hashes[i] = state.state_hash;
            ledger_hashes[i] = state.ledger_hash;
        }

        Ok(Self {
            state_hashes,
            ledger_hashes,
            state_bodies: Some(proof.candidate_chain_states.clone()),
        })
    }

    /// Verify chain continuity (each state links to the previous).
    pub fn verify_chain_continuity(&self) -> Result<bool, crate::KimchiWrapperError> {
        let bodies = self.state_bodies.as_ref().ok_or_else(|| {
            crate::KimchiWrapperError::InvalidInput("state bodies required for continuity check".into())
        })?;

        for i in 1..bodies.len() {
            if bodies[i].previous_state_hash != bodies[i - 1].state_hash {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

/// Bridge tip state information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeTipInfo {
    /// State hash of the current bridge tip.
    pub state_hash: [u8; 32],

    /// Blockchain length at the tip.
    pub blockchain_length: u32,

    /// Global slot at the tip.
    pub global_slot: u64,

    /// Timestamp at the tip.
    pub timestamp: u64,
}

impl From<&MinaStateBody> for BridgeTipInfo {
    fn from(state: &MinaStateBody) -> Self {
        Self {
            state_hash: state.state_hash,
            blockchain_length: state.blockchain_length,
            global_slot: state.global_slot,
            timestamp: state.timestamp,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_of_state_constants() {
        assert_eq!(PROOF_OF_STATE_DOMAIN_SIZE, 65536);
        assert_eq!(PROOF_OF_STATE_DOMAIN_LOG2, 16);
        assert_eq!(PROOF_OF_STATE_NUM_PUBLIC_INPUTS, 33);
        assert_eq!(KIMCHI_WITNESS_COLUMNS, 15);
        assert_eq!(IPA_ROUNDS, 16);
    }

    #[test]
    fn test_verifier_index_default() {
        let index = KimchiVerifierIndex::default();
        assert_eq!(index.domain_size, PROOF_OF_STATE_DOMAIN_SIZE);
        assert_eq!(index.domain_log2, PROOF_OF_STATE_DOMAIN_LOG2);
        assert_eq!(index.num_public_inputs, PROOF_OF_STATE_NUM_PUBLIC_INPUTS);
        assert_eq!(index.num_witness_cols, KIMCHI_WITNESS_COLUMNS);
        assert_eq!(index.version, "mina_proof_of_state_v1");
    }

    #[test]
    fn test_verifier_index_validation() {
        let index = KimchiVerifierIndex::proof_of_state();
        assert!(index.validate_proof_of_state().is_ok());

        // Test with wrong domain size
        let mut bad_index = index.clone();
        bad_index.domain_size = 1234;
        assert!(bad_index.validate_proof_of_state().is_err());
    }

    #[test]
    fn test_full_verifier_index_placeholder() {
        let full = FullVerifierIndex::proof_of_state_placeholder();
        assert_eq!(full.index.domain_size, PROOF_OF_STATE_DOMAIN_SIZE);
        assert_eq!(full.sigma_commitments.len(), KIMCHI_SIGMA_COLUMNS);
        assert_eq!(full.domain_generator, DOMAIN_GENERATOR_BYTES);
    }

    #[test]
    fn test_wrapper_config_default() {
        let config = WrapperConfig::default();
        assert_eq!(config.k, 20);
        assert_eq!(config.lookup_bits, 19);
    }

    fn sample_state_body(idx: u8) -> MinaStateBody {
        MinaStateBody {
            state_hash: [idx; 32],
            ledger_hash: [idx + 100; 32],
            blockchain_length: idx as u32 * 1000,
            global_slot: idx as u64 * 100000,
            timestamp: 1700000000000 + idx as u64 * 180000,
            previous_state_hash: if idx > 0 { [idx - 1; 32] } else { [0; 32] },
            snarked_ledger_hash: [idx + 50; 32],
            genesis_state_hash: [1; 32],
            staking_epoch_ledger_hash: [2; 32],
            next_epoch_ledger_hash: [3; 32],
            min_window_density: 77,
            sub_window_densities: vec![77, 77, 77, 77, 77, 77, 77, 77, 77, 77, 77],
        }
    }

    #[test]
    fn test_candidate_chain_segment() {
        let states: Vec<MinaStateBody> = (0..CANDIDATE_CHAIN_LENGTH as u8)
            .map(sample_state_body)
            .collect();

        let proof = MinaProofOfStateProof {
            candidate_tip_proof: vec![0; 1024],
            candidate_chain_states: states,
            bridge_tip_state: sample_state_body(0),
            consensus_witness: None,
        };

        let segment = CandidateChainSegment::from_proof(&proof).unwrap();
        assert_eq!(segment.state_hashes.len(), CANDIDATE_CHAIN_LENGTH);
        assert_eq!(segment.ledger_hashes.len(), CANDIDATE_CHAIN_LENGTH);

        // Chain should be continuous (each links to previous)
        assert!(segment.verify_chain_continuity().unwrap());
    }

    #[test]
    fn test_bridge_tip_info() {
        let state = sample_state_body(5);
        let tip_info = BridgeTipInfo::from(&state);

        assert_eq!(tip_info.state_hash, state.state_hash);
        assert_eq!(tip_info.blockchain_length, state.blockchain_length);
        assert_eq!(tip_info.global_slot, state.global_slot);
    }
}

