// zkpf/zkpf-prover/src/main.rs
// Numan Thabit 2025

use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use clap::Parser;

use zkpf_circuit::ZkpfCircuitInput;
use zkpf_common::{
    load_prover_artifacts, serialize_verifier_public_inputs, ProofBundle, VerifierPublicInputs,
};
use zkpf_prover::prove_with_public_inputs;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    attestation_json: PathBuf,
    #[arg(long)]
    output_proof: PathBuf,
    #[arg(long, default_value = "artifacts/manifest.json")]
    manifest: PathBuf,
    /// Optional path to write the verifier-facing public inputs JSON.
    #[arg(long)]
    public_inputs_json: Option<PathBuf>,
    /// Optional path to write a proof bundle (proof + public inputs + circuit version).
    #[arg(long)]
    bundle_json: Option<PathBuf>,
    /// Optional path to write canonical serialized public inputs bytes.
    #[arg(long)]
    public_inputs_bin: Option<PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let json = fs::read_to_string(&args.attestation_json)
        .with_context(|| format!("failed to read {}", args.attestation_json.display()))?;
    let input: ZkpfCircuitInput =
        serde_json::from_str(&json).context("failed to parse attestation json")?;

    let artifacts = load_prover_artifacts(&args.manifest)
        .with_context(|| format!("failed to load manifest {}", args.manifest.display()))?;
    let pk = artifacts
        .proving_key()
        .context("prover artifacts missing proving key")?;
    let (proof, public_inputs) = prove_with_public_inputs(&artifacts.params, pk.as_ref(), input);

    fs::write(&args.output_proof, &proof)
        .with_context(|| format!("failed to write {}", args.output_proof.display()))?;

    if let Some(path) = args.public_inputs_json.as_ref() {
        write_public_inputs_json(path, &public_inputs)?;
    }

    if let Some(path) = args.public_inputs_bin.as_ref() {
        write_public_inputs_bin(path, &public_inputs)?;
    }

    if let Some(path) = args.bundle_json.as_ref() {
        write_bundle_json(
            path,
            ProofBundle {
                circuit_version: artifacts.manifest.circuit_version,
                proof: proof.clone(),
                public_inputs: public_inputs.clone(),
            },
        )?;
    }

    Ok(())
}

fn write_public_inputs_json(path: &PathBuf, inputs: &VerifierPublicInputs) -> Result<()> {
    let json = serde_json::to_vec_pretty(inputs).context("failed to serialize public inputs")?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))
}

fn write_public_inputs_bin(path: &PathBuf, inputs: &VerifierPublicInputs) -> Result<()> {
    let bytes = serialize_verifier_public_inputs(inputs)?;
    fs::write(path, bytes).with_context(|| format!("failed to write {}", path.display()))
}

fn write_bundle_json(path: &PathBuf, bundle: ProofBundle) -> Result<()> {
    let json = serde_json::to_vec_pretty(&bundle).context("failed to serialize proof bundle")?;
    fs::write(path, json).with_context(|| format!("failed to write {}", path.display()))
}
