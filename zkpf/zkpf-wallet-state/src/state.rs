//! Wallet state types and commitment computation.
//!
//! This module defines the logical wallet state representation and the
//! cryptographic commitment scheme used to create compact, public state hashes.

use halo2curves_axiom::bn256::Fr;
use halo2curves_axiom::ff::PrimeField;
use serde::{Deserialize, Serialize};
use zkpf_common::{fr_to_bytes, reduce_be_bytes_to_fr};

/// Current version of the wallet state circuit.
/// Increment this when making breaking changes to the state structure or circuit.
pub const WALLET_STATE_VERSION: u32 = 1;

/// Logical wallet state representation.
///
/// This structure contains all the information needed to compute a state commitment
/// and to verify state transitions. The actual note data and nullifiers are kept
/// private; only their Merkle/hash commitments are included.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletState {
    /// Last processed block height.
    pub height: u64,

    /// Orchard Merkle tree root (or simplified accumulator root) after this height.
    /// This anchors the wallet's view of the global note commitment tree.
    #[serde(with = "serde_fr_bytes")]
    pub anchor: Fr,

    /// Commitment to the set of wallet's unspent notes.
    /// Computed as a Merkle root over note identifiers, or hash of sorted list.
    #[serde(with = "serde_fr_bytes")]
    pub notes_root: Fr,

    /// Commitment to the set of nullifiers known spent by this wallet.
    /// This prevents double-spending within the wallet's local view.
    #[serde(with = "serde_fr_bytes")]
    pub nullifiers_root: Fr,

    /// State version / circuit identifier.
    /// Used for forward compatibility and circuit upgrades.
    pub version: u32,
}

/// Compact, public commitment to a wallet state.
///
/// This is the "S" in the state machine model: a single field element
/// that commits to the entire wallet state without revealing any secrets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletStateCommitment(#[serde(with = "serde_fr_bytes")] pub Fr);

impl WalletStateCommitment {
    /// Create a commitment from a field element.
    pub fn from_fr(fr: Fr) -> Self {
        Self(fr)
    }

    /// Get the underlying field element.
    pub fn as_fr(&self) -> &Fr {
        &self.0
    }

    /// Convert to 32-byte representation.
    pub fn to_bytes(&self) -> [u8; 32] {
        fr_to_bytes(&self.0)
    }

    /// Create from 32-byte representation.
    pub fn from_bytes(bytes: &[u8; 32]) -> Self {
        Self(reduce_be_bytes_to_fr(bytes))
    }
}

impl WalletState {
    /// Create a new wallet state.
    pub fn new(
        height: u64,
        anchor: Fr,
        notes_root: Fr,
        nullifiers_root: Fr,
        version: u32,
    ) -> Self {
        Self {
            height,
            anchor,
            notes_root,
            nullifiers_root,
            version,
        }
    }

    /// Create the genesis (empty) wallet state.
    ///
    /// The genesis state has:
    /// - height = 0
    /// - anchor = zero (no tree yet)
    /// - notes_root = zero (no notes)
    /// - nullifiers_root = zero (no spent nullifiers)
    pub fn genesis() -> Self {
        Self {
            height: 0,
            anchor: Fr::zero(),
            notes_root: Fr::zero(),
            nullifiers_root: Fr::zero(),
            version: WALLET_STATE_VERSION,
        }
    }

    /// Compute the state commitment: S = Poseidon(height || anchor || notes_root || nullifiers_root || version)
    pub fn commitment(&self) -> WalletStateCommitment {
        WalletStateCommitment(compute_state_hash(
            self.height,
            &self.anchor,
            &self.notes_root,
            &self.nullifiers_root,
            self.version,
        ))
    }
}

/// Block delta representing changes to apply during a state transition.
///
/// This structure captures all the information needed to transition from
/// one wallet state to the next based on a single block's data.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockDelta {
    /// The block height being processed.
    pub block_height: u64,

    /// New Orchard anchor (Merkle root) after this block.
    #[serde(with = "serde_fr_bytes")]
    pub anchor_new: Fr,

    /// Commitments of new notes discovered for this wallet in this block.
    /// These are note identifiers (e.g., extracted note commitments).
    #[serde(default)]
    pub new_notes: Vec<NoteIdentifier>,

    /// Nullifiers spent by this wallet in this block.
    #[serde(default)]
    pub spent_nullifiers: Vec<NullifierIdentifier>,
}

/// Identifier for a note in the wallet's note set.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NoteIdentifier {
    /// Note commitment (extracted note commitment for Orchard).
    #[serde(with = "serde_fr_bytes")]
    pub commitment: Fr,

    /// Value in base units (zatoshis for Zcash).
    pub value: u64,

    /// Position in the global note commitment tree (for Merkle path).
    pub position: u64,
}

/// Identifier for a nullifier in the wallet's spent set.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NullifierIdentifier {
    /// The nullifier value.
    #[serde(with = "serde_fr_bytes")]
    pub nullifier: Fr,

    /// Reference to the note being spent (commitment).
    #[serde(with = "serde_fr_bytes")]
    pub note_commitment: Fr,
}

/// Compute the wallet state hash using Poseidon.
///
/// S = Poseidon(height, anchor, notes_root, nullifiers_root, version)
///
/// Uses halo2-base's OptimizedPoseidonSpec to ensure consistency with the circuit.
pub fn compute_state_hash(
    height: u64,
    anchor: &Fr,
    notes_root: &Fr,
    nullifiers_root: &Fr,
    version: u32,
) -> Fr {
    let inputs = [
        Fr::from(height),
        *anchor,
        *notes_root,
        *nullifiers_root,
        Fr::from(version as u64),
    ];

    native_poseidon_hash(&inputs)
}

/// Compute a simple Merkle-like commitment to a set of notes.
///
/// For a production implementation, this would be a proper Merkle tree.
/// This simplified version uses iterative Poseidon hashing.
pub fn compute_notes_root(notes: &[NoteIdentifier]) -> Fr {
    if notes.is_empty() {
        return Fr::zero();
    }

    let mut acc = Fr::zero();
    for note in notes {
        acc = native_poseidon_hash(&[acc, note.commitment, Fr::from(note.value)]);
    }
    acc
}

/// Compute a commitment to the set of nullifiers.
pub fn compute_nullifiers_root(nullifiers: &[NullifierIdentifier]) -> Fr {
    if nullifiers.is_empty() {
        return Fr::zero();
    }

    let mut acc = Fr::zero();
    for nf in nullifiers {
        acc = native_poseidon_hash(&[acc, nf.nullifier]);
    }
    acc
}

// ============================================================
// Native Poseidon Hash Implementation
// ============================================================
//
// This implementation uses halo2-base's OptimizedPoseidonSpec directly
// to ensure bit-exact consistency with the in-circuit Poseidon hash.
// The implementation mirrors the one in zkpf-circuit/tests/basic.rs.

use halo2_base::poseidon::hasher::spec::OptimizedPoseidonSpec;
use once_cell::sync::Lazy;
use zkpf_circuit::gadgets::poseidon::{
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};

static POSEIDON_SPEC: Lazy<OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE>> = Lazy::new(|| {
    OptimizedPoseidonSpec::new::<POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, 0>()
});

fn native_poseidon_hash(inputs: &[Fr]) -> Fr {
    let spec = &*POSEIDON_SPEC;
    let mut state = [Fr::zero(); POSEIDON_T];
    state[0] = Fr::from_u128(1u128 << 64);

    for chunk in inputs.chunks(POSEIDON_RATE) {
        poseidon_permutation(&mut state, chunk, spec);
    }

    if inputs.len() % POSEIDON_RATE == 0 {
        poseidon_permutation(&mut state, &[], spec);
    }

    state[1]
}

fn poseidon_permutation(
    state: &mut [Fr; POSEIDON_T],
    inputs: &[Fr],
    spec: &OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE>,
) {
    let r_f = spec.r_f() / 2;
    let constants = spec.constants();
    let matrices = spec.mds_matrices();
    let start = constants.start();

    absorb_with_pre_constants(state, inputs, &start[0]);

    for coeffs in start.iter().skip(1).take(r_f - 1) {
        sbox_full(state, coeffs);
        apply_mds(state, matrices.mds().as_ref());
    }

    if let Some(last) = start.last() {
        sbox_full(state, last);
    }
    apply_mds(state, matrices.pre_sparse_mds().as_ref());

    for (constant, sparse) in constants
        .partial()
        .iter()
        .zip(matrices.sparse_matrices().iter())
    {
        sbox_part(state, constant);
        apply_sparse_mds(state, sparse.row(), sparse.col_hat());
    }

    for coeffs in constants.end().iter() {
        sbox_full(state, coeffs);
        apply_mds(state, matrices.mds().as_ref());
    }

    sbox_full(state, &[Fr::zero(); POSEIDON_T]);
    apply_mds(state, matrices.mds().as_ref());
}

fn absorb_with_pre_constants(
    state: &mut [Fr; POSEIDON_T],
    inputs: &[Fr],
    pre_constants: &[Fr; POSEIDON_T],
) {
    assert!(inputs.len() < POSEIDON_T);

    state[0] += pre_constants[0];
    for (idx, input) in inputs.iter().enumerate() {
        state[idx + 1] += *input + pre_constants[idx + 1];
    }

    let offset = inputs.len() + 1;
    for (i, idx) in (offset..POSEIDON_T).enumerate() {
        let mut addend = pre_constants[idx];
        if i == 0 {
            addend += Fr::one();
        }
        state[idx] += addend;
    }
}

fn sbox_full(state: &mut [Fr; POSEIDON_T], constants: &[Fr; POSEIDON_T]) {
    for (value, constant) in state.iter_mut().zip(constants.iter()) {
        *value = value.pow_vartime([5]) + constant;
    }
}

fn sbox_part(state: &mut [Fr; POSEIDON_T], constant: &Fr) {
    state[0] = state[0].pow_vartime([5]) + constant;
}

fn apply_mds(state: &mut [Fr; POSEIDON_T], matrix: &[[Fr; POSEIDON_T]; POSEIDON_T]) {
    let current = *state;
    let mut next = [Fr::zero(); POSEIDON_T];
    for (i, row) in matrix.iter().enumerate() {
        let mut acc = Fr::zero();
        for (coeff, value) in row.iter().zip(current.iter()) {
            acc += *coeff * *value;
        }
        next[i] = acc;
    }
    *state = next;
}

fn apply_sparse_mds(
    state: &mut [Fr; POSEIDON_T],
    row: &[Fr; POSEIDON_T],
    col_hat: &[Fr; POSEIDON_RATE],
) {
    let current = *state;
    let mut next = [Fr::zero(); POSEIDON_T];

    let mut acc = Fr::zero();
    for (coeff, value) in row.iter().zip(current.iter()) {
        acc += *coeff * *value;
    }
    next[0] = acc;

    for (i, (coeff, value)) in col_hat.iter().zip(current.iter().skip(1)).enumerate() {
        next[i + 1] = current[0] * *coeff + *value;
    }

    *state = next;
}

/// Serde module for Fr as 32-byte hex (little-endian, matching halo2's to_repr).
mod serde_fr_bytes {
    use super::*;
    use halo2curves_axiom::ff::PrimeField;
    use serde::{de, Deserializer, Serializer};
    use std::fmt;

    pub fn serialize<S>(fr: &Fr, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let bytes = fr_to_bytes(fr);
        let hex_str = format!("0x{}", hex::encode(bytes));
        serializer.serialize_str(&hex_str)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Fr, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FrVisitor;

        impl de::Visitor<'_> for FrVisitor {
            type Value = Fr;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a 32-byte hex string (with or without 0x prefix)")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let hex_str = v.strip_prefix("0x").unwrap_or(v);
                if hex_str.len() != 64 {
                    return Err(E::custom(format!(
                        "expected 64 hex chars, got {}",
                        hex_str.len()
                    )));
                }
                let mut bytes = [0u8; 32];
                hex::decode_to_slice(hex_str, &mut bytes).map_err(E::custom)?;
                // Use from_repr to match serialize's to_repr (little-endian)
                Fr::from_repr(bytes)
                    .into_option()
                    .ok_or_else(|| E::custom("invalid field element encoding"))
            }
        }

        deserializer.deserialize_str(FrVisitor)
    }
}

// Re-export hex for the serde module
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes
            .as_ref()
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect()
    }

    pub fn decode_to_slice(hex: &str, out: &mut [u8]) -> Result<(), String> {
        if hex.len() != out.len() * 2 {
            return Err(format!(
                "hex length {} doesn't match output length {}",
                hex.len(),
                out.len() * 2
            ));
        }
        for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
            let hi = (chunk[0] as char)
                .to_digit(16)
                .ok_or_else(|| "invalid hex char".to_string())?;
            let lo = (chunk[1] as char)
                .to_digit(16)
                .ok_or_else(|| "invalid hex char".to_string())?;
            out[i] = ((hi << 4) | lo) as u8;
        }
        Ok(())
    }
}

use halo2curves_axiom::ff::Field;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genesis_state_commitment_is_deterministic() {
        let s1 = WalletState::genesis();
        let s2 = WalletState::genesis();
        assert_eq!(s1.commitment(), s2.commitment());
    }

    #[test]
    fn different_heights_produce_different_commitments() {
        let s1 = WalletState::genesis();
        let s2 = WalletState::new(1, Fr::zero(), Fr::zero(), Fr::zero(), WALLET_STATE_VERSION);
        assert_ne!(s1.commitment(), s2.commitment());
    }

    #[test]
    fn state_serialization_round_trip() {
        let state = WalletState::new(
            100,
            Fr::from(12345u64),
            Fr::from(67890u64),
            Fr::from(11111u64),
            WALLET_STATE_VERSION,
        );

        let json = serde_json::to_string(&state).unwrap();
        let recovered: WalletState = serde_json::from_str(&json).unwrap();

        assert_eq!(state.commitment(), recovered.commitment());
    }
}

