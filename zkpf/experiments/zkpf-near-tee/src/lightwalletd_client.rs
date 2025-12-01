//! Lightwalletd gRPC client for the PCD Keeper.
//!
//! This module provides a client for communicating with Zcash lightwalletd servers
//! to fetch chain state and blocks for PCD synchronization.
//!
//! # Protocol
//!
//! Uses the standard lightwalletd gRPC protocol defined in:
//! https://github.com/zcash/lightwalletd/blob/master/walletrpc/service.proto
//!
//! # HTTP Fallback
//!
//! When gRPC is not available (e.g., WASM), falls back to HTTP JSON-RPC.

use std::time::Duration;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::pcd_keeper::{BlockDelta, PcdKeeperError};

// ═══════════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/// Errors from the lightwalletd client.
#[derive(Debug, Error)]
pub enum LightwalletdError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("RPC error: {0}")]
    RpcError(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Timeout")]
    Timeout,

    #[error("Server unavailable")]
    ServerUnavailable,

    #[error("Block not found: {0}")]
    BlockNotFound(u64),

    #[error("HTTP error: {0}")]
    HttpError(String),
}

impl From<LightwalletdError> for PcdKeeperError {
    fn from(e: LightwalletdError) -> Self {
        PcdKeeperError::LightwalletdUnavailable(e.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTWALLETD TYPES (matching proto definitions)
// ═══════════════════════════════════════════════════════════════════════════════

/// Lightwalletd server info.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LightdInfo {
    /// Server version.
    pub version: String,
    /// Vendor name.
    pub vendor: String,
    /// Chain name ("main" or "test").
    pub chain_name: String,
    /// Sapling activation height.
    pub sapling_activation_height: u64,
    /// Current block height.
    pub block_height: u64,
    /// Estimated height (if syncing).
    pub estimated_height: u64,
    /// Consensus branch ID.
    pub consensus_branch_id: String,
}

/// Tree state at a block.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TreeState {
    /// Network ("main" or "test").
    pub network: String,
    /// Block height.
    pub height: u64,
    /// Block hash (hex).
    pub hash: String,
    /// Block time (Unix timestamp).
    pub time: u32,
    /// Sapling commitment tree state (hex).
    pub sapling_tree: String,
    /// Orchard commitment tree state (hex).
    pub orchard_tree: String,
}

/// Compact block data.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompactBlock {
    /// Block height.
    pub height: u64,
    /// Block hash (hex).
    pub hash: String,
    /// Previous block hash (hex).
    pub prev_hash: String,
    /// Block time (Unix timestamp).
    pub time: u32,
    /// Orchard actions in this block.
    pub orchard_actions: Vec<CompactOrchardAction>,
}

/// Compact Orchard action (note commitment + nullifier).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompactOrchardAction {
    /// Nullifier (hex).
    pub nullifier: String,
    /// Note commitment (hex, cmx).
    pub cmx: String,
    /// Ephemeral key (hex).
    pub ephemeral_key: String,
    /// Encrypted note ciphertext (base64).
    pub ciphertext: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIGHTWALLETD CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for the lightwalletd client.
#[derive(Clone, Debug)]
pub struct LightwalletdConfig {
    /// Server URL (gRPC or HTTP).
    pub url: String,
    /// Connection timeout.
    pub connect_timeout: Duration,
    /// Request timeout.
    pub request_timeout: Duration,
    /// Whether to use gRPC (vs HTTP fallback).
    pub use_grpc: bool,
}

impl Default for LightwalletdConfig {
    fn default() -> Self {
        Self {
            url: "https://zcash-mainnet.chainsafe.dev".to_string(),
            connect_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_secs(30),
            use_grpc: false, // HTTP by default for compatibility
        }
    }
}

/// Lightwalletd client for PCD Keeper.
pub struct LightwalletdClient {
    /// Configuration.
    config: LightwalletdConfig,
    /// HTTP client for JSON-RPC fallback.
    http_client: reqwest::Client,
}

impl LightwalletdClient {
    /// Create a new lightwalletd client.
    pub fn new(config: LightwalletdConfig) -> Result<Self, LightwalletdError> {
        let http_client = reqwest::Client::builder()
            .connect_timeout(config.connect_timeout)
            .timeout(config.request_timeout)
            .build()
            .map_err(|e| LightwalletdError::ConnectionFailed(e.to_string()))?;

        Ok(Self {
            config,
            http_client,
        })
    }

    /// Create a client with default mainnet configuration.
    pub fn mainnet() -> Result<Self, LightwalletdError> {
        Self::new(LightwalletdConfig::default())
    }

    /// Create a client for testnet.
    pub fn testnet() -> Result<Self, LightwalletdError> {
        Self::new(LightwalletdConfig {
            url: "https://zcash-testnet.chainsafe.dev".to_string(),
            ..Default::default()
        })
    }

    /// Get server info.
    pub async fn get_lightd_info(&self) -> Result<LightdInfo, LightwalletdError> {
        // Use gRPC-Web compatible HTTP endpoint
        let url = format!(
            "{}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo",
            self.config.url
        );

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .body(encode_grpc_web_request(&[]))
            .send()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(LightwalletdError::RpcError(format!(
                "HTTP {}: {}",
                response.status(),
                response.status().canonical_reason().unwrap_or("Unknown")
            )));
        }

        let body = response
            .bytes()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        // Parse gRPC-Web response
        let data = decode_grpc_web_response(&body)?;
        parse_lightd_info(&data)
    }

    /// Get the current chain tip height.
    pub async fn get_chain_height(&self) -> Result<u64, LightwalletdError> {
        let info = self.get_lightd_info().await?;
        Ok(info.block_height)
    }

    /// Get tree state at a specific height.
    pub async fn get_tree_state(&self, height: u64) -> Result<TreeState, LightwalletdError> {
        let url = format!(
            "{}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTreeState",
            self.config.url
        );

        // Encode BlockID message
        let request_data = encode_block_id(height);

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .body(encode_grpc_web_request(&request_data))
            .send()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(LightwalletdError::RpcError(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let body = response
            .bytes()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        let data = decode_grpc_web_response(&body)?;
        parse_tree_state(&data)
    }

    /// Get the latest tree state.
    pub async fn get_latest_tree_state(&self) -> Result<TreeState, LightwalletdError> {
        let url = format!(
            "{}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestTreeState",
            self.config.url
        );

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .body(encode_grpc_web_request(&[]))
            .send()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(LightwalletdError::RpcError(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let body = response
            .bytes()
            .await
            .map_err(|e| LightwalletdError::HttpError(e.to_string()))?;

        let data = decode_grpc_web_response(&body)?;
        parse_tree_state(&data)
    }

    /// Fetch a block delta for PCD state transition.
    ///
    /// This retrieves the tree state and computes the anchor change.
    /// Note: Full note trial decryption requires the user's IVK and is
    /// done separately in the wallet layer.
    pub async fn fetch_block_delta(
        &self,
        _from_height: u64,
        to_height: u64,
    ) -> Result<BlockDelta, LightwalletdError> {
        // Get tree state at target height for the new anchor
        let tree_state = self.get_tree_state(to_height).await?;

        // Derive anchor from Orchard tree state
        let anchor_new = parse_orchard_anchor(&tree_state.orchard_tree)?;

        // Note: In a full implementation, we would:
        // 1. Fetch compact blocks in the range [from_height, to_height]
        // 2. Trial-decrypt outputs using the user's IVK
        // 3. Collect discovered notes and spent nullifiers
        //
        // For the PCD Keeper, we return an empty delta and let the
        // wallet layer handle actual note discovery.

        Ok(BlockDelta {
            block_height: to_height,
            anchor_new,
            new_notes: vec![], // Populated by wallet layer
            spent_nullifiers: vec![], // Populated by wallet layer
        })
    }

    /// Check if the server is available.
    pub async fn health_check(&self) -> bool {
        self.get_lightd_info().await.is_ok()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRPC-WEB ENCODING/DECODING
// ═══════════════════════════════════════════════════════════════════════════════

/// Encode a gRPC-Web request.
fn encode_grpc_web_request(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(5 + data.len());
    
    // gRPC-Web frame: 1 byte flags + 4 bytes length + data
    result.push(0); // No compression
    result.extend_from_slice(&(data.len() as u32).to_be_bytes());
    result.extend_from_slice(data);
    
    result
}

/// Decode a gRPC-Web response.
fn decode_grpc_web_response(data: &[u8]) -> Result<Vec<u8>, LightwalletdError> {
    if data.len() < 5 {
        return Err(LightwalletdError::InvalidResponse(
            "Response too short".into(),
        ));
    }

    // Check for trailers (status)
    if data[0] & 0x80 != 0 {
        // This is a trailer frame, check for errors
        let trailer_str = String::from_utf8_lossy(&data[5..]);
        if trailer_str.contains("grpc-status: 0") || trailer_str.is_empty() {
            return Ok(vec![]); // Success with no data
        }
        return Err(LightwalletdError::RpcError(trailer_str.to_string()));
    }

    // Extract message length
    let length = u32::from_be_bytes([data[1], data[2], data[3], data[4]]) as usize;
    
    if data.len() < 5 + length {
        return Err(LightwalletdError::InvalidResponse(
            "Incomplete response".into(),
        ));
    }

    Ok(data[5..5 + length].to_vec())
}

/// Encode a BlockID protobuf message.
fn encode_block_id(height: u64) -> Vec<u8> {
    // BlockID { height: uint64 (field 1) }
    let mut buf = Vec::new();
    
    // Field 1, type varint (wire type 0)
    buf.push(0x08);
    encode_varint(height, &mut buf);
    
    buf
}

/// Encode a varint.
fn encode_varint(mut value: u64, buf: &mut Vec<u8>) {
    while value >= 0x80 {
        buf.push((value as u8) | 0x80);
        value >>= 7;
    }
    buf.push(value as u8);
}

/// Decode a varint from bytes.
fn decode_varint(data: &[u8]) -> Result<(u64, usize), LightwalletdError> {
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
            return Err(LightwalletdError::InvalidResponse("Varint too long".into()));
        }
    }

    Err(LightwalletdError::InvalidResponse("Incomplete varint".into()))
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROTOBUF PARSING
// ═══════════════════════════════════════════════════════════════════════════════

/// Parse LightdInfo from protobuf bytes.
fn parse_lightd_info(data: &[u8]) -> Result<LightdInfo, LightwalletdError> {
    let mut info = LightdInfo {
        version: String::new(),
        vendor: String::new(),
        chain_name: String::new(),
        sapling_activation_height: 0,
        block_height: 0,
        estimated_height: 0,
        consensus_branch_id: String::new(),
    };

    let mut offset = 0;
    while offset < data.len() {
        let tag = data[offset];
        offset += 1;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // version (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.version = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (2, 2) => {
                // vendor (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.vendor = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (4, 2) => {
                // chainName (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.chain_name = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (5, 0) => {
                // saplingActivationHeight (uint64)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.sapling_activation_height = val;
            }
            (6, 2) => {
                // consensusBranchId (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.consensus_branch_id = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (7, 0) => {
                // blockHeight (uint64)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.block_height = val;
            }
            (12, 0) => {
                // estimatedHeight (uint64)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                info.estimated_height = val;
            }
            (_, 0) => {
                // Skip unknown varint
                let (_, n) = decode_varint(&data[offset..])?;
                offset += n;
            }
            (_, 2) => {
                // Skip unknown length-delimited
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n + len as usize;
            }
            _ => {
                // Skip other wire types
                break;
            }
        }
    }

    Ok(info)
}

/// Parse TreeState from protobuf bytes.
fn parse_tree_state(data: &[u8]) -> Result<TreeState, LightwalletdError> {
    let mut state = TreeState {
        network: String::new(),
        height: 0,
        hash: String::new(),
        time: 0,
        sapling_tree: String::new(),
        orchard_tree: String::new(),
    };

    let mut offset = 0;
    while offset < data.len() {
        let tag = data[offset];
        offset += 1;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // network (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.network = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (2, 0) => {
                // height (uint64)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.height = val;
            }
            (3, 2) => {
                // hash (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.hash = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (4, 0) => {
                // time (uint32)
                let (val, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.time = val as u32;
            }
            (5, 2) => {
                // saplingTree (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.sapling_tree = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (6, 2) => {
                // orchardTree (string)
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n;
                state.orchard_tree = String::from_utf8_lossy(&data[offset..offset + len as usize]).to_string();
                offset += len as usize;
            }
            (_, 0) => {
                let (_, n) = decode_varint(&data[offset..])?;
                offset += n;
            }
            (_, 2) => {
                let (len, n) = decode_varint(&data[offset..])?;
                offset += n + len as usize;
            }
            _ => break,
        }
    }

    Ok(state)
}

/// Parse Orchard anchor from tree state hex string.
fn parse_orchard_anchor(tree_state_hex: &str) -> Result<[u8; 32], LightwalletdError> {
    if tree_state_hex.is_empty() {
        // Empty tree state - return zero anchor
        return Ok([0u8; 32]);
    }

    // The Orchard tree state is a hex-encoded frontier.
    // For the anchor, we need to extract or compute the root.
    // For now, we hash the tree state as a simplified anchor.
    let hash = blake3::hash(tree_state_hex.as_bytes());
    Ok(*hash.as_bytes())
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_varint() {
        let mut buf = Vec::new();
        encode_varint(150, &mut buf);
        assert_eq!(buf, vec![0x96, 0x01]);

        buf.clear();
        encode_varint(0, &mut buf);
        assert_eq!(buf, vec![0x00]);

        buf.clear();
        encode_varint(300, &mut buf);
        assert_eq!(buf, vec![0xac, 0x02]);
    }

    #[test]
    fn test_decode_varint() {
        let data = vec![0x96, 0x01];
        let (value, bytes_read) = decode_varint(&data).unwrap();
        assert_eq!(value, 150);
        assert_eq!(bytes_read, 2);

        let data = vec![0x00];
        let (value, bytes_read) = decode_varint(&data).unwrap();
        assert_eq!(value, 0);
        assert_eq!(bytes_read, 1);
    }

    #[test]
    fn test_encode_block_id() {
        let encoded = encode_block_id(2500000);
        // Field 1, varint
        assert_eq!(encoded[0], 0x08);
        // Check value decodes correctly
        let (value, _) = decode_varint(&encoded[1..]).unwrap();
        assert_eq!(value, 2500000);
    }

    #[test]
    fn test_grpc_web_encoding() {
        let data = b"test";
        let encoded = encode_grpc_web_request(data);
        
        assert_eq!(encoded[0], 0); // No compression
        let len = u32::from_be_bytes([encoded[1], encoded[2], encoded[3], encoded[4]]);
        assert_eq!(len, 4);
        assert_eq!(&encoded[5..], data);
    }

    #[test]
    fn test_config_default() {
        let config = LightwalletdConfig::default();
        assert!(config.url.contains("zcash-mainnet"));
        assert!(!config.use_grpc);
    }

    #[tokio::test]
    async fn test_client_creation() {
        let client = LightwalletdClient::mainnet();
        assert!(client.is_ok());
    }
}

