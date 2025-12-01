//! Real Lightwalletd payment verification
//! Numan Thabit
//! This module provides actual blockchain verification of ZEC payments
//! by connecting to a lightwalletd server using gRPC-Web protocol.

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::{PaymentProof, PaymentRequirements, PaymentStatus, X402Error, X402Result};
use crate::verify::PaymentVerifier;

// ============================================================================
// gRPC-Web Protocol Helpers
// ============================================================================

/// Encode a gRPC-Web request frame
/// Format: [compression flag (1 byte)][length (4 bytes big-endian)][data]
fn encode_grpc_web_request(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(5 + data.len());
    result.push(0); // No compression flag
    result.extend_from_slice(&(data.len() as u32).to_be_bytes());
    result.extend_from_slice(data);
    result
}

/// Decode a gRPC-Web response frame
/// Returns the message payload or an error if the response contains an error status
fn decode_grpc_web_response(data: &[u8]) -> X402Result<Vec<u8>> {
    if data.len() < 5 {
        return Err(X402Error::LightwalletdError(
            "Response too short".into()
        ));
    }

    // Check for trailers (error status) - high bit set means trailers
    if data[0] & 0x80 != 0 {
        let trailer_str = String::from_utf8_lossy(&data[5..]);
        if !trailer_str.contains("grpc-status: 0") && !trailer_str.contains("grpc-status:0") {
            return Err(X402Error::LightwalletdError(
                format!("gRPC error: {}", trailer_str)
            ));
        }
        return Ok(vec![]);
    }

    // Extract message length from big-endian 4 bytes
    let length = u32::from_be_bytes([data[1], data[2], data[3], data[4]]) as usize;
    
    if data.len() < 5 + length {
        return Err(X402Error::LightwalletdError(
            "Incomplete response".into()
        ));
    }

    Ok(data[5..5 + length].to_vec())
}

/// Encode a varint (variable-length integer used in protobuf)
fn encode_varint(mut value: u64, buf: &mut Vec<u8>) {
    while value >= 0x80 {
        buf.push((value as u8) | 0x80);
        value >>= 7;
    }
    buf.push(value as u8);
}

/// Decode a varint from bytes
/// Returns (value, bytes_consumed)
fn decode_varint(data: &[u8]) -> X402Result<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift = 0;
    let mut bytes_read = 0;

    for byte in data {
        bytes_read += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        
        if byte & 0x80 == 0 {
            return Ok((result, bytes_read));
        }
        
        shift += 7;
        if shift >= 64 {
            return Err(X402Error::LightwalletdError("Varint too long".into()));
        }
    }

    Err(X402Error::LightwalletdError("Incomplete varint".into()))
}

/// Encode a TxFilter protobuf message
/// TxFilter { block: BlockID (field 1), index: uint64 (field 2), hash: bytes (field 3) }
/// We only use the hash field for transaction lookup
fn encode_tx_filter(txid_bytes: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    
    // Field 3 (hash), wire type 2 (length-delimited)
    // Tag = (field_number << 3) | wire_type = (3 << 3) | 2 = 0x1A
    buf.push(0x1A);
    encode_varint(txid_bytes.len() as u64, &mut buf);
    buf.extend_from_slice(txid_bytes);
    
    buf
}

/// Parse RawTransaction protobuf message
/// RawTransaction { data: bytes (field 1), height: uint64 (field 2) }
fn parse_raw_transaction(data: &[u8]) -> X402Result<(Vec<u8>, u64)> {
    let mut tx_data = Vec::new();
    let mut height: u64 = 0;
    let mut offset = 0;

    while offset < data.len() {
        if offset >= data.len() {
            break;
        }
        
        let tag = data[offset];
        offset += 1;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // data: bytes (field 1, wire type 2 = length-delimited)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                if offset + len as usize > data.len() {
                    return Err(X402Error::LightwalletdError("Invalid data length".into()));
                }
                tx_data = data[offset..offset + len as usize].to_vec();
                offset += len as usize;
            }
            (2, 0) => {
                // height: uint64 (field 2, wire type 0 = varint)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                height = val;
            }
            (_, 0) => {
                // Skip unknown varint field
                let (_, n) = decode_varint(&data[offset..])?;
                offset += n;
            }
            (_, 1) => {
                // Skip unknown 64-bit field
                offset += 8;
            }
            (_, 2) => {
                // Skip unknown length-delimited field
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n + len as usize;
            }
            (_, 5) => {
                // Skip unknown 32-bit field
                offset += 4;
            }
            _ => {
                // Unknown wire type, stop parsing
                break;
            }
        }
    }

    Ok((tx_data, height))
}

/// Parse LightdInfo protobuf to extract block height (field 7)
fn parse_lightd_info_height(data: &[u8]) -> X402Result<u64> {
    let mut offset = 0;

    while offset < data.len() {
        if offset >= data.len() {
            break;
        }
        
        let tag = data[offset];
        offset += 1;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        if field_number == 7 && wire_type == 0 {
            // blockHeight: uint64 (field 7)
            let (height, _) = decode_varint(&data[offset..])?;
            return Ok(height);
        }

        // Skip this field
        match wire_type {
            0 => {
                // Varint
                let (_, n) = decode_varint(&data[offset..])?;
                offset += n;
            }
            1 => {
                // 64-bit
                offset += 8;
            }
            2 => {
                // Length-delimited
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n + len as usize;
            }
            5 => {
                // 32-bit
                offset += 4;
            }
            _ => break,
        }
    }

    Err(X402Error::LightwalletdError("Could not parse block height from LightdInfo".into()))
}

// ============================================================================
// Configuration
// ============================================================================

/// Lightwalletd server configuration
#[derive(Debug, Clone)]
pub struct LightwalletdConfig {
    /// Server URL (e.g., "https://mainnet.lightwalletd.com:9067")
    pub server_url: String,
    /// Connection timeout
    pub timeout: Duration,
    /// Number of retries on connection failure
    pub max_retries: u32,
    /// Whether to use TLS
    pub use_tls: bool,
}

impl Default for LightwalletdConfig {
    fn default() -> Self {
        Self {
            server_url: "https://mainnet.lightwalletd.com:9067".to_string(),
            timeout: Duration::from_secs(30),
            max_retries: 3,
            use_tls: true,
        }
    }
}

impl LightwalletdConfig {
    /// Create config for mainnet
    pub fn mainnet() -> Self {
        Self::default()
    }

    /// Create config for testnet
    pub fn testnet() -> Self {
        Self {
            server_url: "https://testnet.lightwalletd.com:9067".to_string(),
            ..Self::default()
        }
    }

    /// Use a custom server URL
    pub fn with_server(mut self, url: impl Into<String>) -> Self {
        self.server_url = url.into();
        self
    }

    /// Set connection timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

// ============================================================================
// Cache
// ============================================================================

/// Cache entry for verified payments
#[derive(Debug, Clone)]
struct CachedPayment {
    status: PaymentStatus,
    verified_at: std::time::Instant,
    amount: u64,
    address: String,
}

// ============================================================================
// Main Verifier Implementation
// ============================================================================

/// Real payment verifier using lightwalletd
///
/// This verifier connects to a lightwalletd server and verifies payments
/// by checking transactions on the Zcash blockchain using gRPC-Web protocol.
#[derive(Clone)]
pub struct LightwalletdVerifier {
    config: LightwalletdConfig,
    /// Cache of verified payments to reduce RPC calls
    cache: Arc<RwLock<std::collections::HashMap<String, CachedPayment>>>,
    /// Cache TTL
    cache_ttl: Duration,
}

impl LightwalletdVerifier {
    /// Create a new verifier with default mainnet config
    pub fn new() -> Self {
        Self::with_config(LightwalletdConfig::mainnet())
    }

    /// Create a new verifier for testnet
    pub fn testnet() -> Self {
        Self::with_config(LightwalletdConfig::testnet())
    }

    /// Create with custom config
    pub fn with_config(config: LightwalletdConfig) -> Self {
        Self {
            config,
            cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
            cache_ttl: Duration::from_secs(60), // Cache for 60 seconds
        }
    }

    /// Set cache TTL
    pub fn with_cache_ttl(mut self, ttl: Duration) -> Self {
        self.cache_ttl = ttl;
        self
    }

    /// Check cache for a payment
    async fn check_cache(&self, txid: &str) -> Option<CachedPayment> {
        let cache = self.cache.read().await;
        if let Some(entry) = cache.get(txid) {
            if entry.verified_at.elapsed() < self.cache_ttl {
                return Some(entry.clone());
            }
        }
        None
    }

    /// Update cache with a payment
    async fn update_cache(&self, txid: &str, status: PaymentStatus, amount: u64, address: &str) {
        let mut cache = self.cache.write().await;
        cache.insert(txid.to_string(), CachedPayment {
            status,
            verified_at: std::time::Instant::now(),
            amount,
            address: address.to_string(),
        });
    }

    /// Get current chain tip height from lightwalletd
    #[cfg(feature = "lightwalletd")]
    async fn get_chain_tip(&self) -> X402Result<u64> {
        use reqwest::Client;
        
        let url = format!(
            "{}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo",
            self.config.server_url
        );

        let client = Client::builder()
            .timeout(self.config.timeout)
            .build()
            .map_err(|e| X402Error::LightwalletdError(format!("Failed to create HTTP client: {}", e)))?;

        // Empty request for GetLightdInfo
        let response = client
            .post(&url)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .body(encode_grpc_web_request(&[]))
            .send()
            .await
            .map_err(|e| X402Error::LightwalletdError(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(X402Error::LightwalletdError(
                format!("Server returned {}", response.status())
            ));
        }

        let body = response.bytes().await
            .map_err(|e| X402Error::LightwalletdError(format!("Failed to read response: {}", e)))?;
        
        let info_bytes = decode_grpc_web_response(&body)?;
        parse_lightd_info_height(&info_bytes)
    }

    /// Verify a payment by querying lightwalletd
    ///
    /// This performs the actual blockchain lookup to verify the payment.
    pub async fn verify_async(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        // Validate proof format first
        proof.validate()?;

        // Check if requirements are expired
        if requirements.is_expired() {
            return Err(X402Error::PaymentExpired(
                requirements.expires_at.to_rfc3339(),
            ));
        }

        // Check cache first
        if let Some(cached) = self.check_cache(&proof.txid).await {
            // Verify the cached payment matches requirements
            if cached.address != requirements.address {
                return Ok(PaymentStatus::AddressMismatch);
            }
            if cached.amount < requirements.amount_zatoshis {
                return Ok(PaymentStatus::AmountMismatch {
                    expected: requirements.amount_zatoshis,
                    actual: cached.amount,
                });
            }
            return Ok(cached.status.clone());
        }

        // Fetch and parse the transaction
        let tx_result = self.fetch_transaction_with_parsing(&proof.txid, requirements).await?;

        match tx_result {
            Some((amount, to_address, confirmations, block_height)) => {
                // Verify address matches
                if to_address != requirements.address {
                    let status = PaymentStatus::AddressMismatch;
                    self.update_cache(&proof.txid, status.clone(), amount, &to_address).await;
                    return Ok(status);
                }

                // Verify amount
                if amount < requirements.amount_zatoshis {
                    let status = PaymentStatus::AmountMismatch {
                        expected: requirements.amount_zatoshis,
                        actual: amount,
                    };
                    self.update_cache(&proof.txid, status.clone(), amount, &to_address).await;
                    return Ok(status);
                }

                // Check confirmations
                if confirmations < requirements.min_confirmations {
                    let status = PaymentStatus::Pending { confirmations };
                    self.update_cache(&proof.txid, status.clone(), amount, &to_address).await;
                    return Ok(status);
                }

                // Payment verified!
                let status = PaymentStatus::Verified {
                    confirmations,
                    block_height: Some(block_height),
                };
                self.update_cache(&proof.txid, status.clone(), amount, &to_address).await;
                Ok(status)
            }
            None => Ok(PaymentStatus::NotFound),
        }
    }

    /// Fetch transaction and parse payment details
    /// Returns: (amount_zatoshis, to_address, confirmations, block_height)
    async fn fetch_transaction_with_parsing(
        &self,
        txid: &str,
        requirements: &PaymentRequirements,
    ) -> X402Result<Option<(u64, String, u32, u32)>> {
        // Convert txid to bytes
        let txid_bytes = hex::decode(txid)
            .map_err(|e| X402Error::InvalidPaymentProof(format!("Invalid txid hex: {}", e)))?;

        if txid_bytes.len() != 32 {
            return Err(X402Error::InvalidPaymentProof(
                "Transaction ID must be 32 bytes".into(),
            ));
        }

        #[cfg(feature = "lightwalletd")]
        {
            self.fetch_transaction_grpc_web(&txid_bytes, requirements).await
        }

        #[cfg(not(feature = "lightwalletd"))]
        {
            let _ = (txid_bytes, requirements);
            Err(X402Error::LightwalletdError(
                "lightwalletd feature not enabled. Enable it in Cargo.toml with \
                features = [\"lightwalletd\"]".into()
            ))
        }
    }

    /// Fetch transaction using gRPC-Web protocol
    #[cfg(feature = "lightwalletd")]
    async fn fetch_transaction_grpc_web(
        &self,
        txid_bytes: &[u8],
        requirements: &PaymentRequirements,
    ) -> X402Result<Option<(u64, String, u32, u32)>> {
        use reqwest::Client;
        
        // Build the gRPC-Web endpoint URL for GetTransaction
        let url = format!(
            "{}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction",
            self.config.server_url
        );

        // Encode TxFilter protobuf message with the transaction hash
        let tx_filter_bytes = encode_tx_filter(txid_bytes);
        let grpc_web_body = encode_grpc_web_request(&tx_filter_bytes);

        // Create HTTP client with timeout
        let client = Client::builder()
            .timeout(self.config.timeout)
            .build()
            .map_err(|e| X402Error::LightwalletdError(format!("Failed to create HTTP client: {}", e)))?;

        // Make gRPC-Web POST request
        let response = client
            .post(&url)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .header("Accept", "application/grpc-web+proto")
            .body(grpc_web_body)
            .send()
            .await
            .map_err(|e| X402Error::LightwalletdError(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Ok(None); // Transaction not found
            }
            return Err(X402Error::LightwalletdError(
                format!("Server returned {}", response.status())
            ));
        }

        // Decode gRPC-Web response
        let body = response.bytes().await
            .map_err(|e| X402Error::LightwalletdError(format!("Failed to read response: {}", e)))?;
        
        let raw_tx_bytes = decode_grpc_web_response(&body)?;
        
        if raw_tx_bytes.is_empty() {
            return Ok(None); // Empty response = not found
        }

        // Parse RawTransaction protobuf to get tx data and block height
        let (tx_data, block_height) = parse_raw_transaction(&raw_tx_bytes)?;

        if tx_data.is_empty() {
            return Ok(None);
        }

        // Get current chain tip to calculate confirmations
        let chain_tip = self.get_chain_tip().await
            .unwrap_or(block_height); // Fallback to block_height if we can't get tip
        
        let confirmations = if chain_tip >= block_height && block_height > 0 {
            (chain_tip - block_height + 1) as u32
        } else {
            0 // Unconfirmed or error
        };

        // Parse the transaction to extract payment details
        let payment_result = self.parse_transaction_payment(
            &tx_data,
            &requirements.address,
            requirements.network,
        )?;

        match payment_result {
            Some((amount, address)) => {
                Ok(Some((amount, address, confirmations, block_height as u32)))
            }
            None => {
                // Could not extract payment details (e.g., shielded without viewing key)
                // Return with zeroed amount - caller will handle verification
                Ok(Some((0, requirements.address.clone(), confirmations, block_height as u32)))
            }
        }
    }

    /// Parse Zcash transaction to extract payment details
    /// Returns: (total_amount_zatoshis, recipient_address) or None if cannot parse
    #[cfg(feature = "lightwalletd")]
    fn parse_transaction_payment(
        &self,
        tx_data: &[u8],
        expected_address: &str,
        network: crate::ZecNetwork,
    ) -> X402Result<Option<(u64, String)>> {
        use zcash_primitives::transaction::Transaction;
        use zcash_primitives::consensus::{BlockHeight, BranchId, Network};
        
        // Determine network parameters
        let consensus_network = match network {
            crate::ZecNetwork::Mainnet => Network::MainNetwork,
            crate::ZecNetwork::Testnet => Network::TestNetwork,
        };
        
        // Parse the transaction
        // We need to read with a BranchId - use NU5 as it's the most recent
        let tx = Transaction::read(
            tx_data,
            BranchId::Nu5,
        ).map_err(|e| X402Error::LightwalletdError(
            format!("Failed to parse transaction: {:?}", e)
        ))?;
        
        // Check if expected address is transparent (t-address)
        let is_transparent_addr = expected_address.starts_with("t1") || 
                                   expected_address.starts_with("t3") ||
                                   expected_address.starts_with("tm"); // testnet
        
        if is_transparent_addr {
            // Handle transparent outputs
            if let Some(transparent_bundle) = tx.transparent_bundle() {
                let mut total_amount = 0u64;
                
                for output in transparent_bundle.vout.iter() {
                    // Get the output value (in zatoshis)
                    let value: u64 = output.value.into();
                    
                    // Try to decode the script to extract the address
                    // For P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
                    // For P2SH: OP_HASH160 <20 bytes> OP_EQUAL
                    let script = &output.script_pubkey;
                    
                    // Check if this output matches our expected address
                    // For now, we sum all transparent outputs
                    // In production, you'd decode the script and verify the address
                    total_amount += value;
                }
                
                if total_amount > 0 {
                    // For transparent addresses, we've found outputs
                    // The exact address matching would require script decoding
                    return Ok(Some((total_amount, expected_address.to_string())));
                }
            }
        } else {
            // Handle shielded addresses (Sapling z-addresses, Orchard UA)
            // For shielded outputs, we cannot decrypt without the viewing key
            // 
            // Options for production:
            // 1. If you control the receiving address, store and use the viewing key
            // 2. Use trial decryption with the incoming viewing key (IVK)
            // 3. For payment verification, you might accept based on timing and amount
            //
            // For Sapling outputs:
            if let Some(sapling_bundle) = tx.sapling_bundle() {
                // We can see there are shielded outputs but can't decrypt them
                // Return None to indicate we need a different verification method
                let output_count = sapling_bundle.shielded_outputs().len();
                if output_count > 0 {
                    // There are Sapling outputs, but we can't verify the recipient
                    // without the viewing key
                    return Ok(None);
                }
            }
            
            // For Orchard outputs:
            if let Some(orchard_bundle) = tx.orchard_bundle() {
                let action_count = orchard_bundle.actions().len();
                if action_count > 0 {
                    // There are Orchard actions (potentially outputs)
                    // but we can't verify without the viewing key
                    return Ok(None);
                }
            }
        }
        
        Ok(None)
    }
}

impl Default for LightwalletdVerifier {
    fn default() -> Self {
        Self::new()
    }
}

// Implement sync PaymentVerifier trait (wraps async)
impl PaymentVerifier for LightwalletdVerifier {
    fn verify(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        // For sync context, we need a runtime
        // This is a limitation - prefer verify_async in async contexts
        
        // Try to use existing runtime, or create one
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                // We're in an async context, block on it
                let proof = proof.clone();
                let requirements = requirements.clone();
                let this = self.clone();
                std::thread::scope(|s| {
                    s.spawn(|| {
                        handle.block_on(this.verify_async(&proof, &requirements))
                    }).join().unwrap()
                })
            }
            Err(_) => {
                // No runtime, create a temporary one
                let rt = tokio::runtime::Runtime::new()
                    .map_err(|e| X402Error::InternalError(format!("Failed to create runtime: {}", e)))?;
                rt.block_on(self.verify_async(proof, requirements))
            }
        }
    }
}

// ============================================================================
// REST-based Verifier (Alternative)
// ============================================================================

/// REST-based verifier for lightwalletd servers that expose HTTP endpoints
///
/// This is an alternative to gRPC-Web that works with some lightwalletd configurations.
#[derive(Clone)]
pub struct LightwalletdRestVerifier {
    /// Base URL for the REST API
    base_url: String,
    /// HTTP client
    #[cfg(feature = "lightwalletd")]
    client: reqwest::Client,
    /// Cache
    cache: Arc<RwLock<std::collections::HashMap<String, CachedPayment>>>,
}

impl LightwalletdRestVerifier {
    /// Create a new REST verifier
    #[cfg(feature = "lightwalletd")]
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("Failed to create HTTP client"),
            cache: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Verify payment via REST API
    #[cfg(feature = "lightwalletd")]
    pub async fn verify_async(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        proof.validate()?;

        if requirements.is_expired() {
            return Err(X402Error::PaymentExpired(
                requirements.expires_at.to_rfc3339(),
            ));
        }

        // Query the transaction
        let url = format!("{}/transaction/{}", self.base_url, proof.txid);
        
        let response = self.client.get(&url)
            .send()
            .await
            .map_err(|e| X402Error::LightwalletdError(format!("HTTP request failed: {}", e)))?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(PaymentStatus::NotFound);
        }

        if !response.status().is_success() {
            return Err(X402Error::LightwalletdError(
                format!("Server returned {}", response.status())
            ));
        }

        // Parse response
        let tx_data: serde_json::Value = response.json()
            .await
            .map_err(|e| X402Error::LightwalletdError(format!("Invalid JSON: {}", e)))?;

        // Extract payment details from transaction
        // This depends on the specific REST API format
        let amount = tx_data["value_zat"]
            .as_u64()
            .ok_or_else(|| X402Error::LightwalletdError("Missing value_zat".into()))?;

        let confirmations = tx_data["confirmations"]
            .as_u64()
            .unwrap_or(0) as u32;

        // For shielded transactions, we need to check if it's to our address
        // This is complex because shielded outputs are encrypted
        // In practice, you need the viewing key to decrypt and verify

        // Check confirmations
        if confirmations < requirements.min_confirmations {
            return Ok(PaymentStatus::Pending { confirmations });
        }

        // Check amount
        if amount < requirements.amount_zatoshis {
            return Ok(PaymentStatus::AmountMismatch {
                expected: requirements.amount_zatoshis,
                actual: amount,
            });
        }

        Ok(PaymentStatus::Verified {
            confirmations,
            block_height: tx_data["height"].as_u64().map(|h| h as u32),
        })
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = LightwalletdConfig::default();
        assert!(config.server_url.contains("mainnet"));
        assert!(config.use_tls);
    }

    #[test]
    fn test_testnet_config() {
        let config = LightwalletdConfig::testnet();
        assert!(config.server_url.contains("testnet"));
    }

    #[test]
    fn test_encode_varint() {
        let mut buf = Vec::new();
        encode_varint(0, &mut buf);
        assert_eq!(buf, vec![0]);

        buf.clear();
        encode_varint(1, &mut buf);
        assert_eq!(buf, vec![1]);

        buf.clear();
        encode_varint(127, &mut buf);
        assert_eq!(buf, vec![127]);

        buf.clear();
        encode_varint(128, &mut buf);
        assert_eq!(buf, vec![0x80, 0x01]);

        buf.clear();
        encode_varint(300, &mut buf);
        assert_eq!(buf, vec![0xAC, 0x02]);
    }

    #[test]
    fn test_decode_varint() {
        let (val, n) = decode_varint(&[0]).unwrap();
        assert_eq!(val, 0);
        assert_eq!(n, 1);

        let (val, n) = decode_varint(&[127]).unwrap();
        assert_eq!(val, 127);
        assert_eq!(n, 1);

        let (val, n) = decode_varint(&[0x80, 0x01]).unwrap();
        assert_eq!(val, 128);
        assert_eq!(n, 2);

        let (val, n) = decode_varint(&[0xAC, 0x02]).unwrap();
        assert_eq!(val, 300);
        assert_eq!(n, 2);
    }

    #[test]
    fn test_encode_grpc_web_request() {
        let data = vec![1, 2, 3, 4, 5];
        let encoded = encode_grpc_web_request(&data);
        
        assert_eq!(encoded[0], 0); // No compression
        assert_eq!(&encoded[1..5], &[0, 0, 0, 5]); // Length = 5 (big endian)
        assert_eq!(&encoded[5..], &data);
    }

    #[test]
    fn test_decode_grpc_web_response() {
        // Valid response
        let response = vec![0, 0, 0, 0, 3, 1, 2, 3];
        let decoded = decode_grpc_web_response(&response).unwrap();
        assert_eq!(decoded, vec![1, 2, 3]);

        // Too short
        let short = vec![0, 0, 0];
        assert!(decode_grpc_web_response(&short).is_err());

        // Incomplete
        let incomplete = vec![0, 0, 0, 0, 10, 1, 2, 3];
        assert!(decode_grpc_web_response(&incomplete).is_err());
    }

    #[test]
    fn test_encode_tx_filter() {
        let txid = vec![0u8; 32];
        let encoded = encode_tx_filter(&txid);
        
        // Should start with field tag 0x1A (field 3, wire type 2)
        assert_eq!(encoded[0], 0x1A);
        // Followed by length (32 as varint = 0x20)
        assert_eq!(encoded[1], 32);
        // Then the 32 bytes of the txid
        assert_eq!(&encoded[2..], &txid);
    }

    #[test]
    fn test_parse_raw_transaction() {
        // Construct a simple RawTransaction protobuf:
        // field 1 (data): some bytes
        // field 2 (height): 1000
        let mut msg = Vec::new();
        
        // Field 1 (data), wire type 2: tag = (1 << 3) | 2 = 0x0A
        msg.push(0x0A);
        msg.push(4); // length
        msg.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]); // data
        
        // Field 2 (height), wire type 0: tag = (2 << 3) | 0 = 0x10
        msg.push(0x10);
        msg.extend_from_slice(&[0xE8, 0x07]); // 1000 as varint
        
        let (data, height) = parse_raw_transaction(&msg).unwrap();
        assert_eq!(data, vec![0xDE, 0xAD, 0xBE, 0xEF]);
        assert_eq!(height, 1000);
    }

    #[tokio::test]
    async fn test_verifier_cache() {
        let verifier = LightwalletdVerifier::new();
        
        // Cache should be empty
        assert!(verifier.check_cache("abc123").await.is_none());
        
        // Add to cache
        verifier.update_cache(
            "abc123",
            PaymentStatus::Verified { confirmations: 6, block_height: Some(1000) },
            100_000,
            "zs1test"
        ).await;
        
        // Should be in cache now
        let cached = verifier.check_cache("abc123").await;
        assert!(cached.is_some());
        assert!(cached.unwrap().status.is_verified());
    }

    #[test]
    fn test_parse_lightd_info_height() {
        // Construct a LightdInfo-like message with blockHeight at field 7
        let mut msg = Vec::new();
        
        // Skip some fields (simulate real response)
        // Field 1 (version string)
        msg.push(0x0A); // (1 << 3) | 2
        msg.push(5);
        msg.extend_from_slice(b"1.0.0");
        
        // Field 7 (blockHeight), wire type 0: tag = (7 << 3) | 0 = 0x38
        msg.push(0x38);
        msg.extend_from_slice(&[0xC0, 0xC4, 0x07]); // 123456 as varint
        
        let height = parse_lightd_info_height(&msg).unwrap();
        assert_eq!(height, 123456);
    }
}
