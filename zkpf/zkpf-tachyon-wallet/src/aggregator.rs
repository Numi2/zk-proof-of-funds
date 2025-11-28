//! Proof aggregation for the Tachyon wallet.
//!
//! The aggregator combines proofs from multiple rails into a single
//! unified attestation. Mina serves as the primary aggregation hub
//! using recursive SNARKs.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::TachyonError;
use crate::rails::{Rail, RailId};
use crate::types::{Epoch, HolderId, Policy, ProofResult};
use zkpf_common::ProofBundle;

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

/// Strategy for aggregating proofs across rails.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AggregationStrategy {
    /// Use a single rail (no aggregation).
    SingleRail {
        rail_id: String,
    },
    /// Sum balances across rails, aggregate proofs via Mina.
    SumAcrossRails {
        /// Rails to include in aggregation.
        rails: Vec<String>,
        /// Whether to fail if any rail fails, or continue with available rails.
        fail_fast: bool,
    },
    /// Use the rail with the highest balance.
    HighestBalance {
        /// Rails to consider.
        rails: Vec<String>,
    },
    /// Custom selection logic.
    Custom {
        /// Name of the custom strategy.
        name: String,
        /// Strategy parameters.
        params: HashMap<String, String>,
    },
}

impl Default for AggregationStrategy {
    fn default() -> Self {
        Self::SingleRail {
            rail_id: "ZCASH_ORCHARD".to_string(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF AGGREGATOR
// ═══════════════════════════════════════════════════════════════════════════════

/// Aggregates proofs from multiple rails.
pub struct ProofAggregator {
    strategy: AggregationStrategy,
}

impl ProofAggregator {
    pub fn new(strategy: AggregationStrategy) -> Self {
        Self { strategy }
    }

    pub fn with_strategy(mut self, strategy: AggregationStrategy) -> Self {
        self.strategy = strategy;
        self
    }

    /// Aggregate proofs according to the configured strategy.
    pub async fn aggregate(
        &self,
        rails: &HashMap<String, Box<dyn Rail>>,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<AggregationResult, TachyonError> {
        match &self.strategy {
            AggregationStrategy::SingleRail { rail_id } => {
                self.single_rail(rails, rail_id, holder_id, policy, epoch)
                    .await
            }
            AggregationStrategy::SumAcrossRails { rails: rail_ids, fail_fast } => {
                self.sum_across_rails(rails, rail_ids, holder_id, policy, epoch, *fail_fast)
                    .await
            }
            AggregationStrategy::HighestBalance { rails: rail_ids } => {
                self.highest_balance(rails, rail_ids, holder_id, policy, epoch)
                    .await
            }
            AggregationStrategy::Custom { name, .. } => Err(TachyonError::InvalidConfig(format!(
                "custom strategy '{}' not implemented",
                name
            ))),
        }
    }

    async fn single_rail(
        &self,
        rails: &HashMap<String, Box<dyn Rail>>,
        rail_id: &str,
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<AggregationResult, TachyonError> {
        let rail = rails
            .get(rail_id)
            .ok_or_else(|| TachyonError::RailNotAvailable(rail_id.to_string()))?;

        if !rail.is_available().await {
            return Err(TachyonError::RailNotAvailable(rail_id.to_string()));
        }

        let bundle = rail.prove(holder_id, policy, epoch).await?;

        Ok(AggregationResult {
            final_proof: bundle,
            source_proofs: vec![],
            strategy_used: AggregationStrategy::SingleRail {
                rail_id: rail_id.to_string(),
            },
            aggregated_via_mina: false,
            total_proven_amount: 0, // Would be filled from bundle
        })
    }

    async fn sum_across_rails(
        &self,
        rails: &HashMap<String, Box<dyn Rail>>,
        rail_ids: &[String],
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
        fail_fast: bool,
    ) -> Result<AggregationResult, TachyonError> {
        let mut source_proofs: Vec<ProofBundle> = Vec::new();
        let mut errors: Vec<(String, TachyonError)> = Vec::new();

        // Collect proofs from each rail
        for rail_id in rail_ids {
            let rail = match rails.get(rail_id) {
                Some(r) => r,
                None => {
                    if fail_fast {
                        return Err(TachyonError::RailNotAvailable(rail_id.clone()));
                    }
                    continue;
                }
            };

            if !rail.is_available().await {
                if fail_fast {
                    return Err(TachyonError::RailNotAvailable(rail_id.clone()));
                }
                continue;
            }

            match rail.prove(holder_id, policy, epoch).await {
                Ok(bundle) => source_proofs.push(bundle),
                Err(e) => {
                    if fail_fast {
                        return Err(e);
                    }
                    errors.push((rail_id.clone(), e));
                }
            }
        }

        if source_proofs.is_empty() {
            return Err(TachyonError::ProofGeneration(
                "no proofs generated from any rail".to_string(),
            ));
        }

        // If we have multiple proofs, aggregate via Mina
        if source_proofs.len() > 1 {
            let aggregated = self
                .aggregate_via_mina(&source_proofs, holder_id, policy, epoch)
                .await?;

            Ok(AggregationResult {
                final_proof: aggregated,
                source_proofs,
                strategy_used: AggregationStrategy::SumAcrossRails {
                    rails: rail_ids.to_vec(),
                    fail_fast,
                },
                aggregated_via_mina: true,
                total_proven_amount: 0, // Sum from bundles
            })
        } else {
            // Single proof, no aggregation needed
            let bundle = source_proofs.into_iter().next().unwrap();
            Ok(AggregationResult {
                final_proof: bundle,
                source_proofs: vec![],
                strategy_used: AggregationStrategy::SumAcrossRails {
                    rails: rail_ids.to_vec(),
                    fail_fast,
                },
                aggregated_via_mina: false,
                total_proven_amount: 0,
            })
        }
    }

    async fn highest_balance(
        &self,
        rails: &HashMap<String, Box<dyn Rail>>,
        rail_ids: &[String],
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<AggregationResult, TachyonError> {
        let mut best_rail: Option<(&str, u128)> = None;

        // Find rail with highest balance for the policy currency
        for rail_id in rail_ids {
            let rail = match rails.get(rail_id) {
                Some(r) => r,
                None => continue,
            };

            if !rail.is_available().await {
                continue;
            }

            let balance = rail.get_balance(policy.currency).await?;
            let current = best_rail.map(|(_, b)| b).unwrap_or(0);

            if balance.total > current {
                best_rail = Some((rail_id, balance.total));
            }
        }

        let (rail_id, _) = best_rail.ok_or_else(|| {
            TachyonError::ProofGeneration("no available rail with positive balance".to_string())
        })?;

        // Generate proof from the best rail
        self.single_rail(rails, rail_id, holder_id, policy, epoch)
            .await
    }

    async fn aggregate_via_mina(
        &self,
        source_proofs: &[ProofBundle],
        holder_id: &HolderId,
        policy: &Policy,
        epoch: &Epoch,
    ) -> Result<ProofBundle, TachyonError> {
        use zkpf_mina::{MinaPublicMeta, PublicMetaInputs, SourceProofInput};

        let source_inputs: Vec<SourceProofInput> = source_proofs
            .iter()
            .map(|bundle| SourceProofInput {
                bundle: bundle.clone(),
                rail_metadata: serde_json::Value::Null,
            })
            .collect();

        let mina_meta = MinaPublicMeta {
            network_id: "mainnet".to_string(),
            network_id_numeric: 0,
            global_slot: epoch.timestamp,
            zkapp_address: "B62q...".to_string(), // TODO: Configure
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: source_proofs
                .iter()
                .map(|b| b.rail_id.clone())
                .collect(),
        };

        let public_meta = PublicMetaInputs {
            policy_id: policy.policy_id,
            verifier_scope_id: policy.verifier_scope_id,
            current_epoch: epoch.timestamp,
            required_currency_code: policy.currency.as_u32(),
        };

        zkpf_mina::prove_mina_recursive(&source_inputs, &holder_id.0, &mina_meta, &public_meta)
            .map_err(Into::into)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATION RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of proof aggregation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AggregationResult {
    /// The final aggregated proof.
    pub final_proof: ProofBundle,
    /// Source proofs that were aggregated (empty if single-rail).
    pub source_proofs: Vec<ProofBundle>,
    /// Strategy that was used.
    pub strategy_used: AggregationStrategy,
    /// Whether Mina recursive aggregation was used.
    pub aggregated_via_mina: bool,
    /// Total proven amount across all sources.
    pub total_proven_amount: u128,
}

