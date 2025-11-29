//! NEAR Chain Abstraction Layer for Tachyon.
//!
//! This module implements NEAR's Chain Abstraction Framework, providing:
//!
//! 1. **Unified Account**: Single Tachyon account that controls assets on multiple chains
//! 2. **Multichain Signing**: MPC-based signatures for external chains (Zcash, Mina, Starknet)
//! 3. **Intent Resolution**: Convert user intents into chain-specific transactions
//! 4. **Gas Abstraction**: Pay gas in ZEC/USDC, settle in native tokens
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                        NEAR Chain Abstraction                                │
//! ├─────────────────────────────────────────────────────────────────────────────┤
//! │                                                                              │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                      Intent Layer                                    │    │
//! │  │                                                                      │    │
//! │  │  User Intent ──► Intent Resolution ──► Chain-Specific TX            │    │
//! │  │                                                                      │    │
//! │  │  Examples:                                                           │    │
//! │  │  • "Prove I have 1 ZEC" → Zcash Orchard proof + Mina aggregation    │    │
//! │  │  • "Bridge attestation to Starknet" → Axelar GMP message            │    │
//! │  │  • "Sign Mina zkApp tx" → Multichain signature request              │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                   Multichain Signature Layer                         │    │
//! │  │                                                                      │    │
//! │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
//! │  │  │   MPC Signer │  │  Key Manager │  │  Signature Aggregator   │  │    │
//! │  │  │              │  │              │  │                         │  │    │
//! │  │  │ • Ed25519    │  │ • Derivation │  │ • Collect MPC shares   │  │    │
//! │  │  │ • Secp256k1  │  │ • Rotation   │  │ • Combine signatures   │  │    │
//! │  │  │ • ECDSA      │  │ • Backup     │  │ • Verify before relay  │  │    │
//! │  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                     Gas Abstraction Layer                            │    │
//! │  │                                                                      │    │
//! │  │  User pays in:     ZEC, USDC, USDT, DAI                             │    │
//! │  │  System handles:   Swap to native token, pay gas, relay tx          │    │
//! │  │  Settlement:       Via DEX aggregator (Ref Finance, Osmosis)        │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                                                              │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;

use crate::shade_agent::ChainType;
use crate::types::AccountId;

// ═══════════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/// Errors from the chain abstraction layer.
#[derive(Debug, Error)]
pub enum ChainAbstractionError {
    #[error("Intent resolution failed: {0}")]
    IntentResolutionFailed(String),

    #[error("MPC signing failed: {0}")]
    MpcSigningFailed(String),

    #[error("Chain not supported: {0}")]
    ChainNotSupported(String),

    #[error("Gas payment failed: {0}")]
    GasPaymentFailed(String),

    #[error("Insufficient balance for gas: need {need}, have {have}")]
    InsufficientGasBalance { need: u128, have: u128 },

    #[error("Transaction relay failed: {0}")]
    RelayFailed(String),

    #[error("Signature aggregation failed: {0}")]
    SignatureAggregationFailed(String),

    #[error("Key derivation failed: {0}")]
    KeyDerivationFailed(String),

    #[error("Price oracle unavailable")]
    PriceOracleUnavailable,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════

/// A unified Tachyon account that controls assets across multiple chains.
///
/// This account is anchored on NEAR but can sign transactions for:
/// - Zcash (via relayer)
/// - Mina (direct signing)
/// - Starknet (via multichain signature)
/// - Ethereum/EVM chains (via MPC)
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnifiedAccount {
    /// NEAR account ID (the anchor).
    pub near_account: AccountId,
    /// Chain-specific addresses derived from this account.
    pub chain_addresses: HashMap<ChainType, ChainAddress>,
    /// Creation timestamp.
    pub created_at: u64,
    /// Last activity timestamp.
    pub last_activity: u64,
}

/// Address on a specific chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainAddress {
    /// Chain type.
    pub chain: ChainType,
    /// Address string (chain-specific format).
    pub address: String,
    /// Public key used to derive this address.
    pub public_key: Vec<u8>,
    /// Derivation path used.
    pub derivation_path: String,
    /// Whether this address has been used.
    pub is_used: bool,
}

impl UnifiedAccount {
    /// Create a new unified account.
    pub fn new(near_account: AccountId) -> Self {
        Self {
            near_account,
            chain_addresses: HashMap::new(),
            created_at: current_timestamp(),
            last_activity: current_timestamp(),
        }
    }

    /// Get address for a chain.
    pub fn address_for(&self, chain: ChainType) -> Option<&ChainAddress> {
        self.chain_addresses.get(&chain)
    }

    /// Register a new chain address.
    pub fn register_address(&mut self, address: ChainAddress) {
        self.chain_addresses.insert(address.chain, address);
        self.last_activity = current_timestamp();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/// A cross-chain intent that the abstraction layer can resolve.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CrossChainIntent {
    /// Transfer assets (via proof, not actual bridging).
    TransferProof {
        /// Source chain.
        from_chain: ChainType,
        /// Destination chain.
        to_chain: ChainType,
        /// Amount to prove.
        amount: u128,
        /// Asset type.
        asset: String,
    },

    /// Execute a transaction on a chain.
    ExecuteTransaction {
        /// Target chain.
        chain: ChainType,
        /// Transaction data (chain-specific encoding).
        tx_data: Vec<u8>,
        /// Maximum gas to use.
        max_gas: u64,
        /// Gas payment token.
        gas_token: GasToken,
    },

    /// Deploy a contract/zkApp on a chain.
    Deploy {
        /// Target chain.
        chain: ChainType,
        /// Contract bytecode.
        bytecode: Vec<u8>,
        /// Constructor arguments.
        constructor_args: Vec<u8>,
    },

    /// Verify and relay an attestation.
    RelayAttestation {
        /// Source chain where attestation was created.
        source_chain: ChainType,
        /// Destination chain(s) for the attestation.
        target_chains: Vec<ChainType>,
        /// Attestation ID.
        attestation_id: [u8; 32],
    },

    /// Swap tokens (for gas payment).
    Swap {
        /// Token to swap from.
        from_token: String,
        /// Token to swap to.
        to_token: String,
        /// Amount to swap.
        amount: u128,
        /// Minimum output amount.
        min_output: u128,
    },
}

/// Result of resolving an intent.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IntentResolution {
    /// Original intent.
    pub intent_id: [u8; 32],
    /// Resolved transactions to execute.
    pub transactions: Vec<ResolvedTransaction>,
    /// Total gas cost estimate.
    pub total_gas_cost: GasCostEstimate,
    /// Expected completion time (seconds).
    pub eta_secs: u64,
    /// Any warnings or notes.
    pub warnings: Vec<String>,
}

/// A resolved transaction ready for signing.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResolvedTransaction {
    /// Transaction ID.
    pub tx_id: [u8; 32],
    /// Target chain.
    pub chain: ChainType,
    /// Transaction data (chain-specific encoding).
    pub tx_data: Vec<u8>,
    /// Gas limit.
    pub gas_limit: u64,
    /// Gas price (in native token base units).
    pub gas_price: u128,
    /// Execution order (lower = earlier).
    pub order: u32,
    /// Dependencies (tx_ids that must complete first).
    pub dependencies: Vec<[u8; 32]>,
}

/// Gas cost estimate.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasCostEstimate {
    /// Total gas units.
    pub gas_units: u64,
    /// Cost in native token.
    pub native_cost: u128,
    /// Cost in payment token.
    pub payment_token_cost: u128,
    /// Payment token used.
    pub payment_token: GasToken,
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAS ABSTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/// Tokens that can be used for gas payment.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum GasToken {
    /// Native token of target chain.
    Native,
    /// Zcash (ZEC).
    Zec,
    /// USDC stablecoin.
    Usdc,
    /// USDT stablecoin.
    Usdt,
    /// DAI stablecoin.
    Dai,
    /// NEAR token.
    Near,
    /// Wrapped ETH.
    Weth,
}

impl Default for GasToken {
    fn default() -> Self {
        Self::Native
    }
}

/// Gas abstraction configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasAbstractionConfig {
    /// Enabled payment tokens.
    pub enabled_tokens: Vec<GasToken>,
    /// Default payment token.
    pub default_token: GasToken,
    /// Slippage tolerance for swaps (basis points).
    pub slippage_bps: u16,
    /// Maximum gas price multiplier (for fast execution).
    pub max_gas_multiplier: f64,
    /// Price oracle endpoint.
    pub price_oracle_url: Option<String>,
    /// DEX aggregator to use for swaps.
    pub dex_aggregator: DexAggregator,
}

impl Default for GasAbstractionConfig {
    fn default() -> Self {
        Self {
            enabled_tokens: vec![
                GasToken::Native,
                GasToken::Zec,
                GasToken::Usdc,
                GasToken::Near,
            ],
            default_token: GasToken::Native,
            slippage_bps: 50, // 0.5%
            max_gas_multiplier: 1.5,
            price_oracle_url: None,
            dex_aggregator: DexAggregator::RefFinance,
        }
    }
}

/// DEX aggregator options.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DexAggregator {
    /// Ref Finance (NEAR native).
    RefFinance,
    /// Osmosis (Cosmos).
    Osmosis,
    /// 1inch (EVM).
    OneInch,
    /// Custom aggregator.
    Custom { endpoint: String },
}

/// Gas payment request.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasPaymentRequest {
    /// Target chain for the transaction.
    pub target_chain: ChainType,
    /// Gas units needed.
    pub gas_units: u64,
    /// Token to pay with.
    pub payment_token: GasToken,
    /// User's address for the payment token.
    pub payer_address: String,
    /// Maximum amount willing to pay.
    pub max_payment: u128,
}

/// Gas payment result.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GasPaymentResult {
    /// Whether payment was successful.
    pub success: bool,
    /// Amount paid in payment token.
    pub amount_paid: u128,
    /// Native gas acquired.
    pub gas_acquired: u64,
    /// Swap transaction hash (if applicable).
    pub swap_tx_hash: Option<String>,
    /// Refund amount (if overpaid).
    pub refund_amount: u128,
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTICHAIN SIGNATURE
// ═══════════════════════════════════════════════════════════════════════════════

/// MPC signature request for external chains.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MultichainSignatureRequest {
    /// Request ID.
    pub request_id: [u8; 32],
    /// Target chain.
    pub chain: ChainType,
    /// Data to sign (usually a transaction hash).
    pub sign_data: [u8; 32],
    /// Derivation path for the key.
    pub derivation_path: String,
    /// Signature scheme.
    pub signature_scheme: SignatureScheme,
    /// Requester's NEAR account.
    pub requester: AccountId,
    /// Timestamp.
    pub timestamp: u64,
}

/// Signature schemes supported by the MPC network.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureScheme {
    /// ECDSA with secp256k1 (Ethereum, Starknet).
    EcdsaSecp256k1,
    /// EdDSA with Ed25519 (NEAR, Mina, Zcash-like).
    EddsaEd25519,
    /// Schnorr with secp256k1 (Bitcoin Taproot).
    SchnorrSecp256k1,
}

impl SignatureScheme {
    /// Get the expected signature length.
    pub fn signature_length(&self) -> usize {
        match self {
            Self::EcdsaSecp256k1 => 65, // r (32) + s (32) + v (1)
            Self::EddsaEd25519 => 64,   // R (32) + s (32)
            Self::SchnorrSecp256k1 => 64,
        }
    }
}

/// Result of a multichain signature request.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MultichainSignatureResult {
    /// Request ID.
    pub request_id: [u8; 32],
    /// Signature bytes.
    pub signature: Vec<u8>,
    /// Public key used for signing.
    pub public_key: Vec<u8>,
    /// Recovery ID (for ECDSA).
    pub recovery_id: Option<u8>,
    /// MPC signature metadata.
    pub mpc_metadata: MpcMetadata,
}

/// Metadata about the MPC signing process.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MpcMetadata {
    /// Number of MPC participants.
    pub participants: u32,
    /// Threshold required.
    pub threshold: u32,
    /// Round-trip time in milliseconds.
    pub rtt_ms: u64,
    /// MPC protocol version.
    pub protocol_version: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN ABSTRACTION SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

/// The main chain abstraction service.
pub struct ChainAbstractionService {
    /// Configuration.
    config: ChainAbstractionConfig,
    /// Unified accounts registry.
    accounts: Arc<RwLock<HashMap<String, UnifiedAccount>>>,
    /// Pending signature requests.
    pending_signatures: Arc<RwLock<HashMap<[u8; 32], MultichainSignatureRequest>>>,
    /// Price cache (token -> USD price).
    price_cache: Arc<RwLock<HashMap<GasToken, f64>>>,
    /// Transaction queue.
    tx_queue: Arc<RwLock<Vec<ResolvedTransaction>>>,
}

/// Configuration for the chain abstraction service.
#[derive(Clone, Debug)]
pub struct ChainAbstractionConfig {
    /// NEAR RPC endpoint.
    pub near_rpc_url: String,
    /// Gas abstraction config.
    pub gas_config: GasAbstractionConfig,
    /// Supported chains.
    pub supported_chains: Vec<ChainType>,
    /// MPC service endpoint.
    pub mpc_endpoint: Option<String>,
    /// Maximum pending transactions.
    pub max_pending_txs: usize,
}

impl Default for ChainAbstractionConfig {
    fn default() -> Self {
        Self {
            near_rpc_url: "https://rpc.mainnet.near.org".to_string(),
            gas_config: GasAbstractionConfig::default(),
            supported_chains: vec![
                ChainType::Near,
                ChainType::Zcash,
                ChainType::Mina,
                ChainType::Starknet,
                ChainType::Ethereum,
            ],
            mpc_endpoint: None,
            max_pending_txs: 100,
        }
    }
}

impl ChainAbstractionService {
    /// Create a new chain abstraction service.
    pub fn new(config: ChainAbstractionConfig) -> Self {
        Self {
            config,
            accounts: Arc::new(RwLock::new(HashMap::new())),
            pending_signatures: Arc::new(RwLock::new(HashMap::new())),
            price_cache: Arc::new(RwLock::new(HashMap::new())),
            tx_queue: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Register or get a unified account.
    pub async fn get_or_create_account(
        &self,
        near_account: AccountId,
    ) -> Result<UnifiedAccount, ChainAbstractionError> {
        let mut accounts = self.accounts.write().await;
        
        if let Some(account) = accounts.get(near_account.as_str()) {
            return Ok(account.clone());
        }

        let account = UnifiedAccount::new(near_account.clone());
        accounts.insert(near_account.as_str().to_string(), account.clone());
        
        Ok(account)
    }

    /// Resolve a cross-chain intent into executable transactions.
    pub async fn resolve_intent(
        &self,
        intent: CrossChainIntent,
        account: &UnifiedAccount,
    ) -> Result<IntentResolution, ChainAbstractionError> {
        let intent_id = self.compute_intent_id(&intent);

        match intent {
            CrossChainIntent::TransferProof {
                from_chain,
                to_chain,
                amount,
                asset,
            } => {
                self.resolve_transfer_proof(intent_id, from_chain, to_chain, amount, asset)
                    .await
            }

            CrossChainIntent::ExecuteTransaction {
                chain,
                tx_data,
                max_gas,
                gas_token,
            } => {
                self.resolve_execute_transaction(intent_id, chain, tx_data, max_gas, gas_token)
                    .await
            }

            CrossChainIntent::RelayAttestation {
                source_chain,
                target_chains,
                attestation_id,
            } => {
                self.resolve_relay_attestation(
                    intent_id,
                    source_chain,
                    target_chains,
                    attestation_id,
                )
                .await
            }

            CrossChainIntent::Swap {
                from_token,
                to_token,
                amount,
                min_output,
            } => {
                self.resolve_swap(intent_id, from_token, to_token, amount, min_output)
                    .await
            }

            CrossChainIntent::Deploy {
                chain,
                bytecode,
                constructor_args,
            } => {
                self.resolve_deploy(intent_id, chain, bytecode, constructor_args)
                    .await
            }
        }
    }

    /// Request a multichain signature.
    pub async fn request_signature(
        &self,
        chain: ChainType,
        sign_data: [u8; 32],
        derivation_path: String,
        requester: AccountId,
    ) -> Result<MultichainSignatureRequest, ChainAbstractionError> {
        // Determine signature scheme based on chain
        let signature_scheme = match chain {
            ChainType::Ethereum | ChainType::Starknet | ChainType::Cosmos => {
                SignatureScheme::EcdsaSecp256k1
            }
            ChainType::Near | ChainType::Mina | ChainType::Zcash | ChainType::Aztec => {
                SignatureScheme::EddsaEd25519
            }
        };

        let request_id = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"multichain_sig_request");
            hasher.update(&sign_data);
            hasher.update(derivation_path.as_bytes());
            hasher.update(&current_timestamp().to_le_bytes());
            *hasher.finalize().as_bytes()
        };

        let request = MultichainSignatureRequest {
            request_id,
            chain,
            sign_data,
            derivation_path,
            signature_scheme,
            requester,
            timestamp: current_timestamp(),
        };

        // Store pending request
        let mut pending = self.pending_signatures.write().await;
        pending.insert(request_id, request.clone());

        Ok(request)
    }

    /// Execute a signature request (in production, calls MPC network).
    pub async fn execute_signature(
        &self,
        request: &MultichainSignatureRequest,
    ) -> Result<MultichainSignatureResult, ChainAbstractionError> {
        // In production, this would:
        // 1. Submit request to MPC network (e.g., NEAR MPC service)
        // 2. Wait for threshold signatures from MPC nodes
        // 3. Aggregate and return the signature

        // For now, return a mock signature
        let signature = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"mock_signature");
            hasher.update(&request.sign_data);
            hasher.update(&request.timestamp.to_le_bytes());
            hasher.finalize().as_bytes().to_vec()
        };

        let public_key = {
            let mut hasher = blake3::Hasher::new();
            hasher.update(b"mock_pubkey");
            hasher.update(request.derivation_path.as_bytes());
            hasher.finalize().as_bytes().to_vec()
        };

        // Remove from pending
        let mut pending = self.pending_signatures.write().await;
        pending.remove(&request.request_id);

        Ok(MultichainSignatureResult {
            request_id: request.request_id,
            signature,
            public_key,
            recovery_id: Some(0),
            mpc_metadata: MpcMetadata {
                participants: 5,
                threshold: 3,
                rtt_ms: 500,
                protocol_version: "1.0.0".to_string(),
            },
        })
    }

    /// Estimate gas payment in a specific token.
    pub async fn estimate_gas_payment(
        &self,
        request: &GasPaymentRequest,
    ) -> Result<GasCostEstimate, ChainAbstractionError> {
        // Get gas price for target chain
        let (gas_price, native_decimals) = self.get_gas_price(request.target_chain).await?;
        let native_cost = request.gas_units as u128 * gas_price;

        // If paying with native token, no conversion needed
        if request.payment_token == GasToken::Native {
            return Ok(GasCostEstimate {
                gas_units: request.gas_units,
                native_cost,
                payment_token_cost: native_cost,
                payment_token: request.payment_token.clone(),
            });
        }

        // Get price conversion
        let payment_token_cost =
            self.convert_to_payment_token(native_cost, request.target_chain, &request.payment_token)
                .await?;

        Ok(GasCostEstimate {
            gas_units: request.gas_units,
            native_cost,
            payment_token_cost,
            payment_token: request.payment_token.clone(),
        })
    }

    /// Process gas payment.
    pub async fn process_gas_payment(
        &self,
        request: GasPaymentRequest,
    ) -> Result<GasPaymentResult, ChainAbstractionError> {
        let estimate = self.estimate_gas_payment(&request).await?;

        if estimate.payment_token_cost > request.max_payment {
            return Err(ChainAbstractionError::InsufficientGasBalance {
                need: estimate.payment_token_cost,
                have: request.max_payment,
            });
        }

        // In production, this would:
        // 1. Lock payment token from user
        // 2. Swap to native token via DEX
        // 3. Fund the relayer with native gas
        // 4. Return result with swap details

        Ok(GasPaymentResult {
            success: true,
            amount_paid: estimate.payment_token_cost,
            gas_acquired: request.gas_units,
            swap_tx_hash: Some(format!("0x{}", hex::encode(&[0u8; 32]))),
            refund_amount: request.max_payment - estimate.payment_token_cost,
        })
    }

    /// Get supported chains.
    pub fn supported_chains(&self) -> &[ChainType] {
        &self.config.supported_chains
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // INTENT RESOLUTION HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    fn compute_intent_id(&self, intent: &CrossChainIntent) -> [u8; 32] {
        let json = serde_json::to_vec(intent).unwrap_or_default();
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"intent_id_v1");
        hasher.update(&json);
        hasher.update(&current_timestamp().to_le_bytes());
        *hasher.finalize().as_bytes()
    }

    async fn resolve_transfer_proof(
        &self,
        intent_id: [u8; 32],
        from_chain: ChainType,
        to_chain: ChainType,
        amount: u128,
        asset: String,
    ) -> Result<IntentResolution, ChainAbstractionError> {
        // Create proof generation transaction for source chain
        let proof_tx = ResolvedTransaction {
            tx_id: self.derive_tx_id(&intent_id, 0),
            chain: from_chain,
            tx_data: self.encode_proof_request(amount, &asset),
            gas_limit: 100_000,
            gas_price: 1_000_000,
            order: 0,
            dependencies: vec![],
        };

        // Create attestation relay transaction for destination chain
        let relay_tx = ResolvedTransaction {
            tx_id: self.derive_tx_id(&intent_id, 1),
            chain: to_chain,
            tx_data: self.encode_attestation_relay(&intent_id),
            gas_limit: 200_000,
            gas_price: 1_000_000,
            order: 1,
            dependencies: vec![proof_tx.tx_id],
        };

        Ok(IntentResolution {
            intent_id,
            transactions: vec![proof_tx, relay_tx],
            total_gas_cost: GasCostEstimate {
                gas_units: 300_000,
                native_cost: 300_000_000,
                payment_token_cost: 300_000_000,
                payment_token: GasToken::Native,
            },
            eta_secs: 180, // ~3 minutes
            warnings: vec![],
        })
    }

    async fn resolve_execute_transaction(
        &self,
        intent_id: [u8; 32],
        chain: ChainType,
        tx_data: Vec<u8>,
        max_gas: u64,
        gas_token: GasToken,
    ) -> Result<IntentResolution, ChainAbstractionError> {
        let gas_estimate = self
            .estimate_gas_payment(&GasPaymentRequest {
                target_chain: chain,
                gas_units: max_gas,
                payment_token: gas_token.clone(),
                payer_address: String::new(),
                max_payment: u128::MAX,
            })
            .await?;

        let tx = ResolvedTransaction {
            tx_id: self.derive_tx_id(&intent_id, 0),
            chain,
            tx_data,
            gas_limit: max_gas,
            gas_price: gas_estimate.native_cost / max_gas as u128,
            order: 0,
            dependencies: vec![],
        };

        Ok(IntentResolution {
            intent_id,
            transactions: vec![tx],
            total_gas_cost: gas_estimate,
            eta_secs: 60,
            warnings: vec![],
        })
    }

    async fn resolve_relay_attestation(
        &self,
        intent_id: [u8; 32],
        source_chain: ChainType,
        target_chains: Vec<ChainType>,
        attestation_id: [u8; 32],
    ) -> Result<IntentResolution, ChainAbstractionError> {
        let mut transactions = Vec::new();
        let mut total_gas = 0u64;

        for (i, target) in target_chains.iter().enumerate() {
            let tx = ResolvedTransaction {
                tx_id: self.derive_tx_id(&intent_id, i as u32),
                chain: *target,
                tx_data: self.encode_attestation_relay(&attestation_id),
                gas_limit: 150_000,
                gas_price: 1_000_000,
                order: i as u32,
                dependencies: vec![],
            };
            total_gas += tx.gas_limit;
            transactions.push(tx);
        }

        Ok(IntentResolution {
            intent_id,
            transactions,
            total_gas_cost: GasCostEstimate {
                gas_units: total_gas,
                native_cost: total_gas as u128 * 1_000_000,
                payment_token_cost: total_gas as u128 * 1_000_000,
                payment_token: GasToken::Native,
            },
            eta_secs: 300, // ~5 minutes
            warnings: vec![],
        })
    }

    async fn resolve_swap(
        &self,
        intent_id: [u8; 32],
        from_token: String,
        to_token: String,
        amount: u128,
        min_output: u128,
    ) -> Result<IntentResolution, ChainAbstractionError> {
        let tx = ResolvedTransaction {
            tx_id: self.derive_tx_id(&intent_id, 0),
            chain: ChainType::Near, // Swaps happen on NEAR
            tx_data: self.encode_swap(&from_token, &to_token, amount, min_output),
            gas_limit: 50_000_000_000_000, // 50 TGas
            gas_price: 1,
            order: 0,
            dependencies: vec![],
        };

        Ok(IntentResolution {
            intent_id,
            transactions: vec![tx],
            total_gas_cost: GasCostEstimate {
                gas_units: 50_000_000_000_000,
                native_cost: 50_000_000_000_000, // ~0.05 NEAR
                payment_token_cost: 50_000_000_000_000,
                payment_token: GasToken::Near,
            },
            eta_secs: 5,
            warnings: vec![],
        })
    }

    async fn resolve_deploy(
        &self,
        intent_id: [u8; 32],
        chain: ChainType,
        bytecode: Vec<u8>,
        constructor_args: Vec<u8>,
    ) -> Result<IntentResolution, ChainAbstractionError> {
        let gas_estimate = (bytecode.len() as u64 * 200) + 100_000; // Rough estimate

        let tx = ResolvedTransaction {
            tx_id: self.derive_tx_id(&intent_id, 0),
            chain,
            tx_data: [bytecode, constructor_args].concat(),
            gas_limit: gas_estimate,
            gas_price: 2_000_000, // Higher for deployment
            order: 0,
            dependencies: vec![],
        };

        Ok(IntentResolution {
            intent_id,
            transactions: vec![tx],
            total_gas_cost: GasCostEstimate {
                gas_units: gas_estimate,
                native_cost: gas_estimate as u128 * 2_000_000,
                payment_token_cost: gas_estimate as u128 * 2_000_000,
                payment_token: GasToken::Native,
            },
            eta_secs: 120,
            warnings: vec!["Contract deployment may require additional initialization".into()],
        })
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    fn derive_tx_id(&self, intent_id: &[u8; 32], index: u32) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tx_id_v1");
        hasher.update(intent_id);
        hasher.update(&index.to_le_bytes());
        *hasher.finalize().as_bytes()
    }

    fn encode_proof_request(&self, amount: u128, asset: &str) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"PROOF_REQ");
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(asset.as_bytes());
        data
    }

    fn encode_attestation_relay(&self, attestation_id: &[u8; 32]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"ATTEST_RELAY");
        data.extend_from_slice(attestation_id);
        data
    }

    fn encode_swap(&self, from: &str, to: &str, amount: u128, min_out: u128) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(b"SWAP");
        data.push(from.len() as u8);
        data.extend_from_slice(from.as_bytes());
        data.push(to.len() as u8);
        data.extend_from_slice(to.as_bytes());
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(&min_out.to_le_bytes());
        data
    }

    async fn get_gas_price(&self, chain: ChainType) -> Result<(u128, u8), ChainAbstractionError> {
        // Return mock gas prices for each chain
        let (price, decimals) = match chain {
            ChainType::Near => (100_000_000, 24),       // 0.0001 NEAR per gas
            ChainType::Ethereum => (30_000_000_000, 18), // ~30 gwei
            ChainType::Starknet => (1_000_000, 18),
            ChainType::Mina => (100_000_000, 9),
            ChainType::Zcash => (1_000, 8),
            ChainType::Aztec => (10_000, 18),
            ChainType::Cosmos => (25, 6),
        };
        Ok((price, decimals))
    }

    async fn convert_to_payment_token(
        &self,
        native_amount: u128,
        chain: ChainType,
        token: &GasToken,
    ) -> Result<u128, ChainAbstractionError> {
        // Get cached prices (in production, would fetch from oracle)
        let cache = self.price_cache.read().await;
        
        // Mock conversion rates (token price in USD cents)
        let native_price = match chain {
            ChainType::Near => 500,        // $5.00
            ChainType::Ethereum => 250000, // $2500
            ChainType::Starknet => 100,    // $1.00
            ChainType::Mina => 50,         // $0.50
            ChainType::Zcash => 2500,      // $25.00
            ChainType::Aztec => 100,
            ChainType::Cosmos => 700,      // $7.00
        };

        let payment_price = match token {
            GasToken::Native => native_price,
            GasToken::Zec => 2500,    // $25.00
            GasToken::Usdc => 100,    // $1.00
            GasToken::Usdt => 100,
            GasToken::Dai => 100,
            GasToken::Near => 500,
            GasToken::Weth => 250000,
        };

        // Convert: native_amount * native_price / payment_price
        let payment_amount = native_amount
            .saturating_mul(native_price as u128)
            .saturating_div(payment_price as u128);

        Ok(payment_amount)
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
    fn test_unified_account() {
        let account = UnifiedAccount::new(AccountId::new("test.near"));
        assert!(account.chain_addresses.is_empty());
    }

    #[test]
    fn test_gas_token_default() {
        assert_eq!(GasToken::default(), GasToken::Native);
    }

    #[test]
    fn test_signature_scheme_lengths() {
        assert_eq!(SignatureScheme::EcdsaSecp256k1.signature_length(), 65);
        assert_eq!(SignatureScheme::EddsaEd25519.signature_length(), 64);
    }

    #[tokio::test]
    async fn test_chain_abstraction_service() {
        let service = ChainAbstractionService::new(ChainAbstractionConfig::default());
        
        let account = service
            .get_or_create_account(AccountId::new("test.near"))
            .await
            .unwrap();
        
        assert_eq!(account.near_account.as_str(), "test.near");
    }

    #[tokio::test]
    async fn test_intent_resolution() {
        let service = ChainAbstractionService::new(ChainAbstractionConfig::default());
        let account = service
            .get_or_create_account(AccountId::new("test.near"))
            .await
            .unwrap();

        let intent = CrossChainIntent::ExecuteTransaction {
            chain: ChainType::Near,
            tx_data: vec![1, 2, 3],
            max_gas: 100_000,
            gas_token: GasToken::Native,
        };

        let resolution = service.resolve_intent(intent, &account).await.unwrap();
        assert_eq!(resolution.transactions.len(), 1);
    }

    #[tokio::test]
    async fn test_signature_request() {
        let service = ChainAbstractionService::new(ChainAbstractionConfig::default());

        let request = service
            .request_signature(
                ChainType::Ethereum,
                [0u8; 32],
                "m/44'/60'/0'/0/0".to_string(),
                AccountId::new("test.near"),
            )
            .await
            .unwrap();

        assert_eq!(request.signature_scheme, SignatureScheme::EcdsaSecp256k1);
    }
}

