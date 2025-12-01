//! Starknet chain submitter.
//!
//! Submits attestations from Mina to Starknet using JSON-RPC.

use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{debug, info, warn};

use super::Submitter;
use crate::queue::QueuedAttestation;

/// Starknet chain submitter.
pub struct StarknetSubmitter {
    /// Chain name for logging.
    chain_name: String,
    /// Starknet RPC URL.
    rpc_url: String,
    /// Bridge contract address on Starknet.
    _bridge_address: String,
    /// Account address for signing transactions.
    account_address: Option<String>,
    /// Private key for signing (stark key).
    private_key: Option<String>,
    /// HTTP client.
    client: Client,
    /// Current chain ID.
    _chain_id: String,
}

impl StarknetSubmitter {
    /// Create a new Starknet submitter.
    pub fn new(
        rpc_url: String,
        bridge_address: String,
        account_address: Option<String>,
        private_key: Option<String>,
        chain_id: Option<String>,
    ) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            chain_name: "starknet".to_string(),
            rpc_url,
            _bridge_address: bridge_address,
            account_address,
            private_key,
            client,
            _chain_id: chain_id.unwrap_or_else(|| "SN_SEPOLIA".to_string()),
        })
    }

    /// Make a JSON-RPC call to Starknet.
    async fn rpc_call(&self, method: &str, params: Value) -> Result<Value> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let response = self
            .client
            .post(&self.rpc_url)
            .json(&request)
            .send()
            .await
            .context("Failed to send RPC request")?;

        let body: RpcResponse = response
            .json()
            .await
            .context("Failed to parse RPC response")?;

        if let Some(error) = body.error {
            anyhow::bail!("RPC error: {} - {}", error.code, error.message);
        }

        body.result.ok_or_else(|| anyhow::anyhow!("Empty RPC result"))
    }

    /// Encode attestation data as Cairo-compatible calldata.
    fn encode_attestation_calldata(&self, attestation: &QueuedAttestation) -> Vec<String> {
        // Cairo uses felt252 for most values
        // We encode each 32-byte array as two felt252 values (high, low)
        let mut calldata = Vec::new();

        // holder_binding as two felt252 (high, low)
        let (holder_high, holder_low) = bytes32_to_felts(&attestation.holder_binding);
        calldata.push(holder_high);
        calldata.push(holder_low);

        // policy_id as single felt252
        calldata.push(format!("0x{:x}", attestation.policy_id));

        // epoch as single felt252
        calldata.push(format!("0x{:x}", attestation.epoch));

        // mina_slot as single felt252
        calldata.push(format!("0x{:x}", attestation.mina_slot));

        // expires_at_slot as single felt252
        calldata.push(format!("0x{:x}", attestation.expires_at_slot));

        // state_root as two felt252 (high, low)
        let (state_high, state_low) = bytes32_to_felts(&attestation.state_root);
        calldata.push(state_high);
        calldata.push(state_low);

        // merkle_proof length
        calldata.push(format!("0x{:x}", attestation.merkle_proof.len()));

        // merkle_proof elements (each as two felt252)
        for proof_element in &attestation.merkle_proof {
            let (high, low) = bytes32_to_felts(proof_element);
            calldata.push(high);
            calldata.push(low);
        }

        calldata
    }

    /// Get the function selector for cacheMinaAttestation.
    fn cache_attestation_selector(&self) -> String {
        // Starknet uses keccak hash of the function signature
        // For simplicity, we use a pre-computed selector
        // selector = starknet_keccak("cacheMinaAttestation")
        "0x01234567890abcdef".to_string() // Placeholder - compute actual selector
    }

    /// Build an invoke transaction.
    fn build_invoke_transaction(
        &self,
        attestation: &QueuedAttestation,
    ) -> InvokeTransaction {
        let calldata = self.encode_attestation_calldata(attestation);
        let _selector = self.cache_attestation_selector();

        InvokeTransaction {
            r#type: "INVOKE".to_string(),
            sender_address: self.account_address.clone().unwrap_or_default(),
            calldata,
            max_fee: "0x0".to_string(), // Will be estimated
            version: "0x1".to_string(),
            signature: vec![], // To be signed
            nonce: "0x0".to_string(), // To be fetched
        }
    }

    /// Estimate fee for a transaction.
    async fn estimate_fee(&self, tx: &InvokeTransaction) -> Result<String> {
        let params = json!([{
            "type": tx.r#type,
            "sender_address": tx.sender_address,
            "calldata": tx.calldata,
            "max_fee": tx.max_fee,
            "version": tx.version,
            "signature": tx.signature,
            "nonce": tx.nonce,
        }]);

        let result = self
            .rpc_call("starknet_estimateFee", params)
            .await?;

        let fee = result
            .get(0)
            .and_then(|r| r.get("overall_fee"))
            .and_then(|f| f.as_str())
            .unwrap_or("0x1000000");

        Ok(fee.to_string())
    }

    /// Get the current nonce for the account.
    async fn get_nonce(&self) -> Result<String> {
        if self.account_address.is_none() {
            return Ok("0x0".to_string());
        }

        let params = json!({
            "contract_address": self.account_address,
            "block_id": "latest"
        });

        let result = self
            .rpc_call("starknet_getNonce", params)
            .await?;

        result
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("Invalid nonce response"))
    }

    /// Sign a transaction (placeholder - would use actual Stark signing).
    fn sign_transaction(&self, tx: &mut InvokeTransaction, _tx_hash: &str) -> Result<()> {
        // In a real implementation, this would:
        // 1. Compute the transaction hash
        // 2. Sign with the Stark private key
        // For now, we set placeholder signatures
        
        if self.private_key.is_none() {
            warn!("No private key configured, using empty signature");
            return Ok(());
        }

        // Placeholder signature (would be computed from private key)
        tx.signature = vec![
            "0x0".to_string(), // r
            "0x0".to_string(), // s
        ];

        Ok(())
    }
}

#[async_trait]
impl Submitter for StarknetSubmitter {
    fn chain_name(&self) -> &str {
        &self.chain_name
    }

    async fn submit(&self, attestation: &QueuedAttestation) -> Result<String> {
        info!(
            "Submitting attestation to Starknet: {:?}",
            hex::encode(&attestation.attestation_id[..8])
        );

        // Build the transaction
        let mut tx = self.build_invoke_transaction(attestation);

        // Get nonce
        tx.nonce = self.get_nonce().await.unwrap_or_else(|_| "0x0".to_string());

        // Estimate fee
        tx.max_fee = self.estimate_fee(&tx).await.unwrap_or_else(|_| "0x10000000000".to_string());

        // Sign the transaction
        let tx_hash = compute_invoke_hash(&tx); // Placeholder
        self.sign_transaction(&mut tx, &tx_hash)?;

        // Submit the transaction
        let params = json!({
            "invoke_transaction": {
                "type": tx.r#type,
                "sender_address": tx.sender_address,
                "calldata": tx.calldata,
                "max_fee": tx.max_fee,
                "version": tx.version,
                "signature": tx.signature,
                "nonce": tx.nonce,
            }
        });

        let result = self
            .rpc_call("starknet_addInvokeTransaction", params)
            .await?;

        let tx_hash = result
            .get("transaction_hash")
            .and_then(|h| h.as_str())
            .unwrap_or("unknown");

        info!("Transaction submitted: {}", tx_hash);

        // Wait for transaction to be accepted (with timeout)
        let mut attempts = 0;
        const MAX_ATTEMPTS: u32 = 30;
        const POLL_INTERVAL: u64 = 2;

        loop {
            attempts += 1;
            if attempts > MAX_ATTEMPTS {
                warn!("Transaction {} not confirmed after {} attempts", tx_hash, MAX_ATTEMPTS);
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(POLL_INTERVAL)).await;

            let status = self.get_transaction_status(tx_hash).await;
            match status {
                Ok(TxStatus::Accepted) | Ok(TxStatus::AcceptedOnL1) | Ok(TxStatus::AcceptedOnL2) => {
                    info!("Transaction {} confirmed", tx_hash);
                    break;
                }
                Ok(TxStatus::Rejected) => {
                    anyhow::bail!("Transaction {} was rejected", tx_hash);
                }
                Ok(TxStatus::Pending) => {
                    debug!("Transaction {} still pending...", tx_hash);
                }
                Err(e) => {
                    debug!("Failed to get status for {}: {}", tx_hash, e);
                }
            }
        }

        Ok(tx_hash.to_string())
    }

    async fn health_check(&self) -> Result<bool> {
        let result = self.rpc_call("starknet_blockNumber", json!([])).await?;
        let block = result.as_u64().unwrap_or(0);
        debug!("Starknet health check: block {}", block);
        Ok(true)
    }
}

impl StarknetSubmitter {
    /// Get transaction status.
    async fn get_transaction_status(&self, tx_hash: &str) -> Result<TxStatus> {
        let params = json!({
            "transaction_hash": tx_hash
        });

        let result = self
            .rpc_call("starknet_getTransactionReceipt", params)
            .await?;

        let status = result
            .get("finality_status")
            .or_else(|| result.get("status"))
            .and_then(|s| s.as_str())
            .unwrap_or("PENDING");

        match status {
            "ACCEPTED_ON_L1" => Ok(TxStatus::AcceptedOnL1),
            "ACCEPTED_ON_L2" => Ok(TxStatus::AcceptedOnL2),
            "REJECTED" => Ok(TxStatus::Rejected),
            _ => Ok(TxStatus::Pending),
        }
    }
}

/// Transaction status.
#[derive(Debug, Clone, PartialEq)]
enum TxStatus {
    Pending,
    #[allow(dead_code)]
    Accepted,
    AcceptedOnL1,
    AcceptedOnL2,
    Rejected,
}

/// JSON-RPC response.
#[derive(Debug, Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<RpcError>,
}

/// JSON-RPC error.
#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

/// Invoke transaction structure.
#[derive(Debug, Serialize)]
struct InvokeTransaction {
    r#type: String,
    sender_address: String,
    calldata: Vec<String>,
    max_fee: String,
    version: String,
    signature: Vec<String>,
    nonce: String,
}

/// Convert a 32-byte array to two felt252 values (high, low).
fn bytes32_to_felts(bytes: &[u8; 32]) -> (String, String) {
    // Split into high (first 16 bytes) and low (last 16 bytes)
    let high = u128::from_be_bytes(bytes[0..16].try_into().unwrap());
    let low = u128::from_be_bytes(bytes[16..32].try_into().unwrap());
    
    (format!("0x{:x}", high), format!("0x{:x}", low))
}

/// Compute the invoke transaction hash (placeholder).
fn compute_invoke_hash(tx: &InvokeTransaction) -> String {
    // In a real implementation, this would compute the Pedersen hash
    // of the transaction data according to Starknet's transaction hashing spec
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    tx.sender_address.hash(&mut hasher);
    tx.nonce.hash(&mut hasher);
    for data in &tx.calldata {
        data.hash(&mut hasher);
    }
    format!("0x{:x}", hasher.finish())
}

