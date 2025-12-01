// zkpf/zkpf-prover/src/lib.rs
// Numan Thabit 2025

use halo2_proofs_axiom::{
    plonk::{self, create_proof, keygen_pk, keygen_vk},
    poly::kzg::{
        commitment::{KZGCommitmentScheme, ParamsKZG},
        multiopen::ProverGWC,
    },
    transcript::{Blake2bWrite, Challenge255, TranscriptWriterBuffer},
};
use halo2curves_axiom::bn256::{Bn256, Fr, G1Affine};
use rand::{rngs::OsRng, RngCore};

use zkpf_circuit::{ZkpfCircuit, ZkpfCircuitInput};
use zkpf_common::{public_to_verifier_inputs, ProofBundle, VerifierPublicInputs};

pub struct ProverParams {
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: plonk::ProvingKey<G1Affine>,
}

pub fn setup(k: u32) -> ProverParams {
    let mut rng = OsRng;
    let params = ParamsKZG::<Bn256>::setup(k, &mut rng);
    let empty_circuit = ZkpfCircuit::default();
    let vk = keygen_vk(&params, &empty_circuit).expect("vk");
    let pk = keygen_pk(&params, vk.clone(), &empty_circuit).expect("pk");
    ProverParams { params, vk, pk }
}

pub fn prove(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> Vec<u8> {
    prove_with_public_inputs(params, pk, input).0
}

pub fn prove_with_public_inputs(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> (Vec<u8>, VerifierPublicInputs) {
    let public_inputs = public_to_verifier_inputs(&input.public);
    let proof = create_proof_bytes(params, pk, input);
    (proof, public_inputs)
}

pub fn prove_bundle(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> ProofBundle {
    let (proof, public_inputs) = prove_with_public_inputs(params, pk, input);
    ProofBundle::new(proof, public_inputs)
}

// ============================================================
// RNG-injectable proving functions for testing/debugging
// ============================================================

/// Proves with a custom RNG source.
///
/// This is useful for:
/// - Deterministic testing with a seeded RNG
/// - Debugging proof generation issues
/// - Environments where `OsRng` may not be available (e.g., some WASM targets)
///
/// # Example
/// ```ignore
/// use rand::SeedableRng;
/// use rand_chacha::ChaCha20Rng;
///
/// // Deterministic proof for testing
/// let mut rng = ChaCha20Rng::seed_from_u64(12345);
/// let proof = prove_with_rng(params, pk, input, &mut rng);
/// ```
pub fn prove_with_rng<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> Vec<u8> {
    prove_with_public_inputs_and_rng(params, pk, input, rng).0
}

/// Proves with custom RNG and returns public inputs.
pub fn prove_with_public_inputs_and_rng<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> (Vec<u8>, VerifierPublicInputs) {
    let public_inputs = public_to_verifier_inputs(&input.public);
    let proof = create_proof_bytes_with_rng(params, pk, input, rng);
    (proof, public_inputs)
}

/// Proves and bundles with custom RNG.
pub fn prove_bundle_with_rng<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> ProofBundle {
    let (proof, public_inputs) = prove_with_public_inputs_and_rng(params, pk, input, rng);
    ProofBundle::new(proof, public_inputs)
}

/// Error type for proof generation failures.
#[derive(Debug)]
pub struct ProofGenError(pub String);

impl std::fmt::Display for ProofGenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "proof generation failed: {}", self.0)
    }
}

impl std::error::Error for ProofGenError {}

/// Proves and returns a bundle, returning an error instead of panicking.
/// This is the preferred API for WASM builds where panic = abort and catch_unwind doesn't work.
pub fn prove_bundle_result(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> Result<ProofBundle, ProofGenError> {
    prove_bundle_result_with_rng(params, pk, input, &mut OsRng)
}

/// Proves and returns a bundle with custom RNG, returning an error instead of panicking.
pub fn prove_bundle_result_with_rng<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> Result<ProofBundle, ProofGenError> {
    let public_inputs = public_to_verifier_inputs(&input.public);
    let proof = create_proof_bytes_with_rng_result(params, pk, input, rng)?;
    Ok(ProofBundle::new(proof, public_inputs))
}

fn create_proof_bytes(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> Vec<u8> {
    create_proof_bytes_with_rng(params, pk, input, &mut OsRng)
}

fn create_proof_bytes_with_rng<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> Vec<u8> {
    create_proof_bytes_with_rng_result(params, pk, input, rng)
        .unwrap_or_else(|e| panic!("proof generation failed: {}", e.0))
}

fn create_proof_bytes_with_rng_result<R: RngCore>(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
    rng: &mut R,
) -> Result<Vec<u8>, ProofGenError> {
    let instance_slices = zkpf_circuit::public_instances(&input.public);
    let instance_refs: Vec<&[Fr]> = instance_slices.iter().map(|col| col.as_slice()).collect();

    // Use new_prover for optimized production proof generation.
    // This uses CircuitBuilderStage::Prover which enables witness_gen_only mode,
    // skipping constraint storage since constraints are already in the proving key.
    let circuit = ZkpfCircuit::new_prover(input);

    let mut transcript = Blake2bWrite::<_, G1Affine, Challenge255<_>>::init(vec![]);
    create_proof::<KZGCommitmentScheme<Bn256>, ProverGWC<'_, Bn256>, _, _, _, _>(
        params,
        pk,
        &[circuit],
        &[instance_refs.as_slice()],
        rng,
        &mut transcript,
    )
    .map_err(|e| ProofGenError(format!("{:?}", e)))?;
    Ok(transcript.finalize())
}
