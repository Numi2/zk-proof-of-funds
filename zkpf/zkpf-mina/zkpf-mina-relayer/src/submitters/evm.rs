//! EVM chain submitter.

use anyhow::{Context, Result};
use async_trait::async_trait;
use ethers::{
    prelude::*,
    types::{Address, Bytes, U256},
};
use std::sync::Arc;
use tracing::{info, debug};

use super::Submitter;
use crate::queue::QueuedAttestation;

/// EVM chain submitter.
pub struct EvmSubmitter {
    chain_name: String,
    client: Arc<SignerMiddleware<Provider<Http>, LocalWallet>>,
    bridge_address: Address,
}

impl EvmSubmitter {
    pub fn new(
        rpc_url: String,
        bridge_address: String,
        private_key: Option<String>,
    ) -> Result<Self> {
        let provider = Provider::<Http>::try_from(&rpc_url)
            .context("Failed to create HTTP provider")?;

        let wallet = if let Some(key) = private_key {
            key.parse::<LocalWallet>()
                .context("Invalid private key")?
        } else {
            LocalWallet::new(&mut rand::thread_rng())
        };

        let chain_id = 1u64; // Will be fetched from provider in production
        let wallet = wallet.with_chain_id(chain_id);

        let client = SignerMiddleware::new(provider, wallet);

        let bridge_address: Address = bridge_address
            .parse()
            .unwrap_or(Address::zero());

        Ok(Self {
            chain_name: "ethereum".to_string(),
            client: Arc::new(client),
            bridge_address,
        })
    }
}

#[async_trait]
impl Submitter for EvmSubmitter {
    fn chain_name(&self) -> &str {
        &self.chain_name
    }

    async fn submit(&self, attestation: &QueuedAttestation) -> Result<String> {
        info!(
            "Submitting attestation to EVM: {:?}",
            hex::encode(&attestation.attestation_id[..8])
        );

        // Encode the attestation data for the bridge contract
        let attestation_data = ethers::abi::encode(&[
            ethers::abi::Token::FixedBytes(attestation.holder_binding.to_vec()),
            ethers::abi::Token::Uint(U256::from(attestation.policy_id)),
            ethers::abi::Token::Uint(U256::from(attestation.epoch)),
            ethers::abi::Token::Uint(U256::from(attestation.mina_slot)),
            ethers::abi::Token::Uint(U256::from(attestation.expires_at_slot)),
            ethers::abi::Token::FixedBytes(attestation.state_root.to_vec()),
        ]);

        // Encode Merkle proof
        let merkle_proof: Vec<ethers::abi::Token> = attestation
            .merkle_proof
            .iter()
            .map(|p| ethers::abi::Token::FixedBytes(p.to_vec()))
            .collect();

        let proof_data = ethers::abi::encode(&[
            ethers::abi::Token::FixedBytes(attestation.state_root.to_vec()),
            ethers::abi::Token::Uint(U256::from(attestation.mina_slot)),
            ethers::abi::Token::FixedBytes(
                ethers::utils::keccak256(&attestation_data).to_vec()
            ),
            ethers::abi::Token::Array(merkle_proof),
            ethers::abi::Token::Bytes(vec![]), // Empty state proof for trusted mode
        ]);

        // Build transaction to cacheAttestation
        // Function selector for cacheAttestation(Attestation,MinaProof)
        let selector = &ethers::utils::keccak256(
            "cacheAttestation((bytes32,uint64,uint64,uint64,uint64,uint256,bool),(bytes32,uint64,bytes32,bytes32[],bytes))"
        )[..4];

        let mut calldata = selector.to_vec();
        calldata.extend_from_slice(&attestation_data);
        calldata.extend_from_slice(&proof_data);

        // Create and send transaction
        let tx = TransactionRequest::new()
            .to(self.bridge_address)
            .data(Bytes::from(calldata))
            .gas(500_000u64);

        debug!("Sending transaction to bridge at {:?}", self.bridge_address);

        let pending_tx = self.client.send_transaction(tx, None).await?;
        let tx_hash = pending_tx.tx_hash();

        info!("Transaction submitted: {:?}", tx_hash);

        // Wait for confirmation
        let receipt = pending_tx
            .await?
            .context("Transaction failed")?;

        Ok(format!("{:?}", receipt.transaction_hash))
    }

    async fn health_check(&self) -> Result<bool> {
        let block = self.client.get_block_number().await?;
        debug!("EVM health check: block {}", block);
        Ok(true)
    }
}

