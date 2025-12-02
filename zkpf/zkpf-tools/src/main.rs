use std::{
    fmt, fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand, ValueEnum};
use serde::Serialize;
use zkpf_common::{
    load_prover_artifacts, serialize_params, serialize_proving_key, serialize_verifying_key,
    write_manifest, ArtifactFile, ArtifactManifest, ProverArtifacts, CIRCUIT_VERSION, MANIFEST_FILE,
    MANIFEST_VERSION,
};
use zkpf_prover::setup;
use zkpf_starknet_l2::{
    serialize_starknet_proving_key, serialize_starknet_verifying_key, starknet_keygen,
    STARKNET_DEFAULT_K,
};
use zkpf_zcash_orchard_circuit::{orchard_keygen, serialize_break_points, ORCHARD_DEFAULT_K};

const DEFAULT_OUTPUT_DIR: &str = "artifacts/local";
const DEFAULT_MANIFEST_PATH: &str = "artifacts/manifest.json";
const PARAMS_FILENAME: &str = "params.bin";
const VK_FILENAME: &str = "vk.bin";
const PK_FILENAME: &str = "pk.bin";
const BREAK_POINTS_FILENAME: &str = "break_points.json";

#[derive(Parser)]
#[command(
    name = "zkpf-tools",
    about = "Utility commands for zk-proof-of-funds artifacts"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate params/vk/pk and a manifest for a specific circuit version.
    GenParams(GenParamsArgs),
    /// Regenerate just the break_points.json file (fast, ~30-60 seconds).
    GenBreakPoints(GenBreakPointsArgs),
    /// Print metadata about params.bin based on the manifest path.
    DumpParams(DumpArgs),
    /// Print metadata about vk.bin based on the manifest path.
    DumpVk(DumpArgs),
}

/// Rail type for keygen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum RailType {
    /// Default zkpf circuit (custodial attestations).
    Default,
    /// Starknet L2 rail circuit.
    Starknet,
    /// Zcash Orchard rail circuit (k=19, 10 public inputs).
    Orchard,
}

impl Default for RailType {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Args)]
struct GenParamsArgs {
    /// Circuit k parameter (log2 of circuit size).
    #[arg(long, default_value_t = 19)]
    k: u32,
    /// Output directory for artifacts.
    #[arg(long, default_value = DEFAULT_OUTPUT_DIR)]
    output_dir: PathBuf,
    /// Circuit version number.
    #[arg(long, default_value_t = CIRCUIT_VERSION)]
    circuit_version: u32,
    /// Rail type to generate artifacts for.
    #[arg(long, value_enum, default_value_t = RailType::Default)]
    rail: RailType,
}

#[derive(Args)]
struct DumpArgs {
    #[arg(long, default_value = DEFAULT_MANIFEST_PATH)]
    manifest: PathBuf,
    #[arg(long)]
    json: bool,
}

#[derive(Args)]
struct GenBreakPointsArgs {
    /// Output directory containing existing artifacts.
    #[arg(long, default_value = "artifacts/zcash-orchard")]
    output_dir: PathBuf,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::GenParams(args) => gen_params(args),
        Commands::GenBreakPoints(args) => gen_break_points_only(args),
        Commands::DumpParams(args) => dump_params(args),
        Commands::DumpVk(args) => dump_vk(args),
    }
}

fn gen_params(args: GenParamsArgs) -> Result<()> {
    match args.rail {
        RailType::Default => gen_default_params(args),
        RailType::Starknet => gen_starknet_params(args),
        RailType::Orchard => gen_orchard_params(args),
    }
}

fn gen_default_params(args: GenParamsArgs) -> Result<()> {
    fs::create_dir_all(&args.output_dir)
        .with_context(|| format!("failed to create {}", args.output_dir.display()))?;

    println!(
        "Generating default zkpf circuit artifacts (k={})...",
        args.k
    );
    println!("This may take several minutes...");

    let params = setup(args.k);
    let params_bytes = serialize_params(&params.params)?;
    let vk_bytes = serialize_verifying_key(&params.vk)?;
    let pk_bytes = serialize_proving_key(&params.pk)?;

    write_binary(args.output_dir.join(PARAMS_FILENAME), &params_bytes)?;
    write_binary(args.output_dir.join(VK_FILENAME), &vk_bytes)?;
    write_binary(args.output_dir.join(PK_FILENAME), &pk_bytes)?;

    let manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        circuit_version: args.circuit_version,
        k: args.k,
        created_at_unix: current_unix_timestamp(),
        params: ArtifactFile::from_bytes(PARAMS_FILENAME, &params_bytes),
        vk: ArtifactFile::from_bytes(VK_FILENAME, &vk_bytes),
        pk: ArtifactFile::from_bytes(PK_FILENAME, &pk_bytes),
    };

    let manifest_path = args.output_dir.join(MANIFEST_FILE);
    write_manifest(&manifest_path, &manifest)?;

    println!(
        "Generated artifacts for circuit v{} (k={}) at {}",
        manifest.circuit_version,
        manifest.k,
        args.output_dir.display()
    );
    print_artifact_summary(&manifest);
    Ok(())
}

fn gen_starknet_params(args: GenParamsArgs) -> Result<()> {
    fs::create_dir_all(&args.output_dir)
        .with_context(|| format!("failed to create {}", args.output_dir.display()))?;

    // Use Starknet default k if not specified
    let k = if args.k == 19 {
        STARKNET_DEFAULT_K as u32
    } else {
        args.k
    };

    println!("Generating Starknet L2 rail circuit artifacts (k={})...", k);
    println!("This may take several minutes...");

    let params = starknet_keygen(k);
    let params_bytes = serialize_params(&params.params)?;
    let vk_bytes = serialize_starknet_verifying_key(&params.vk)?;
    let pk_bytes = serialize_starknet_proving_key(&params.pk)?;

    write_binary(args.output_dir.join(PARAMS_FILENAME), &params_bytes)?;
    write_binary(args.output_dir.join(VK_FILENAME), &vk_bytes)?;
    write_binary(args.output_dir.join(PK_FILENAME), &pk_bytes)?;

    let manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        circuit_version: args.circuit_version,
        k,
        created_at_unix: current_unix_timestamp(),
        params: ArtifactFile::from_bytes(PARAMS_FILENAME, &params_bytes),
        vk: ArtifactFile::from_bytes(VK_FILENAME, &vk_bytes),
        pk: ArtifactFile::from_bytes(PK_FILENAME, &pk_bytes),
    };

    let manifest_path = args.output_dir.join(MANIFEST_FILE);
    write_manifest(&manifest_path, &manifest)?;

    println!(
        "Generated Starknet artifacts for circuit v{} (k={}) at {}",
        manifest.circuit_version,
        manifest.k,
        args.output_dir.display()
    );
    print_artifact_summary(&manifest);
    Ok(())
}

fn gen_orchard_params(args: GenParamsArgs) -> Result<()> {
    fs::create_dir_all(&args.output_dir)
        .with_context(|| format!("failed to create {}", args.output_dir.display()))?;

    // Use Orchard default k (19) if not specified, otherwise use provided k
    let k = if args.k == 19 {
        ORCHARD_DEFAULT_K as u32
    } else {
        args.k
    };

    println!("Generating Zcash Orchard rail circuit artifacts (k={})...", k);
    println!("This circuit has 10 instance columns (V2_ORCHARD layout).");
    println!("This may take several minutes...");

    let keygen_result = orchard_keygen(k);
    let params_bytes = serialize_params(&keygen_result.params)?;
    let vk_bytes = serialize_verifying_key(&keygen_result.vk)?;
    let pk_bytes = serialize_proving_key(&keygen_result.pk)?;
    
    // Serialize break points - these are REQUIRED for proof generation
    let break_points_bytes = serialize_break_points(&keygen_result.break_points)
        .context("failed to serialize break points")?;

    write_binary(args.output_dir.join(PARAMS_FILENAME), &params_bytes)?;
    write_binary(args.output_dir.join(VK_FILENAME), &vk_bytes)?;
    write_binary(args.output_dir.join(PK_FILENAME), &pk_bytes)?;
    write_binary(args.output_dir.join(BREAK_POINTS_FILENAME), &break_points_bytes)?;

    let manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        circuit_version: args.circuit_version,
        k,
        created_at_unix: current_unix_timestamp(),
        params: ArtifactFile::from_bytes(PARAMS_FILENAME, &params_bytes),
        vk: ArtifactFile::from_bytes(VK_FILENAME, &vk_bytes),
        pk: ArtifactFile::from_bytes(PK_FILENAME, &pk_bytes),
    };

    let manifest_path = args.output_dir.join(MANIFEST_FILE);
    write_manifest(&manifest_path, &manifest)?;

    println!(
        "Generated Orchard artifacts for circuit v{} (k={}) at {}",
        manifest.circuit_version,
        manifest.k,
        args.output_dir.display()
    );
    print_artifact_summary(&manifest);
    println!("  break_points.json: {} bytes", break_points_bytes.len());
    println!("\n⚠️  IMPORTANT: break_points.json is REQUIRED for proof generation.");
    println!("    Without it, the prover will panic with 'break points not set'.");
    Ok(())
}

/// Regenerate just the break_points.json file without regenerating params/vk/pk.
/// This is much faster (~30-60 seconds) compared to full keygen (~10+ minutes).
fn gen_break_points_only(args: GenBreakPointsArgs) -> Result<()> {
    use zkpf_common::read_manifest;
    use zkpf_zcash_orchard_circuit::compute_break_points_for_k;

    println!("Regenerating break_points.json only (fast mode)...");
    println!("This runs MockProver to compute break points (~30-60 seconds).\n");

    // Load manifest to get the correct k value (instead of hardcoding)
    let manifest_path = args.output_dir.join(MANIFEST_FILE);
    let manifest = if manifest_path.exists() {
        read_manifest(&manifest_path)
            .context("failed to read manifest - ensure params/vk/pk exist first")?
    } else {
        anyhow::bail!(
            "manifest.json not found at {} - run gen-params first to create artifacts",
            manifest_path.display()
        );
    };

    let k = manifest.k;
    println!("Using k={} from manifest", k);
    println!("Running MockProver (this may consume significant memory)...\n");

    // Compute break points using the public API - this handles MockProver internally
    let break_points = compute_break_points_for_k(k)
        .context("failed to compute break points - this may indicate insufficient memory")?;

    println!("Break points computed successfully");

    let break_points_bytes = serialize_break_points(&break_points)
        .context("failed to serialize break points")?;

    let output_path = args.output_dir.join(BREAK_POINTS_FILENAME);
    write_binary(output_path.clone(), &break_points_bytes)?;

    println!(
        "\n✅ Wrote {} ({} bytes)",
        output_path.display(),
        break_points_bytes.len()
    );
    Ok(())
}

fn print_artifact_summary(manifest: &ArtifactManifest) {
    println!("\nArtifact Summary:");
    println!("  params.bin: {} bytes, blake3: {}", manifest.params.size, manifest.params.blake3);
    println!("  vk.bin: {} bytes, blake3: {}", manifest.vk.size, manifest.vk.blake3);
    println!("  pk.bin: {} bytes, blake3: {}", manifest.pk.size, manifest.pk.blake3);
}

fn dump_params(args: DumpArgs) -> Result<()> {
    let artifacts = load_artifacts(&args.manifest)?;
    let summary = ParamsSummary {
        manifest_path: args.manifest.display().to_string(),
        circuit_version: artifacts.manifest.circuit_version,
        manifest_version: artifacts.manifest.manifest_version,
        params_hash: artifacts.manifest.params.blake3.clone(),
        params_size: artifacts.manifest.params.size,
        k: artifacts.manifest.k,
        n: 1u64 << artifacts.manifest.k,
    };
    output_summary(&summary, args.json)
}

fn dump_vk(args: DumpArgs) -> Result<()> {
    let artifacts = load_artifacts(&args.manifest)?;
    let cs = artifacts.vk.cs();
    let summary = VkSummary {
        manifest_path: args.manifest.display().to_string(),
        circuit_version: artifacts.manifest.circuit_version,
        manifest_version: artifacts.manifest.manifest_version,
        vk_hash: artifacts.manifest.vk.blake3.clone(),
        vk_size: artifacts.manifest.vk.size,
        num_instance_columns: cs.num_instance_columns(),
        num_advice_columns: cs.num_advice_columns(),
        num_fixed_columns: cs.num_fixed_columns(),
        num_selectors: cs.num_selectors(),
        num_gates: cs.gates().len(),
    };
    output_summary(&summary, args.json)
}

fn write_binary(path: PathBuf, bytes: &[u8]) -> Result<()> {
    fs::write(&path, bytes).with_context(|| format!("failed to write {}", path.display()))
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn load_artifacts(path: &PathBuf) -> Result<ProverArtifacts> {
    load_prover_artifacts(path)
        .with_context(|| format!("failed to load manifest {}", path.display()))
}

fn output_summary<T>(summary: &T, json: bool) -> Result<()>
where
    T: Serialize + fmt::Display,
{
    if json {
        println!("{}", serde_json::to_string_pretty(summary)?);
    } else {
        println!("{}", summary);
    }
    Ok(())
}

#[derive(Serialize)]
struct ParamsSummary {
    manifest_path: String,
    circuit_version: u32,
    manifest_version: u32,
    params_hash: String,
    params_size: u64,
    k: u32,
    n: u64,
}

impl fmt::Display for ParamsSummary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "manifest: {}", self.manifest_path)?;
        writeln!(f, "circuit_version: {}", self.circuit_version)?;
        writeln!(f, "manifest_version: {}", self.manifest_version)?;
        writeln!(f, "params_hash: {}", self.params_hash)?;
        writeln!(f, "params_size: {} bytes", self.params_size)?;
        writeln!(f, "k: {}", self.k)?;
        writeln!(f, "n: {}", self.n)
    }
}

#[derive(Serialize)]
struct VkSummary {
    manifest_path: String,
    circuit_version: u32,
    manifest_version: u32,
    vk_hash: String,
    vk_size: u64,
    num_instance_columns: usize,
    num_advice_columns: usize,
    num_fixed_columns: usize,
    num_selectors: usize,
    num_gates: usize,
}

impl fmt::Display for VkSummary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "manifest: {}", self.manifest_path)?;
        writeln!(f, "circuit_version: {}", self.circuit_version)?;
        writeln!(f, "manifest_version: {}", self.manifest_version)?;
        writeln!(f, "vk_hash: {}", self.vk_hash)?;
        writeln!(f, "vk_size: {} bytes", self.vk_size)?;
        writeln!(f, "instance columns: {}", self.num_instance_columns)?;
        writeln!(f, "advice columns: {}", self.num_advice_columns)?;
        writeln!(f, "fixed columns: {}", self.num_fixed_columns)?;
        writeln!(f, "selectors: {}", self.num_selectors)?;
        writeln!(f, "gates: {}", self.num_gates)
    }
}
