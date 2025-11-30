//! Rail abstraction layer for the Tachyon wallet.
//!
//! Each rail provides a specific proving capability. The Tachyon wallet
//! coordinates across rails to generate unified proofs.
//!
//! # Rail Integration
//!
//! Each rail connects to its backend crate:
//! - **ZcashOrchardRail** → `zkpf-zcash-orchard-wallet` + `zkpf-orchard-pof-circuit`
//! - **MinaRecursiveRail** → `zkpf-mina` for recursive proof aggregation
//! - **StarknetL2Rail** → `zkpf-starknet-l2` for Starknet PoF

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::{RailCapability, RailConfig};
use crate::error::TachyonError;
use crate::state::ChainBalance;
use crate::types::{CurrencyCode, Epoch, HolderId, Policy};
use zkpf_common::ProofBundle;

// Orchard circuit integration
use zkpf_orchard_inner::{OrchardInnerPublicInputs, OrchardPofProver};
use zkpf_orchard_pof_circuit::{
    verify_orchard_pof_proof, OrchardPofCircuitArtifacts, OrchardPofCircuitProver, OrchardPofParams,
};

const ORCHARD_PROOF_MAGIC: &[u8; 7] = b"OPFv1.0";

#[derive(Clone, Debug, Serialize, Deserialize)]
struct OrchardProofEnvelope {
    inner_public_inputs: OrchardInnerPublicInputs,
    proof: Vec<u8>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAIL IDENTIFIER
// ═══════════════════════════════════════════════════════════════════════════════

/// Canonical rail identifiers.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RailId {
    /// Zcash Orchard shielded pool.
    ZcashOrchard,
    /// Mina recursive proof aggregation.
    MinaRecursive,
    /// Starknet L2 accounts and DeFi.
    StarknetL2,
    /// Axelar cross-chain transport (not a proving rail).
    AxelarGmp,
    /// NEAR TEE agent (computation, not proving).
    NearTee,
    /// Omni Bridge for cross-chain asset transfers.
    OmniBridge,
    /// Custom rail with string identifier.
    Custom(String),
}

impl RailId {
    pub fn as_str(&self) -> &str {
        match self {
            Self::ZcashOrchard => "ZCASH_ORCHARD",
            Self::MinaRecursive => "MINA_RECURSIVE",
            Self::StarknetL2 => "STARKNET_L2",
            Self::AxelarGmp => "AXELAR_GMP",
            Self::NearTee => "NEAR_TEE",
            Self::OmniBridge => "OMNI_BRIDGE",
            Self::Custom(s) => s,
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "ZCASH_ORCHARD" => Self::ZcashOrchard,
            "MINA_RECURSIVE" => Self::MinaRecursive,
            "STARKNET_L2" => Self::StarknetL2,
            "AXELAR_GMP" => Self::AxelarGmp,
            "NEAR_TEE" => Self::NearTee,
            "OMNI_BRIDGE" => Self::OmniBridge,
            other => Self::Custom(other.to_string()),
        }
    }

    /// Get the capabilities this rail provides.
    pub fn capabilities(&self) -> HashSet<RailCapability> {
        match self {
            Self::ZcashOrchard => [
                RailCapability::ShieldedBalance,
                RailCapability::PrivateTransfer,
            ]
            .into_iter()
            .collect(),
            Self::MinaRecursive => [
                RailCapability::RecursiveProof,
                RailCapability::ProofAggregation,
            ]
            .into_iter()
            .collect(),
            Self::StarknetL2 => [
                RailCapability::DeFiPosition,
                RailCapability::AccountAbstraction,
                RailCapability::SessionKey,
            ]
            .into_iter()
            .collect(),
            Self::AxelarGmp => [RailCapability::CrossChainBridge].into_iter().collect(),
            Self::NearTee => [RailCapability::TeeCompute].into_iter().collect(),
            Self::OmniBridge => [
                RailCapability::CrossChainBridge,
                RailCapability::TokenTransfer,
                RailCapability::BridgedAssetProof,
            ]
            .into_iter()
            .collect(),
            Self::Custom(_) => HashSet::new(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RAIL TRAIT
// ═══════════════════════════════════════════════════════════════════════════════

/// Trait implemented by all proving rails.
#[async_trait]
pub trait Rail: Send + Sync {
    /// Get the rail identifier.
    fn id(&self) -> RailId;

    /// Get the capabilities this rail provides.
    fn capabilities(&self) -> HashSet<RailCapability>;

    /// Check if the rail is available and configured.
    async fn is_available(&self) -> bool;

    /// Synchronize the rail with its chain.
    async fn sync(&self) -> Result<SyncStatus, TachyonError>;

    /// Get the current balance for a currency.
    async fn get_balance(&self, currency: CurrencyCode) -> Result<ChainBalance, TachyonError>;

    /// Generate a proof-of-funds for the given policy.
    async fn prove(
        &self,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError>;

    /// Verify a proof generated by this rail.
    async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError>;
}

/// Synchronization status for a rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncStatus {
    /// Whether sync is complete.
    pub synced: bool,
    /// Current chain height.
    pub chain_height: u64,
    /// Wallet/scan height.
    pub wallet_height: u64,
    /// Percentage complete (0-100).
    pub progress_pct: f32,
    /// Estimated time to completion (seconds).
    pub eta_secs: Option<u64>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZCASH ORCHARD RAIL
// ═══════════════════════════════════════════════════════════════════════════════

/// Zcash Orchard rail implementation.
///
/// Connects to `zkpf-zcash-orchard-wallet` for snapshot generation and
/// `zkpf-orchard-pof-circuit` for proof generation.
pub struct ZcashOrchardRail {
    config: RailConfig,
    /// Cached wallet tip height for sync status.
    cached_height: Arc<RwLock<u32>>,
    /// Cached balance in zatoshi.
    cached_balance_zats: Arc<RwLock<u64>>,
    /// Full viewing key for this rail instance (if configured).
    fvk: Option<zkpf_zcash_orchard_wallet::OrchardFvk>,
    /// Circuit artifacts for proof generation/verification.
    /// Lazy-loaded on first use.
    circuit_artifacts: Arc<RwLock<Option<OrchardPofCircuitArtifacts>>>,
}

impl ZcashOrchardRail {
    pub fn new(config: RailConfig) -> Self {
        Self {
            config,
            cached_height: Arc::new(RwLock::new(0)),
            cached_balance_zats: Arc::new(RwLock::new(0)),
            fvk: None,
            circuit_artifacts: Arc::new(RwLock::new(None)),
        }
    }

    /// Create a rail with a specific full viewing key.
    pub fn with_fvk(config: RailConfig, fvk: zkpf_zcash_orchard_wallet::OrchardFvk) -> Self {
        Self {
            config,
            cached_height: Arc::new(RwLock::new(0)),
            cached_balance_zats: Arc::new(RwLock::new(0)),
            fvk: Some(fvk),
            circuit_artifacts: Arc::new(RwLock::new(None)),
        }
    }

    /// Create a rail with circuit artifacts pre-loaded.
    pub fn with_artifacts(
        config: RailConfig,
        fvk: zkpf_zcash_orchard_wallet::OrchardFvk,
        artifacts: OrchardPofCircuitArtifacts,
    ) -> Self {
        Self {
            config,
            cached_height: Arc::new(RwLock::new(0)),
            cached_balance_zats: Arc::new(RwLock::new(0)),
            fvk: Some(fvk),
            circuit_artifacts: Arc::new(RwLock::new(Some(artifacts))),
        }
    }

    /// Load or get circuit artifacts.
    ///
    /// Returns default artifacts if none are loaded. In production, this would
    /// load from disk or a key management service.
    async fn get_or_load_artifacts(&self) -> Result<OrchardPofCircuitArtifacts, TachyonError> {
        let artifacts = self.circuit_artifacts.read().await;
        if let Some(ref a) = *artifacts {
            return Ok(a.clone());
        }
        drop(artifacts);

        // Create default artifacts (in production, load from disk)
        // The circuit uses IPA commitment scheme over Pasta curves
        let default_artifacts = OrchardPofCircuitArtifacts {
            params_bytes: vec![], // Generated on-the-fly in the circuit
            vk_bytes: vec![],
            pk_bytes: vec![],
            k: 11,
        };

        let mut artifacts = self.circuit_artifacts.write().await;
        *artifacts = Some(default_artifacts.clone());
        Ok(default_artifacts)
    }
}

#[async_trait]
impl Rail for ZcashOrchardRail {
    fn id(&self) -> RailId {
        RailId::ZcashOrchard
    }

    fn capabilities(&self) -> HashSet<RailCapability> {
        RailId::ZcashOrchard.capabilities()
    }

    async fn is_available(&self) -> bool {
        if !self.config.enabled {
            return false;
        }
        // Check if wallet backend is initialized
        zkpf_zcash_orchard_wallet::wallet_tip_height().is_ok()
    }

    async fn sync(&self) -> Result<SyncStatus, TachyonError> {
        // Trigger wallet sync
        zkpf_zcash_orchard_wallet::sync_once()
            .await
            .map_err(|e| TachyonError::Sync(format!("Orchard sync failed: {}", e)))?;

        let height = zkpf_zcash_orchard_wallet::wallet_tip_height()
            .map_err(|e| TachyonError::Sync(e.to_string()))?;

        *self.cached_height.write().await = height;

        Ok(SyncStatus {
            synced: true,
            chain_height: height as u64,
            wallet_height: height as u64,
            progress_pct: 100.0,
            eta_secs: None,
        })
    }

    async fn get_balance(&self, currency: CurrencyCode) -> Result<ChainBalance, TachyonError> {
        if currency != CurrencyCode::ZEC {
            return Ok(ChainBalance {
                total: 0,
                spendable: 0,
                pending: 0,
                currency,
                block_height: 0,
            });
        }

        // If we have an FVK, try to get balance from snapshot
        let balance_zats = if let Some(ref fvk) = self.fvk {
            let height = *self.cached_height.read().await;
            match zkpf_zcash_orchard_wallet::build_snapshot_for_fvk(fvk, height) {
                Ok(snapshot) => snapshot.notes.iter().map(|n| n.value_zats).sum(),
                Err(_) => 0,
            }
        } else {
            0
        };

        *self.cached_balance_zats.write().await = balance_zats;
        let height = *self.cached_height.read().await;

        Ok(ChainBalance {
            total: balance_zats as u128,
            spendable: balance_zats as u128,
            pending: 0,
            currency,
            block_height: height as u64,
        })
    }

    async fn prove(
        &self,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError> {
        use zkpf_common::VerifierPublicInputs;

        let fvk = self
            .fvk
            .as_ref()
            .ok_or_else(|| TachyonError::ProofGeneration("Orchard FVK not configured".into()))?;

        let height = *self.cached_height.read().await;

        // Build snapshot from wallet
        let snapshot =
            zkpf_zcash_orchard_wallet::build_snapshot_for_fvk(fvk, height).map_err(|e| {
                TachyonError::ProofGeneration(format!("Failed to build snapshot: {}", e))
            })?;

        // Convert to PoF snapshot format
        let pof_snapshot =
            zkpf_zcash_orchard_wallet::snapshot_to_pof_snapshot(&snapshot).map_err(|e| {
                TachyonError::ProofGeneration(format!("Failed to convert snapshot: {}", e))
            })?;

        // Calculate total value
        let total_zats: u64 = pof_snapshot
            .notes
            .iter()
            .map(|n| n.value_zats.inner())
            .sum();

        if total_zats < policy.threshold as u64 {
            return Err(TachyonError::ProofGeneration(format!(
                "Insufficient funds: {} zatoshi < {} threshold",
                total_zats, policy.threshold
            )));
        }

        let nullifier = compute_nullifier(holder_id, policy, epoch);
        let holder_id_hash = compute_holder_id_bytes(holder_id);

        // Build PoF parameters for the circuit
        let pof_params = OrchardPofParams {
            threshold_zats: policy.threshold as u64,
            ufvk_bytes: fvk.encoded.as_bytes().to_vec(),
            holder_id: Some(holder_id_hash),
        };

        // Get circuit artifacts
        let artifacts = self.get_or_load_artifacts().await?;

        // Create the circuit prover and convert snapshot to circuit input
        let prover = OrchardPofCircuitProver::new(artifacts.clone());
        let circuit_input =
            OrchardPofCircuitProver::snapshot_to_inner_input(&pof_snapshot, &pof_params).map_err(
                |e| TachyonError::ProofGeneration(format!("Failed to build circuit input: {}", e)),
            )?;

        // Generate the real cryptographic proof
        let (inner_proof_bytes, inner_public_inputs) = prover
            .prove_orchard_pof_statement(&circuit_input)
            .map_err(|e| TachyonError::ProofGeneration(format!("Circuit proof failed: {}", e)))?;

        // Serialize proof with its public inputs so verifiers can recover them later
        let proof = serialize_orchard_proof_envelope(&inner_public_inputs, inner_proof_bytes)
            .map_err(|e| TachyonError::ProofGeneration(format!("Failed to encode proof: {}", e)))?;

        // Build the verifier public inputs from the circuit output
        let public_inputs = VerifierPublicInputs {
            threshold_raw: policy.threshold as u64,
            required_currency_code: policy.currency.as_u32(),
            current_epoch: epoch.timestamp,
            verifier_scope_id: policy.verifier_scope_id,
            policy_id: policy.policy_id,
            nullifier,
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(inner_public_inputs.height as u64),
            snapshot_anchor_orchard: Some(inner_public_inputs.anchor_orchard),
            holder_binding: inner_public_inputs.binding,
            proven_sum: Some(inner_public_inputs.sum_zats as u128),
        };

        tracing::info!(
            rail = "ZCASH_ORCHARD",
            height = height,
            total_zats = total_zats,
            threshold = policy.threshold,
            proof_size = proof.len(),
            "Generated real Orchard PoF proof"
        );

        Ok(ProofBundle {
            rail_id: self.id().as_str().to_string(),
            circuit_version: zkpf_common::CIRCUIT_VERSION,
            proof,
            public_inputs,
        })
    }

    async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError> {
        if bundle.rail_id != self.id().as_str() {
            return Err(TachyonError::ProofVerification(format!(
                "Wrong rail: expected {}, got {}",
                self.id().as_str(),
                bundle.rail_id
            )));
        }

        // Reject legacy placeholder proofs
        if bundle.proof.starts_with(b"ORCHARD_POF_V1_PLACEHOLDER") {
            return Err(TachyonError::ProofVerification(
                "Legacy placeholder proofs are no longer accepted - use real circuit proofs".into(),
            ));
        }

        // Deserialize proof envelope
        let envelope = deserialize_orchard_proof_envelope(&bundle.proof)?;

        // Ensure reported public inputs align with the embedded ones
        ensure_orchard_public_inputs_consistent(
            &envelope.inner_public_inputs,
            &bundle.public_inputs,
        )?;

        // Get circuit artifacts for verification
        let artifacts = self.get_or_load_artifacts().await?;

        // Perform cryptographic verification
        let is_valid =
            verify_orchard_pof_proof(&envelope.proof, &envelope.inner_public_inputs, &artifacts)
                .map_err(|e| {
                    TachyonError::ProofVerification(format!("Verification failed: {}", e))
                })?;

        if is_valid {
            tracing::info!(
                rail = "ZCASH_ORCHARD",
                height = envelope.inner_public_inputs.height,
                sum_zats = envelope.inner_public_inputs.sum_zats,
                "Orchard PoF proof verified successfully"
            );
        } else {
            tracing::warn!(
                rail = "ZCASH_ORCHARD",
                "Orchard PoF proof verification failed"
            );
        }

        Ok(is_valid)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINA RECURSIVE RAIL
// ═══════════════════════════════════════════════════════════════════════════════

/// Mina recursive proof aggregation rail.
///
/// This rail aggregates proofs from other rails into Mina-native recursive proofs
/// for cross-chain attestations. It does not hold balances directly.
///
/// # Usage
///
/// ```ignore
/// // Create rail with source proofs to aggregate
/// let mina_rail = MinaRecursiveRail::new(config);
/// mina_rail.set_source_proofs(vec![starknet_bundle, zcash_bundle]);
/// let aggregated = mina_rail.prove(&holder_id, &policy, &epoch).await?;
/// ```
pub struct MinaRecursiveRail {
    config: RailConfig,
    /// zkApp address for attestation publishing.
    zkapp_address: String,
    /// Network ID (mainnet, testnet, berkeley).
    network_id: String,
    /// Source proofs to aggregate (set before proving).
    source_proofs: Arc<RwLock<Vec<zkpf_mina::SourceProofInput>>>,
    /// Cached Mina slot for sync status.
    cached_slot: Arc<RwLock<u64>>,
}

impl MinaRecursiveRail {
    pub fn new(config: RailConfig) -> Self {
        // Load zkApp address from environment or use the deployed contract
        let zkapp_address = std::env::var("ZKPF_MINA_ZKAPP_ADDRESS")
            .unwrap_or_else(|_| {
                // Default to the deployed zkpf attestation zkApp on Mina mainnet
                "B62qkYa1o6Mj6uTTjDQCob7FYZspuhkm4RRQhgJg9j4koEBWiSrTQrS".to_string()
            });
        
        let network_id = std::env::var("ZKPF_MINA_NETWORK")
            .unwrap_or_else(|_| "mainnet".to_string());
        
        Self {
            config,
            zkapp_address,
            network_id,
            source_proofs: Arc::new(RwLock::new(Vec::new())),
            cached_slot: Arc::new(RwLock::new(0)),
        }
    }

    /// Create a rail with specific zkApp configuration.
    pub fn with_zkapp(config: RailConfig, zkapp_address: String, network_id: String) -> Self {
        Self {
            config,
            zkapp_address,
            network_id,
            source_proofs: Arc::new(RwLock::new(Vec::new())),
            cached_slot: Arc::new(RwLock::new(0)),
        }
    }

    /// Set source proofs to aggregate into a recursive proof.
    pub async fn set_source_proofs(&self, proofs: Vec<ProofBundle>) {
        let source_inputs: Vec<zkpf_mina::SourceProofInput> = proofs
            .into_iter()
            .map(|bundle| zkpf_mina::SourceProofInput {
                bundle,
                rail_metadata: serde_json::json!({}),
            })
            .collect();
        *self.source_proofs.write().await = source_inputs;
    }

    /// Add a source proof with metadata.
    pub async fn add_source_proof(&self, bundle: ProofBundle, metadata: serde_json::Value) {
        self.source_proofs
            .write()
            .await
            .push(zkpf_mina::SourceProofInput {
                bundle,
                rail_metadata: metadata,
            });
    }

    /// Clear source proofs.
    pub async fn clear_source_proofs(&self) {
        self.source_proofs.write().await.clear();
    }

    /// Wrap a Starknet proof for cross-chain attestation via Mina.
    pub async fn wrap_starknet_proof(
        &self,
        starknet_bundle: ProofBundle,
        holder_id: &HolderId,
    ) -> Result<ProofBundle, TachyonError> {
        let config = zkpf_mina::StarknetWrapConfig {
            holder_id: holder_id.0.clone(),
            mina_slot: *self.cached_slot.read().await,
            zkapp_address: Some(self.zkapp_address.clone()),
            chain_id: None,                    // Inferred from bundle
            validity_window_slots: Some(7200), // ~24 hours
        };

        let wrap_result = zkpf_mina::wrap_starknet_proof(starknet_bundle, config)
            .map_err(|e| TachyonError::ProofGeneration(e.to_string()))?;

        Ok(wrap_result.bundle)
    }
}

#[async_trait]
impl Rail for MinaRecursiveRail {
    fn id(&self) -> RailId {
        RailId::MinaRecursive
    }

    fn capabilities(&self) -> HashSet<RailCapability> {
        RailId::MinaRecursive.capabilities()
    }

    async fn is_available(&self) -> bool {
        self.config.enabled
    }

    async fn sync(&self) -> Result<SyncStatus, TachyonError> {
        // In production, this would query Mina GraphQL for current slot
        // For now, use epoch timestamp as slot approximation
        let current_slot = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() / 3) // ~3 second slots
            .unwrap_or(0);

        *self.cached_slot.write().await = current_slot;

        Ok(SyncStatus {
            synced: true,
            chain_height: current_slot,
            wallet_height: current_slot,
            progress_pct: 100.0,
            eta_secs: None,
        })
    }

    async fn get_balance(&self, currency: CurrencyCode) -> Result<ChainBalance, TachyonError> {
        // Mina rail is for aggregation, not direct balance
        // It aggregates balances from source proofs
        let source_proofs = self.source_proofs.read().await;
        let total: u128 = source_proofs
            .iter()
            .filter_map(|s| s.bundle.public_inputs.proven_sum)
            .sum();

        Ok(ChainBalance {
            total,
            spendable: total,
            pending: 0,
            currency,
            block_height: *self.cached_slot.read().await,
        })
    }

    async fn prove(
        &self,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError> {
        let source_proofs = self.source_proofs.read().await;

        if source_proofs.is_empty() {
            return Err(TachyonError::ProofGeneration(
                "Mina rail requires source proofs to aggregate. \
                 Use set_source_proofs() or add_source_proof() first."
                    .into(),
            ));
        }

        if source_proofs.len() > zkpf_mina::MINA_MAX_SOURCE_PROOFS {
            return Err(TachyonError::ProofGeneration(format!(
                "Too many source proofs: {} > {} max",
                source_proofs.len(),
                zkpf_mina::MINA_MAX_SOURCE_PROOFS
            )));
        }

        let global_slot = *self.cached_slot.read().await;

        let mina_meta = zkpf_mina::MinaPublicMeta {
            network_id: self.network_id.clone(),
            network_id_numeric: match self.network_id.as_str() {
                "mainnet" => 0,
                "testnet" | "berkeley" => 1,
                _ => 99,
            },
            global_slot,
            zkapp_address: self.zkapp_address.clone(),
            recursive_proof_commitment: [0u8; 32], // Computed by prove_mina_recursive
            source_rail_ids: vec![],               // Populated by prove_mina_recursive
        };

        let public_meta = zkpf_mina::PublicMetaInputs {
            policy_id: policy.policy_id,
            verifier_scope_id: policy.verifier_scope_id,
            current_epoch: epoch.timestamp,
            required_currency_code: policy.currency.as_u32(),
        };

        let bundle = zkpf_mina::prove_mina_recursive(
            &source_proofs,
            &holder_id.0,
            &mina_meta,
            &public_meta,
        )?;

        Ok(bundle)
    }

    async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError> {
        if bundle.rail_id != zkpf_mina::RAIL_ID_MINA {
            return Err(TachyonError::ProofVerification(format!(
                "Expected rail {}, got {}",
                zkpf_mina::RAIL_ID_MINA,
                bundle.rail_id
            )));
        }

        zkpf_mina::verify_mina_proof(bundle).map_err(Into::into)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARKNET L2 RAIL
// ═══════════════════════════════════════════════════════════════════════════════

/// Starknet L2 rail implementation.
///
/// Connects to `zkpf-starknet-l2` for Starknet account balance proofs and
/// DeFi position proofs.
pub struct StarknetL2Rail {
    config: RailConfig,
    /// Chain ID (SN_MAIN, SN_SEPOLIA).
    chain_id: String,
    /// Starknet account addresses controlled by this rail.
    accounts: Arc<RwLock<Vec<String>>>,
    /// Cached snapshot for proving.
    cached_snapshot: Arc<RwLock<Option<zkpf_starknet_l2::StarknetSnapshot>>>,
    /// Cached block number.
    cached_block: Arc<RwLock<u64>>,
}

impl StarknetL2Rail {
    pub fn new(config: RailConfig) -> Self {
        Self {
            config,
            chain_id: "SN_MAIN".to_string(),
            accounts: Arc::new(RwLock::new(Vec::new())),
            cached_snapshot: Arc::new(RwLock::new(None)),
            cached_block: Arc::new(RwLock::new(0)),
        }
    }

    /// Create a rail with specific chain and accounts.
    pub fn with_accounts(config: RailConfig, chain_id: String, accounts: Vec<String>) -> Self {
        Self {
            config,
            chain_id,
            accounts: Arc::new(RwLock::new(accounts)),
            cached_snapshot: Arc::new(RwLock::new(None)),
            cached_block: Arc::new(RwLock::new(0)),
        }
    }

    /// Add a Starknet account address.
    pub async fn add_account(&self, address: String) {
        self.accounts.write().await.push(address);
    }

    /// Set the snapshot to use for proving.
    /// This allows pre-computing snapshots or loading from external sources.
    pub async fn set_snapshot(&self, snapshot: zkpf_starknet_l2::StarknetSnapshot) {
        *self.cached_block.write().await = snapshot.block_number;
        *self.cached_snapshot.write().await = Some(snapshot);
    }

    /// Get the numeric chain ID for circuit encoding.
    fn chain_id_numeric(&self) -> u128 {
        match self.chain_id.as_str() {
            "SN_MAIN" => 0x534e5f4d41494e,          // "SN_MAIN" as felt
            "SN_SEPOLIA" => 0x534e5f5345504f4c4941, // "SN_SEPOLIA" as felt
            _ => 0,
        }
    }
}

#[async_trait]
impl Rail for StarknetL2Rail {
    fn id(&self) -> RailId {
        RailId::StarknetL2
    }

    fn capabilities(&self) -> HashSet<RailCapability> {
        RailId::StarknetL2.capabilities()
    }

    async fn is_available(&self) -> bool {
        self.config.enabled
    }

    async fn sync(&self) -> Result<SyncStatus, TachyonError> {
        // In production, this would query Starknet RPC for block info
        // For now, use timestamp-based approximation
        let block_estimate = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() / 12) // ~12 second blocks
            .unwrap_or(0);

        *self.cached_block.write().await = block_estimate;

        Ok(SyncStatus {
            synced: true,
            chain_height: block_estimate,
            wallet_height: block_estimate,
            progress_pct: 100.0,
            eta_secs: None,
        })
    }

    async fn get_balance(&self, currency: CurrencyCode) -> Result<ChainBalance, TachyonError> {
        // Check if we have a cached snapshot with balance data
        let snapshot = self.cached_snapshot.read().await;
        let block = *self.cached_block.read().await;

        let total = if let Some(ref snap) = *snapshot {
            let asset_filter = match currency {
                CurrencyCode::ETH => Some("ETH"),
                CurrencyCode::STRK => Some("STRK"),
                CurrencyCode::USDC => Some("USDC"),
                _ => None,
            };

            snap.accounts
                .iter()
                .map(|account| match asset_filter {
                    Some("ETH") | Some("STRK") => account.native_balance,
                    Some(symbol) => account
                        .token_balances
                        .iter()
                        .filter(|t| t.symbol == symbol)
                        .map(|t| t.balance)
                        .sum(),
                    None => {
                        let mut total = account.native_balance;
                        for token in &account.token_balances {
                            total = total.saturating_add(token.balance);
                        }
                        for position in &account.defi_positions {
                            total = total.saturating_add(position.value);
                        }
                        total
                    }
                })
                .sum()
        } else {
            0
        };

        Ok(ChainBalance {
            total,
            spendable: total,
            pending: 0,
            currency,
            block_height: block,
        })
    }

    async fn prove(
        &self,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError> {
        // Use cached snapshot or create empty one
        let snapshot = {
            let cached = self.cached_snapshot.read().await;
            if let Some(ref snap) = *cached {
                snap.clone()
            } else {
                // Create minimal snapshot from configured accounts
                let accounts = self.accounts.read().await;
                zkpf_starknet_l2::StarknetSnapshot {
                    chain_id: self.chain_id.clone(),
                    block_number: *self.cached_block.read().await,
                    block_hash: "0x0".to_string(),
                    timestamp: epoch.timestamp,
                    accounts: accounts
                        .iter()
                        .map(|addr| zkpf_starknet_l2::StarknetAccountSnapshot {
                            address: addr.clone(),
                            class_hash: "0x0".to_string(),
                            native_balance: 0,
                            token_balances: vec![],
                            defi_positions: vec![],
                        })
                        .collect(),
                }
            }
        };

        if snapshot.accounts.is_empty() {
            return Err(TachyonError::ProofGeneration(
                "No Starknet accounts configured. Use add_account() or set_snapshot().".into(),
            ));
        }

        let starknet_meta = zkpf_starknet_l2::StarknetPublicMeta {
            chain_id: snapshot.chain_id.clone(),
            chain_id_numeric: self.chain_id_numeric(),
            block_number: snapshot.block_number,
            account_commitment: [0u8; 32], // Computed by prove_starknet_pof
            holder_binding: [0u8; 32],     // Computed by prove_starknet_pof
        };

        let public_meta = zkpf_starknet_l2::PublicMetaInputs {
            policy_id: policy.policy_id,
            verifier_scope_id: policy.verifier_scope_id,
            current_epoch: epoch.timestamp,
            required_currency_code: policy.currency.as_u32(),
        };

        let asset_filter = match policy.currency {
            CurrencyCode::ETH => Some("ETH"),
            CurrencyCode::STRK => Some("STRK"),
            CurrencyCode::USDC => Some("USDC"),
            CurrencyCode::USDT => Some("USDT"),
            CurrencyCode::DAI => Some("DAI"),
            _ => None,
        };

        let bundle = zkpf_starknet_l2::prove_starknet_pof(
            &snapshot,
            &holder_id.0,
            policy.threshold as u64,
            asset_filter,
            &starknet_meta,
            &public_meta,
        )?;

        Ok(bundle)
    }

    async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError> {
        if bundle.rail_id != zkpf_starknet_l2::RAIL_ID_STARKNET_L2 {
            return Err(TachyonError::ProofVerification(format!(
                "Expected rail {}, got {}",
                zkpf_starknet_l2::RAIL_ID_STARKNET_L2,
                bundle.rail_id
            )));
        }

        zkpf_starknet_l2::verify_starknet_proof_with_loaded_artifacts(
            &bundle.proof,
            &bundle.public_inputs,
        )
        .map_err(Into::into)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OMNI BRIDGE RAIL
// ═══════════════════════════════════════════════════════════════════════════════

/// Omni Bridge rail for cross-chain asset transfers.
///
/// This rail integrates with the Omni Bridge SDK to enable:
/// - Token bridging between NEAR, Ethereum, Arbitrum, Base, and Solana
/// - Proof of bridged assets
/// - Cross-chain attestations
pub struct OmniBridgeRail {
    config: RailConfig,
    /// Use testnet instead of mainnet.
    use_testnet: bool,
    /// NEAR RPC URL.
    near_rpc_url: String,
    /// Cached transfer count for status.
    cached_transfer_count: Arc<RwLock<u64>>,
}

impl OmniBridgeRail {
    /// Create a new Omni Bridge rail.
    pub fn new(config: RailConfig) -> Self {
        let near_rpc_url = std::env::var("ZKPF_NEAR_RPC_URL")
            .unwrap_or_else(|_| "https://rpc.mainnet.near.org".to_string());
        let use_testnet = std::env::var("ZKPF_USE_TESTNET")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        Self {
            config,
            use_testnet,
            near_rpc_url,
            cached_transfer_count: Arc::new(RwLock::new(0)),
        }
    }

    /// Create a rail with specific configuration.
    pub fn with_config(
        config: RailConfig,
        near_rpc_url: String,
        use_testnet: bool,
    ) -> Self {
        Self {
            config,
            use_testnet,
            near_rpc_url,
            cached_transfer_count: Arc::new(RwLock::new(0)),
        }
    }

    /// Get the supported chains for this rail.
    pub fn supported_chains(&self) -> Vec<String> {
        if self.use_testnet {
            vec![
                "near-testnet".to_string(),
                "ethereum-sepolia".to_string(),
                "arbitrum-sepolia".to_string(),
                "base-sepolia".to_string(),
                "solana-devnet".to_string(),
            ]
        } else {
            vec![
                "near".to_string(),
                "ethereum".to_string(),
                "arbitrum".to_string(),
                "base".to_string(),
                "solana".to_string(),
            ]
        }
    }

    /// Get the NEAR RPC URL.
    pub fn near_rpc_url(&self) -> &str {
        &self.near_rpc_url
    }

    /// Check if using testnet.
    pub fn is_testnet(&self) -> bool {
        self.use_testnet
    }
}

#[async_trait]
impl Rail for OmniBridgeRail {
    fn id(&self) -> RailId {
        RailId::OmniBridge
    }

    fn capabilities(&self) -> HashSet<RailCapability> {
        RailId::OmniBridge.capabilities()
    }

    async fn is_available(&self) -> bool {
        self.config.enabled
    }

    async fn sync(&self) -> Result<SyncStatus, TachyonError> {
        // Omni Bridge doesn't need traditional sync - it's always ready
        Ok(SyncStatus {
            synced: true,
            chain_height: 0, // Not applicable
            wallet_height: 0,
            progress_pct: 100.0,
            eta_secs: None,
        })
    }

    async fn get_balance(&self, currency: CurrencyCode) -> Result<ChainBalance, TachyonError> {
        // Omni Bridge aggregates balances across chains
        // In production, this would query actual chain balances
        Ok(ChainBalance {
            total: 0,
            spendable: 0,
            pending: 0,
            currency,
            block_height: 0,
        })
    }

    async fn prove(
        &self,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError> {
        use zkpf_common::VerifierPublicInputs;

        // The Omni Bridge rail generates proofs of bridged assets
        // This creates an attestation that can be verified on-chain

        let nullifier = compute_nullifier(holder_id, policy, epoch);
        let holder_binding = compute_holder_binding(holder_id);

        // Create a proof showing bridged asset ownership
        // In production, this would integrate with the actual Omni Bridge SDK
        let proof_data = format!(
            "OMNI_BRIDGE_PROOF_V1:{}:{}:{}:{}",
            hex::encode(&holder_binding),
            policy.policy_id,
            epoch.timestamp,
            if self.use_testnet { "testnet" } else { "mainnet" }
        );

        let public_inputs = VerifierPublicInputs {
            threshold_raw: policy.threshold as u64,
            required_currency_code: policy.currency.as_u32(),
            current_epoch: epoch.timestamp,
            verifier_scope_id: policy.verifier_scope_id,
            policy_id: policy.policy_id,
            nullifier,
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: None,
            snapshot_anchor_orchard: None,
            holder_binding: Some(holder_binding),
            proven_sum: None, // Sum determined by bridge queries
        };

        tracing::info!(
            rail = "OMNI_BRIDGE",
            network = if self.use_testnet { "testnet" } else { "mainnet" },
            chains = ?self.supported_chains(),
            "Generated Omni Bridge attestation"
        );

        Ok(ProofBundle {
            rail_id: self.id().as_str().to_string(),
            circuit_version: zkpf_common::CIRCUIT_VERSION,
            proof: proof_data.into_bytes(),
            public_inputs,
        })
    }

    async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError> {
        if bundle.rail_id != self.id().as_str() {
            return Err(TachyonError::ProofVerification(format!(
                "Wrong rail: expected {}, got {}",
                self.id().as_str(),
                bundle.rail_id
            )));
        }

        // Verify the proof format
        let proof_str = String::from_utf8_lossy(&bundle.proof);
        if !proof_str.starts_with("OMNI_BRIDGE_PROOF_V1:") {
            return Err(TachyonError::ProofVerification(
                "Invalid Omni Bridge proof format".into(),
            ));
        }

        // In production, this would verify:
        // 1. The proof against on-chain state
        // 2. Cross-chain attestation validity
        // 3. Wormhole VAA (if applicable)

        Ok(true)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

fn compute_nullifier(holder_id: &HolderId, policy: &Policy, epoch: &Epoch) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_nullifier_v1");
    hasher.update(holder_id.0.as_bytes());
    hasher.update(&policy.policy_id.to_be_bytes());
    hasher.update(&policy.verifier_scope_id.to_be_bytes());
    hasher.update(&epoch.timestamp.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn compute_holder_id_bytes(holder_id: &HolderId) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_holder_id_v1");
    hasher.update(holder_id.0.as_bytes());
    *hasher.finalize().as_bytes()
}

fn compute_holder_binding(holder_id: &HolderId) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_holder_binding_v1");
    hasher.update(holder_id.0.as_bytes());
    *hasher.finalize().as_bytes()
}

fn serialize_orchard_proof_envelope(
    inner_public_inputs: &OrchardInnerPublicInputs,
    proof: Vec<u8>,
) -> Result<Vec<u8>, bincode::Error> {
    let envelope = OrchardProofEnvelope {
        inner_public_inputs: inner_public_inputs.clone(),
        proof,
    };
    let mut encoded = Vec::with_capacity(ORCHARD_PROOF_MAGIC.len());
    encoded.extend_from_slice(ORCHARD_PROOF_MAGIC);
    let payload = bincode::serialize(&envelope)?;
    encoded.extend_from_slice(&payload);
    Ok(encoded)
}

fn deserialize_orchard_proof_envelope(bytes: &[u8]) -> Result<OrchardProofEnvelope, TachyonError> {
    if bytes.len() <= ORCHARD_PROOF_MAGIC.len()
        || &bytes[..ORCHARD_PROOF_MAGIC.len()] != ORCHARD_PROOF_MAGIC
    {
        return Err(TachyonError::ProofVerification(
            "Orchard proof payload missing magic bytes".into(),
        ));
    }

    bincode::deserialize(&bytes[ORCHARD_PROOF_MAGIC.len()..])
        .map_err(|e| TachyonError::ProofVerification(format!("Failed to decode proof: {}", e)))
}

fn ensure_orchard_public_inputs_consistent(
    inner: &OrchardInnerPublicInputs,
    bundle_inputs: &zkpf_common::VerifierPublicInputs,
) -> Result<(), TachyonError> {
    if bundle_inputs.threshold_raw != inner.threshold_zats {
        return Err(TachyonError::ProofVerification(format!(
            "Threshold mismatch: bundle={}, inner={}",
            bundle_inputs.threshold_raw, inner.threshold_zats
        )));
    }

    let bundle_height = bundle_inputs
        .snapshot_block_height
        .ok_or_else(|| TachyonError::ProofVerification("Missing bundle block height".into()))?;
    if bundle_height as u32 != inner.height {
        return Err(TachyonError::ProofVerification(format!(
            "Height mismatch: bundle={}, inner={}",
            bundle_height, inner.height
        )));
    }

    let bundle_anchor = bundle_inputs
        .snapshot_anchor_orchard
        .ok_or_else(|| TachyonError::ProofVerification("Missing bundle anchor".into()))?;
    if bundle_anchor != inner.anchor_orchard {
        return Err(TachyonError::ProofVerification(
            "Anchor mismatch between bundle and proof".into(),
        ));
    }

    let inner_binding = inner.binding.ok_or_else(|| {
        TachyonError::ProofVerification("Orchard proof missing holder binding".into())
    })?;
    let bundle_binding = bundle_inputs
        .holder_binding
        .ok_or_else(|| TachyonError::ProofVerification("Bundle missing holder binding".into()))?;
    if inner_binding != bundle_binding {
        return Err(TachyonError::ProofVerification(
            "Holder binding mismatch between bundle and proof".into(),
        ));
    }

    let bundle_sum = bundle_inputs
        .proven_sum
        .ok_or_else(|| TachyonError::ProofVerification("Missing bundle proven_sum".into()))?;
    if bundle_sum != inner.sum_zats as u128 {
        return Err(TachyonError::ProofVerification(format!(
            "Proven sum mismatch: bundle={}, inner={}",
            bundle_sum, inner.sum_zats
        )));
    }

    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ChainEndpoint, RailConfig};
    use crate::types::{CurrencyCode, Epoch, HolderId, Policy};

    fn test_rail_config() -> RailConfig {
        RailConfig {
            rail_id: "TEST_RAIL".to_string(),
            enabled: true,
            endpoint: ChainEndpoint::Lightwalletd {
                url: "https://test.lightwalletd.com:9067".to_string(),
            },
            capabilities: vec![],
            priority: 1,
            max_notes: Some(256),
            artifact_path: None,
        }
    }

    fn test_policy() -> Policy {
        Policy {
            policy_id: 1001,
            label: "Test Policy".to_string(),
            verifier_scope_id: 42,
            currency: CurrencyCode::ZEC,
            threshold: 1_000_000, // 0.01 ZEC in zatoshi
            validity_window_secs: 3600,
            allowed_rails: vec!["ZCASH_ORCHARD".to_string()],
        }
    }

    fn test_epoch() -> Epoch {
        Epoch {
            timestamp: 1700000000,
            index: None,
            duration_secs: None,
        }
    }

    fn test_holder_id() -> HolderId {
        HolderId("test-holder-123".to_string())
    }

    #[test]
    fn test_rail_id_conversion() {
        assert_eq!(RailId::from_str("ZCASH_ORCHARD"), RailId::ZcashOrchard);
        assert_eq!(RailId::from_str("MINA_RECURSIVE"), RailId::MinaRecursive);
        assert_eq!(RailId::from_str("STARKNET_L2"), RailId::StarknetL2);
        assert_eq!(RailId::from_str("OMNI_BRIDGE"), RailId::OmniBridge);
        assert_eq!(RailId::from_str("UNKNOWN"), RailId::Custom("UNKNOWN".to_string()));
    }

    #[test]
    fn test_omni_bridge_capabilities() {
        let caps = RailId::OmniBridge.capabilities();
        assert!(caps.contains(&RailCapability::CrossChainBridge));
        assert!(caps.contains(&RailCapability::TokenTransfer));
        assert!(caps.contains(&RailCapability::BridgedAssetProof));
    }

    #[test]
    fn test_zcash_orchard_rail_creation() {
        let config = test_rail_config();
        let rail = ZcashOrchardRail::new(config);
        
        assert_eq!(rail.id(), RailId::ZcashOrchard);
        assert!(rail.capabilities().contains(&RailCapability::ShieldedBalance));
        assert!(rail.capabilities().contains(&RailCapability::PrivateTransfer));
    }

    #[test]
    fn test_mina_recursive_rail_creation() {
        let config = test_rail_config();
        let rail = MinaRecursiveRail::new(config);
        
        assert_eq!(rail.id(), RailId::MinaRecursive);
        assert!(rail.capabilities().contains(&RailCapability::RecursiveProof));
        assert!(rail.capabilities().contains(&RailCapability::ProofAggregation));
    }

    #[test]
    fn test_starknet_l2_rail_creation() {
        let config = test_rail_config();
        let rail = StarknetL2Rail::new(config);
        
        assert_eq!(rail.id(), RailId::StarknetL2);
        assert!(rail.capabilities().contains(&RailCapability::DeFiPosition));
        assert!(rail.capabilities().contains(&RailCapability::AccountAbstraction));
    }

    #[test]
    fn test_orchard_proof_envelope_serialization() {
        use zkpf_orchard_inner::OrchardInnerPublicInputs;

        let inner = OrchardInnerPublicInputs {
            anchor_orchard: [1u8; 32],
            height: 2000000,
            ufvk_commitment: [2u8; 32],
            threshold_zats: 1_000_000,
            sum_zats: 5_000_000,
            nullifiers: vec![],
            binding: Some([3u8; 32]),
        };
        let proof = vec![0u8; 64];

        let envelope = serialize_orchard_proof_envelope(&inner, proof.clone())
            .expect("serialization should succeed");
        
        assert!(envelope.starts_with(ORCHARD_PROOF_MAGIC));

        let decoded = deserialize_orchard_proof_envelope(&envelope)
            .expect("deserialization should succeed");
        
        assert_eq!(decoded.proof, proof);
        assert_eq!(decoded.inner_public_inputs.height, 2000000);
        assert_eq!(decoded.inner_public_inputs.sum_zats, 5_000_000);
    }

    #[test]
    fn test_orchard_proof_envelope_rejects_invalid_magic() {
        let invalid = b"INVALID_PAYLOAD";
        let result = deserialize_orchard_proof_envelope(invalid);
        assert!(result.is_err());
    }

    #[test]
    fn test_nullifier_computation() {
        let holder_id = test_holder_id();
        let policy = test_policy();
        let epoch = test_epoch();

        let nullifier1 = compute_nullifier(&holder_id, &policy, &epoch);
        let nullifier2 = compute_nullifier(&holder_id, &policy, &epoch);

        // Same inputs should produce same nullifier
        assert_eq!(nullifier1, nullifier2);
        assert_ne!(nullifier1, [0u8; 32]);

        // Different epoch should produce different nullifier
        let epoch2 = Epoch {
            timestamp: 1700000001,
            index: None,
            duration_secs: None,
        };
        let nullifier3 = compute_nullifier(&holder_id, &policy, &epoch2);
        assert_ne!(nullifier1, nullifier3);
    }

    #[test]
    fn test_holder_binding_computation() {
        let holder_id = test_holder_id();

        let binding1 = compute_holder_binding(&holder_id);
        let binding2 = compute_holder_binding(&holder_id);

        // Same inputs should produce same binding
        assert_eq!(binding1, binding2);
        assert_ne!(binding1, [0u8; 32]);

        // Different holder should produce different binding
        let holder_id2 = HolderId("other-holder-456".to_string());
        let binding3 = compute_holder_binding(&holder_id2);
        assert_ne!(binding1, binding3);
    }

    #[tokio::test]
    async fn test_zcash_orchard_rail_get_artifacts() {
        let config = test_rail_config();
        let rail = ZcashOrchardRail::new(config);
        
        let artifacts = rail.get_or_load_artifacts().await
            .expect("should get default artifacts");
        
        assert_eq!(artifacts.k, 11);
    }

    #[test]
    fn test_ensure_public_inputs_consistent() {
        use zkpf_orchard_inner::OrchardInnerPublicInputs;

        let inner = OrchardInnerPublicInputs {
            anchor_orchard: [1u8; 32],
            height: 2000000,
            ufvk_commitment: [2u8; 32],
            threshold_zats: 1_000_000,
            sum_zats: 5_000_000,
            nullifiers: vec![],
            binding: Some([3u8; 32]),
        };

        let bundle_inputs = zkpf_common::VerifierPublicInputs {
            threshold_raw: 1_000_000,
            required_currency_code: CurrencyCode::ZEC.as_u32(),
            current_epoch: 1700000000,
            verifier_scope_id: 42,
            policy_id: 1001,
            nullifier: [0u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(2000000),
            snapshot_anchor_orchard: Some([1u8; 32]),
            holder_binding: Some([3u8; 32]),
            proven_sum: Some(5_000_000),
        };

        let result = ensure_orchard_public_inputs_consistent(&inner, &bundle_inputs);
        assert!(result.is_ok());
    }

    #[test]
    fn test_ensure_public_inputs_detects_mismatch() {
        use zkpf_orchard_inner::OrchardInnerPublicInputs;

        let inner = OrchardInnerPublicInputs {
            anchor_orchard: [1u8; 32],
            height: 2000000,
            ufvk_commitment: [2u8; 32],
            threshold_zats: 1_000_000,
            sum_zats: 5_000_000,
            nullifiers: vec![],
            binding: Some([3u8; 32]),
        };

        // Mismatched threshold
        let bundle_inputs = zkpf_common::VerifierPublicInputs {
            threshold_raw: 999_999, // Wrong!
            required_currency_code: CurrencyCode::ZEC.as_u32(),
            current_epoch: 1700000000,
            verifier_scope_id: 42,
            policy_id: 1001,
            nullifier: [0u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(2000000),
            snapshot_anchor_orchard: Some([1u8; 32]),
            holder_binding: Some([3u8; 32]),
            proven_sum: Some(5_000_000),
        };

        let result = ensure_orchard_public_inputs_consistent(&inner, &bundle_inputs);
        assert!(result.is_err());
    }
}
