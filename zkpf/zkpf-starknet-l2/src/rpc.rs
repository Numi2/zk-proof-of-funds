//! Starknet RPC client for reading account state.
//!
//! This module requires the `starknet-rpc` feature flag.

#![cfg(feature = "starknet-rpc")]

use starknet::{
    core::types::{BlockId, BlockTag, FieldElement, FunctionCall},
    providers::{jsonrpc::HttpTransport, JsonRpcClient, Provider},
};
use std::sync::Arc;
use url::Url;

use crate::{
    error::StarknetRailError,
    types::{StarknetChainConfig, known_tokens},
    state::get_token_metadata,
    StarknetAccountSnapshot, StarknetSnapshot, TokenBalance,
};

/// Starknet RPC client wrapper.
pub struct StarknetRpcClient {
    provider: Arc<JsonRpcClient<HttpTransport>>,
    config: StarknetChainConfig,
}

impl StarknetRpcClient {
    /// Create a new RPC client.
    pub fn new(config: StarknetChainConfig) -> Result<Self, StarknetRailError> {
        let url: Url = config.rpc_url.parse().map_err(|e: url::ParseError| {
            StarknetRailError::Rpc(format!("invalid RPC URL: {}", e))
        })?;
        let transport = HttpTransport::new(url);
        let provider = Arc::new(JsonRpcClient::new(transport));
        
        Ok(Self { provider, config })
    }

    /// Get the current block number.
    pub async fn get_block_number(&self) -> Result<u64, StarknetRailError> {
        self.provider
            .block_number()
            .await
            .map_err(|e| StarknetRailError::Rpc(e.to_string()))
    }

    /// Get ERC-20 balance for an account.
    pub async fn get_erc20_balance(
        &self,
        token_address: &str,
        account_address: &str,
    ) -> Result<u128, StarknetRailError> {
        let token = FieldElement::from_hex_be(token_address)
            .map_err(|e| StarknetRailError::InvalidInput(format!("invalid token address: {}", e)))?;
        let account = FieldElement::from_hex_be(account_address)
            .map_err(|e| StarknetRailError::InvalidInput(format!("invalid account address: {}", e)))?;

        // Call balanceOf(account) - standard ERC-20 interface
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap(); // "balanceOf" selector

        let call_result = self.provider
            .call(
                FunctionCall {
                    contract_address: token,
                    entry_point_selector: balance_selector,
                    calldata: vec![account],
                },
                BlockId::Tag(BlockTag::Latest),
            )
            .await
            .map_err(|e| StarknetRailError::Rpc(format!("balanceOf call failed: {}", e)))?;

        // ERC-20 returns (low, high) for u256
        if call_result.len() >= 2 {
            let low = felt_to_u128(&call_result[0]);
            let high = felt_to_u128(&call_result[1]);
            // Combine as u256, but we only support u128 for simplicity
            if high > 0 {
                Ok(u128::MAX) // Saturate if balance exceeds u128
            } else {
                Ok(low)
            }
        } else if call_result.len() == 1 {
            Ok(felt_to_u128(&call_result[0]))
        } else {
            Err(StarknetRailError::Rpc("unexpected balanceOf response".into()))
        }
    }

    /// Get native ETH balance for an account.
    pub async fn get_native_balance(&self, account_address: &str) -> Result<u128, StarknetRailError> {
        self.get_erc20_balance(known_tokens::ETH, account_address).await
    }

    /// Get account class hash.
    pub async fn get_class_hash(&self, account_address: &str) -> Result<String, StarknetRailError> {
        let address = FieldElement::from_hex_be(account_address)
            .map_err(|e| StarknetRailError::InvalidInput(format!("invalid address: {}", e)))?;

        let class_hash = self.provider
            .get_class_hash_at(BlockId::Tag(BlockTag::Latest), address)
            .await
            .map_err(|e| StarknetRailError::Rpc(format!("get_class_hash_at failed: {}", e)))?;

        Ok(format!("0x{:064x}", class_hash))
    }

    /// Build a complete account snapshot.
    pub async fn build_account_snapshot(
        &self,
        account_address: &str,
        tokens_to_check: &[&str],
    ) -> Result<StarknetAccountSnapshot, StarknetRailError> {
        let class_hash = self.get_class_hash(account_address).await?;
        let native_balance = self.get_native_balance(account_address).await?;

        let mut token_balances = vec![];
        for token_addr in tokens_to_check {
            let balance = self.get_erc20_balance(token_addr, account_address).await?;
            if balance > 0 {
                if let Some(meta) = get_token_metadata(token_addr) {
                    token_balances.push(TokenBalance {
                        token_address: token_addr.to_string(),
                        symbol: meta.symbol,
                        balance,
                        usd_value: None, // Would need price oracle
                    });
                }
            }
        }

        Ok(StarknetAccountSnapshot {
            address: account_address.to_string(),
            class_hash,
            native_balance,
            token_balances,
            defi_positions: vec![], // DeFi positions require protocol-specific queries
        })
    }

    /// Build a snapshot for multiple accounts.
    pub async fn build_snapshot(
        &self,
        account_addresses: &[&str],
        tokens_to_check: &[&str],
    ) -> Result<StarknetSnapshot, StarknetRailError> {
        let block_number = self.get_block_number().await?;
        
        // Get block info
        let block = self.provider
            .get_block_with_tx_hashes(BlockId::Number(block_number))
            .await
            .map_err(|e| StarknetRailError::Rpc(format!("get_block failed: {}", e)))?;

        let (block_hash, timestamp) = match block {
            starknet::core::types::MaybePendingBlockWithTxHashes::Block(b) => {
                (format!("0x{:064x}", b.block_hash), b.timestamp)
            }
            starknet::core::types::MaybePendingBlockWithTxHashes::PendingBlock(b) => {
                ("pending".to_string(), b.timestamp)
            }
        };

        let mut accounts = vec![];
        for addr in account_addresses {
            let snapshot = self.build_account_snapshot(addr, tokens_to_check).await?;
            accounts.push(snapshot);
        }

        Ok(StarknetSnapshot {
            chain_id: self.config.chain_id.clone(),
            block_number,
            block_hash,
            timestamp,
            accounts,
        })
    }

    /// Get the chain configuration.
    pub fn config(&self) -> &StarknetChainConfig {
        &self.config
    }
}

/// Convert a FieldElement to u128.
fn felt_to_u128(felt: &FieldElement) -> u128 {
    let bytes = felt.to_bytes_be();
    // Take the last 16 bytes (128 bits)
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&bytes[16..32]);
    u128::from_be_bytes(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests require a Starknet RPC endpoint
    // Run with: cargo test --features starknet-rpc -- --ignored

    #[tokio::test]
    #[ignore]
    async fn test_get_block_number() {
        let config = StarknetChainConfig::sepolia("https://starknet-sepolia.public.blastapi.io");
        let client = StarknetRpcClient::new(config).expect("should create client");
        let block = client.get_block_number().await.expect("should get block");
        assert!(block > 0);
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_native_balance() {
        let config = StarknetChainConfig::sepolia("https://starknet-sepolia.public.blastapi.io");
        let client = StarknetRpcClient::new(config).expect("should create client");
        
        // Use a known account with some balance on Sepolia
        let test_account = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
        let balance = client.get_native_balance(test_account).await;
        // This might fail if the account doesn't exist or has no balance
        println!("Balance result: {:?}", balance);
    }
}

