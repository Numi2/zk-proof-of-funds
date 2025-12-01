//! Core Omni Bridge client implementation.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::chains::{ChainCapability, SupportedChain};
use crate::config::OmniBridgeConfig;
use crate::error::{BridgeResult, OmniBridgeError};
use crate::proof::{BridgedAssetProof, CrossChainAttestation};
use crate::tokens::TokenRegistry;
use crate::transfer::{TransferRequest, TransferResult, TransferStatus};
use crate::types::{BridgeAddress, BridgeAsset, BridgeChainId, BridgeFee};

/// Capabilities provided by the Omni Bridge.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BridgeCapability {
    /// Can transfer tokens between chains.
    TokenTransfer,
    /// Can generate proofs of bridged assets.
    AssetProof,
    /// Can create cross-chain attestations.
    CrossChainAttestation,
    /// Supports fast finality mode.
    FastFinality,
    /// Supports batched transfers.
    BatchedTransfers,
    /// Can query historical transfers.
    HistoricalQueries,
}

/// Main Omni Bridge client.
pub struct OmniBridge {
    /// Configuration.
    config: OmniBridgeConfig,
    /// Token registry.
    tokens: TokenRegistry,
    /// Active transfers.
    active_transfers: Arc<RwLock<HashMap<[u8; 32], TransferResult>>>,
    /// Connected chains.
    connected_chains: Arc<RwLock<HashSet<BridgeChainId>>>,
    /// Cached balances per chain.
    balances: Arc<RwLock<HashMap<String, u128>>>,
}

impl OmniBridge {
    /// Create a new Omni Bridge client.
    pub fn new(config: OmniBridgeConfig) -> Self {
        Self {
            config,
            tokens: TokenRegistry::with_common_tokens(),
            active_transfers: Arc::new(RwLock::new(HashMap::new())),
            connected_chains: Arc::new(RwLock::new(HashSet::new())),
            balances: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Create with default mainnet configuration.
    pub fn mainnet() -> Self {
        Self::new(OmniBridgeConfig::default())
    }

    /// Create with testnet configuration.
    pub fn testnet() -> Self {
        Self::new(OmniBridgeConfig::testnet())
    }

    /// Get the configuration.
    pub fn config(&self) -> &OmniBridgeConfig {
        &self.config
    }

    /// Get the token registry.
    pub fn tokens(&self) -> &TokenRegistry {
        &self.tokens
    }

    /// Get a mutable reference to the token registry.
    pub fn tokens_mut(&mut self) -> &mut TokenRegistry {
        &mut self.tokens
    }

    /// Check if the bridge is enabled.
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Get supported capabilities.
    pub fn capabilities(&self) -> HashSet<BridgeCapability> {
        let mut caps = HashSet::new();
        caps.insert(BridgeCapability::TokenTransfer);
        caps.insert(BridgeCapability::AssetProof);
        caps.insert(BridgeCapability::CrossChainAttestation);

        if self
            .config
            .endpoints
            .values()
            .any(|e| e.ws_url.is_some())
        {
            caps.insert(BridgeCapability::FastFinality);
        }

        caps
    }

    /// Connect to a chain.
    pub async fn connect_chain(&self, chain: &BridgeChainId) -> BridgeResult<()> {
        let endpoint = self.config.endpoint_for_chain(chain).ok_or_else(|| {
            OmniBridgeError::UnsupportedChain(format!("No endpoint configured for {}", chain))
        })?;

        if !endpoint.healthy {
            return Err(OmniBridgeError::Rpc(format!(
                "Endpoint for {} is unhealthy",
                chain
            )));
        }

        // In production, this would establish actual connections
        // For now, mark as connected
        self.connected_chains.write().await.insert(chain.clone());

        tracing::info!(chain = %chain, "Connected to chain via Omni Bridge");
        Ok(())
    }

    /// Disconnect from a chain.
    pub async fn disconnect_chain(&self, chain: &BridgeChainId) {
        self.connected_chains.write().await.remove(chain);
        tracing::info!(chain = %chain, "Disconnected from chain");
    }

    /// Check if connected to a chain.
    pub async fn is_connected(&self, chain: &BridgeChainId) -> bool {
        self.connected_chains.read().await.contains(chain)
    }

    /// Get all connected chains.
    pub async fn connected_chains(&self) -> Vec<BridgeChainId> {
        self.connected_chains.read().await.iter().cloned().collect()
    }

    /// Get supported chains.
    pub fn supported_chains(&self) -> Vec<SupportedChain> {
        if self.config.use_testnet {
            SupportedChain::testnets()
        } else {
            SupportedChain::mainnets()
        }
    }

    /// Estimate fees for a transfer.
    pub async fn estimate_fee(&self, request: &TransferRequest) -> BridgeResult<BridgeFee> {
        request.validate()?;

        // Get chain info for gas estimation
        let source_chain = SupportedChain::by_id(&request.source_chain).ok_or_else(|| {
            OmniBridgeError::UnsupportedChain(request.source_chain.to_string())
        })?;

        let dest_chain = SupportedChain::by_id(&request.destination_chain).ok_or_else(|| {
            OmniBridgeError::UnsupportedChain(request.destination_chain.to_string())
        })?;

        // Base fee calculation (simplified)
        // In production, this would query actual gas prices and bridge fees
        let base_fee = match &request.source_chain {
            BridgeChainId::NearMainnet | BridgeChainId::NearTestnet => {
                // NEAR has very low fees
                1_000_000_000_000_000_000_u128 // 0.001 NEAR
            }
            chain if chain.is_evm() => {
                // EVM chains have variable gas
                50_000_000_000_000_000_u128 // 0.05 ETH (overestimate)
            }
            BridgeChainId::SolanaMainnet | BridgeChainId::SolanaDevnet => {
                // Solana has fixed low fees
                5_000_u128 // lamports
            }
            _ => 0,
        };

        // Add destination chain fee
        let dest_fee = if dest_chain.has_capability(&ChainCapability::FastFinality) {
            base_fee / 10 // Lower fees for fast finality chains
        } else {
            base_fee / 5
        };

        let total_fee = base_fee + dest_fee;
        let fast_multiplier = if request.fast_mode { 2 } else { 1 };

        Ok(BridgeFee {
            amount: total_fee * fast_multiplier,
            currency: source_chain.native_currency.clone(),
            recipient: Some(self.config.near_bridge_contracts.omni_locker.clone()),
        })
    }

    /// Initiate a bridge transfer.
    pub async fn transfer(&self, request: TransferRequest) -> BridgeResult<TransferResult> {
        // Validate the request
        request.validate()?;

        // Check connections
        if !self.is_connected(&request.source_chain).await {
            self.connect_chain(&request.source_chain).await?;
        }
        if !self.is_connected(&request.destination_chain).await {
            self.connect_chain(&request.destination_chain).await?;
        }

        // Check token bridgeability
        self.tokens.can_bridge(
            request.asset.symbol(),
            &request.source_chain,
            &request.destination_chain,
        )?;

        // Estimate fees
        let estimated_fee = self.estimate_fee(&request).await?;

        // Create pending result
        let mut result = TransferResult::pending(&request);
        result.estimated_fee = Some(estimated_fee);

        // Calculate estimated completion time based on chain finality
        let source_chain = SupportedChain::by_id(&request.source_chain);
        let dest_chain = SupportedChain::by_id(&request.destination_chain);

        if let (Some(src), Some(dst)) = (source_chain, dest_chain) {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();

            let estimated_time = src.finality_secs + dst.finality_secs + 60; // +60s buffer
            result.estimated_completion = Some(now + estimated_time);
        }

        // Store the transfer
        self.active_transfers
            .write()
            .await
            .insert(result.transfer_id, result.clone());

        tracing::info!(
            transfer_id = hex::encode(result.transfer_id),
            source = %request.source_chain,
            destination = %request.destination_chain,
            amount = request.amount,
            "Initiated bridge transfer"
        );

        // In production, this would:
        // 1. Call the Omni Bridge SDK to lock/burn on source
        // 2. Wait for source confirmation
        // 3. Generate proof/VAA
        // 4. Submit to destination
        // For now, we return the pending result

        Ok(result)
    }

    /// Get the status of a transfer.
    pub async fn get_transfer(&self, transfer_id: &[u8; 32]) -> Option<TransferResult> {
        self.active_transfers.read().await.get(transfer_id).cloned()
    }

    /// Get all active transfers.
    pub async fn active_transfers(&self) -> Vec<TransferResult> {
        self.active_transfers
            .read()
            .await
            .values()
            .filter(|t| !t.status.is_terminal())
            .cloned()
            .collect()
    }

    /// Get transfer history.
    pub async fn transfer_history(&self) -> Vec<TransferResult> {
        self.active_transfers
            .read()
            .await
            .values()
            .cloned()
            .collect()
    }

    /// Cancel a pending transfer.
    pub async fn cancel_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult> {
        let mut transfers = self.active_transfers.write().await;

        let transfer = transfers.get_mut(transfer_id).ok_or_else(|| {
            OmniBridgeError::TransferFailed("Transfer not found".into())
        })?;

        if transfer.status != TransferStatus::Pending {
            return Err(OmniBridgeError::NotPermitted(
                "Can only cancel pending transfers".into(),
            ));
        }

        transfer.status = TransferStatus::Refunded;
        Ok(transfer.clone())
    }

    /// Get balance for an address on a chain.
    pub async fn get_balance(
        &self,
        chain: &BridgeChainId,
        address: &BridgeAddress,
        asset: &BridgeAsset,
    ) -> BridgeResult<u128> {
        if !self.is_connected(chain).await {
            self.connect_chain(chain).await?;
        }

        // In production, this would query the actual chain
        // For now, return cached or zero
        let key = format!("{}:{}:{}", chain, address, asset.symbol());
        let balance = self.balances.read().await.get(&key).copied().unwrap_or(0);

        Ok(balance)
    }

    /// Generate a proof of bridged assets.
    pub async fn prove_bridged_assets(
        &self,
        chain: &BridgeChainId,
        address: &BridgeAddress,
        assets: &[BridgeAsset],
    ) -> BridgeResult<BridgedAssetProof> {
        if !self.is_connected(chain).await {
            self.connect_chain(chain).await?;
        }

        // Collect balances
        let mut asset_balances = Vec::new();
        for asset in assets {
            let balance = self.get_balance(chain, address, asset).await?;
            asset_balances.push((asset.clone(), balance));
        }

        // Generate proof
        let proof = BridgedAssetProof::new(chain.clone(), address.clone(), asset_balances);

        Ok(proof)
    }

    /// Create a cross-chain attestation.
    pub async fn create_attestation(
        &self,
        holder_id: &[u8; 32],
        source_chain: &BridgeChainId,
        destination_chain: &BridgeChainId,
        proof: &BridgedAssetProof,
    ) -> BridgeResult<CrossChainAttestation> {
        let attestation = CrossChainAttestation::create(
            holder_id,
            source_chain.clone(),
            destination_chain.clone(),
            proof.clone(),
        );

        Ok(attestation)
    }
}

/// Trait for bridge operations.
#[async_trait]
pub trait BridgeOperations: Send + Sync {
    /// Initiate a token transfer.
    async fn initiate_transfer(&self, request: TransferRequest) -> BridgeResult<TransferResult>;

    /// Complete a transfer on the destination chain.
    async fn complete_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult>;

    /// Refund a failed transfer.
    async fn refund_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult>;

    /// Query transfer status.
    async fn query_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult>;
}

#[async_trait]
impl BridgeOperations for OmniBridge {
    async fn initiate_transfer(&self, request: TransferRequest) -> BridgeResult<TransferResult> {
        self.transfer(request).await
    }

    async fn complete_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult> {
        let mut transfers = self.active_transfers.write().await;

        let transfer = transfers.get_mut(transfer_id).ok_or_else(|| {
            OmniBridgeError::TransferFailed("Transfer not found".into())
        })?;

        if transfer.status.is_terminal() {
            return Err(OmniBridgeError::NotPermitted(
                "Transfer is already in terminal state".into(),
            ));
        }

        // In production, this would submit the finalization transaction
        transfer.status = TransferStatus::Completed;
        transfer.metadata.completed_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        );

        Ok(transfer.clone())
    }

    async fn refund_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult> {
        self.cancel_transfer(transfer_id).await
    }

    async fn query_transfer(&self, transfer_id: &[u8; 32]) -> BridgeResult<TransferResult> {
        self.get_transfer(transfer_id).await.ok_or_else(|| {
            OmniBridgeError::TransferFailed("Transfer not found".into())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_creation() {
        let bridge = OmniBridge::mainnet();
        assert!(bridge.is_enabled());
        assert!(bridge.capabilities().contains(&BridgeCapability::TokenTransfer));
    }

    #[test]
    fn test_supported_chains() {
        let bridge = OmniBridge::mainnet();
        let chains = bridge.supported_chains();
        assert!(!chains.is_empty());
        assert!(chains.iter().any(|c| c.chain_id == BridgeChainId::NearMainnet));
    }

    #[tokio::test]
    async fn test_connect_chain() {
        let bridge = OmniBridge::mainnet();
        let result = bridge.connect_chain(&BridgeChainId::NearMainnet).await;
        assert!(result.is_ok());
        assert!(bridge.is_connected(&BridgeChainId::NearMainnet).await);
    }

    #[test]
    fn test_token_registry() {
        let bridge = OmniBridge::mainnet();
        assert!(bridge.tokens().get("USDC").is_some());
        assert!(bridge.tokens().get("WETH").is_some());
    }
}

