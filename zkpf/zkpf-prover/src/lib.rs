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
use rand::rngs::OsRng;

use zkpf_circuit::{ZkpfCircuit, ZkpfCircuitInput};
use zkpf_common::{public_to_verifier_inputs, ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

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

fn create_proof_bytes(
    params: &ParamsKZG<Bn256>,
    pk: &plonk::ProvingKey<G1Affine>,
    input: ZkpfCircuitInput,
) -> Vec<u8> {
    let instance_slices = zkpf_circuit::public_instances(&input.public);
    let instance_refs: Vec<&[Fr]> = instance_slices.iter().map(|col| col.as_slice()).collect();

    let circuit = ZkpfCircuit::new(Some(input));

    let mut transcript = Blake2bWrite::<_, G1Affine, Challenge255<_>>::init(vec![]);
    create_proof::<KZGCommitmentScheme<Bn256>, ProverGWC<'_, Bn256>, _, _, _, _>(
        params,
        pk,
        &[circuit],
        &[instance_refs.as_slice()],
        OsRng,
        &mut transcript,
    )
    .expect("proof gen");
    transcript.finalize()
}
