//! GraphQL client for Mina network interactions.
//!
//! This module provides a client for querying Mina's GraphQL API to fetch
//! account state, zkApp state, and submit transactions.

use serde::{Deserialize, Serialize};

use crate::{
    error::MinaRailError,
    types::{MinaAddress, MinaNetwork, MinaTxHash, ZkAppStateEntry},
};

/// Mina GraphQL client.
#[derive(Clone, Debug)]
pub struct MinaGraphQLClient {
    /// HTTP client.
    client: reqwest::Client,
    /// GraphQL endpoint URL.
    endpoint: String,
    /// Network identifier.
    network: MinaNetwork,
}

impl MinaGraphQLClient {
    /// Create a new GraphQL client.
    pub fn new(endpoint: impl Into<String>, network: MinaNetwork) -> Self {
        Self {
            client: reqwest::Client::new(),
            endpoint: endpoint.into(),
            network,
        }
    }

    /// Get the endpoint URL.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Get the network.
    pub fn network(&self) -> MinaNetwork {
        self.network
    }

    /// Fetch the current best chain tip.
    pub async fn get_chain_tip(&self) -> Result<ChainTip, MinaRailError> {
        let query = r#"
            query {
                bestChain(maxLength: 1) {
                    stateHash
                    protocolState {
                        consensusState {
                            blockHeight
                            slotSinceGenesis
                            epoch
                            slot
                        }
                        blockchainState {
                            snarkedLedgerHash
                            date
                        }
                    }
                }
            }
        "#;

        let response = self.execute_query(query, None).await?;
        let data: ChainTipResponse = serde_json::from_value(response)
            .map_err(|e| MinaRailError::GraphQL(format!("failed to parse response: {}", e)))?;

        data.data
            .best_chain
            .into_iter()
            .next()
            .ok_or_else(|| MinaRailError::GraphQL("no chain tip found".into()))
    }

    /// Fetch account information.
    pub async fn get_account(&self, address: &MinaAddress) -> Result<AccountInfo, MinaRailError> {
        let query = r#"
            query($publicKey: PublicKey!) {
                account(publicKey: $publicKey) {
                    publicKey
                    balance {
                        total
                    }
                    nonce
                    zkappState
                    zkappUri
                }
            }
        "#;

        let variables = serde_json::json!({
            "publicKey": address.as_str()
        });

        let response = self.execute_query(query, Some(variables)).await?;
        let data: AccountResponse = serde_json::from_value(response)
            .map_err(|e| MinaRailError::GraphQL(format!("failed to parse response: {}", e)))?;

        data.data
            .account
            .ok_or_else(|| MinaRailError::GraphQL("account not found".into()))
    }

    /// Fetch zkApp state for an address.
    pub async fn get_zkapp_state(
        &self,
        address: &MinaAddress,
    ) -> Result<Vec<ZkAppStateEntry>, MinaRailError> {
        let account = self.get_account(address).await?;

        let state = account
            .zkapp_state
            .unwrap_or_default()
            .into_iter()
            .enumerate()
            .map(|(idx, value)| ZkAppStateEntry {
                index: idx as u8,
                value: value.unwrap_or_else(|| "0".to_string()),
            })
            .collect();

        Ok(state)
    }

    /// Submit a signed transaction.
    pub async fn submit_transaction(
        &self,
        signed_tx: &str,
    ) -> Result<MinaTxHash, MinaRailError> {
        let mutation = r#"
            mutation($input: SendZkappInput!) {
                sendZkapp(input: $input) {
                    zkapp {
                        hash
                        id
                    }
                }
            }
        "#;

        let variables = serde_json::json!({
            "input": {
                "zkappCommand": signed_tx
            }
        });

        let response = self.execute_query(mutation, Some(variables)).await?;
        let data: SendZkappResponse = serde_json::from_value(response)
            .map_err(|e| MinaRailError::GraphQL(format!("failed to parse response: {}", e)))?;

        Ok(MinaTxHash::new(data.data.send_zkapp.zkapp.hash))
    }

    /// Get transaction status.
    pub async fn get_transaction_status(
        &self,
        tx_hash: &MinaTxHash,
    ) -> Result<TransactionStatus, MinaRailError> {
        let query = r#"
            query($hash: String!) {
                transactionStatus(hash: $hash)
            }
        "#;

        let variables = serde_json::json!({
            "hash": tx_hash.as_str()
        });

        let response = self.execute_query(query, Some(variables)).await?;
        let data: TransactionStatusResponse = serde_json::from_value(response)
            .map_err(|e| MinaRailError::GraphQL(format!("failed to parse response: {}", e)))?;

        Ok(data.data.transaction_status)
    }

    /// Execute a GraphQL query.
    async fn execute_query(
        &self,
        query: &str,
        variables: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, MinaRailError> {
        let body = serde_json::json!({
            "query": query,
            "variables": variables.unwrap_or(serde_json::json!({}))
        });

        let response = self
            .client
            .post(&self.endpoint)
            .json(&body)
            .send()
            .await
            .map_err(|e| MinaRailError::GraphQL(format!("request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(MinaRailError::GraphQL(format!(
                "request failed with status: {}",
                response.status()
            )));
        }

        response
            .json()
            .await
            .map_err(|e| MinaRailError::GraphQL(format!("failed to parse JSON: {}", e)))
    }
}

// === Response types ===

#[derive(Debug, Deserialize)]
struct ChainTipResponse {
    data: ChainTipData,
}

#[derive(Debug, Deserialize)]
struct ChainTipData {
    #[serde(rename = "bestChain")]
    best_chain: Vec<ChainTip>,
}

/// Chain tip information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainTip {
    #[serde(rename = "stateHash")]
    pub state_hash: String,
    #[serde(rename = "protocolState")]
    pub protocol_state: ProtocolState,
}

/// Protocol state information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProtocolState {
    #[serde(rename = "consensusState")]
    pub consensus_state: ConsensusState,
    #[serde(rename = "blockchainState")]
    pub blockchain_state: BlockchainState,
}

/// Consensus state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsensusState {
    #[serde(rename = "blockHeight")]
    pub block_height: String,
    #[serde(rename = "slotSinceGenesis")]
    pub slot_since_genesis: String,
    pub epoch: String,
    pub slot: String,
}

/// Blockchain state.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockchainState {
    #[serde(rename = "snarkedLedgerHash")]
    pub snarked_ledger_hash: String,
    pub date: String,
}

#[derive(Debug, Deserialize)]
struct AccountResponse {
    data: AccountData,
}

#[derive(Debug, Deserialize)]
struct AccountData {
    account: Option<AccountInfo>,
}

/// Account information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountInfo {
    #[serde(rename = "publicKey")]
    pub public_key: String,
    pub balance: AccountBalance,
    pub nonce: String,
    #[serde(rename = "zkappState")]
    pub zkapp_state: Option<Vec<Option<String>>>,
    #[serde(rename = "zkappUri")]
    pub zkapp_uri: Option<String>,
}

/// Account balance.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountBalance {
    pub total: String,
}

#[derive(Debug, Deserialize)]
struct SendZkappResponse {
    data: SendZkappData,
}

#[derive(Debug, Deserialize)]
struct SendZkappData {
    #[serde(rename = "sendZkapp")]
    send_zkapp: SendZkappResult,
}

#[derive(Debug, Deserialize)]
struct SendZkappResult {
    zkapp: ZkappTxInfo,
}

#[derive(Debug, Deserialize)]
struct ZkappTxInfo {
    hash: String,
    #[allow(dead_code)]
    id: String,
}

#[derive(Debug, Deserialize)]
struct TransactionStatusResponse {
    data: TransactionStatusData,
}

#[derive(Debug, Deserialize)]
struct TransactionStatusData {
    #[serde(rename = "transactionStatus")]
    transaction_status: TransactionStatus,
}

/// Transaction status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionStatus {
    Pending,
    Included,
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = MinaGraphQLClient::new(
            "https://proxy.testworld.minaprotocol.network/graphql",
            MinaNetwork::Testnet,
        );
        assert_eq!(client.network(), MinaNetwork::Testnet);
    }

    // Integration tests would go here with #[tokio::test] and #[ignore]
}

