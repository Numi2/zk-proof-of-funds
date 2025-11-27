//! State transition logic for the wallet state machine.
//!
//! This module implements the transition relation:
//! - Given a previous state and a block delta, compute the next state
//! - Verify that a transition is valid according to the state machine rules

use anyhow::{ensure, Result};
use halo2curves_axiom::bn256::Fr;

use crate::state::{
    compute_notes_root, compute_nullifiers_root, BlockDelta, NoteIdentifier, NullifierIdentifier,
    WalletState, WalletStateCommitment, WALLET_STATE_VERSION,
};

/// Witness data for a state transition proof.
///
/// This contains all the private inputs needed to prove a valid transition.
#[derive(Clone, Debug)]
pub struct TransitionWitness {
    /// Full previous state (private, only commitment is public)
    pub state_prev: WalletState,

    /// Current unspent notes in the wallet (private)
    pub current_notes: Vec<NoteIdentifier>,

    /// Current spent nullifiers known to wallet (private)
    pub current_nullifiers: Vec<NullifierIdentifier>,
}

/// Result of applying a state transition.
#[derive(Clone, Debug)]
pub struct TransitionResult {
    /// The new wallet state after transition
    pub state_next: WalletState,

    /// Commitment to the new state (public output)
    pub commitment_next: WalletStateCommitment,

    /// Updated notes set after transition
    pub notes_next: Vec<NoteIdentifier>,

    /// Updated nullifiers set after transition
    pub nullifiers_next: Vec<NullifierIdentifier>,
}

/// Apply a state transition given the previous state witness and block delta.
///
/// This implements the transition rules:
/// - height_next = block_height
/// - anchor_next = anchor_new
/// - notes_next = notes_prev + new_notes - spent_notes
/// - nullifiers_next = nullifiers_prev ∪ spent_nullifiers
/// - S_next = Hash(WalletState_next)
pub fn apply_transition(
    witness: &TransitionWitness,
    delta: &BlockDelta,
) -> Result<TransitionResult> {
    // Validate transition preconditions
    ensure!(
        delta.block_height > witness.state_prev.height,
        "block_height {} must be greater than previous height {}",
        delta.block_height,
        witness.state_prev.height
    );

    ensure!(
        witness.state_prev.version == WALLET_STATE_VERSION,
        "state version mismatch: expected {}, got {}",
        WALLET_STATE_VERSION,
        witness.state_prev.version
    );

    // Compute notes_next: add new notes, remove spent notes
    let spent_commitments: std::collections::HashSet<_> = delta
        .spent_nullifiers
        .iter()
        .map(|nf| nf.note_commitment)
        .collect();

    let mut notes_next: Vec<NoteIdentifier> = witness
        .current_notes
        .iter()
        .filter(|note| !spent_commitments.contains(&note.commitment))
        .cloned()
        .collect();

    // Add new notes from this block
    notes_next.extend(delta.new_notes.iter().cloned());

    // Compute nullifiers_next: union of previous nullifiers and new spent nullifiers
    let mut nullifiers_next = witness.current_nullifiers.clone();
    nullifiers_next.extend(delta.spent_nullifiers.iter().cloned());

    // Compute new roots
    let notes_root_next = compute_notes_root(&notes_next);
    let nullifiers_root_next = compute_nullifiers_root(&nullifiers_next);

    // Create new state
    let state_next = WalletState::new(
        delta.block_height,
        delta.anchor_new,
        notes_root_next,
        nullifiers_root_next,
        WALLET_STATE_VERSION,
    );

    let commitment_next = state_next.commitment();

    Ok(TransitionResult {
        state_next,
        commitment_next,
        notes_next,
        nullifiers_next,
    })
}

/// Verify that a transition witness is consistent with claimed commitments.
///
/// This is the "prover side" check that ensures the witness matches what will
/// be proven in the ZK circuit.
pub fn verify_transition_witness(
    commitment_prev: &WalletStateCommitment,
    witness: &TransitionWitness,
    delta: &BlockDelta,
    expected_commitment_next: &WalletStateCommitment,
) -> Result<()> {
    // Verify that the witness's previous state matches the claimed commitment
    let computed_prev = witness.state_prev.commitment();
    ensure!(
        computed_prev == *commitment_prev,
        "previous state commitment mismatch: computed {:?}, expected {:?}",
        computed_prev,
        commitment_prev
    );

    // Verify that notes_root in state_prev matches the witness notes
    let notes_root = compute_notes_root(&witness.current_notes);
    ensure!(
        notes_root == witness.state_prev.notes_root,
        "notes_root mismatch: computed from witness doesn't match state_prev.notes_root"
    );

    // Verify that nullifiers_root in state_prev matches the witness nullifiers
    let nullifiers_root = compute_nullifiers_root(&witness.current_nullifiers);
    ensure!(
        nullifiers_root == witness.state_prev.nullifiers_root,
        "nullifiers_root mismatch: computed from witness doesn't match state_prev.nullifiers_root"
    );

    // Apply the transition and verify the result
    let result = apply_transition(witness, delta)?;
    ensure!(
        result.commitment_next == *expected_commitment_next,
        "next state commitment mismatch: computed {:?}, expected {:?}",
        result.commitment_next,
        expected_commitment_next
    );

    Ok(())
}

/// Input structure for the state transition circuit and API.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StateTransitionInput {
    /// Previous state commitment (public)
    pub s_prev: WalletStateCommitment,

    /// Block height being processed (public)
    pub block_height: u64,

    /// New anchor after this block (public)
    #[serde(with = "serde_fr_bytes")]
    pub anchor_new: Fr,

    /// Full previous state (private witness)
    pub state_prev_witness: WalletState,

    /// Current notes in wallet (private witness)
    pub current_notes: Vec<NoteIdentifier>,

    /// Current nullifiers in wallet (private witness)
    pub current_nullifiers: Vec<NullifierIdentifier>,

    /// New notes from this block (private)
    pub new_notes: Vec<NoteIdentifier>,

    /// Nullifiers spent in this block (private)
    pub spent_nullifiers: Vec<NullifierIdentifier>,
}

/// Output structure from the state transition proof.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StateTransitionOutput {
    /// Previous state commitment (public input)
    pub s_prev: WalletStateCommitment,

    /// New state commitment (public output)
    pub s_next: WalletStateCommitment,

    /// Block height processed (public)
    pub block_height: u64,

    /// New anchor (public)
    #[serde(with = "serde_fr_bytes")]
    pub anchor_new: Fr,
}

impl StateTransitionInput {
    /// Compute the expected output for this transition input.
    pub fn expected_output(&self) -> Result<StateTransitionOutput> {
        let witness = TransitionWitness {
            state_prev: self.state_prev_witness.clone(),
            current_notes: self.current_notes.clone(),
            current_nullifiers: self.current_nullifiers.clone(),
        };

        let delta = BlockDelta {
            block_height: self.block_height,
            anchor_new: self.anchor_new,
            new_notes: self.new_notes.clone(),
            spent_nullifiers: self.spent_nullifiers.clone(),
        };

        let result = apply_transition(&witness, &delta)?;

        Ok(StateTransitionOutput {
            s_prev: self.s_prev,
            s_next: result.commitment_next,
            block_height: self.block_height,
            anchor_new: self.anchor_new,
        })
    }

    /// Validate the input's internal consistency.
    pub fn validate(&self) -> Result<()> {
        // Verify s_prev matches state_prev_witness
        let computed_prev = self.state_prev_witness.commitment();
        ensure!(
            computed_prev == self.s_prev,
            "s_prev does not match state_prev_witness commitment"
        );

        // Verify block_height is valid
        ensure!(
            self.block_height > self.state_prev_witness.height,
            "block_height must be greater than previous state height"
        );

        Ok(())
    }
}

/// Serde module for Fr as 32-byte hex.
mod serde_fr_bytes {
    use halo2curves_axiom::bn256::Fr;
    use serde::{de, Deserializer, Serializer};
    use std::fmt;
    use zkpf_common::{fr_to_bytes, reduce_be_bytes_to_fr};

    pub fn serialize<S>(fr: &Fr, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let bytes = fr_to_bytes(fr);
        let hex = format!("0x{}", bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>());
        serializer.serialize_str(&hex)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Fr, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FrVisitor;

        impl<'de> de::Visitor<'de> for FrVisitor {
            type Value = Fr;

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a 32-byte hex string (with or without 0x prefix)")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let hex = v.strip_prefix("0x").unwrap_or(v);
                if hex.len() != 64 {
                    return Err(E::custom(format!("expected 64 hex chars, got {}", hex.len())));
                }
                let mut bytes = [0u8; 32];
                for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
                    let hi = (chunk[0] as char).to_digit(16).ok_or_else(|| E::custom("invalid hex"))?;
                    let lo = (chunk[1] as char).to_digit(16).ok_or_else(|| E::custom("invalid hex"))?;
                    bytes[i] = ((hi << 4) | lo) as u8;
                }
                Ok(reduce_be_bytes_to_fr(&bytes))
            }
        }

        deserializer.deserialize_str(FrVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_note(id: u64) -> NoteIdentifier {
        NoteIdentifier {
            commitment: Fr::from(id * 1000),
            value: id * 100,
            position: id,
        }
    }

    fn sample_nullifier(id: u64, note_commitment: Fr) -> NullifierIdentifier {
        NullifierIdentifier {
            nullifier: Fr::from(id * 10000),
            note_commitment,
        }
    }

    #[test]
    fn apply_transition_adds_new_notes() {
        let state_prev = WalletState::genesis();
        let witness = TransitionWitness {
            state_prev: state_prev.clone(),
            current_notes: vec![],
            current_nullifiers: vec![],
        };

        let delta = BlockDelta {
            block_height: 1,
            anchor_new: Fr::from(99999u64),
            new_notes: vec![sample_note(1), sample_note(2)],
            spent_nullifiers: vec![],
        };

        let result = apply_transition(&witness, &delta).unwrap();
        assert_eq!(result.notes_next.len(), 2);
        assert_eq!(result.state_next.height, 1);
    }

    #[test]
    fn apply_transition_removes_spent_notes() {
        let note1 = sample_note(1);
        let note2 = sample_note(2);

        let state_prev = WalletState::new(
            10,
            Fr::from(123u64),
            compute_notes_root(&[note1.clone(), note2.clone()]),
            Fr::zero(),
            WALLET_STATE_VERSION,
        );

        let witness = TransitionWitness {
            state_prev,
            current_notes: vec![note1.clone(), note2.clone()],
            current_nullifiers: vec![],
        };

        let spent_nf = sample_nullifier(1, note1.commitment);

        let delta = BlockDelta {
            block_height: 11,
            anchor_new: Fr::from(456u64),
            new_notes: vec![],
            spent_nullifiers: vec![spent_nf],
        };

        let result = apply_transition(&witness, &delta).unwrap();
        assert_eq!(result.notes_next.len(), 1);
        assert_eq!(result.notes_next[0].commitment, note2.commitment);
        assert_eq!(result.nullifiers_next.len(), 1);
    }

    #[test]
    fn transition_input_validation() {
        let state = WalletState::genesis();
        let input = StateTransitionInput {
            s_prev: state.commitment(),
            block_height: 1,
            anchor_new: Fr::from(1u64),
            state_prev_witness: state,
            current_notes: vec![],
            current_nullifiers: vec![],
            new_notes: vec![],
            spent_nullifiers: vec![],
        };

        assert!(input.validate().is_ok());
        assert!(input.expected_output().is_ok());
    }
}

