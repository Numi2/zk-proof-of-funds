use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime},
};

use anyhow::{anyhow, ensure, Context, Result};
use chrono::Utc;
use clap::{Args, Parser, Subcommand};
use halo2curves_axiom::{
    bn256::Fr,
    ff::{Field, PrimeField},
};
use k256::{
    ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey, VerifyingKey},
    SecretKey,
};
use poseidon_primitives::poseidon::primitives::{ConstantLength, Hash, Spec};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{json, Value};
use zkpf_circuit::{
    gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey},
    PublicInputs, ZkpfCircuitInput,
};
use zkpf_common::{
    custodian_pubkey_hash, read_manifest, ArtifactManifest, VerifierPublicInputs, CIRCUIT_VERSION,
    // Poseidon parameters from canonical source (zkpf-circuit)
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};

const DEFAULT_OUTPUT_DIR: &str = "artifacts/ci";
const ATTESTATION_FILENAME: &str = "attestation.sample.json";
const PROOF_BUNDLE_FILENAME: &str = "proof_bundle.json";
const PROOF_BIN_FILENAME: &str = "proof.bin";
const PUBLIC_INPUTS_JSON_FILENAME: &str = "public_inputs.json";
const PUBLIC_INPUTS_BIN_FILENAME: &str = "public_inputs.bin";
const PARAMS_METADATA_FILENAME: &str = "params.metadata.json";
const PROVENANCE_FILENAME: &str = "manifest.provenance.json";
const BACKEND_PARAMS_FILENAME: &str = "backend.params.json";
const BACKEND_VERIFY_BUNDLE_FILENAME: &str = "backend.verify_bundle.json";
const BACKEND_VERIFY_BYTES_FILENAME: &str = "backend.verify.json";
const BACKEND_POLICIES_FILENAME: &str = "backend.policies.json";
const BACKEND_NULLIFIER_DB_FILENAME: &str = "backend.nullifiers.db";
const SAMPLE_SK_HEX: &str = "2ec8d8d86fe5a4f4c5db0f826bea4722b8d2535d991a8f8a27c4b31c6d6cf3ce";
const BACKEND_DEFAULT_PORT: u16 = 3000;

#[derive(Parser)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run the end-to-end artifact generation, proving, and backend verification flow.
    CiArtifacts(CiArtifactsArgs),
}

#[derive(Args)]
struct CiArtifactsArgs {
    /// Directory to write generated artifacts and fixtures into.
    #[arg(long, default_value = DEFAULT_OUTPUT_DIR)]
    output_dir: PathBuf,
    /// Circuit size exponent `k` for the trusted setup.
    #[arg(long, default_value_t = 19)]
    k: u32,
    /// Circuit version recorded in the manifest (defaults to `zkpf-common::CIRCUIT_VERSION`).
    #[arg(long)]
    circuit_version: Option<u32>,
    /// Skip spinning up the backend verifier (useful for local smoke tests).
    #[arg(long)]
    skip_backend: bool,
    /// Port the backend verifier should bind to (default 3000).
    #[arg(long, default_value_t = BACKEND_DEFAULT_PORT)]
    backend_port: u16,
    /// Run `cargo run` invocations in release mode for faster key generation/proving.
    #[arg(long)]
    release: bool,
}

fn main() -> Result<()> {
    let args = Cli::parse();
    match args.command {
        Commands::CiArtifacts(opts) => run_ci_artifacts(opts),
    }
}

fn run_ci_artifacts(args: CiArtifactsArgs) -> Result<()> {
    let workspace_root = workspace_root();
    let artifacts_dir = workspace_root.join(&args.output_dir);
    if artifacts_dir.exists() {
        fs::remove_dir_all(&artifacts_dir)
            .with_context(|| format!("failed to clean {}", artifacts_dir.display()))?;
    }
    fs::create_dir_all(&artifacts_dir)
        .with_context(|| format!("failed to create {}", artifacts_dir.display()))?;

    let manifest_path = artifacts_dir.join("manifest.json");
    println!(
        "⭐️ Generating trusted setup artifacts in {}",
        artifacts_dir.display()
    );
    run_gen_params(
        &workspace_root,
        args.release,
        args.k,
        args.circuit_version.unwrap_or(CIRCUIT_VERSION),
        &artifacts_dir,
    )?;

    capture_manifest_metadata(
        &workspace_root,
        args.release,
        &manifest_path,
        &artifacts_dir,
    )?;

    let manifest = read_manifest(&manifest_path)
        .with_context(|| format!("failed to read manifest at {}", manifest_path.display()))?;
    write_provenance(&manifest, &artifacts_dir)?;

    println!("🧪 Writing deterministic sample attestation input");
    let sample_input = generate_sample_input()?;
    let attestation_path = artifacts_dir.join(ATTESTATION_FILENAME);
    write_json(&attestation_path, &sample_input)?;

    println!("🧾 Running zkpf-prover to materialize proof artifacts");
    run_prover(
        &workspace_root,
        args.release,
        &attestation_path,
        &manifest_path,
        &artifacts_dir,
    )?;

    if !args.skip_backend {
        println!("✅ Booting backend verifier to replay the sample proof");
        verify_with_backend(
            &workspace_root,
            args.release,
            &manifest_path,
            &artifacts_dir,
            args.backend_port,
            &manifest,
        )?;
    } else {
        println!("⚠️ Skipping backend verification because --skip-backend was set");
    }

    println!(
        "\nDone! Sample artifacts are available under {}",
        artifacts_dir.display()
    );
    Ok(())
}

fn run_gen_params(
    workspace_root: &Path,
    release: bool,
    k: u32,
    circuit_version: u32,
    output_dir: &Path,
) -> Result<()> {
    let mut cmd = cargo_run_cmd(workspace_root, "zkpf-tools", release);
    cmd.args([
        "gen-params",
        "--k",
        &k.to_string(),
        "--circuit-version",
        &circuit_version.to_string(),
        "--output-dir",
        output_dir
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", output_dir.display()))?,
    ]);
    run_command(cmd, "zkpf-tools gen-params")
}

fn capture_manifest_metadata(
    workspace_root: &Path,
    release: bool,
    manifest_path: &Path,
    artifacts_dir: &Path,
) -> Result<()> {
    let mut cmd = cargo_run_cmd(workspace_root, "zkpf-tools", release);
    cmd.args([
        "dump-params",
        "--manifest",
        manifest_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", manifest_path.display()))?,
        "--json",
    ]);
    let output = run_command_capture(cmd, "zkpf-tools dump-params")?;
    fs::write(artifacts_dir.join(PARAMS_METADATA_FILENAME), output)
        .with_context(|| format!("failed to write {}", PARAMS_METADATA_FILENAME))?;
    Ok(())
}

fn run_prover(
    workspace_root: &Path,
    release: bool,
    attestation_path: &Path,
    manifest_path: &Path,
    artifacts_dir: &Path,
) -> Result<()> {
    let mut cmd = cargo_run_cmd(workspace_root, "zkpf-prover", release);
    cmd.args([
        "--attestation-json",
        attestation_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", attestation_path.display()))?,
        "--manifest",
        manifest_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", manifest_path.display()))?,
        "--output-proof",
        artifacts_dir
            .join(PROOF_BIN_FILENAME)
            .to_str()
            .ok_or_else(|| anyhow!("invalid UTF-8 path for proof output"))?,
        "--public-inputs-json",
        artifacts_dir
            .join(PUBLIC_INPUTS_JSON_FILENAME)
            .to_str()
            .ok_or_else(|| anyhow!("invalid UTF-8 path for public inputs JSON"))?,
        "--public-inputs-bin",
        artifacts_dir
            .join(PUBLIC_INPUTS_BIN_FILENAME)
            .to_str()
            .ok_or_else(|| anyhow!("invalid UTF-8 path for public inputs bin"))?,
        "--bundle-json",
        artifacts_dir
            .join(PROOF_BUNDLE_FILENAME)
            .to_str()
            .ok_or_else(|| anyhow!("invalid UTF-8 path for bundle output"))?,
    ]);
    run_command(cmd, "zkpf-prover")
}

fn verify_with_backend(
    workspace_root: &Path,
    release: bool,
    manifest_path: &Path,
    artifacts_dir: &Path,
    port: u16,
    manifest: &ArtifactManifest,
) -> Result<()> {
    let public_inputs_json_path = artifacts_dir.join(PUBLIC_INPUTS_JSON_FILENAME);
    let public_inputs_json = fs::read(&public_inputs_json_path)
        .with_context(|| format!("failed to read {}", public_inputs_json_path.display()))?;
    let verifier_inputs: VerifierPublicInputs = serde_json::from_slice(&public_inputs_json)
        .context("failed to parse public inputs json")?;
    let policy_entry = json!({
        "threshold_raw": verifier_inputs.threshold_raw,
        "required_currency_code": verifier_inputs.required_currency_code,
        "verifier_scope_id": verifier_inputs.verifier_scope_id,
        "policy_id": verifier_inputs.policy_id,
    });
    let policies_path = artifacts_dir.join(BACKEND_POLICIES_FILENAME);
    write_json(&policies_path, &vec![policy_entry.clone()])?;

    let mut backend_cmd = cargo_run_cmd(workspace_root, "zkpf-backend", release);
    backend_cmd.env(
        "ZKPF_MANIFEST_PATH",
        manifest_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", manifest_path.display()))?,
    );
    backend_cmd.env(
        "ZKPF_POLICY_PATH",
        policies_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", policies_path.display()))?,
    );
    let nullifier_db_path = artifacts_dir.join(BACKEND_NULLIFIER_DB_FILENAME);
    backend_cmd.env(
        "ZKPF_NULLIFIER_DB",
        nullifier_db_path
            .to_str()
            .ok_or_else(|| anyhow!("non-UTF8 path {}", nullifier_db_path.display()))?,
    );
    backend_cmd.env("RUST_LOG", "info");
    backend_cmd
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child = backend_cmd
        .spawn()
        .context("failed to start zkpf-backend process")?;

    let result = (|| -> Result<()> {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .context("failed to build HTTP client")?;
        wait_for_backend(&client, port)?;

        let params_url = format!("http://127.0.0.1:{port}/zkpf/params");
        let params_value: Value = client
            .get(&params_url)
            .send()
            .and_then(|resp| resp.error_for_status())
            .context("failed to call /zkpf/params")?
            .json()
            .context("failed to decode /zkpf/params response")?;
        write_json(&artifacts_dir.join(BACKEND_PARAMS_FILENAME), &params_value)?;

        let bundle_path = artifacts_dir.join(PROOF_BUNDLE_FILENAME);
        let bundle_value: Value =
            serde_json::from_slice(&fs::read(&bundle_path).with_context(|| {
                format!("failed to read proof bundle at {}", bundle_path.display())
            })?)
            .context("failed to parse proof bundle JSON")?;
        let policy_id = verifier_inputs.policy_id;

        let verify_bundle_url = format!("http://127.0.0.1:{port}/zkpf/verify-bundle");
        let bundle_request = json!({
            "policy_id": policy_id,
            "bundle": bundle_value,
        });
        let verify_bundle_value: Value = client
            .post(&verify_bundle_url)
            .json(&bundle_request)
            .send()
            .and_then(|resp| resp.error_for_status())
            .context("failed to call /zkpf/verify-bundle")?
            .json()
            .context("failed to decode /zkpf/verify-bundle response")?;
        write_json(
            &artifacts_dir.join(BACKEND_VERIFY_BUNDLE_FILENAME),
            &verify_bundle_value,
        )?;
        ensure!(
            verify_bundle_value
                .get("valid")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "backend reported invalid proof bundle"
        );

        let proof_bytes = fs::read(artifacts_dir.join(PROOF_BIN_FILENAME))
            .context("failed to read proof bytes")?;
        let public_inputs_bytes = fs::read(artifacts_dir.join(PUBLIC_INPUTS_BIN_FILENAME))
            .context("failed to read public inputs bytes")?;

        let verify_payload = serde_json::json!({
            "circuit_version": manifest.circuit_version,
            "proof": proof_bytes,
            "public_inputs": public_inputs_bytes,
            "policy_id": policy_id,
        });
        let verify_bytes_url = format!("http://127.0.0.1:{port}/zkpf/verify");
        let verify_bytes_value: Value = client
            .post(&verify_bytes_url)
            .json(&verify_payload)
            .send()
            .and_then(|resp| resp.error_for_status())
            .context("failed to call /zkpf/verify")?
            .json()
            .context("failed to decode /zkpf/verify response")?;
        write_json(
            &artifacts_dir.join(BACKEND_VERIFY_BYTES_FILENAME),
            &verify_bytes_value,
        )?;
        ensure!(
            verify_bytes_value
                .get("valid")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            "backend reported invalid proof bytes"
        );

        Ok(())
    })();

    child.kill().ok();
    child.wait().ok();
    result
}

fn wait_for_backend(client: &Client, port: u16) -> Result<()> {
    for _ in 0..60 {
        let params_url = format!("http://127.0.0.1:{port}/zkpf/params");
        match client.get(&params_url).send() {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => thread::sleep(Duration::from_millis(500)),
        }
    }
    Err(anyhow!(
        "backend failed to become ready on port {} within timeout",
        port
    ))
}

fn write_provenance(manifest: &ArtifactManifest, artifacts_dir: &Path) -> Result<()> {
    #[derive(Serialize)]
    struct Provenance<'a> {
        manifest_version: u32,
        circuit_version: u32,
        k: u32,
        params_hash: &'a str,
        vk_hash: &'a str,
        pk_hash: &'a str,
        generated_at_unix: u64,
        generated_at_iso8601: String,
    }

    let provenance = Provenance {
        manifest_version: manifest.manifest_version,
        circuit_version: manifest.circuit_version,
        k: manifest.k,
        params_hash: &manifest.params.blake3,
        vk_hash: &manifest.vk.blake3,
        pk_hash: &manifest.pk.blake3,
        generated_at_unix: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        generated_at_iso8601: Utc::now().to_rfc3339(),
    };
    write_json(&artifacts_dir.join(PROVENANCE_FILENAME), &provenance)
}

fn generate_sample_input() -> Result<ZkpfCircuitInput> {
    const BALANCE_RAW: u64 = 5_000_000_000;
    const CURRENCY_CODE: u32 = 840;
    const CUSTODIAN_ID: u32 = 77;
    const ATTESTATION_ID: u64 = 4242;
    const ISSUED_AT: u64 = 1_704_000_000;
    const VALID_UNTIL: u64 = 1_804_000_000;
    const THRESHOLD_RAW: u64 = 1_000_000_000;
    const CURRENT_EPOCH: u64 = 1_705_000_000;
    const VERIFIER_SCOPE_ID: u64 = 314_159;
    const POLICY_ID: u64 = 2_718;

    let account_id_hash = sample_account_id_hash();
    let att_fields = [
        Fr::from(BALANCE_RAW),
        Fr::from(ATTESTATION_ID),
        Fr::from(CURRENCY_CODE as u64),
        Fr::from(CUSTODIAN_ID as u64),
        Fr::from(ISSUED_AT),
        Fr::from(VALID_UNTIL),
        account_id_hash,
    ];
    let poseidon_digest = poseidon_hash(att_fields);
    let message_hash = fr_to_be_bytes(&poseidon_digest);

    let signing_key = sample_signing_key()?;
    let signature = sign_digest(&signing_key, &message_hash)?;
    let derived_pubkey = derive_pubkey(&signing_key)?;

    let attestation = AttestationWitness {
        balance_raw: BALANCE_RAW,
        currency_code_int: CURRENCY_CODE,
        custodian_id: CUSTODIAN_ID,
        attestation_id: ATTESTATION_ID,
        issued_at: ISSUED_AT,
        valid_until: VALID_UNTIL,
        account_id_hash,
        custodian_pubkey: derived_pubkey,
        signature,
        message_hash,
    };

    let nullifier = poseidon_hash([
        account_id_hash,
        Fr::from(VERIFIER_SCOPE_ID),
        Fr::from(POLICY_ID),
        Fr::from(CURRENT_EPOCH),
    ]);
    let pubkey_hash = custodian_pubkey_hash(&derived_pubkey);

    let public = PublicInputs {
        threshold_raw: THRESHOLD_RAW,
        required_currency_code: CURRENCY_CODE,
        current_epoch: CURRENT_EPOCH,
        verifier_scope_id: VERIFIER_SCOPE_ID,
        policy_id: POLICY_ID,
        nullifier,
        custodian_pubkey_hash: pubkey_hash,
    };

    Ok(ZkpfCircuitInput {
        attestation,
        public,
    })
}

fn sample_account_id_hash() -> Fr {
    Fr::from(1_234_567_890_u64)
}

fn sign_digest(signing_key: &SigningKey, digest: &[u8; 32]) -> Result<EcdsaSignature> {
    let signature: Signature = signing_key
        .sign_prehash(digest)
        .context("failed to sign Poseidon digest")?;
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    r.copy_from_slice(signature.r().to_bytes().as_slice());
    s.copy_from_slice(signature.s().to_bytes().as_slice());
    Ok(EcdsaSignature { r, s })
}

fn sample_signing_key() -> Result<SigningKey> {
    let bytes_vec =
        hex::decode(SAMPLE_SK_HEX).context("failed to decode sample signing key hex")?;
    let bytes: [u8; 32] = bytes_vec
        .try_into()
        .map_err(|_| anyhow!("sample signing key must be 32 bytes"))?;
    let secret =
        SecretKey::from_bytes(&bytes.into()).context("invalid sample signing key bytes")?;
    Ok(SigningKey::from(secret))
}

fn poseidon_hash<const L: usize>(values: [Fr; L]) -> Fr {
    Hash::<Fr, PoseidonBn254Spec, ConstantLength<L>, POSEIDON_T, POSEIDON_RATE>::init().hash(values)
}

fn derive_pubkey(signing_key: &SigningKey) -> Result<Secp256k1Pubkey> {
    let verifying_key = VerifyingKey::from(signing_key);
    let encoded = verifying_key.to_encoded_point(false);
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(encoded.x().ok_or_else(|| anyhow!("missing x coordinate"))?);
    y.copy_from_slice(encoded.y().ok_or_else(|| anyhow!("missing y coordinate"))?);
    Ok(Secp256k1Pubkey { x, y })
}

#[derive(Clone, Copy, Debug)]
struct PoseidonBn254Spec;

impl Spec<Fr, POSEIDON_T, POSEIDON_RATE> for PoseidonBn254Spec {
    fn full_rounds() -> usize {
        POSEIDON_FULL_ROUNDS
    }

    fn partial_rounds() -> usize {
        POSEIDON_PARTIAL_ROUNDS
    }

    fn sbox(val: Fr) -> Fr {
        val.pow_vartime([5])
    }

    fn secure_mds() -> usize {
        0
    }
}

fn fr_to_be_bytes(value: &Fr) -> [u8; 32] {
    let le_repr = value.to_repr();
    let mut be_bytes = [0u8; 32];
    be_bytes.copy_from_slice(le_repr.as_ref());
    be_bytes.reverse();
    be_bytes
}

fn cargo_run_cmd(workspace_root: &Path, package: &str, release: bool) -> Command {
    let mut cmd = Command::new("cargo");
    cmd.current_dir(workspace_root);
    cmd.arg("run").arg("-p").arg(package);
    if release {
        cmd.arg("--release");
    }
    cmd.arg("--");
    cmd
}

fn run_command(mut cmd: Command, label: &str) -> Result<()> {
    let status = cmd
        .status()
        .with_context(|| format!("failed to execute {label}"))?;
    ensure!(status.success(), "{label} exited with {status}");
    Ok(())
}

fn run_command_capture(mut cmd: Command, label: &str) -> Result<String> {
    let output = cmd
        .output()
        .with_context(|| format!("failed to execute {label}"))?;
    ensure!(
        output.status.success(),
        "{label} exited with {}:\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).map_err(|err| err.into())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let data = serde_json::to_vec_pretty(value)
        .with_context(|| format!("failed to serialize {}", path.display()))?;
    fs::write(path, data).with_context(|| format!("failed to write {}", path.display()))
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask should live inside the workspace root")
        .to_path_buf()
}
