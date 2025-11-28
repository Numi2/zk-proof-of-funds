//! Configuration types for the Tachyon wallet.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::types::ChainId;

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Main configuration for the Tachyon wallet.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TachyonConfig {
    /// Wallet data directory.
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,
    
    /// Default network environment.
    #[serde(default)]
    pub network: NetworkEnvironment,
    
    /// Rail configurations.
    #[serde(default)]
    pub rails: HashMap<String, RailConfig>,
    
    /// Axelar transport configuration.
    #[serde(default)]
    pub axelar: AxelarConfig,
    
    /// NEAR agent configuration (optional).
    #[serde(default)]
    pub near_agent: Option<NearAgentConfig>,
    
    /// Privacy settings.
    #[serde(default)]
    pub privacy: PrivacyConfig,
    
    /// Performance tuning.
    #[serde(default)]
    pub performance: PerformanceConfig,
}

fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("tachyon-wallet")
}

impl Default for TachyonConfig {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
            network: NetworkEnvironment::default(),
            rails: default_rails(),
            axelar: AxelarConfig::default(),
            near_agent: None,
            privacy: PrivacyConfig::default(),
            performance: PerformanceConfig::default(),
        }
    }
}

fn default_rails() -> HashMap<String, RailConfig> {
    let mut rails = HashMap::new();
    
    rails.insert("ZCASH_ORCHARD".to_string(), RailConfig {
        rail_id: "ZCASH_ORCHARD".to_string(),
        enabled: true,
        endpoint: ChainEndpoint::Lightwalletd {
            url: "https://mainnet.lightwalletd.com:9067".to_string(),
        },
        capabilities: vec![
            RailCapability::ShieldedBalance,
            RailCapability::PrivateTransfer,
        ],
        priority: 1,
        max_notes: Some(256),
        artifact_path: None,
    });
    
    rails.insert("MINA_RECURSIVE".to_string(), RailConfig {
        rail_id: "MINA_RECURSIVE".to_string(),
        enabled: true,
        endpoint: ChainEndpoint::GraphQL {
            url: "https://graphql.minaexplorer.com".to_string(),
        },
        capabilities: vec![
            RailCapability::RecursiveProof,
            RailCapability::ProofAggregation,
        ],
        priority: 2,
        max_notes: None,
        artifact_path: None,
    });
    
    rails.insert("STARKNET_L2".to_string(), RailConfig {
        rail_id: "STARKNET_L2".to_string(),
        enabled: true,
        endpoint: ChainEndpoint::JsonRpc {
            url: "https://starknet-mainnet.public.blastapi.io".to_string(),
        },
        capabilities: vec![
            RailCapability::DeFiPosition,
            RailCapability::AccountAbstraction,
            RailCapability::SessionKey,
        ],
        priority: 3,
        max_notes: Some(32),
        artifact_path: None,
    });
    
    rails
}

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK ENVIRONMENT
// ═══════════════════════════════════════════════════════════════════════════════

/// Network environment (mainnet vs testnet).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NetworkEnvironment {
    /// Production mainnet.
    #[default]
    Mainnet,
    /// Test networks.
    Testnet,
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAIL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for a single rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RailConfig {
    /// Rail identifier.
    pub rail_id: String,
    /// Whether this rail is enabled.
    #[serde(default = "bool_true")]
    pub enabled: bool,
    /// Chain endpoint configuration.
    pub endpoint: ChainEndpoint,
    /// Capabilities of this rail.
    #[serde(default)]
    pub capabilities: Vec<RailCapability>,
    /// Priority for rail selection (lower = higher priority).
    #[serde(default = "default_priority")]
    pub priority: u32,
    /// Maximum notes/accounts to process.
    pub max_notes: Option<usize>,
    /// Path to circuit artifacts.
    pub artifact_path: Option<PathBuf>,
}

fn bool_true() -> bool {
    true
}

fn default_priority() -> u32 {
    100
}

/// Chain endpoint types.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChainEndpoint {
    /// Zcash lightwalletd gRPC endpoint.
    Lightwalletd { url: String },
    /// JSON-RPC endpoint (Starknet, Ethereum).
    JsonRpc { url: String },
    /// GraphQL endpoint (Mina).
    GraphQL { url: String },
    /// NEAR RPC endpoint.
    NearRpc { url: String },
    /// Mock endpoint for testing.
    Mock,
}

/// Rail capabilities for routing decisions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RailCapability {
    /// Can prove shielded/private balances.
    ShieldedBalance,
    /// Can perform private transfers.
    PrivateTransfer,
    /// Can create recursive proofs.
    RecursiveProof,
    /// Can aggregate multiple proofs.
    ProofAggregation,
    /// Can prove DeFi positions (LP, lending, vaults).
    DeFiPosition,
    /// Supports account abstraction.
    AccountAbstraction,
    /// Supports session keys.
    SessionKey,
    /// Can bridge proofs cross-chain.
    CrossChainBridge,
    /// TEE-backed computation.
    TeeCompute,
}

// ═══════════════════════════════════════════════════════════════════════════════
// AXELAR CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Axelar GMP transport configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AxelarConfig {
    /// Whether Axelar transport is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Gateway contract address.
    pub gateway_address: Option<String>,
    /// Gas service address.
    pub gas_service_address: Option<String>,
    /// Supported destination chains.
    #[serde(default)]
    pub destination_chains: Vec<DestinationChain>,
    /// Default gas limit for GMP calls.
    #[serde(default = "default_gas_limit")]
    pub default_gas_limit: u64,
}

fn default_gas_limit() -> u64 {
    300_000
}

impl Default for AxelarConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            gateway_address: None,
            gas_service_address: None,
            destination_chains: vec![],
            default_gas_limit: default_gas_limit(),
        }
    }
}

/// Destination chain for Axelar GMP.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DestinationChain {
    /// Axelar chain identifier.
    pub chain_name: String,
    /// PoF receiver contract address.
    pub receiver_address: String,
    /// Gas limit override.
    pub gas_limit: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR AGENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// NEAR TEE agent configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NearAgentConfig {
    /// NEAR network.
    pub network: NearNetwork,
    /// NEAR RPC endpoint.
    pub rpc_url: String,
    /// Agent contract account ID.
    pub agent_account_id: String,
    /// TEE enclave configuration.
    pub tee: TeeConfig,
    /// AI model configuration.
    pub ai_model: AiModelConfig,
}

/// NEAR network selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NearNetwork {
    Mainnet,
    Testnet,
}

/// TEE configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeeConfig {
    /// TEE provider (Intel SGX, AMD SEV, etc.).
    pub provider: TeeProvider,
    /// Attestation service URL.
    pub attestation_url: Option<String>,
    /// Required security level.
    #[serde(default)]
    pub security_level: TeeSecurityLevel,
}

/// TEE provider types.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeeProvider {
    IntelSgx,
    AmdSev,
    ArmTrustZone,
    Mock,
}

/// TEE security levels.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeeSecurityLevel {
    /// Full hardware attestation required.
    Strict,
    /// Software attestation acceptable.
    #[default]
    Standard,
    /// No attestation (testing only).
    Permissive,
}

/// AI model configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AiModelConfig {
    /// Model identifier.
    pub model_id: String,
    /// Whether the model runs locally in TEE.
    #[serde(default)]
    pub local: bool,
    /// Maximum tokens per response.
    #[serde(default = "default_max_tokens")]
    pub max_tokens: usize,
    /// Temperature for generation.
    #[serde(default = "default_temperature")]
    pub temperature: f32,
}

fn default_max_tokens() -> usize {
    2048
}

fn default_temperature() -> f32 {
    0.7
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIVACY CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Privacy configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PrivacyConfig {
    /// Minimum time between proofs to prevent timing analysis.
    #[serde(default = "default_min_proof_interval")]
    pub min_proof_interval_secs: u64,
    /// Add random delay to proof generation.
    #[serde(default)]
    pub randomize_timing: bool,
    /// Maximum delay in seconds when randomizing.
    #[serde(default = "default_max_random_delay")]
    pub max_random_delay_secs: u64,
    /// Use tor for network requests.
    #[serde(default)]
    pub use_tor: bool,
    /// Minimum anonymity set size for Zcash proofs.
    #[serde(default = "default_min_anonymity_set")]
    pub min_anonymity_set: usize,
}

fn default_min_proof_interval() -> u64 {
    60
}

fn default_max_random_delay() -> u64 {
    30
}

fn default_min_anonymity_set() -> usize {
    1000
}

impl Default for PrivacyConfig {
    fn default() -> Self {
        Self {
            min_proof_interval_secs: default_min_proof_interval(),
            randomize_timing: false,
            max_random_delay_secs: default_max_random_delay(),
            use_tor: false,
            min_anonymity_set: default_min_anonymity_set(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Performance tuning configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PerformanceConfig {
    /// Number of parallel proof generation threads.
    #[serde(default = "default_parallel_proofs")]
    pub parallel_proofs: usize,
    /// Cache proof parameters in memory.
    #[serde(default = "bool_true")]
    pub cache_params: bool,
    /// Maximum cache size in MB.
    #[serde(default = "default_cache_size")]
    pub max_cache_mb: usize,
    /// Proof generation timeout in seconds.
    #[serde(default = "default_proof_timeout")]
    pub proof_timeout_secs: u64,
}

fn default_parallel_proofs() -> usize {
    num_cpus::get().min(4)
}

fn default_cache_size() -> usize {
    512
}

fn default_proof_timeout() -> u64 {
    300
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            parallel_proofs: default_parallel_proofs(),
            cache_params: true,
            max_cache_mb: default_cache_size(),
            proof_timeout_secs: default_proof_timeout(),
        }
    }
}

// Stub for num_cpus since we don't want to add the dependency
mod num_cpus {
    pub fn get() -> usize {
        std::thread::available_parallelism()
            .map(|p| p.get())
            .unwrap_or(4)
    }
}

