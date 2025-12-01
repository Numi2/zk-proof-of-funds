// zkpf/zkpf-circuit/src/lib.rs
// Numan Thabit 2025

pub mod gadgets;

use halo2_base::{
    gates::{
        circuit::builder::BaseCircuitBuilder,
        circuit::{BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        range::RangeChip,
        GateChip, GateInstructions, RangeInstructions,
    },
    AssignedValue, Context,
    QuantumCell::Constant,
};
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{Circuit, ConstraintSystem, Error},
};
use halo2curves_axiom::bn256::Fr;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::gadgets::attestation::{AttestationWitness, Secp256k1Pubkey};

/// Errors that can occur during circuit synthesis.
/// 
/// Note: ECDSA verification has been moved out of the circuit to reduce proving key size.
/// Signature verification is now performed by the backend before proof generation.
#[derive(Debug)]
pub enum CircuitError {
    /// Generic synthesis error.
    Synthesis(String),
}

impl std::fmt::Display for CircuitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Synthesis(msg) => write!(f, "synthesis error: {}", msg),
        }
    }
}

impl std::error::Error for CircuitError {}

// Circuit size reduced from k=19 to k=14 after removing in-circuit ECDSA verification.
// This reduces pk.bin from ~688MB to ~20MB while keeping all core proof-of-funds logic.
// ECDSA signature verification is now performed by the backend before proof generation.
const DEFAULT_K: usize = 14;
const DEFAULT_LOOKUP_BITS: usize = 13;
const NUM_INSTANCE_COLUMNS: usize = 7;
const DEFAULT_ADVICE_PER_PHASE: usize = 4;
const DEFAULT_FIXED_COLUMNS: usize = 1;
const DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;

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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicInputs {
    pub threshold_raw: u64,
    pub required_currency_code: u32,
    pub current_epoch: u64,
    pub verifier_scope_id: u64,
    pub policy_id: u64,
    pub nullifier: Fr,
    pub custodian_pubkey_hash: Fr,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkpfCircuitInput {
    pub attestation: AttestationWitness,
    pub public: PublicInputs,
}

#[derive(Clone, Debug)]
pub struct ZkpfCircuit {
    pub input: Option<ZkpfCircuitInput>,
    params: BaseCircuitParams,
    /// Circuit builder stage. Determines optimization level during synthesis:
    /// - `Keygen`: Used during proving key generation (no witness values)
    /// - `Prover`: Optimized for real proof generation (witness-gen only, skips constraints)
    /// - `Mock`: For MockProver tests (stores constraints for verification)
    stage: CircuitBuilderStage,
}

impl Default for ZkpfCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: default_params(),
            stage: CircuitBuilderStage::Keygen,
        }
    }
}

impl ZkpfCircuit {
    /// Creates a new circuit for MockProver testing.
    /// Use `new_prover` for production proof generation.
    pub fn new(input: Option<ZkpfCircuitInput>) -> Self {
        let stage = if input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };
        Self {
            input,
            params: default_params(),
            stage,
        }
    }

    /// Creates a circuit for production proof generation.
    /// 
    /// # Implementation Note
    /// 
    /// We use `CircuitBuilderStage::Mock` here despite the name - in halo2-axiom this is
    /// the standard production stage that computes column break points during synthesis.
    /// The alternative `Prover` stage is a performance optimization that requires break
    /// points to be pre-computed during keygen and passed in separately. Since we serialize
    /// only params/pk/vk (without break points), we use the self-contained Mock stage which
    /// computes them automatically.
    /// 
    /// Performance impact is minimal for our k=14 circuit (~2^14 rows). The Mock stage adds
    /// constraint verification overhead, but this is negligible compared to the polynomial
    /// commitment operations that dominate proving time.
    pub fn new_prover(input: ZkpfCircuitInput) -> Self {
        Self {
            input: Some(input),
            params: default_params(),
            stage: CircuitBuilderStage::Mock,
        }
    }
}

pub fn public_instances(public: &PublicInputs) -> Vec<Vec<Fr>> {
    vec![
        vec![Fr::from(public.threshold_raw)],
        vec![Fr::from(public.required_currency_code as u64)],
        vec![Fr::from(public.current_epoch)],
        vec![Fr::from(public.verifier_scope_id)],
        vec![Fr::from(public.policy_id)],
        vec![public.nullifier],
        vec![public.custodian_pubkey_hash],
    ]
}

impl Circuit<Fr> for ZkpfCircuit {
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
        }
    }

    fn configure_with_params(
        meta: &mut ConstraintSystem<Fr>,
        params: Self::Params,
    ) -> Self::Config {
        BaseConfig::configure(meta, params)
    }

    fn configure(_: &mut ConstraintSystem<Fr>) -> Self::Config {
        unreachable!("ZkpfCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        // Use the pre-configured stage:
        // - Keygen: Key generation phase, uses sample input with `unknown(true)`
        // - Mock: MockProver testing, stores constraints for verification  
        // - Prover: Production proving, `witness_gen_only(true)` for performance
        let input = self.input.as_ref().unwrap_or(&SAMPLE_INPUT);

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(self.stage)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        // Build constraints for the simplified proof-of-funds circuit.
        // ECDSA verification has been moved to the backend for smaller pk.bin.
        build_constraints(&mut builder, input);

        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

static SAMPLE_INPUT: Lazy<ZkpfCircuitInput> = Lazy::new(|| {
    serde_json::from_str(include_str!("sample_input.json")).expect("valid sample circuit input")
});

fn build_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &ZkpfCircuitInput,
) {
    let range = builder.range_chip();
    let gate = range.gate();

    let att = &input.attestation;
    let pub_in = &input.public;

    let ctx = builder.main(0);

    let balance = assign_u64(ctx, &range, att.balance_raw);
    let threshold = assign_u64(ctx, &range, pub_in.threshold_raw);
    let currency = assign_u32(ctx, &range, att.currency_code_int);
    let req_currency = assign_u32(ctx, &range, pub_in.required_currency_code);
    let custodian = assign_u32(ctx, &range, att.custodian_id);
    let attestation_id = assign_u64(ctx, &range, att.attestation_id);
    let issued_at = assign_u64(ctx, &range, att.issued_at);
    let valid_until = assign_u64(ctx, &range, att.valid_until);
    let current_epoch = assign_u64(ctx, &range, pub_in.current_epoch);
    let verifier_scope = assign_u64(ctx, &range, pub_in.verifier_scope_id);
    let policy_id = assign_u64(ctx, &range, pub_in.policy_id);
    let account_id_hash = ctx.load_witness(att.account_id_hash);

    crate::gadgets::compare::enforce_leq(ctx, gate, &range, issued_at, current_epoch);
    crate::gadgets::compare::enforce_leq(ctx, gate, &range, current_epoch, valid_until);

    crate::gadgets::policy::enforce_currency(ctx, gate, currency, req_currency);

    crate::gadgets::compare::enforce_geq(ctx, gate, &range, balance, threshold);

    let digest_fr = crate::gadgets::poseidon::hash_attestation(
        ctx,
        gate,
        balance,
        attestation_id,
        currency,
        custodian,
        issued_at,
        valid_until,
        account_id_hash,
    );
    let digest_from_bytes = fr_from_be_bytes(ctx, gate, &range, &att.message_hash);
    ctx.constrain_equal(&digest_fr, &digest_from_bytes);

    let (witness_pubkey_x, witness_pubkey_y) =
        assign_pubkey_coords(ctx, gate, &range, &att.custodian_pubkey);

    // NOTE: ECDSA signature verification has been moved OUT of the circuit.
    // The backend verifies the signature before calling the prover.
    // This reduces pk.bin from ~688MB to ~20MB by eliminating the expensive
    // halo2-ecc ECDSA gadget, making browser-based proving practical.
    //
    // What we still prove in-circuit:
    // - Balance >= threshold
    // - Currency code matches policy
    // - Attestation is within validity period
    // - Nullifier is correctly computed (prevents double-spending)
    // - Pubkey hash matches (binds proof to specific custodian key)
    // - Message hash matches Poseidon(attestation_fields)

    let computed_nullifier = crate::gadgets::nullifier::compute_nullifier(
        ctx,
        gate,
        account_id_hash,
        verifier_scope,
        policy_id,
        current_epoch,
    );
    let public_nullifier = ctx.load_witness(pub_in.nullifier);
    ctx.constrain_equal(&computed_nullifier, &public_nullifier);

    let pubkey_hash = hash_pubkey_coords(
        ctx,
        gate,
        witness_pubkey_x,
        witness_pubkey_y,
    );
    let public_pubkey_hash = ctx.load_witness(pub_in.custodian_pubkey_hash);
    ctx.constrain_equal(&pubkey_hash, &public_pubkey_hash);

    let _ = ctx;

    expose_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            current_epoch,
            verifier_scope,
            policy_id,
            public_nullifier,
            public_pubkey_hash,
        ],
    );
}

fn assign_u64(ctx: &mut Context<Fr>, range: &RangeChip<Fr>, value: u64) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value));
    range.range_check(ctx, cell, 64);
    cell
}

fn assign_u32(ctx: &mut Context<Fr>, range: &RangeChip<Fr>, value: u32) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value as u64));
    range.range_check(ctx, cell, 32);
    cell
}

fn expose_public_inputs(
    builder: &mut BaseCircuitBuilder<Fr>,
    values: [AssignedValue<Fr>; NUM_INSTANCE_COLUMNS],
) {
    for (idx, value) in values.into_iter().enumerate() {
        builder.assigned_instances[idx].push(value);
    }
}

fn fr_from_be_bytes(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    range: &RangeChip<Fr>,
    bytes: &[u8; 32],
) -> AssignedValue<Fr> {
    let mut acc = ctx.load_constant(Fr::zero());
    let base = Constant(Fr::from(256u64));
    for byte in bytes.iter() {
        let byte_val = ctx.load_witness(Fr::from(*byte as u64));
        range.range_check(ctx, byte_val, 8);
        acc = gate.mul_add(ctx, acc, base, byte_val);
    }
    acc
}

fn assign_pubkey_coords(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    range: &RangeChip<Fr>,
    pubkey: &Secp256k1Pubkey,
) -> (AssignedValue<Fr>, AssignedValue<Fr>) {
    let x = fr_from_be_bytes(ctx, gate, range, &pubkey.x);
    let y = fr_from_be_bytes(ctx, gate, range, &pubkey.y);
    (x, y)
}

fn hash_pubkey_coords(
    ctx: &mut Context<Fr>,
    gate: &GateChip<Fr>,
    x: AssignedValue<Fr>,
    y: AssignedValue<Fr>,
) -> AssignedValue<Fr> {
    crate::gadgets::poseidon::hash_elements(ctx, gate, &[x, y])
}
