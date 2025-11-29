//! HTTP middleware for x402 payment gating
//! Numan Thabit
//! This module provides ready-to-use middleware for Axum web framework.
//!
//! # Example
//!
//! ```rust,ignore
//! use axum::{Router, routing::get};
//! use zkpf_x402::{X402Builder, middleware::X402Layer};
//! use std::sync::Arc;
//!
//! let config = X402Config::new("zs1youraddress...");
//!
//! let app = Router::new()
//!     .route("/premium", get(premium_handler))
//!     .layer(X402Layer::new(config));
//! ```

use std::sync::Arc;

use axum::{
    body::Body,
    extract::Request,
    http::{Response, StatusCode},
};
use tower::{Layer, Service};

use crate::{
    headers::{build_402_headers, PaymentHeaders},
    verify::{PaymentStatus, PaymentVerifier},
    PaymentRequirements, X402Builder, X402Error, X402Result, ZecNetwork,
    HEADER_PAYMENT_PROOF,
};

/// Configuration for x402 middleware
#[derive(Clone)]
pub struct X402Config {
    /// Default receiving address
    pub address: String,
    /// Network (mainnet/testnet)
    pub network: ZecNetwork,
    /// Minimum confirmations required
    pub min_confirmations: u32,
    /// Payment validity duration in seconds
    pub max_age_seconds: u64,
}

impl X402Config {
    /// Create new config with address
    pub fn new(address: impl Into<String>) -> Self {
        Self {
            address: address.into(),
            network: ZecNetwork::Mainnet,
            min_confirmations: 1,
            max_age_seconds: 900,
        }
    }

    /// Set network
    pub fn network(mut self, network: ZecNetwork) -> Self {
        self.network = network;
        self
    }

    /// Set minimum confirmations
    pub fn min_confirmations(mut self, confirmations: u32) -> Self {
        self.min_confirmations = confirmations;
        self
    }

    /// Set max age in seconds
    pub fn max_age_seconds(mut self, seconds: u64) -> Self {
        self.max_age_seconds = seconds;
        self
    }
}

/// Pricing function that determines the cost for a request
pub trait PricingFunction: Send + Sync + Clone {
    /// Get the price in zatoshis for a given request path
    fn get_price(&self, path: &str) -> Option<u64>;

    /// Get optional description for the payment
    fn get_description(&self, path: &str) -> Option<String> {
        let _ = path;
        None
    }
}

/// Simple fixed-price pricing
#[derive(Clone)]
pub struct FixedPrice {
    price_zatoshis: u64,
    description: Option<String>,
}

impl FixedPrice {
    /// Create a fixed price in ZEC
    pub fn zec(amount: f64) -> Self {
        Self {
            price_zatoshis: crate::zec_to_zatoshis(amount),
            description: None,
        }
    }

    /// Create a fixed price in zatoshis
    pub fn zatoshis(amount: u64) -> Self {
        Self {
            price_zatoshis: amount,
            description: None,
        }
    }

    /// Set description
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }
}

impl PricingFunction for FixedPrice {
    fn get_price(&self, _path: &str) -> Option<u64> {
        Some(self.price_zatoshis)
    }

    fn get_description(&self, _path: &str) -> Option<String> {
        self.description.clone()
    }
}

/// Per-path pricing with a hashmap
#[derive(Clone)]
pub struct PathPricing {
    prices: std::collections::HashMap<String, u64>,
    default_price: Option<u64>,
}

impl PathPricing {
    /// Create new path-based pricing
    pub fn new() -> Self {
        Self {
            prices: std::collections::HashMap::new(),
            default_price: None,
        }
    }

    /// Add a price for a specific path
    pub fn add_path(mut self, path: impl Into<String>, price_zatoshis: u64) -> Self {
        self.prices.insert(path.into(), price_zatoshis);
        self
    }

    /// Set default price for unmatched paths
    pub fn default_price(mut self, price_zatoshis: u64) -> Self {
        self.default_price = Some(price_zatoshis);
        self
    }
}

impl Default for PathPricing {
    fn default() -> Self {
        Self::new()
    }
}

impl PricingFunction for PathPricing {
    fn get_price(&self, path: &str) -> Option<u64> {
        self.prices.get(path).copied().or(self.default_price)
    }
}

/// x402 middleware layer
#[derive(Clone)]
pub struct X402Layer<P, V>
where
    P: PricingFunction,
    V: PaymentVerifier + Clone,
{
    config: X402Config,
    pricing: P,
    verifier: Arc<V>,
}

impl<P, V> X402Layer<P, V>
where
    P: PricingFunction,
    V: PaymentVerifier + Clone,
{
    /// Create a new x402 layer
    pub fn new(config: X402Config, pricing: P, verifier: V) -> Self {
        Self {
            config,
            pricing,
            verifier: Arc::new(verifier),
        }
    }
}

impl<S, P, V> Layer<S> for X402Layer<P, V>
where
    P: PricingFunction + Clone,
    V: PaymentVerifier + Clone,
{
    type Service = X402Middleware<S, P, V>;

    fn layer(&self, inner: S) -> Self::Service {
        X402Middleware {
            inner,
            config: self.config.clone(),
            pricing: self.pricing.clone(),
            verifier: self.verifier.clone(),
        }
    }
}

/// x402 middleware service
#[derive(Clone)]
pub struct X402Middleware<S, P, V>
where
    P: PricingFunction,
    V: PaymentVerifier + Clone,
{
    inner: S,
    config: X402Config,
    pricing: P,
    verifier: Arc<V>,
}

impl<S, P, V> Service<Request> for X402Middleware<S, P, V>
where
    S: Service<Request, Response = Response<Body>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    P: PricingFunction + Clone + 'static,
    V: PaymentVerifier + Clone + 'static,
{
    type Response = Response<Body>;
    type Error = S::Error;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self::Response, Self::Error>> + Send>,
    >;

    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request) -> Self::Future {
        let path = req.uri().path().to_string();
        let config = self.config.clone();
        let pricing = self.pricing.clone();
        let verifier = self.verifier.clone();
        let mut inner = self.inner.clone();

        Box::pin(async move {
            // Check if this path requires payment
            let price = match pricing.get_price(&path) {
                Some(p) => p,
                None => {
                    // No price = free access
                    return inner.call(req).await;
                }
            };

            // Check for payment header
            let payment_header = req
                .headers()
                .get(HEADER_PAYMENT_PROOF)
                .and_then(|v| v.to_str().ok())
                .map(String::from);

            let auth_header = req
                .headers()
                .get(http::header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .map(String::from);

            let payment_headers = PaymentHeaders::new(payment_header, auth_header);

            // Try to extract and verify payment
            match payment_headers.extract_proof() {
                Ok(proof) => {
                    // Build requirements for verification
                    let requirements = match build_requirements(&config, &pricing, &path, price) {
                        Ok(r) => r,
                        Err(e) => return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, &e)),
                    };

                    // Verify payment
                    match verifier.verify(&proof, &requirements) {
                        Ok(PaymentStatus::Verified { .. }) => {
                            // Payment verified, proceed with request
                            inner.call(req).await
                        }
                        Ok(PaymentStatus::Pending { confirmations }) => {
                            // Payment pending, return 402 with status
                            let mut resp = payment_required_response(&requirements);
                            resp.headers_mut().insert(
                                "X-Payment-Status",
                                format!("pending:{}", confirmations).parse().unwrap(),
                            );
                            Ok(resp)
                        }
                        Ok(status) => {
                            // Payment failed
                            let msg = match status {
                                PaymentStatus::NotFound => "Payment not found",
                                PaymentStatus::AmountMismatch { .. } => "Insufficient payment amount",
                                PaymentStatus::AddressMismatch => "Wrong payment address",
                                _ => "Payment verification failed",
                            };
                            Ok(error_response(StatusCode::PAYMENT_REQUIRED, &X402Error::VerificationError(msg.into())))
                        }
                        Err(e) => {
                            Ok(error_response(StatusCode::BAD_REQUEST, &e))
                        }
                    }
                }
                Err(_) => {
                    // No payment provided, return 402
                    let requirements = match build_requirements(&config, &pricing, &path, price) {
                        Ok(r) => r,
                        Err(e) => return Ok(error_response(StatusCode::INTERNAL_SERVER_ERROR, &e)),
                    };
                    Ok(payment_required_response(&requirements))
                }
            }
        })
    }
}

fn build_requirements<P: PricingFunction>(
    config: &X402Config,
    pricing: &P,
    path: &str,
    price: u64,
) -> X402Result<PaymentRequirements> {
    let mut builder = X402Builder::new()
        .address(&config.address)
        .amount_zatoshis(price)
        .network(config.network)
        .resource(path)
        .min_confirmations(config.min_confirmations)
        .max_age_seconds(config.max_age_seconds)
        .random_payment_id();

    if let Some(desc) = pricing.get_description(path) {
        builder = builder.description(desc);
    }

    builder.build()
}

fn payment_required_response(requirements: &PaymentRequirements) -> Response<Body> {
    let headers = match build_402_headers(requirements) {
        Ok(h) => h,
        Err(e) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &e),
    };

    let body = serde_json::json!({
        "error": "Payment Required",
        "message": "This resource requires payment",
        "payment": {
            "address": requirements.address,
            "amount_zatoshis": requirements.amount_zatoshis,
            "amount_zec": requirements.amount_zec(),
            "scheme": requirements.scheme.as_str(),
            "network": requirements.network.as_str(),
            "expires_at": requirements.expires_at.to_rfc3339(),
            "resource": requirements.resource,
            "description": requirements.description,
            "payment_id": requirements.payment_id,
        }
    });

    let mut response = Response::builder()
        .status(StatusCode::PAYMENT_REQUIRED)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();

    // Add x402 headers
    for header in headers {
        if let (Ok(name), Ok(value)) = (
            http::header::HeaderName::try_from(header.name.as_str()),
            header.value.parse()
        ) {
            response.headers_mut().insert(name, value);
        }
    }

    response
}

fn error_response(status: StatusCode, error: &X402Error) -> Response<Body> {
    let body = serde_json::json!({
        "error": status.as_str(),
        "message": error.to_string(),
    });

    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Helper to create a simple x402-protected router
pub fn x402_protected<V>(
    config: X402Config,
    price_zec: f64,
    verifier: V,
) -> X402Layer<FixedPrice, V>
where
    V: PaymentVerifier + Clone,
{
    X402Layer::new(config, FixedPrice::zec(price_zec), verifier)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fixed_pricing() {
        let pricing = FixedPrice::zec(0.001).with_description("Test");
        assert_eq!(pricing.get_price("/any/path"), Some(100_000));
        assert_eq!(pricing.get_description("/any/path"), Some("Test".to_string()));
    }

    #[test]
    fn test_path_pricing() {
        let pricing = PathPricing::new()
            .add_path("/expensive", 1_000_000)
            .add_path("/cheap", 1_000)
            .default_price(10_000);

        assert_eq!(pricing.get_price("/expensive"), Some(1_000_000));
        assert_eq!(pricing.get_price("/cheap"), Some(1_000));
        assert_eq!(pricing.get_price("/other"), Some(10_000));
    }

    #[test]
    fn test_config_builder() {
        let config = X402Config::new("zs1test")
            .network(ZecNetwork::Testnet)
            .min_confirmations(3)
            .max_age_seconds(600);

        assert_eq!(config.address, "zs1test");
        assert_eq!(config.network, ZecNetwork::Testnet);
        assert_eq!(config.min_confirmations, 3);
        assert_eq!(config.max_age_seconds, 600);
    }
}

