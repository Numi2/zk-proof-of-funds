//! Main wallet coordinator for the Tachyon wallet.
//!
//! The coordinator orchestrates all rails, manages state, and handles
//! proof generation and cross-chain attestations.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::aggregator::{AggregationResult, AggregationStrategy, ProofAggregator};
use crate::attestation::{AttestationProof, UnifiedAttestation};
use crate::config::{RailConfig, TachyonConfig};
use crate::error::TachyonError;
use crate::rails::{MinaRecursiveRail, Rail, RailId, StarknetL2Rail, ZcashOrchardRail};
use crate::state::{ProofRecord, ProofState, RailSyncState, UnifiedBalance, WalletState};
use crate::transport::{AxelarTransport, BroadcastResult};
use crate::types::{
    ChainId, CurrencyCode, Epoch, HolderId, Policy, ProofMetadata, ProofRequest, ProofResult,
    WalletId,
};
use zkpf_common::ProofBundle;

// ═══════════════════════════════════════════════════════════════════════════════
// TACHYON WALLET
// ═══════════════════════════════════════════════════════════════════════════════

/// The main Tachyon wallet coordinator.
///
/// Orchestrates proving across multiple chains while preserving privacy
/// and never bridging actual assets.
pub struct TachyonWallet {
    /// Wallet configuration.
    config: TachyonConfig,
    /// Wallet state (shared across async tasks).
    state: Arc<RwLock<WalletState>>,
    /// Available rails.
    rails: HashMap<String, Box<dyn Rail>>,
    /// Proof aggregator.
    aggregator: ProofAggregator,
    /// Cross-chain transport.
    transport: AxelarTransport,
    /// Whether the wallet is initialized.
    initialized: bool,
}

impl TachyonWallet {
    /// Create a new Tachyon wallet with the given configuration.
    pub fn new(config: TachyonConfig) -> Result<Self, TachyonError> {
        let transport = AxelarTransport::new(config.axelar.clone());
        let aggregator = ProofAggregator::new(AggregationStrategy::default());

        // Initialize rails based on configuration
        let mut rails: HashMap<String, Box<dyn Rail>> = HashMap::new();

        for (rail_id, rail_config) in &config.rails {
            let rail: Box<dyn Rail> = match rail_id.as_str() {
                "ZCASH_ORCHARD" => Box::new(ZcashOrchardRail::new(rail_config.clone())),
                "MINA_RECURSIVE" => Box::new(MinaRecursiveRail::new(rail_config.clone())),
                "STARKNET_L2" => Box::new(StarknetL2Rail::new(rail_config.clone())),
                _ => {
                    tracing::warn!("Unknown rail type: {}, skipping", rail_id);
                    continue;
                }
            };
            rails.insert(rail_id.clone(), rail);
        }

        // Create initial wallet state
        let wallet_id = WalletId([0u8; 32]); // Would be derived from seed
        let state = WalletState {
            wallet_id,
            balance: UnifiedBalance::default(),
            proofs: ProofState::default(),
            rail_sync: HashMap::new(),
            created_at: current_timestamp(),
            last_activity: current_timestamp(),
        };

        Ok(Self {
            config,
            state: Arc::new(RwLock::new(state)),
            rails,
            aggregator,
            transport,
            initialized: false,
        })
    }

    /// Initialize the wallet from a seed.
    pub async fn initialize(&mut self, seed_fingerprint: &[u8; 32]) -> Result<(), TachyonError> {
        if self.initialized {
            return Err(TachyonError::AlreadyInitialized);
        }

        let wallet_id = WalletId::from_seed_fingerprint(seed_fingerprint);

        let mut state = self.state.write().await;
        state.wallet_id = wallet_id;
        state.created_at = current_timestamp();
        drop(state);

        self.initialized = true;
        tracing::info!("Tachyon wallet initialized");

        Ok(())
    }

    /// Get the current wallet state.
    pub async fn state(&self) -> WalletState {
        self.state.read().await.clone()
    }

    /// Synchronize all enabled rails with their respective chains.
    pub async fn sync_all(&self) -> Result<SyncAllResult, TachyonError> {
        let mut results = HashMap::new();

        for (rail_id, rail) in &self.rails {
            if !rail.is_available().await {
                continue;
            }

            let sync_result = rail.sync().await;

            let sync_state = match &sync_result {
                Ok(status) => RailSyncState {
                    rail_id: rail_id.clone(),
                    synced: status.synced,
                    chain_height: status.chain_height,
                    scanned_height: status.wallet_height,
                    last_sync: current_timestamp(),
                    error: None,
                },
                Err(e) => RailSyncState {
                    rail_id: rail_id.clone(),
                    synced: false,
                    chain_height: 0,
                    scanned_height: 0,
                    last_sync: current_timestamp(),
                    error: Some(e.to_string()),
                },
            };

            results.insert(rail_id.clone(), sync_state.clone());

            // Update wallet state
            let mut state = self.state.write().await;
            state.rail_sync.insert(rail_id.clone(), sync_state);
        }

        Ok(SyncAllResult { rails: results })
    }

    /// Get unified balance across all chains.
    pub async fn get_balance(&self) -> Result<UnifiedBalance, TachyonError> {
        let mut unified = UnifiedBalance::default();

        for (rail_id, rail) in &self.rails {
            if !rail.is_available().await {
                continue;
            }

            // Query balance for common currencies
            for currency in [
                CurrencyCode::ZEC,
                CurrencyCode::ETH,
                CurrencyCode::USDC,
                CurrencyCode::STRK,
            ] {
                if let Ok(balance) = rail.get_balance(currency).await {
                    if balance.total > 0 {
                        let entry = unified.totals.entry(currency).or_default();
                        entry.total += balance.total;
                        entry.spendable += balance.spendable;
                        entry.pending += balance.pending;
                    }
                }
            }
        }

        unified.last_updated = current_timestamp();

        // Update state
        let mut state = self.state.write().await;
        state.balance = unified.clone();
        state.last_activity = current_timestamp();

        Ok(unified)
    }

    /// Generate a proof-of-funds for the given request.
    pub async fn prove(&self, request: ProofRequest) -> Result<ProofResult, TachyonError> {
        let start_time = std::time::Instant::now();

        // Select aggregation strategy
        let strategy = if request.aggregate_rails {
            AggregationStrategy::SumAcrossRails {
                rails: request
                    .policy
                    .allowed_rails
                    .clone()
                    .into_iter()
                    .filter(|r| !r.is_empty())
                    .collect(),
                fail_fast: false,
            }
        } else if let Some(ref rail) = request.preferred_rail {
            AggregationStrategy::SingleRail {
                rail_id: rail.clone(),
            }
        } else {
            // Default: use the rail with highest balance for the required currency
            AggregationStrategy::HighestBalance {
                rails: self.rails.keys().cloned().collect(),
            }
        };

        // Run aggregation
        let aggregator = ProofAggregator::new(strategy);
        let result = aggregator
            .aggregate(&self.rails, &request.holder_id, &request.policy, &request.epoch)
            .await?;

        let generation_time_ms = start_time.elapsed().as_millis() as u64;

        // Create attestation if cross-chain targets specified
        let attestation = if !request.target_chains.is_empty() {
            Some(self.create_attestation(&result.final_proof, &request).await?)
        } else {
            None
        };

        // Record the proof
        let proof_hash = compute_proof_hash(&result.final_proof);
        let record = ProofRecord {
            proof_hash,
            rail_id: result.final_proof.rail_id.clone(),
            policy_id: request.policy.policy_id,
            epoch: request.epoch.timestamp,
            generated_at: current_timestamp(),
            expires_at: current_timestamp() + request.policy.validity_window_secs,
            verified: false,
            target_chains: request
                .target_chains
                .iter()
                .map(|c| c.as_str().to_string())
                .collect(),
        };

        let mut state = self.state.write().await;
        state.proofs.recent_proofs.push(record.clone());
        state
            .proofs
            .last_proof_per_policy
            .insert(request.policy.policy_id, record);
        state.last_activity = current_timestamp();

        Ok(ProofResult {
            bundle: result.final_proof,
            rail_id: result
                .source_proofs
                .first()
                .map(|p| p.rail_id.clone())
                .unwrap_or_else(|| "AGGREGATED".to_string()),
            attestation,
            metadata: ProofMetadata {
                generation_time_ms,
                aggregated_count: result.source_proofs.len().max(1),
                block_heights: HashMap::new(), // Would be filled from rails
                cached: false,
            },
        })
    }

    /// Verify a proof bundle.
    pub async fn verify(&self, bundle: &ProofBundle) -> Result<bool, TachyonError> {
        let rail_id = RailId::from_str(&bundle.rail_id);

        // Find the appropriate rail for verification
        let rail = self
            .rails
            .get(rail_id.as_str())
            .ok_or_else(|| TachyonError::RailNotAvailable(bundle.rail_id.clone()))?;

        rail.verify(bundle).await
    }

    /// Broadcast an attestation to target chains via Axelar.
    pub async fn broadcast_attestation(
        &self,
        attestation: &UnifiedAttestation,
    ) -> Result<BroadcastResult, TachyonError> {
        self.transport
            .broadcast_attestation(attestation, &attestation.valid_on)
            .await
    }

    /// Get available rails.
    pub fn available_rails(&self) -> Vec<String> {
        self.rails.keys().cloned().collect()
    }

    /// Check if a specific rail is available.
    pub async fn is_rail_available(&self, rail_id: &str) -> bool {
        self.rails
            .get(rail_id)
            .map(|r| futures::executor::block_on(r.is_available()))
            .unwrap_or(false)
    }

    // === Private helpers ===

    async fn create_attestation(
        &self,
        bundle: &ProofBundle,
        request: &ProofRequest,
    ) -> Result<UnifiedAttestation, TachyonError> {
        let attestation_id = compute_attestation_id(
            &request.holder_id,
            request.policy.policy_id,
            request.epoch.timestamp,
        );

        let holder_binding = bundle
            .public_inputs
            .holder_binding
            .unwrap_or_else(|| compute_holder_binding(&request.holder_id));

        let proof = AttestationProof::Direct {
            proof: bundle.proof.clone(),
            public_inputs_hash: compute_public_inputs_hash(&bundle.public_inputs),
        };

        // Convert string chain IDs to ChainId enum
        let valid_on: Vec<ChainId> = request
            .target_chains
            .iter()
            .map(|s| match s.as_str() {
                "starknet_mainnet" => ChainId::StarknetMainnet,
                "starknet_sepolia" => ChainId::StarknetSepolia,
                "mina_mainnet" => ChainId::MinaMainnet,
                "mina_berkeley" => ChainId::MinaBerkeley,
                "near_mainnet" => ChainId::NearMainnet,
                "near_testnet" => ChainId::NearTestnet,
                "zcash_mainnet" => ChainId::ZcashMainnet,
                "zcash_testnet" => ChainId::ZcashTestnet,
                other => ChainId::Custom(other.to_string()),
            })
            .collect();

        Ok(UnifiedAttestation {
            attestation_id,
            holder_binding,
            policy_id: request.policy.policy_id,
            epoch: request.epoch.timestamp,
            source_rail: bundle.rail_id.clone(),
            valid_on,
            created_at: current_timestamp(),
            expires_at: current_timestamp() + request.policy.validity_window_secs,
            revoked: false,
            proof,
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of synchronizing all rails.
#[derive(Clone, Debug)]
pub struct SyncAllResult {
    /// Per-rail sync states.
    pub rails: HashMap<String, RailSyncState>,
}

impl SyncAllResult {
    /// Check if all rails are synced.
    pub fn all_synced(&self) -> bool {
        self.rails.values().all(|s| s.synced)
    }

    /// Get rails that failed to sync.
    pub fn failed_rails(&self) -> Vec<&str> {
        self.rails
            .iter()
            .filter(|(_, s)| s.error.is_some())
            .map(|(id, _)| id.as_str())
            .collect()
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs()
}

fn compute_proof_hash(bundle: &ProofBundle) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_proof_hash_v1");
    hasher.update(&bundle.proof);
    hasher.update(&bundle.public_inputs.nullifier);
    *hasher.finalize().as_bytes()
}

fn compute_attestation_id(holder_id: &HolderId, policy_id: u64, epoch: u64) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_attestation_id_v1");
    hasher.update(holder_id.0.as_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn compute_holder_binding(holder_id: &HolderId) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"tachyon_holder_binding_v1");
    hasher.update(holder_id.0.as_bytes());
    *hasher.finalize().as_bytes()
}

fn compute_public_inputs_hash(inputs: &zkpf_common::VerifierPublicInputs) -> [u8; 32] {
    let json = serde_json::to_vec(inputs).unwrap_or_default();
    *blake3::hash(&json).as_bytes()
}

