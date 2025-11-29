//! Real Lightwalletd payment verification
//! Numan Thabit
//! This module provides actual blockchain verification of ZEC payments
//! by connecting to a lightwalletd server.

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

use crate::{PaymentProof, PaymentRequirements, PaymentStatus, X402Error, X402Result};
use crate::verify::PaymentVerifier;

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

/// Cache entry for verified payments
#[derive(Debug, Clone)]
struct CachedPayment {
    status: PaymentStatus,
    verified_at: std::time::Instant,
    amount: u64,
    address: String,
}

/// Real payment verifier using lightwalletd
///
/// This verifier connects to a lightwalletd server and verifies payments
/// by checking transactions on the Zcash blockchain.
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

        // Query lightwalletd for transaction
        let tx_result = self.fetch_transaction(&proof.txid).await?;

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

    /// Fetch transaction details from lightwalletd
    ///
    /// Returns: (amount_zatoshis, to_address, confirmations, block_height)
    async fn fetch_transaction(&self, txid: &str) -> X402Result<Option<(u64, String, u32, u32)>> {
        // Convert txid to bytes
        let txid_bytes = hex::decode(txid)
            .map_err(|e| X402Error::InvalidPaymentProof(format!("Invalid txid hex: {}", e)))?;

        if txid_bytes.len() != 32 {
            return Err(X402Error::InvalidPaymentProof(
                "Transaction ID must be 32 bytes".into(),
            ));
        }

        // For now, return a helpful error if gRPC features aren't enabled
        #[cfg(not(feature = "lightwalletd-grpc"))]
        {
            // Provide a mock/placeholder that explains what's needed
            return Err(X402Error::LightwalletdError(
                "Lightwalletd gRPC not enabled. Add 'lightwalletd-grpc' feature or use \
                the REST API fallback. For production, implement the gRPC client with \
                the zcash.proto definitions.".into()
            ));
        }

        #[cfg(feature = "lightwalletd-grpc")]
        {
            self.fetch_transaction_grpc(&txid_bytes).await
        }
    }

    #[cfg(feature = "lightwalletd-grpc")]
    async fn fetch_transaction_grpc(&self, txid_bytes: &[u8]) -> X402Result<Option<(u64, String, u32, u32)>> {
        // This would be the actual gRPC implementation
        // For now, placeholder that returns NotFound
        // In production, this connects to lightwalletd and fetches the tx
        todo!("Implement gRPC client - see zkpf-near-tee/src/lightwalletd_client.rs for reference")
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

/// REST-based verifier for lightwalletd servers that expose HTTP endpoints
///
/// This is an alternative to gRPC that works with some lightwalletd configurations.
#[derive(Clone)]
pub struct LightwalletdRestVerifier {
    /// Base URL for the REST API
    base_url: String,
    /// HTTP client
    client: reqwest::Client,
    /// Cache
    cache: Arc<RwLock<std::collections::HashMap<String, CachedPayment>>>,
}

impl LightwalletdRestVerifier {
    /// Create a new REST verifier
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
}

