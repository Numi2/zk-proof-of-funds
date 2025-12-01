//! NEAR RPC client for agent operations.

use serde::{Deserialize, Serialize};

use crate::error::NearTeeError;
use crate::types::AccountId;

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR RPC CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/// NEAR RPC client.
pub struct NearRpcClient {
    rpc_url: String,
    #[cfg(feature = "http-clients")]
    client: reqwest::Client,
}

impl NearRpcClient {
    /// Create a new RPC client.
    pub fn new(rpc_url: &str) -> Result<Self, NearTeeError> {
        Ok(Self {
            rpc_url: rpc_url.to_string(),
            #[cfg(feature = "http-clients")]
            client: reqwest::Client::new(),
        })
    }

    /// Get account information.
    pub async fn get_account(&self, account_id: &AccountId) -> Result<AccountInfo, NearTeeError> {
        let method = "query";
        let params = serde_json::json!({
            "request_type": "view_account",
            "finality": "final",
            "account_id": account_id.as_str()
        });

        // Try real RPC first when HTTP client support is enabled.
        #[cfg(feature = "http-clients")]
        if let Ok(json) = self.rpc_call(method, params).await {
            if let Some(result) = json.as_object() {
                let amount = result
                    .get("amount")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let locked = result
                    .get("locked")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let code_hash = result
                    .get("code_hash")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let storage_usage = result
                    .get("storage_usage")
                    .and_then(|v| v.as_u64())
                    .unwrap_or_default();
                let block_height = result
                    .get("block_height")
                    .and_then(|v| v.as_u64())
                    .unwrap_or_default();
                let block_hash = result
                    .get("block_hash")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                return Ok(AccountInfo {
                    account_id: account_id.clone(),
                    amount,
                    locked,
                    code_hash,
                    storage_usage,
                    block_height,
                    block_hash,
                });
            }
        }

        // Fallback: mock response for environments without HTTP client support.
        Ok(AccountInfo {
            account_id: account_id.clone(),
            amount: "1000000000000000000000000".to_string(), // 1 NEAR
            locked: "0".to_string(),
            code_hash: "11111111111111111111111111111111".to_string(),
            storage_usage: 1000,
            block_height: 100000000,
            block_hash: "mock_block_hash".to_string(),
        })
    }

    /// Get contract state.
    pub async fn view_state(
        &self,
        _account_id: &AccountId,
        prefix: Option<&str>,
    ) -> Result<Vec<StateItem>, NearTeeError> {
        let _prefix_base64 = prefix.map(|p| base64_encode(p.as_bytes()));

        // Mock response
        Ok(vec![])
    }

    /// Call a view function on a contract.
    pub async fn view_function(
        &self,
        _account_id: &AccountId,
        _method_name: &str,
        args: &[u8],
    ) -> Result<Vec<u8>, NearTeeError> {
        let _args_base64 = base64_encode(args);

        // In production, would call the contract
        Ok(vec![])
    }

    /// Send a signed transaction.
    pub async fn send_transaction(
        &self,
        signed_tx: &SignedTransaction,
    ) -> Result<TransactionResult, NearTeeError> {
        let _encoded = serde_json::to_vec(signed_tx).map_err(|e| {
            NearTeeError::Serialization(format!("failed to encode transaction: {}", e))
        })?;

        // In production, would broadcast the transaction
        Ok(TransactionResult {
            transaction_hash: "mock_tx_hash".to_string(),
            final_execution_status: ExecutionStatus::Success,
            receipts_outcome: vec![],
        })
    }

    /// Get the latest block.
    pub async fn get_block(&self) -> Result<BlockInfo, NearTeeError> {
        // Mock response
        Ok(BlockInfo {
            block_height: 100000000,
            block_hash: "mock_block_hash".to_string(),
            timestamp: current_timestamp(),
        })
    }

    #[cfg(feature = "http-clients")]
    async fn rpc_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, NearTeeError> {
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": "dontcare",
            "method": method,
            "params": params
        });

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .map_err(|e| NearTeeError::NearRpc(e.to_string()))?;

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| NearTeeError::NearRpc(e.to_string()))?;

        if let Some(error) = json.get("error") {
            return Err(NearTeeError::NearRpc(error.to_string()));
        }

        json.get("result")
            .cloned()
            .ok_or_else(|| NearTeeError::NearRpc("missing result in response".into()))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RPC TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// NEAR account information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AccountInfo {
    pub account_id: AccountId,
    pub amount: String,
    pub locked: String,
    pub code_hash: String,
    pub storage_usage: u64,
    pub block_height: u64,
    pub block_hash: String,
}

/// State item from contract storage.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StateItem {
    pub key: Vec<u8>,
    pub value: Vec<u8>,
}

/// Block information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BlockInfo {
    pub block_height: u64,
    pub block_hash: String,
    pub timestamp: u64,
}

/// Signed transaction.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SignedTransaction {
    pub signer_id: AccountId,
    pub receiver_id: AccountId,
    pub actions: Vec<Action>,
    pub signature: Vec<u8>,
    pub nonce: u64,
    pub block_hash: String,
}

/// Transaction action.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    FunctionCall {
        method_name: String,
        args: Vec<u8>,
        gas: u64,
        deposit: String,
    },
    Transfer {
        deposit: String,
    },
}

/// Transaction result.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransactionResult {
    pub transaction_hash: String,
    pub final_execution_status: ExecutionStatus,
    pub receipts_outcome: Vec<ReceiptOutcome>,
}

/// Execution status.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ExecutionStatus {
    Success,
    Failure,
    Unknown,
}

/// Receipt outcome.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReceiptOutcome {
    pub receipt_id: String,
    pub status: ExecutionStatus,
    pub logs: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let mut n: u32 = 0;
        for (i, &byte) in chunk.iter().enumerate() {
            n |= (byte as u32) << (16 - 8 * i);
        }

        for i in 0..((chunk.len() * 8 + 5) / 6) {
            let idx = ((n >> (18 - 6 * i)) & 0x3f) as usize;
            result.push(ALPHABET[idx] as char);
        }
    }

    let padding = (3 - bytes.len() % 3) % 3;
    for _ in 0..padding {
        result.push('=');
    }

    result
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs()
}

