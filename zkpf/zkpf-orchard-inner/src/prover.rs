//! zkpf-orchard-inner/src/prover.rs
// Numan Thabtah 2025-11-22
use crate::{
    artifacts::orchard_artifacts,
    error::OrchardRailError,
    types::{OrchardProofBundle, OrchardSnapshot, RailMeta},
};
use halo2_proofs::{
    halo2curves::bn256::{Bn256, G1Affine},
    plonk::{create_proof, verify_proof},
    poly::kzg::{
        commitment::KZGCommitmentScheme,
        multiopen::{ProverGWC, VerifierGWC},
        strategy::SingleStrategy,
    },
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use rand_core::OsRng;
use zkpf_zcash_orchard_circuit::{OrchardPofCircuit, OrchardPofPublicInputs};

type OrchardScheme = KZGCommitmentScheme<Bn256>;
type OrchardProver = ProverGWC<Bn256>;
type OrchardVerifier<'a> = VerifierGWC<'a, Bn256>;

/// Construct the public inputs for a given snapshot and rail meta.
/// This keeps all public state derivation in one place.
fn build_public_inputs(
    snapshot: &OrchardSnapshot,
    threshold_raw: u64,
    rail_meta: &RailMeta,
    proven_value: u64,
) -> OrchardPofPublicInputs {
    OrchardPofPublicInputs {
        anchor: snapshot.anchor,
        threshold_raw,
        proven_value,
        holder_commitment: snapshot.holder_commitment,
        rail_meta_hash: rail_meta.policy_hash,
    }
}

/// Sum the values in the snapshot. The circuit still enforces the constraint,
/// but we also compute it here for public inputs.
fn sum_snapshot_value(snapshot: &OrchardSnapshot) -> u64 {
    snapshot
        .notes
        .iter()
        .fold(0u64, |acc, note| acc.saturating_add(note.value))
}

/// Generate a Orchard PoF proof and bundle, given a snapshot and policy.
///
/// This expects that the OrchardPofCircuit uses exactly the same public input
/// layout as OrchardPofPublicInputs::to_field_elements.
pub fn prove_pof(
    snapshot: &OrchardSnapshot,
    threshold_raw: u64,
    rail_meta: &RailMeta,
) -> Result<OrchardProofBundle, OrchardRailError> {
    let artifacts = orchard_artifacts()?;

    // Local sanity: circuit version must agree with rail_meta.
    if rail_meta.circuit_version != artifacts.circuit_version {
        return Err(OrchardRailError::CircuitVersionMismatch {
            expected: artifacts.circuit_version,
            actual: rail_meta.circuit_version,
        });
    }

    let proven_value = sum_snapshot_value(snapshot);
    let public_inputs = build_public_inputs(snapshot, threshold_raw, rail_meta, proven_value);

    // Build the circuit instance; this assumes you have implemented OrchardPofCircuit::new
    // that takes a snapshot and public inputs and wires the notes into the circuit.
    let circuit = OrchardPofCircuit::new(snapshot.clone(), public_inputs.clone());

    let mut transcript = Blake2bWrite::<_, G1Affine, Challenge255<_>>::init(vec![]);

    let instances = vec![public_inputs.to_field_elements()];

    // halo2_proofs expects &[&[&[Fr]]]; we only have a single circuit here.
    let instance_slices: Vec<&[halo2_proofs::halo2curves::bn256::Fr]> =
        instances.iter().map(|v| v.as_slice()).collect();
    let instance_refs: Vec<&[&[halo2_proofs::halo2curves::bn256::Fr]]> =
        vec![instance_slices.as_slice()];

    create_proof::<OrchardScheme, OrchardProver, _, _, _>(
        &artifacts.params,
        &artifacts.pk,
        &[circuit],
        &instance_refs,
        OsRng,
        &mut transcript,
    )?;

    let proof = transcript.finalize();

    Ok(OrchardProofBundle {
        rail_id: rail_meta.rail_id.clone(),
        circuit_version: artifacts.circuit_version,
        public_inputs,
        proof,
        height: snapshot.height,
    })
}

/// Verify a previously generated Orchard PoF bundle.
///
/// This uses the stored verifying key and params; it does not depend on the
/// original snapshot or UFVK.
pub fn verify_pof(
    bundle: &OrchardProofBundle,
    expected_rail_id: &str,
    expected_circuit_version: u32,
) -> Result<(), OrchardRailError> {
    let artifacts = orchard_artifacts()?;

    if bundle.rail_id != expected_rail_id {
        return Err(OrchardRailError::Plonk(format!(
            "rail_id mismatch: expected {}, got {}",
            expected_rail_id, bundle.rail_id
        )));
    }

    if bundle.circuit_version != expected_circuit_version {
        return Err(OrchardRailError::CircuitVersionMismatch {
            expected: expected_circuit_version,
            actual: bundle.circuit_version,
        });
    }

    if bundle.circuit_version != artifacts.circuit_version {
        return Err(OrchardRailError::CircuitVersionMismatch {
            expected: artifacts.circuit_version,
            actual: bundle.circuit_version,
        });
    }

    let public_elems = bundle.public_inputs.to_field_elements();
    let instance_slices: Vec<&[halo2_proofs::halo2curves::bn256::Fr]> =
        vec![public_elems.as_slice()];
    let instance_refs: Vec<&[&[halo2_proofs::halo2curves::bn256::Fr]]> =
        vec![instance_slices.as_slice()];

    let mut transcript = Blake2bRead::<_, G1Affine, Challenge255<_>>::init(bundle.proof.as_slice());

    let strategy = SingleStrategy::<Bn256>::new(&artifacts.params);

    verify_proof::<OrchardScheme, OrchardVerifier<'_>, _, _>(
        &artifacts.params,
        &artifacts.vk,
        strategy,
        &instance_refs,
        &mut transcript,
    )?;

    Ok(())
}