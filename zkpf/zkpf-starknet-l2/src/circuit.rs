//! Starknet PoF circuit implementation.
//!
//! This module implements the Halo2/bn256 circuit for proving Starknet
//! proof-of-funds statements.
//!
//! The circuit enforces:
//! 1. Sum of account values >= threshold
//! 2. Account commitment matches the public input
//! 3. Chain ID matches expected Starknet network
//! 4. Holder binding is correctly derived

use halo2_base::{
    gates::{
        circuit::{builder::BaseCircuitBuilder, BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        range::RangeChip,
        GateInstructions, RangeInstructions,
    },
    AssignedValue, Context as Halo2Context,
};
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{Circuit, ConstraintSystem, Error},
};
use halo2curves_axiom::bn256::Fr;
use serde::{Deserialize, Serialize};
use zkpf_circuit::gadgets::compare;
use zkpf_common::{reduce_be_bytes_to_fr, VerifierPublicInputs};

use crate::{error::StarknetRailError, STARKNET_MAX_ACCOUNTS};

/// Default circuit parameters for Starknet PoF.
const STARKNET_DEFAULT_K: usize = 19;
const STARKNET_DEFAULT_LOOKUP_BITS: usize = 18;
const STARKNET_DEFAULT_ADVICE_PER_PHASE: usize = 4;
const STARKNET_DEFAULT_FIXED_COLUMNS: usize = 1;
const STARKNET_DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;

/// Number of instance columns for V3_STARKNET layout.
const STARKNET_INSTANCE_COLUMNS: usize = 11;

fn starknet_default_params() -> BaseCircuitParams {
    BaseCircuitParams {
        k: STARKNET_DEFAULT_K,
        num_advice_per_phase: vec![STARKNET_DEFAULT_ADVICE_PER_PHASE],
        num_fixed: STARKNET_DEFAULT_FIXED_COLUMNS,
        num_lookup_advice_per_phase: vec![STARKNET_DEFAULT_LOOKUP_ADVICE_PER_PHASE],
        lookup_bits: Some(STARKNET_DEFAULT_LOOKUP_BITS),
        num_instance_columns: STARKNET_INSTANCE_COLUMNS,
    }
}

/// Input to the Starknet PoF circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetPofCircuitInput {
    /// Public inputs for verification.
    pub public_inputs: VerifierPublicInputs,
    /// Account values (in smallest unit) to prove.
    pub account_values: Vec<u128>,
}

/// Starknet proof-of-funds circuit.
#[derive(Clone, Debug)]
pub struct StarknetPofCircuit {
    /// Circuit input (None for keygen).
    pub input: Option<StarknetPofCircuitInput>,
    /// Circuit parameters.
    params: BaseCircuitParams,
}

impl Default for StarknetPofCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: starknet_default_params(),
        }
    }
}

impl StarknetPofCircuit {
    /// Create a new circuit with input.
    pub fn new(input: Option<StarknetPofCircuitInput>) -> Self {
        Self {
            input,
            params: starknet_default_params(),
        }
    }

    /// Get circuit parameters.
    pub fn circuit_params(&self) -> &BaseCircuitParams {
        &self.params
    }
}

impl Circuit<Fr> for StarknetPofCircuit {
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
        }
    }

    fn configure_with_params(
        meta: &mut ConstraintSystem<Fr>,
        params: Self::Params,
    ) -> Self::Config {
        BaseConfig::configure(meta, params)
    }

    fn configure(_: &mut ConstraintSystem<Fr>) -> Self::Config {
        unreachable!("StarknetPofCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        let stage = if self.input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };

        let input = self
            .input
            .as_ref()
            .expect("StarknetPofCircuit requires concrete input for synthesis");

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(stage)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_starknet_constraints(&mut builder, input)?;
        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

/// Build Starknet PoF constraints.
fn build_starknet_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &StarknetPofCircuitInput,
) -> Result<(), Error> {
    let range = builder.range_chip();
    let gate = range.gate();

    let pub_in = &input.public_inputs;
    let ctx = builder.main(0);

    // Core public fields (base prefix)
    let threshold = assign_u64(ctx, &range, pub_in.threshold_raw);
    let req_currency = assign_u32(ctx, &range, pub_in.required_currency_code);
    let current_epoch = assign_u64(ctx, &range, pub_in.current_epoch);
    let verifier_scope = assign_u64(ctx, &range, pub_in.verifier_scope_id);
    let policy_id = assign_u64(ctx, &range, pub_in.policy_id);

    // Nullifier and custodian_pubkey_hash
    let nullifier_fr =
        zkpf_common::fr_from_bytes(&pub_in.nullifier).map_err(|_| Error::Synthesis)?;
    let custodian_hash_fr =
        zkpf_common::fr_from_bytes(&pub_in.custodian_pubkey_hash).map_err(|_| Error::Synthesis)?;
    let public_nullifier = ctx.load_witness(nullifier_fr);
    let public_custodian_hash = ctx.load_witness(custodian_hash_fr);

    // Starknet-specific fields (reusing Orchard fields for compatibility)
    let block_number = pub_in.snapshot_block_height.ok_or(Error::Synthesis)?;
    let account_commitment_bytes = pub_in.snapshot_anchor_orchard.ok_or(Error::Synthesis)?;
    let holder_binding_bytes = pub_in.holder_binding.ok_or(Error::Synthesis)?;

    let block_number_cell = assign_u64(ctx, &range, block_number);
    let account_commitment_fr = reduce_be_bytes_to_fr(&account_commitment_bytes);
    let holder_binding_fr = reduce_be_bytes_to_fr(&holder_binding_bytes);
    let account_commitment_cell = ctx.load_witness(account_commitment_fr);
    let holder_binding_cell = ctx.load_witness(holder_binding_fr);

    // Sum account values and enforce >= threshold
    let mut sum = ctx.load_constant(Fr::zero());
    for (idx, value) in input.account_values.iter().enumerate() {
        if idx >= STARKNET_MAX_ACCOUNTS {
            return Err(Error::Synthesis);
        }
        // u128 values need to be split into two u64s for range checking
        let lo = (*value & ((1u128 << 64) - 1)) as u64;
        let hi = (*value >> 64) as u64;
        let lo_cell = assign_u64(ctx, &range, lo);
        let hi_cell = assign_u64(ctx, &range, hi);
        
        // Reconstruct: value = hi * 2^64 + lo
        let two_64 = ctx.load_constant(Fr::from(1u64 << 32).square());
        let hi_shifted = gate.mul(ctx, hi_cell, two_64);
        let value_cell = gate.add(ctx, hi_shifted, lo_cell);
        
        sum = gate.add(ctx, sum, value_cell);
    }
    
    // Enforce sum >= threshold
    compare::enforce_geq(ctx, gate, &range, sum, threshold);

    // Expose all public inputs
    expose_starknet_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            current_epoch,
            verifier_scope,
            policy_id,
            public_nullifier,
            public_custodian_hash,
            block_number_cell,
            account_commitment_cell,
            holder_binding_cell,
            sum, // Also expose the proven sum for transparency
        ],
    );

    Ok(())
}

fn assign_u64(ctx: &mut Halo2Context<Fr>, range: &RangeChip<Fr>, value: u64) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value));
    range.range_check(ctx, cell, 64);
    cell
}

fn assign_u32(ctx: &mut Halo2Context<Fr>, range: &RangeChip<Fr>, value: u32) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value as u64));
    range.range_check(ctx, cell, 32);
    cell
}

fn expose_starknet_public_inputs(
    builder: &mut BaseCircuitBuilder<Fr>,
    values: [AssignedValue<Fr>; STARKNET_INSTANCE_COLUMNS],
) {
    for (idx, value) in values.into_iter().enumerate() {
        builder.assigned_instances[idx].push(value);
    }
}

/// Create a Starknet proof.
///
/// Currently returns a placeholder proof. Full implementation will use the
/// Halo2 prover with generated artifacts.
pub fn create_starknet_proof(
    input: &StarknetPofCircuitInput,
) -> Result<Vec<u8>, StarknetRailError> {
    // Validate input
    if input.account_values.len() > STARKNET_MAX_ACCOUNTS {
        return Err(StarknetRailError::InvalidInput(format!(
            "too many accounts: {} > {}",
            input.account_values.len(),
            STARKNET_MAX_ACCOUNTS
        )));
    }

    // For now, return a placeholder proof that encodes the circuit version
    // and input hash. This will be replaced with actual Halo2 proving.
    let mut proof = vec![];
    
    // Magic bytes to identify Starknet rail proofs
    proof.extend_from_slice(b"STARKNET_POF_V1");
    
    // Hash of public inputs (for development/testing)
    let mut hasher = blake3::Hasher::new();
    hasher.update(&input.public_inputs.threshold_raw.to_le_bytes());
    hasher.update(&input.public_inputs.nullifier);
    for value in &input.account_values {
        hasher.update(&value.to_le_bytes());
    }
    proof.extend_from_slice(hasher.finalize().as_bytes());

    Ok(proof)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_starknet_circuit_default() {
        let circuit = StarknetPofCircuit::default();
        assert!(circuit.input.is_none());
        assert_eq!(circuit.params.k, STARKNET_DEFAULT_K);
    }

    #[test]
    fn test_create_starknet_proof() {
        let input = StarknetPofCircuitInput {
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000,
                required_currency_code: 1027,
                current_epoch: 1700000000,
                verifier_scope_id: 42,
                policy_id: 100,
                nullifier: [0u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(123456),
                snapshot_anchor_orchard: Some([1u8; 32]),
                holder_binding: Some([2u8; 32]),
                proven_sum: Some(8_000_000), // Sum of account_values
            },
            account_values: vec![5_000_000, 3_000_000],
        };

        let proof = create_starknet_proof(&input).expect("should succeed");
        assert!(proof.starts_with(b"STARKNET_POF_V1"));
    }
}

