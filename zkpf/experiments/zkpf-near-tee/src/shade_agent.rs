//! NEAR Shade Agent Coordinator for TachyonWallet.
//!
//! This module implements the TachyonWallet coordinator as a NEAR Shade Agent,
//! running in a TEE (Trusted Execution Environment) with the following capabilities:
//!
//! 1. **Key Custody**: Hold user key material for Tachyon Zcash, Starknet, Aztec, etc.
//! 2. **Multichain Signing**: Use NEAR's multichain signature / intents system
//! 3. **Orchestration**: Coordinate PCD updates, bridging, and collateral movement
//! 4. **Private Compute**: All operations happen in a TEE with remote attestation
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                       NEAR Shade Agent (TEE)                                 │
//! ├─────────────────────────────────────────────────────────────────────────────┤
//! │                                                                              │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                   ShadeAgentCoordinator                              │    │
//! │  │                                                                      │    │
//! │  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐ │    │
//! │  │  │  TachyonWallet│  │ ChainKeys    │  │  IntentProcessor          │ │    │
//! │  │  │  (Wrapped)   │  │              │  │                           │ │    │
//! │  │  │              │  │ • Zcash      │  │ • Parse user intents      │ │    │
//! │  │  │ • Rails      │  │ • Starknet   │  │ • Route to appropriate    │ │    │
//! │  │  │ • Proofs     │  │ • Mina       │  │   rail                    │ │    │
//! │  │  │ • Attestation│  │ • Aztec      │  │ • Gas abstraction         │ │    │
//! │  │  └──────────────┘  └──────────────┘  └───────────────────────────┘ │    │
//! │  │                                                                      │    │
//! │  └──────────────────────────────────────────────────────────────────────┘    │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                   NEAR Chain Abstraction Layer                       │    │
//! │  │                                                                      │    │
//! │  │  • Multichain Signatures (MPC signing for external chains)           │    │
//! │  │  • Intent Resolution (convert intents to chain-specific txs)         │    │
//! │  │  • Gas Abstraction (pay in ZEC/stablecoins, settle in native)        │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                                                              │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::agent::{AgentConfig, NearAgent};
use crate::attestation::TeeAttestation;
use crate::crypto::TeeKeyManager;
use crate::error::NearTeeError;
use crate::pcd_keeper::{
    KeeperHandle, KeeperStatus, PcdKeeper, PcdKeeperConfig, PcdKeeperError,
    PcdState as KeeperPcdState, Tachystamp, EpochStrategy,
};
use crate::types::{AgentAction, AgentResponse, KeyType};

// ═══════════════════════════════════════════════════════════════════════════════
// SHADE AGENT ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/// Errors specific to the Shade Agent coordinator.
#[derive(Debug, Error)]
pub enum ShadeAgentError {
    #[error("TEE error: {0}")]
    Tee(#[from] NearTeeError),

    #[error("Chain not supported: {0}")]
    ChainNotSupported(String),

    #[error("Key not found for chain: {0}")]
    KeyNotFound(String),

    #[error("Intent processing failed: {0}")]
    IntentFailed(String),

    #[error("Signing failed: {0}")]
    SigningFailed(String),

    #[error("Gas estimation failed: {0}")]
    GasEstimationFailed(String),

    #[error("Wallet coordinator error: {0}")]
    WalletError(String),

    #[error("Attestation required")]
    AttestationRequired,

    #[error("Not initialized")]
    NotInitialized,

    #[error("PCD Keeper error: {0}")]
    PcdKeeper(#[from] PcdKeeperError),

    #[error("PCD Keeper not started")]
    KeeperNotStarted,
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN KEYS
// ═══════════════════════════════════════════════════════════════════════════════

/// Supported chains for multichain key management.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChainType {
    /// Zcash (Orchard shielded pool).
    Zcash,
    /// Mina Protocol.
    Mina,
    /// Starknet L2.
    Starknet,
    /// Aztec Network.
    Aztec,
    /// Ethereum / EVM chains.
    Ethereum,
    /// NEAR Protocol.
    Near,
    /// Osmosis / Cosmos.
    Cosmos,
}

impl ChainType {
    /// Get the key type required for this chain.
    pub fn key_type(&self) -> KeyType {
        match self {
            ChainType::Zcash => KeyType::Ed25519,     // Zcash uses similar curves
            ChainType::Mina => KeyType::Ed25519,      // Mina uses Pasta curves (similar)
            ChainType::Starknet => KeyType::Secp256k1, // Starknet uses STARK-friendly field
            ChainType::Aztec => KeyType::Ed25519,
            ChainType::Ethereum => KeyType::Secp256k1,
            ChainType::Near => KeyType::Ed25519,
            ChainType::Cosmos => KeyType::Secp256k1,
        }
    }

    /// Get the derivation path prefix for this chain.
    pub fn derivation_prefix(&self) -> &'static str {
        match self {
            ChainType::Zcash => "m/44'/133'",
            ChainType::Mina => "m/44'/12586'",
            ChainType::Starknet => "m/44'/9004'",
            ChainType::Aztec => "m/44'/60'/0'/0", // Uses Ethereum path for now
            ChainType::Ethereum => "m/44'/60'",
            ChainType::Near => "m/44'/397'",
            ChainType::Cosmos => "m/44'/118'",
        }
    }
}

/// Chain-specific key material managed within the TEE.
#[derive(Clone, Debug)]
pub struct ChainKey {
    /// Chain this key is for.
    pub chain: ChainType,
    /// Key identifier in the TEE.
    pub key_id: String,
    /// Public key (safe to expose).
    pub public_key: Vec<u8>,
    /// Chain-specific address derived from public key.
    pub address: String,
    /// Account index in derivation.
    pub account_index: u32,
}

/// Registry of chain keys managed by the Shade Agent.
#[derive(Debug, Default)]
pub struct ChainKeyRegistry {
    /// Keys indexed by chain type.
    keys: HashMap<ChainType, Vec<ChainKey>>,
    /// Primary key for each chain.
    primary_keys: HashMap<ChainType, String>,
}

impl ChainKeyRegistry {
    /// Create a new empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a chain key.
    pub fn register(&mut self, key: ChainKey) {
        let chain = key.chain;
        let key_id = key.key_id.clone();
        
        let keys = self.keys.entry(chain).or_default();
        
        // If this is the first key for this chain, make it primary
        if keys.is_empty() {
            self.primary_keys.insert(chain, key_id.clone());
        }
        
        keys.push(key);
    }

    /// Get the primary key for a chain.
    pub fn primary_key(&self, chain: ChainType) -> Option<&ChainKey> {
        let primary_id = self.primary_keys.get(&chain)?;
        self.keys
            .get(&chain)?
            .iter()
            .find(|k| &k.key_id == primary_id)
    }

    /// Get all keys for a chain.
    pub fn keys_for_chain(&self, chain: ChainType) -> &[ChainKey] {
        self.keys.get(&chain).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Set the primary key for a chain.
    pub fn set_primary(&mut self, chain: ChainType, key_id: String) -> bool {
        if let Some(keys) = self.keys.get(&chain) {
            if keys.iter().any(|k| k.key_id == key_id) {
                self.primary_keys.insert(chain, key_id);
                return true;
            }
        }
        false
    }

    /// Get all registered chains.
    pub fn registered_chains(&self) -> Vec<ChainType> {
        self.keys.keys().copied().collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/// User intent that the Shade Agent can process.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TachyonIntent {
    /// Generate a proof-of-funds attestation.
    GenerateProof {
        /// Policy to satisfy.
        policy_id: u64,
        /// Target chains for the attestation.
        target_chains: Vec<String>,
        /// Preferred rail (optional).
        preferred_rail: Option<String>,
    },

    /// Bridge an attestation to another chain.
    BridgeAttestation {
        /// Attestation ID to bridge.
        attestation_id: [u8; 32],
        /// Destination chain.
        destination: ChainType,
    },

    /// Move collateral between chains (proof transport only, no asset bridging).
    MoveCollateral {
        /// Source chain.
        from: ChainType,
        /// Destination chain.
        to: ChainType,
        /// Amount in base units.
        amount: u128,
        /// Asset type.
        asset: String,
    },

    /// Request PCD update from OSS.
    UpdatePcd {
        /// Wallet identifier.
        wallet_id: [u8; 32],
        /// Force full rescan.
        force_rescan: bool,
    },

    /// Sign a transaction for a specific chain.
    SignTransaction {
        /// Target chain.
        chain: ChainType,
        /// Transaction data (chain-specific encoding).
        tx_data: Vec<u8>,
        /// Account index (uses primary if None).
        account_index: Option<u32>,
    },

    /// Natural language command.
    NaturalLanguage {
        /// User's command.
        command: String,
        /// Current context.
        context: HashMap<String, serde_json::Value>,
    },
}

/// Result of processing an intent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IntentResult {
    /// Proof generation succeeded.
    ProofGenerated {
        /// Proof bundle hash.
        proof_hash: [u8; 32],
        /// Rails used.
        rails_used: Vec<String>,
        /// Attestation ID (if cross-chain).
        attestation_id: Option<[u8; 32]>,
    },

    /// Attestation bridged successfully.
    AttestationBridged {
        /// Destination chain.
        destination: String,
        /// Transaction hash on destination.
        tx_hash: String,
    },

    /// Transaction signed.
    TransactionSigned {
        /// Chain the transaction is for.
        chain: String,
        /// Signed transaction bytes.
        signed_tx: Vec<u8>,
        /// Signature.
        signature: Vec<u8>,
    },

    /// Intent requires clarification.
    ClarificationNeeded {
        /// What needs clarification.
        question: String,
        /// Suggested options.
        options: Vec<String>,
    },

    /// Intent is being processed asynchronously.
    Pending {
        /// Task ID for tracking.
        task_id: String,
        /// Estimated completion time (seconds).
        eta_secs: u64,
    },

    /// Error processing intent.
    Error {
        /// Error message.
        message: String,
        /// Error code.
        code: String,
    },
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAS ABSTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/// Gas payment configuration for chain abstraction.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasConfig {
    /// Token to pay gas with.
    pub payment_token: GasPaymentToken,
    /// Maximum gas price willing to pay (in payment token units).
    pub max_price: u128,
    /// Slippage tolerance for swap (basis points).
    pub slippage_bps: u16,
}

/// Tokens that can be used for gas payment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum GasPaymentToken {
    /// Zcash (ZEC).
    Zec,
    /// USDC stablecoin.
    Usdc,
    /// USDT stablecoin.
    Usdt,
    /// DAI stablecoin.
    Dai,
    /// Native token of target chain (no abstraction).
    Native,
}

impl Default for GasConfig {
    fn default() -> Self {
        Self {
            payment_token: GasPaymentToken::Native,
            max_price: u128::MAX,
            slippage_bps: 100, // 1%
        }
    }
}

/// Estimated gas cost for an operation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasEstimate {
    /// Target chain.
    pub chain: ChainType,
    /// Gas units required.
    pub gas_units: u64,
    /// Price per gas unit in native token.
    pub gas_price_native: u128,
    /// Total cost in native token.
    pub total_native: u128,
    /// Equivalent cost in payment token (if abstracted).
    pub total_payment_token: Option<u128>,
    /// Payment token used.
    pub payment_token: GasPaymentToken,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHADE AGENT COORDINATOR
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for the Shade Agent Coordinator.
#[derive(Clone, Debug)]
pub struct ShadeAgentConfig {
    /// NEAR agent configuration.
    pub near_config: AgentConfig,
    /// Enabled chains for multichain operations.
    pub enabled_chains: Vec<ChainType>,
    /// Default gas configuration.
    pub gas_config: GasConfig,
    /// Enable AI-powered intent parsing.
    pub ai_enabled: bool,
    /// Maximum concurrent operations.
    pub max_concurrent_ops: usize,
    /// PCD Keeper configuration (optional - enables autonomous PCD management).
    pub pcd_keeper_config: Option<PcdKeeperConfig>,
}

impl ShadeAgentConfig {
    /// Create a testnet configuration.
    pub fn testnet(agent_account_id: impl Into<String>) -> Self {
        Self {
            near_config: AgentConfig::testnet(agent_account_id),
            enabled_chains: vec![
                ChainType::Zcash,
                ChainType::Mina,
                ChainType::Starknet,
                ChainType::Near,
            ],
            gas_config: GasConfig::default(),
            ai_enabled: true,
            max_concurrent_ops: 10,
            pcd_keeper_config: Some(PcdKeeperConfig::default()),
        }
    }

    /// Create a mainnet configuration.
    pub fn mainnet(agent_account_id: impl Into<String>) -> Self {
        Self {
            near_config: AgentConfig::mainnet(agent_account_id),
            enabled_chains: vec![
                ChainType::Zcash,
                ChainType::Mina,
                ChainType::Starknet,
                ChainType::Ethereum,
                ChainType::Near,
            ],
            gas_config: GasConfig::default(),
            ai_enabled: true,
            max_concurrent_ops: 20,
            pcd_keeper_config: Some(PcdKeeperConfig {
                min_blocks_behind: 5,      // More aggressive on mainnet
                max_blocks_behind: 50,
                poll_interval_secs: 30,
                auto_submit_tachystamps: true,
                epoch_submission_strategy: EpochStrategy::BatchOptimal,
                auto_attestation_policies: vec![],
                max_gas_budget_per_epoch: 10_000_000_000, // Higher budget for mainnet
                ai_optimization_enabled: true,
                lightwalletd_url: Some("https://mainnet.lightwalletd.com".into()),
                mina_rail_url: Some("https://mina-rail.zkpf.io".into()),
            }),
        }
    }

    /// Create a configuration without PCD keeper (for light clients).
    pub fn without_keeper(agent_account_id: impl Into<String>) -> Self {
        Self {
            near_config: AgentConfig::testnet(agent_account_id),
            enabled_chains: vec![
                ChainType::Zcash,
                ChainType::Mina,
                ChainType::Near,
            ],
            gas_config: GasConfig::default(),
            ai_enabled: false,
            max_concurrent_ops: 5,
            pcd_keeper_config: None,
        }
    }
}

/// The main Shade Agent Coordinator.
///
/// This is the "brain" of the Tachyon wallet, running inside a NEAR TEE.
/// It coordinates:
/// - Proof generation and aggregation across rails
/// - Cross-chain attestation transport
/// - Multichain key management and signing
/// - Gas abstraction for seamless UX
/// - Autonomous PCD state management via the PCD Keeper
pub struct ShadeAgentCoordinator {
    /// Configuration.
    config: ShadeAgentConfig,
    /// Underlying NEAR TEE agent.
    near_agent: NearAgent,
    /// Chain key registry.
    chain_keys: Arc<RwLock<ChainKeyRegistry>>,
    /// TEE key manager for cryptographic operations.
    key_manager: Arc<RwLock<TeeKeyManager>>,
    /// Current TEE attestation.
    attestation: Option<TeeAttestation>,
    /// Whether the coordinator is initialized.
    initialized: bool,
    /// PCD Keeper instance (for autonomous wallet state management).
    pcd_keeper: Option<Arc<PcdKeeper>>,
    /// Handle to the running PCD Keeper (if started).
    keeper_handle: Option<KeeperHandle>,
}

impl ShadeAgentCoordinator {
    /// Create a new Shade Agent Coordinator.
    pub fn new(config: ShadeAgentConfig) -> Result<Self, ShadeAgentError> {
        let near_agent = NearAgent::new(config.near_config.clone())?;
        let key_manager = TeeKeyManager::new(&config.near_config.tee_provider)?;

        // Create PCD Keeper if configured
        let pcd_keeper = config
            .pcd_keeper_config
            .as_ref()
            .map(|keeper_config| Arc::new(PcdKeeper::new(keeper_config.clone())));

        Ok(Self {
            config,
            near_agent,
            chain_keys: Arc::new(RwLock::new(ChainKeyRegistry::new())),
            key_manager: Arc::new(RwLock::new(key_manager)),
            attestation: None,
            initialized: false,
            pcd_keeper,
            keeper_handle: None,
        })
    }

    /// Initialize the coordinator with TEE attestation.
    ///
    /// This must be called before any operations. It:
    /// 1. Generates a TEE attestation
    /// 2. Derives initial keys for enabled chains
    /// 3. Registers the agent on NEAR
    pub async fn initialize(&mut self) -> Result<(), ShadeAgentError> {
        // Initialize the underlying NEAR agent
        self.near_agent.initialize().await?;
        self.attestation = self.near_agent.attestation().cloned();

        // Derive keys for each enabled chain
        for chain in &self.config.enabled_chains {
            self.derive_chain_key(*chain, 0).await?;
        }

        self.initialized = true;

        tracing::info!(
            "ShadeAgentCoordinator initialized with {} chains",
            self.config.enabled_chains.len()
        );

        Ok(())
    }

    /// Check if the coordinator is initialized.
    pub fn is_initialized(&self) -> bool {
        self.initialized
    }

    /// Get the current TEE attestation.
    pub fn attestation(&self) -> Option<&TeeAttestation> {
        self.attestation.as_ref()
    }

    /// Derive a key for a specific chain.
    pub async fn derive_chain_key(
        &self,
        chain: ChainType,
        account_index: u32,
    ) -> Result<ChainKey, ShadeAgentError> {
        let derivation_path = format!("{}/{}'", chain.derivation_prefix(), account_index);
        let key_type = chain.key_type();

        let mut key_manager = self.key_manager.write().await;
        let (public_key, key_id) = key_manager.derive_key(&derivation_path, key_type).await?;

        // Derive chain-specific address from public key
        let address = self.derive_address(chain, &public_key);

        let chain_key = ChainKey {
            chain,
            key_id: key_id.clone(),
            public_key,
            address,
            account_index,
        };

        // Register in the key registry
        let mut registry = self.chain_keys.write().await;
        registry.register(chain_key.clone());

        tracing::info!(
            chain = ?chain,
            account_index = account_index,
            address = %chain_key.address,
            "Derived chain key"
        );

        Ok(chain_key)
    }

    /// Get the primary key for a chain.
    pub async fn get_primary_key(&self, chain: ChainType) -> Option<ChainKey> {
        let registry = self.chain_keys.read().await;
        registry.primary_key(chain).cloned()
    }

    /// Process a Tachyon intent.
    ///
    /// This is the main entry point for user actions. The coordinator:
    /// 1. Parses the intent
    /// 2. Routes to appropriate handler
    /// 3. Executes cross-chain operations as needed
    /// 4. Returns the result
    pub async fn process_intent(
        &mut self,
        intent: TachyonIntent,
    ) -> Result<IntentResult, ShadeAgentError> {
        if !self.initialized {
            return Err(ShadeAgentError::NotInitialized);
        }

        // Verify attestation is still valid
        if let Some(ref attestation) = self.attestation {
            if attestation.is_expired() {
                return Err(ShadeAgentError::AttestationRequired);
            }
        } else {
            return Err(ShadeAgentError::AttestationRequired);
        }

        match intent {
            TachyonIntent::GenerateProof {
                policy_id,
                target_chains,
                preferred_rail,
            } => {
                self.handle_generate_proof(policy_id, target_chains, preferred_rail)
                    .await
            }

            TachyonIntent::BridgeAttestation {
                attestation_id,
                destination,
            } => {
                self.handle_bridge_attestation(attestation_id, destination)
                    .await
            }

            TachyonIntent::MoveCollateral { from, to, amount, asset } => {
                self.handle_move_collateral(from, to, amount, asset).await
            }

            TachyonIntent::UpdatePcd {
                wallet_id,
                force_rescan,
            } => self.handle_update_pcd(wallet_id, force_rescan).await,

            TachyonIntent::SignTransaction {
                chain,
                tx_data,
                account_index,
            } => {
                self.handle_sign_transaction(chain, tx_data, account_index)
                    .await
            }

            TachyonIntent::NaturalLanguage { command, context } => {
                self.handle_natural_language(command, context).await
            }
        }
    }

    /// Sign data for a specific chain.
    pub async fn sign_for_chain(
        &self,
        chain: ChainType,
        data_hash: &[u8; 32],
        account_index: Option<u32>,
    ) -> Result<Vec<u8>, ShadeAgentError> {
        let registry = self.chain_keys.read().await;
        
        let key = if let Some(idx) = account_index {
            registry
                .keys_for_chain(chain)
                .iter()
                .find(|k| k.account_index == idx)
        } else {
            registry.primary_key(chain)
        };

        let key = key.ok_or_else(|| ShadeAgentError::KeyNotFound(format!("{:?}", chain)))?;
        let key_id = key.key_id.clone();
        drop(registry);

        let key_manager = self.key_manager.read().await;
        let signature = key_manager.sign(data_hash, &key_id).await?;

        Ok(signature)
    }

    /// Estimate gas for an operation on a chain.
    ///
    /// # Note
    /// Uses static estimates. In production, integrate with chain RPCs and
    /// price oracles for accurate gas estimation and token conversion.
    pub async fn estimate_gas(
        &self,
        chain: ChainType,
        operation: &str,
        gas_config: Option<GasConfig>,
    ) -> Result<GasEstimate, ShadeAgentError> {
        let config = gas_config.unwrap_or_else(|| self.config.gas_config.clone());

        // Base gas estimates per chain (conservative values for safety margin)
        // TODO: Query chain RPCs for operation-specific estimates
        let (gas_units, gas_price) = match chain {
            ChainType::Zcash => (10_000, 1_000),             // Zcash is cheap
            ChainType::Mina => (5_000, 100_000_000),         // Mina slot-based
            ChainType::Starknet => (100_000, 1_000_000),     // Starknet gas
            ChainType::Ethereum => (21_000, 30_000_000_000), // ~30 gwei
            ChainType::Near => (30_000_000_000_000, 1),      // NEAR gas model
            ChainType::Aztec => (50_000, 10_000),            // Aztec L2
            ChainType::Cosmos => (200_000, 25),              // Cosmos SDK
        };

        let total_native = gas_units as u128 * gas_price;

        // Calculate payment token equivalent if gas abstraction enabled
        let total_payment_token = if config.payment_token != GasPaymentToken::Native {
            // TODO: Integrate with price oracle (e.g., Pyth, Chainlink, RedStone)
            // Current: simple 1:1000 placeholder ratio
            Some(total_native / 1_000)
        } else {
            None
        };

        tracing::debug!(
            ?chain,
            %operation,
            gas_units,
            gas_price,
            total_native,
            ?total_payment_token,
            "Estimated gas for operation"
        );

        Ok(GasEstimate {
            chain,
            gas_units,
            gas_price_native: gas_price,
            total_native,
            total_payment_token,
            payment_token: config.payment_token,
        })
    }

    /// Get all registered chains.
    pub async fn registered_chains(&self) -> Vec<ChainType> {
        let registry = self.chain_keys.read().await;
        registry.registered_chains()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PCD KEEPER MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /// Start the PCD Keeper for autonomous wallet state management.
    ///
    /// The keeper will:
    /// - Monitor chain state and auto-sync PCD when needed
    /// - Queue and submit tachystamps at optimal times
    /// - Generate attestations for configured policies
    ///
    /// Returns a handle for interacting with the running keeper.
    pub async fn start_pcd_keeper(&mut self) -> Result<KeeperHandle, ShadeAgentError> {
        let keeper = self
            .pcd_keeper
            .as_ref()
            .ok_or(ShadeAgentError::WalletError(
                "PCD Keeper not configured. Enable pcd_keeper_config in ShadeAgentConfig.".into(),
            ))?
            .clone();

        if self.keeper_handle.is_some() {
            return Err(ShadeAgentError::WalletError(
                "PCD Keeper already running".into(),
            ));
        }

        let handle = keeper.start().await?;
        self.keeper_handle = Some(handle.clone());

        tracing::info!("PCD Keeper started");
        Ok(handle)
    }

    /// Start the PCD Keeper with existing PCD state.
    ///
    /// Use this when resuming from persisted state.
    pub async fn start_pcd_keeper_with_state(
        &mut self,
        pcd_state: KeeperPcdState,
    ) -> Result<KeeperHandle, ShadeAgentError> {
        let keeper = self
            .pcd_keeper
            .as_ref()
            .ok_or(ShadeAgentError::WalletError(
                "PCD Keeper not configured".into(),
            ))?
            .clone();

        if self.keeper_handle.is_some() {
            return Err(ShadeAgentError::WalletError(
                "PCD Keeper already running".into(),
            ));
        }

        // Initialize with existing state
        keeper.initialize_with_state(pcd_state).await?;

        let handle = keeper.start().await?;
        self.keeper_handle = Some(handle.clone());

        tracing::info!("PCD Keeper started with existing state");
        Ok(handle)
    }

    /// Stop the PCD Keeper.
    pub async fn stop_pcd_keeper(&mut self) -> Result<(), ShadeAgentError> {
        if let Some(handle) = self.keeper_handle.take() {
            handle.stop().await?;
            tracing::info!("PCD Keeper stopped");
        }
        Ok(())
    }

    /// Get the current PCD Keeper status.
    pub async fn get_keeper_status(&self) -> Result<KeeperStatus, ShadeAgentError> {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        Ok(handle.status().await)
    }

    /// Request an immediate PCD sync.
    ///
    /// Useful when the user knows new transactions have occurred.
    pub async fn request_pcd_sync(&self) -> Result<(), ShadeAgentError> {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        handle.request_sync().await?;
        Ok(())
    }

    /// Queue a tachystamp for submission to Mina Rail.
    ///
    /// The keeper will submit at the optimal time based on the epoch strategy.
    pub async fn queue_tachystamp(
        &self,
        tachystamp: Tachystamp,
        priority: u32,
    ) -> Result<(), ShadeAgentError> {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        handle.queue_tachystamp(tachystamp, priority).await?;
        Ok(())
    }

    /// Flush all pending tachystamps immediately.
    ///
    /// Use when you need attestations submitted before the natural epoch timing.
    pub async fn flush_tachystamps(&self) -> Result<(), ShadeAgentError> {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        handle.flush_tachystamps().await?;
        Ok(())
    }

    /// Update the PCD Keeper configuration at runtime.
    pub async fn update_keeper_config(
        &self,
        config: PcdKeeperConfig,
    ) -> Result<(), ShadeAgentError> {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        handle.update_config(config).await?;
        Ok(())
    }

    /// Check if the PCD Keeper is running.
    pub fn is_keeper_running(&self) -> bool {
        self.keeper_handle.is_some()
    }

    /// Get the current PCD state from the keeper.
    pub async fn get_pcd_state(&self) -> Result<Option<KeeperPcdState>, ShadeAgentError> {
        let keeper = self
            .pcd_keeper
            .as_ref()
            .ok_or(ShadeAgentError::WalletError(
                "PCD Keeper not configured".into(),
            ))?;

        Ok(keeper.get_pcd_state().await)
    }

    /// Subscribe to keeper events.
    ///
    /// Returns a broadcast receiver that will receive all keeper events.
    pub fn subscribe_keeper_events(
        &self,
    ) -> Result<tokio::sync::broadcast::Receiver<crate::pcd_keeper::KeeperEvent>, ShadeAgentError>
    {
        let handle = self
            .keeper_handle
            .as_ref()
            .ok_or(ShadeAgentError::KeeperNotStarted)?;

        Ok(handle.subscribe())
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTENT HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    async fn handle_generate_proof(
        &mut self,
        policy_id: u64,
        target_chains: Vec<String>,
        preferred_rail: Option<String>,
    ) -> Result<IntentResult, ShadeAgentError> {
        // In production, this would call TachyonWallet.prove()
        // For now, return a placeholder result
        
        let proof_hash = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"shade_agent_proof");
            hasher.update(&policy_id.to_le_bytes());
            hasher.update(&current_timestamp().to_le_bytes());
            *hasher.finalize().as_bytes()
        };

        let rails_used = preferred_rail
            .map(|r| vec![r])
            .unwrap_or_else(|| vec!["ZCASH_ORCHARD".to_string()]);

        let attestation_id = if !target_chains.is_empty() {
            Some(proof_hash) // Same as proof hash for simplicity
        } else {
            None
        };

        tracing::info!(
            policy_id = policy_id,
            rails = ?rails_used,
            targets = ?target_chains,
            "Generated proof via Shade Agent"
        );

        Ok(IntentResult::ProofGenerated {
            proof_hash,
            rails_used,
            attestation_id,
        })
    }

    async fn handle_bridge_attestation(
        &self,
        attestation_id: [u8; 32],
        destination: ChainType,
    ) -> Result<IntentResult, ShadeAgentError> {
        // In production, this would use Axelar GMP
        let tx_hash = format!(
            "0x{}",
            hex::encode(&attestation_id[..16])
        );

        Ok(IntentResult::AttestationBridged {
            destination: format!("{:?}", destination),
            tx_hash,
        })
    }

    async fn handle_move_collateral(
        &self,
        from: ChainType,
        to: ChainType,
        amount: u128,
        asset: String,
    ) -> Result<IntentResult, ShadeAgentError> {
        // Proof transport only - no actual asset bridging
        // This would coordinate with Mina recursive rail for attestation

        tracing::info!(
            from = ?from,
            to = ?to,
            amount = amount,
            asset = %asset,
            "Initiating proof-based collateral movement"
        );

        Ok(IntentResult::Pending {
            task_id: format!("collateral-{}", current_timestamp()),
            eta_secs: 300, // ~5 minutes
        })
    }

    async fn handle_update_pcd(
        &self,
        wallet_id: [u8; 32],
        force_rescan: bool,
    ) -> Result<IntentResult, ShadeAgentError> {
        tracing::info!(
            wallet_id = %hex::encode(&wallet_id[..8]),
            force_rescan = force_rescan,
            "Requesting PCD update"
        );

        // If the keeper is running, trigger a sync through it
        if let Some(ref handle) = self.keeper_handle {
            handle.request_sync().await?;
            
            // Get status to estimate completion
            let status = handle.status().await;
            let eta_secs = if force_rescan {
                600 // Full rescan takes longer
            } else {
                // Estimate based on blocks behind
                (status.blocks_behind * 2).max(30) // ~2 sec per block, min 30 sec
            };

            return Ok(IntentResult::Pending {
                task_id: format!("pcd-sync-{}", current_timestamp()),
                eta_secs,
            });
        }

        // Fallback for when keeper is not running
        Ok(IntentResult::Pending {
            task_id: format!("pcd-update-{}", current_timestamp()),
            eta_secs: if force_rescan { 600 } else { 60 },
        })
    }

    async fn handle_sign_transaction(
        &self,
        chain: ChainType,
        tx_data: Vec<u8>,
        account_index: Option<u32>,
    ) -> Result<IntentResult, ShadeAgentError> {
        // Hash the transaction data
        let tx_hash: [u8; 32] = *blake3::hash(&tx_data).as_bytes();

        // Sign with the appropriate chain key
        let signature = self.sign_for_chain(chain, &tx_hash, account_index).await?;

        // Construct signed transaction (chain-specific encoding would go here)
        let mut signed_tx = tx_data.clone();
        signed_tx.extend_from_slice(&signature);

        Ok(IntentResult::TransactionSigned {
            chain: format!("{:?}", chain),
            signed_tx,
            signature,
        })
    }

    async fn handle_natural_language(
        &mut self,
        command: String,
        context: HashMap<String, serde_json::Value>,
    ) -> Result<IntentResult, ShadeAgentError> {
        if !self.config.ai_enabled {
            return Ok(IntentResult::Error {
                message: "AI processing is not enabled".into(),
                code: "AI_DISABLED".into(),
            });
        }

        // Use the underlying NEAR agent for intent parsing
        let intent_context = crate::types::IntentContext {
            available_actions: vec![
                "generate_proof".into(),
                "bridge_attestation".into(),
                "sign_transaction".into(),
                "update_pcd".into(),
            ],
            current_mode: context
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("default")
                .to_string(),
            recent_action_types: vec![],
        };

        let action = AgentAction::ParseIntent {
            input: command,
            context: intent_context,
        };

        let response = self.near_agent.execute(action).await?;

        match response {
            AgentResponse::ParsedIntent {
                action: Some(parsed),
                confidence,
                ..
            } => {
                if confidence > 0.7 {
                    // Handle parsed action directly to avoid recursive async call
                    match parsed.action_type.as_str() {
                        "generate_proof" => {
                            let policy_id = parsed
                                .params
                                .get("policy_id")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(1);
                            return self
                                .handle_generate_proof(policy_id, vec![], None)
                                .await;
                        }
                        "sign_transaction" => {
                            let chain_str = parsed
                                .params
                                .get("chain")
                                .and_then(|v| v.as_str())
                                .unwrap_or("near");
                            let chain = match chain_str {
                                "zcash" => ChainType::Zcash,
                                "mina" => ChainType::Mina,
                                "starknet" => ChainType::Starknet,
                                "ethereum" => ChainType::Ethereum,
                                _ => ChainType::Near,
                            };
                            return self
                                .handle_sign_transaction(chain, vec![], None)
                                .await;
                        }
                        _ => {}
                    }
                }

                Ok(IntentResult::ClarificationNeeded {
                    question: "I understood your request but need more details.".into(),
                    options: vec![
                        "Generate a proof of funds".into(),
                        "Bridge attestation to another chain".into(),
                        "Sign a transaction".into(),
                    ],
                })
            }
            AgentResponse::ParsedIntent {
                clarification_needed: Some(question),
                ..
            } => Ok(IntentResult::ClarificationNeeded {
                question,
                options: vec![],
            }),
            _ => Ok(IntentResult::Error {
                message: "Could not parse intent".into(),
                code: "PARSE_FAILED".into(),
            }),
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    fn derive_address(&self, chain: ChainType, public_key: &[u8]) -> String {
        let hash = blake3::hash(public_key);
        let hash_bytes = hash.as_bytes();

        match chain {
            ChainType::Zcash => {
                // Zcash unified address format (simplified)
                format!("u1{}", base58_encode(&hash_bytes[..20]))
            }
            ChainType::Mina => {
                // Mina base58check address
                format!("B62q{}", base58_encode(&hash_bytes[..20]))
            }
            ChainType::Starknet => {
                // Starknet hex address
                format!("0x{}", hex::encode(&hash_bytes[..20]))
            }
            ChainType::Ethereum | ChainType::Aztec => {
                // Ethereum checksum address
                format!("0x{}", hex::encode(&hash_bytes[..20]))
            }
            ChainType::Near => {
                // NEAR implicit account
                hex::encode(&hash_bytes[..32])
            }
            ChainType::Cosmos => {
                // Cosmos bech32 address
                format!("cosmos1{}", base58_encode(&hash_bytes[..20]))
            }
        }
    }

    /// Convert a parsed action to a TachyonIntent.
    /// Useful for programmatic intent construction.
    #[allow(dead_code)]
    fn parsed_action_to_intent(
        &self,
        parsed: &crate::types::ParsedAction,
    ) -> Option<TachyonIntent> {
        match parsed.action_type.as_str() {
            "generate_proof" => {
                let policy_id = parsed
                    .params
                    .get("policy_id")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1);
                
                Some(TachyonIntent::GenerateProof {
                    policy_id,
                    target_chains: vec![],
                    preferred_rail: None,
                })
            }
            "sign_transaction" => {
                let chain_str = parsed
                    .params
                    .get("chain")
                    .and_then(|v| v.as_str())
                    .unwrap_or("near");
                
                let chain = match chain_str {
                    "zcash" => ChainType::Zcash,
                    "mina" => ChainType::Mina,
                    "starknet" => ChainType::Starknet,
                    "ethereum" => ChainType::Ethereum,
                    _ => ChainType::Near,
                };

                Some(TachyonIntent::SignTransaction {
                    chain,
                    tx_data: vec![],
                    account_index: None,
                })
            }
            _ => None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs()
}

fn base58_encode(bytes: &[u8]) -> String {
    // Simplified base58 (not Bitcoin's base58check)
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    
    let mut result = String::new();
    let mut num = bytes.iter().fold(0u128, |acc, &b| acc * 256 + b as u128);
    
    while num > 0 {
        result.push(ALPHABET[(num % 58) as usize] as char);
        num /= 58;
    }
    
    result.chars().rev().collect()
}

mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chain_key_registry() {
        let mut registry = ChainKeyRegistry::new();

        let key = ChainKey {
            chain: ChainType::Zcash,
            key_id: "zcash-0".to_string(),
            public_key: vec![1, 2, 3],
            address: "u1abc123".to_string(),
            account_index: 0,
        };

        registry.register(key.clone());

        assert!(registry.primary_key(ChainType::Zcash).is_some());
        assert_eq!(
            registry.primary_key(ChainType::Zcash).unwrap().key_id,
            "zcash-0"
        );
    }

    #[test]
    fn test_chain_type_derivation_paths() {
        assert_eq!(ChainType::Zcash.derivation_prefix(), "m/44'/133'");
        assert_eq!(ChainType::Mina.derivation_prefix(), "m/44'/12586'");
        assert_eq!(ChainType::Ethereum.derivation_prefix(), "m/44'/60'");
    }

    #[test]
    fn test_gas_config_default() {
        let config = GasConfig::default();
        assert!(matches!(config.payment_token, GasPaymentToken::Native));
        assert_eq!(config.slippage_bps, 100);
    }

    #[tokio::test]
    async fn test_shade_agent_config() {
        let config = ShadeAgentConfig::testnet("test-agent.testnet");
        assert_eq!(config.enabled_chains.len(), 4);
        assert!(config.ai_enabled);
    }
}

