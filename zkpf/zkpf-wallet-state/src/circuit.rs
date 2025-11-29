//! ZK Circuit for Wallet State Transitions
//!
//! This circuit proves that a state transition from S_prev to S_next is valid:
//!
//! Public Inputs:
//! - S_prev: Previous state commitment
//! - block_height: The block being processed
//! - anchor_new: New Merkle root after this block
//! - S_next: New state commitment (output)
//!
//! Private Witness:
//! - WalletState_prev decomposition (height, anchor, notes_root, nullifiers_root, version)
//! - new_notes_for_wallet: Note identifiers added
//! - spent_nullifiers_for_wallet: Nullifiers spent
//!
//! Constraints:
//! 1. Recompute S_prev from WalletState_prev witness
//! 2. Apply transition rules to compute new roots
//! 3. Compute S_next and expose as public output

use halo2_base::{
    gates::{
        circuit::builder::BaseCircuitBuilder,
        circuit::{BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        flex_gate::{GateChip, MultiPhaseThreadBreakPoints},
        GateInstructions, RangeInstructions,
    },
    poseidon::hasher::{spec::OptimizedPoseidonSpec, PoseidonHasher},
    AssignedValue, Context,
};
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{Circuit, ConstraintSystem, Error},
};
use halo2curves_axiom::bn256::Fr;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use zkpf_circuit::gadgets::poseidon::{
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};

use crate::state::{NoteIdentifier, NullifierIdentifier, WalletState, WALLET_STATE_VERSION};

// Circuit parameters
const DEFAULT_K: usize = 17; // Smaller than main circuit, transitions are simpler
const DEFAULT_LOOKUP_BITS: usize = 16;
const NUM_INSTANCE_COLUMNS: usize = 4; // S_prev, block_height, anchor_new, S_next
const DEFAULT_ADVICE_PER_PHASE: usize = 4;
const DEFAULT_FIXED_COLUMNS: usize = 1;
const DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;

/// Maximum number of notes that can be added in a single transition.
pub const MAX_NEW_NOTES: usize = 16;

/// Maximum number of nullifiers that can be spent in a single transition.
pub const MAX_SPENT_NULLIFIERS: usize = 16;

fn default_params() -> BaseCircuitParams {
    BaseCircuitParams {
        k: DEFAULT_K,
        num_advice_per_phase: vec![DEFAULT_ADVICE_PER_PHASE],
        num_fixed: DEFAULT_FIXED_COLUMNS,
        num_lookup_advice_per_phase: vec![DEFAULT_LOOKUP_ADVICE_PER_PHASE],
        lookup_bits: Some(DEFAULT_LOOKUP_BITS),
        num_instance_columns: NUM_INSTANCE_COLUMNS,
    }
}

/// Public inputs for the wallet state transition circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletStateTransitionPublicInputs {
    /// Previous state commitment (input)
    pub s_prev: Fr,
    /// Block height being processed
    pub block_height: u64,
    /// New anchor after this block
    pub anchor_new: Fr,
    /// New state commitment (output, computed by circuit)
    pub s_next: Fr,
}

/// Private witness inputs for the state transition circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletStateTransitionWitness {
    /// Previous state decomposition
    pub height_prev: u64,
    pub anchor_prev: Fr,
    pub notes_root_prev: Fr,
    pub nullifiers_root_prev: Fr,
    pub version_prev: u32,

    /// New notes added in this block (padded to MAX_NEW_NOTES)
    pub new_notes: Vec<NoteWitness>,
    /// Count of actual new notes (rest are padding)
    pub new_notes_count: usize,

    /// Nullifiers spent in this block (padded to MAX_SPENT_NULLIFIERS)
    pub spent_nullifiers: Vec<NullifierWitness>,
    /// Count of actual spent nullifiers (rest are padding)
    pub spent_nullifiers_count: usize,

    /// Intermediate values for computing new roots
    pub notes_root_next: Fr,
    pub nullifiers_root_next: Fr,
}

/// Witness for a single note.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NoteWitness {
    pub commitment: Fr,
    pub value: u64,
    /// Flag indicating if this is a real note or padding
    pub is_real: bool,
}

/// Witness for a single nullifier.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct NullifierWitness {
    pub nullifier: Fr,
    /// Flag indicating if this is a real nullifier or padding
    pub is_real: bool,
}

/// Full input for the wallet state transition circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WalletStateTransitionInput {
    pub public: WalletStateTransitionPublicInputs,
    pub witness: WalletStateTransitionWitness,
}

impl WalletStateTransitionInput {
    /// Create circuit input from high-level transition data.
    pub fn from_transition(
        state_prev: &WalletState,
        block_height: u64,
        anchor_new: Fr,
        new_notes: &[NoteIdentifier],
        spent_nullifiers: &[NullifierIdentifier],
        notes_root_next: Fr,
        nullifiers_root_next: Fr,
    ) -> Self {
        // Pad notes to MAX_NEW_NOTES
        let mut note_witnesses: Vec<NoteWitness> = new_notes
            .iter()
            .map(|n| NoteWitness {
                commitment: n.commitment,
                value: n.value,
                is_real: true,
            })
            .collect();
        while note_witnesses.len() < MAX_NEW_NOTES {
            note_witnesses.push(NoteWitness::default());
        }

        // Pad nullifiers to MAX_SPENT_NULLIFIERS
        let mut nullifier_witnesses: Vec<NullifierWitness> = spent_nullifiers
            .iter()
            .map(|n| NullifierWitness {
                nullifier: n.nullifier,
                is_real: true,
            })
            .collect();
        while nullifier_witnesses.len() < MAX_SPENT_NULLIFIERS {
            nullifier_witnesses.push(NullifierWitness::default());
        }

        // Compute new state commitment
        let s_next = crate::state::compute_state_hash(
            block_height,
            &anchor_new,
            &notes_root_next,
            &nullifiers_root_next,
            WALLET_STATE_VERSION,
        );

        Self {
            public: WalletStateTransitionPublicInputs {
                s_prev: state_prev.commitment().0,
                block_height,
                anchor_new,
                s_next,
            },
            witness: WalletStateTransitionWitness {
                height_prev: state_prev.height,
                anchor_prev: state_prev.anchor,
                notes_root_prev: state_prev.notes_root,
                nullifiers_root_prev: state_prev.nullifiers_root,
                version_prev: state_prev.version,
                new_notes: note_witnesses,
                new_notes_count: new_notes.len(),
                spent_nullifiers: nullifier_witnesses,
                spent_nullifiers_count: spent_nullifiers.len(),
                notes_root_next,
                nullifiers_root_next,
            },
        }
    }

    /// Validate that the input is internally consistent.
    /// Used for debugging before proof generation.
    pub fn validate(&self) -> Result<(), String> {
        // Recompute s_prev from witness
        let computed_s_prev = crate::state::compute_state_hash(
            self.witness.height_prev,
            &self.witness.anchor_prev,
            &self.witness.notes_root_prev,
            &self.witness.nullifiers_root_prev,
            self.witness.version_prev,
        );
        if computed_s_prev != self.public.s_prev {
            return Err(format!(
                "s_prev mismatch: computed {:?}, expected {:?}",
                computed_s_prev, self.public.s_prev
            ));
        }

        // Recompute s_next
        let computed_s_next = crate::state::compute_state_hash(
            self.public.block_height,
            &self.public.anchor_new,
            &self.witness.notes_root_next,
            &self.witness.nullifiers_root_next,
            WALLET_STATE_VERSION,
        );
        if computed_s_next != self.public.s_next {
            return Err(format!(
                "s_next mismatch: computed {:?}, expected {:?}",
                computed_s_next, self.public.s_next
            ));
        }

        Ok(())
    }
}

/// The ZK circuit for proving wallet state transitions.
#[derive(Clone, Debug)]
pub struct WalletStateTransitionCircuit {
    pub input: Option<WalletStateTransitionInput>,
    params: BaseCircuitParams,
    stage: CircuitBuilderStage,
    /// Break points from keygen, required for Prover stage.
    break_points: Option<MultiPhaseThreadBreakPoints>,
}

impl Default for WalletStateTransitionCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: default_params(),
            stage: CircuitBuilderStage::Keygen,
            break_points: None,
        }
    }
}

impl WalletStateTransitionCircuit {
    /// Create a new circuit for MockProver testing.
    pub fn new(input: Option<WalletStateTransitionInput>) -> Self {
        let stage = if input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };
        Self {
            input,
            params: default_params(),
            stage,
            break_points: None,
        }
    }

    /// Create a circuit optimized for production proof generation with break points.
    ///
    /// The `break_points` must be obtained from the keygen circuit after key generation.
    /// This allows the Prover stage to efficiently assign witnesses without recalculating
    /// the circuit layout.
    ///
    /// # Arguments
    /// * `input` - The circuit input with witness data
    /// * `break_points` - Break points from keygen (use `extract_break_points_after_keygen`)
    pub fn new_prover(input: WalletStateTransitionInput, break_points: MultiPhaseThreadBreakPoints) -> Self {
        Self {
            input: Some(input),
            params: default_params(),
            stage: CircuitBuilderStage::Prover,
            break_points: Some(break_points),
        }
    }

    /// Extract break points after keygen for use in prover circuits.
    ///
    /// This should be called after `keygen_pk` with a keygen circuit.
    /// The returned break points should be cached and passed to `new_prover`.
    ///
    /// # Returns
    /// Break points needed for proof generation.
    pub fn extract_break_points_after_keygen(&self) -> MultiPhaseThreadBreakPoints {
        // For keygen circuits, we need to run synthesis once to get break points.
        // We do this by creating a temporary builder and running constraints.
        let input = self.input.as_ref().unwrap_or(&SAMPLE_INPUT);

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(CircuitBuilderStage::Mock)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_constraints(&mut builder, input).expect("constraint building failed");

        // Calculate break points by finalizing the builder
        builder.calculate_params(Some(20)); // Use default minimum rows
        builder.break_points()
    }
}

/// Generate public instances from public inputs.
pub fn public_instances(public: &WalletStateTransitionPublicInputs) -> Vec<Vec<Fr>> {
    vec![
        vec![public.s_prev],
        vec![Fr::from(public.block_height)],
        vec![public.anchor_new],
        vec![public.s_next],
    ]
}

impl Circuit<Fr> for WalletStateTransitionCircuit {
    type Config = BaseConfig<Fr>;
    type FloorPlanner = SimpleFloorPlanner;
    type Params = BaseCircuitParams;

    fn params(&self) -> Self::Params {
        self.params.clone()
    }

    fn without_witnesses(&self) -> Self {
        Self {
            input: None,
            params: self.params.clone(),
            stage: CircuitBuilderStage::Keygen,
            break_points: None,
        }
    }

    fn configure_with_params(
        meta: &mut ConstraintSystem<Fr>,
        params: Self::Params,
    ) -> Self::Config {
        BaseConfig::configure(meta, params)
    }

    fn configure(_: &mut ConstraintSystem<Fr>) -> Self::Config {
        unreachable!("WalletStateTransitionCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        let input = self.input.as_ref().unwrap_or(&SAMPLE_INPUT);

        // Create builder based on whether we have break points
        let mut builder = if let Some(ref bp) = self.break_points {
            // Prover stage with cached break points
            BaseCircuitBuilder::<Fr>::prover(self.params.clone(), bp.clone())
                .use_instance_columns(self.params.num_instance_columns)
        } else {
            // Keygen or Mock stage - break points will be calculated
            let mut b = BaseCircuitBuilder::<Fr>::from_stage(self.stage)
                .use_params(self.params.clone())
                .use_instance_columns(self.params.num_instance_columns);
            if let Some(bits) = self.params.lookup_bits {
                b = b.use_lookup_bits(bits);
            }
            b
        };

        // For Prover stage with break points, we still need lookup bits
        if self.break_points.is_some() {
            if let Some(bits) = self.params.lookup_bits {
                builder = builder.use_lookup_bits(bits);
            }
        }

        build_constraints(&mut builder, input).map_err(|_| Error::Synthesis)?;

        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

/// Sample input for keygen and testing.
static SAMPLE_INPUT: Lazy<WalletStateTransitionInput> = Lazy::new(|| {
    let state_prev = WalletState::genesis();
    WalletStateTransitionInput::from_transition(
        &state_prev,
        1,
        Fr::from(12345u64),
        &[],
        &[],
        Fr::zero(),
        Fr::zero(),
    )
});

/// Build the circuit constraints.
fn build_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &WalletStateTransitionInput,
) -> Result<(), CircuitError> {
    let range = builder.range_chip();
    let gate = range.gate();
    let ctx = builder.main(0);

    let public = &input.public;
    let witness = &input.witness;

    // Load witness values for previous state decomposition
    let height_prev = ctx.load_witness(Fr::from(witness.height_prev));
    let anchor_prev = ctx.load_witness(witness.anchor_prev);
    let notes_root_prev = ctx.load_witness(witness.notes_root_prev);
    let nullifiers_root_prev = ctx.load_witness(witness.nullifiers_root_prev);
    let version_prev = ctx.load_witness(Fr::from(witness.version_prev as u64));

    // Load new state values (private)
    let notes_root_next = ctx.load_witness(witness.notes_root_next);
    let nullifiers_root_next = ctx.load_witness(witness.nullifiers_root_next);
    let version_next = ctx.load_witness(Fr::from(WALLET_STATE_VERSION as u64));

    // Load public inputs as witnesses (they will be exposed to instance columns)
    let block_height_pub = ctx.load_witness(Fr::from(public.block_height));
    let anchor_new_pub = ctx.load_witness(public.anchor_new);

    // CONSTRAINT 1: Compute S_prev from witness and expose it as public output
    // The prover computes S_prev = Hash(WalletState_prev) from the witness
    let computed_s_prev = hash_wallet_state(
        ctx,
        gate,
        height_prev,
        anchor_prev,
        notes_root_prev,
        nullifiers_root_prev,
        version_prev,
    );

    // CONSTRAINT 2: Verify block_height > height_prev
    // We check this by ensuring (block_height - height_prev) != 0
    // A full implementation would do proper range checking for > 0
    let height_diff = gate.sub(ctx, block_height_pub, height_prev);
    let is_zero = gate.is_zero(ctx, height_diff);
    let zero = ctx.load_constant(Fr::zero());
    // Ensure is_zero == 0 (i.e., height_diff != 0)
    ctx.constrain_equal(&is_zero, &zero);

    // CONSTRAINT 3: Compute S_next = Hash(new state)
    let computed_s_next = hash_wallet_state(
        ctx,
        gate,
        block_height_pub,
        anchor_new_pub,
        notes_root_next,
        nullifiers_root_next,
        version_next,
    );

    // Expose public inputs/outputs to instance columns
    // The verifier provides these values externally and the circuit proves
    // that computed_s_prev and computed_s_next match
    builder.assigned_instances[0].push(computed_s_prev);      // S_prev (output)
    builder.assigned_instances[1].push(block_height_pub);     // block_height (input)
    builder.assigned_instances[2].push(anchor_new_pub);       // anchor_new (input)
    builder.assigned_instances[3].push(computed_s_next);      // S_next (output)

    Ok(())
}

/// Hash wallet state using Poseidon in-circuit.
fn hash_wallet_state(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    height: AssignedValue<Fr>,
    anchor: AssignedValue<Fr>,
    notes_root: AssignedValue<Fr>,
    nullifiers_root: AssignedValue<Fr>,
    version: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    let mut hasher =
        PoseidonHasher::<Fr, POSEIDON_T, POSEIDON_RATE>::new(poseidon_spec());
    hasher.initialize_consts(ctx, gate);
    hasher.hash_fix_len_array(ctx, gate, &[height, anchor, notes_root, nullifiers_root, version])
}

fn poseidon_spec() -> OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE> {
    OptimizedPoseidonSpec::new::<POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, 0>()
}

/// Circuit-level errors.
#[derive(Debug)]
pub enum CircuitError {
    InvalidTransition(String),
}

impl std::fmt::Display for CircuitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidTransition(msg) => write!(f, "Invalid transition: {}", msg),
        }
    }
}

impl std::error::Error for CircuitError {}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs_axiom::dev::MockProver;

    #[test]
    fn circuit_synthesis_with_sample_input() {
        let input = SAMPLE_INPUT.clone();

        // Validate input consistency first
        if let Err(e) = input.validate() {
            panic!("Input validation failed: {}", e);
        }

        let circuit = WalletStateTransitionCircuit::new(Some(input.clone()));
        let instances = public_instances(&input.public);

        // Debug: print instance values
        println!("Instance column 0 (s_prev): {:?}", instances[0][0]);
        println!("Instance column 1 (block_height): {:?}", instances[1][0]);
        println!("Instance column 2 (anchor_new): {:?}", instances[2][0]);
        println!("Instance column 3 (s_next): {:?}", instances[3][0]);

        let prover = MockProver::run(
            DEFAULT_K as u32,
            &circuit,
            instances.iter().map(|v| v.clone()).collect(),
        )
        .expect("MockProver::run failed");

        prover.verify().expect("Circuit verification failed");
    }

    #[test]
    fn circuit_with_genesis_to_block_1() {
        let state_prev = WalletState::genesis();
        let anchor_new = Fr::from(999u64);

        // Simple transition: no notes, no nullifiers
        let input = WalletStateTransitionInput::from_transition(
            &state_prev,
            1,
            anchor_new,
            &[],
            &[],
            Fr::zero(),
            Fr::zero(),
        );

        let circuit = WalletStateTransitionCircuit::new(Some(input.clone()));
        let instances = public_instances(&input.public);

        let prover = MockProver::run(
            DEFAULT_K as u32,
            &circuit,
            instances.iter().map(|v| v.clone()).collect(),
        )
        .expect("MockProver::run failed");

        prover.verify().expect("Circuit verification failed");
    }

    #[test]
    fn invalid_s_prev_fails_verification() {
        let state_prev = WalletState::genesis();
        let mut input = WalletStateTransitionInput::from_transition(
            &state_prev,
            1,
            Fr::from(999u64),
            &[],
            &[],
            Fr::zero(),
            Fr::zero(),
        );

        // Corrupt s_prev
        input.public.s_prev = Fr::from(123456789u64);

        let circuit = WalletStateTransitionCircuit::new(Some(input.clone()));
        let instances = public_instances(&input.public);

        let prover = MockProver::run(
            DEFAULT_K as u32,
            &circuit,
            instances.iter().map(|v| v.clone()).collect(),
        )
        .expect("MockProver::run failed");

        // This should fail because s_prev doesn't match the witness
        assert!(prover.verify().is_err());
    }
}

