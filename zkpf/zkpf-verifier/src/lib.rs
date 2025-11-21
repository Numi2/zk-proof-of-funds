// zkpf/zkpf-verifier/src/lib.rs
// Numan Thabit 2025

use anyhow::Result;
use halo2_proofs_axiom::{
    plonk::verify_proof,
    poly::kzg::{
        commitment::{KZGCommitmentScheme, ParamsKZG},
        multiopen::VerifierGWC,
        strategy::SingleStrategy,
    },
    transcript::{Blake2bRead, Challenge255, TranscriptReadBuffer},
};
use halo2curves_axiom::bn256::{Bn256, G1Affine};
use zkpf_common::{public_inputs_to_instances, VerifierPublicInputs};

pub fn verify(
    params: &ParamsKZG<Bn256>,
    vk: &halo2_proofs_axiom::plonk::VerifyingKey<G1Affine>,
    proof_bytes: &[u8],
    instances: &[Vec<halo2curves_axiom::bn256::Fr>],
) -> bool {
    let mut transcript = Blake2bRead::<_, G1Affine, Challenge255<_>>::init(proof_bytes);

    let instance_columns: Vec<&[halo2curves_axiom::bn256::Fr]> =
        instances.iter().map(|col| col.as_slice()).collect();
    let prepared_instances = vec![instance_columns.as_slice()];

    verify_proof::<KZGCommitmentScheme<Bn256>, VerifierGWC<'_, Bn256>, _, _, _>(
        params,
        vk,
        SingleStrategy::new(params),
        &prepared_instances,
        &mut transcript,
    )
    .is_ok()
}

pub fn verify_with_public_inputs(
    params: &ParamsKZG<Bn256>,
    vk: &halo2_proofs_axiom::plonk::VerifyingKey<G1Affine>,
    proof_bytes: &[u8],
    public_inputs: &VerifierPublicInputs,
) -> Result<bool> {
    let instances = public_inputs_to_instances(public_inputs)?;
    Ok(verify(params, vk, proof_bytes, &instances))
}
