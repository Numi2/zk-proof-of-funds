//! Builder for x402 payment requirements

use chrono::{Duration, Utc};

use crate::{
    headers::build_402_headers, PaymentRequirements, PaymentScheme, X402Error, X402Headers,
    X402Result, ZecNetwork, ZATOSHIS_PER_ZEC,
};

/// Builder for creating x402 payment requirements
///
/// # Example
///
/// ```rust
/// use zkpf_x402::{X402Builder, ZecNetwork};
///
/// let payment = X402Builder::new()
///     .address("zs1example...")
///     .amount_zec(0.001)
///     .network(ZecNetwork::Mainnet)
///     .resource("/api/data")
///     .description("API access")
///     .max_age_seconds(300)
///     .build()
///     .unwrap();
/// ```
#[derive(Debug, Clone)]
pub struct X402Builder {
    address: Option<String>,
    amount_zatoshis: Option<u64>,
    network: ZecNetwork,
    scheme: Option<PaymentScheme>,
    resource: String,
    description: Option<String>,
    memo: Option<String>,
    payment_id: Option<String>,
    max_age_seconds: u64,
    min_confirmations: u32,
}

impl Default for X402Builder {
    fn default() -> Self {
        Self {
            address: None,
            amount_zatoshis: None,
            network: ZecNetwork::Mainnet,
            scheme: None,
            resource: "/".to_string(),
            description: None,
            memo: None,
            payment_id: None,
            max_age_seconds: 900, // 15 minutes default
            min_confirmations: 1,
        }
    }
}

impl X402Builder {
    /// Create a new x402 builder
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the payment destination address (required)
    ///
    /// Supports:
    /// - Shielded Sapling addresses (zs1...)
    /// - Transparent addresses (t1... or t3...)
    /// - Unified addresses (u1...)
    pub fn address(mut self, address: impl Into<String>) -> Self {
        let addr = address.into();
        // Auto-detect scheme from address if not set
        if self.scheme.is_none() {
            self.scheme = PaymentScheme::from_address(&addr);
        }
        self.address = Some(addr);
        self
    }

    /// Set the payment amount in ZEC
    pub fn amount_zec(mut self, zec: f64) -> Self {
        self.amount_zatoshis = Some((zec * ZATOSHIS_PER_ZEC as f64).round() as u64);
        self
    }

    /// Set the payment amount in zatoshis (1 ZEC = 100,000,000 zatoshis)
    pub fn amount_zatoshis(mut self, zats: u64) -> Self {
        self.amount_zatoshis = Some(zats);
        self
    }

    /// Set the network (mainnet or testnet)
    pub fn network(mut self, network: ZecNetwork) -> Self {
        self.network = network;
        self
    }

    /// Use testnet
    pub fn testnet(mut self) -> Self {
        self.network = ZecNetwork::Testnet;
        self
    }

    /// Use mainnet (default)
    pub fn mainnet(mut self) -> Self {
        self.network = ZecNetwork::Mainnet;
        self
    }

    /// Set the payment scheme explicitly
    ///
    /// If not set, will be auto-detected from address format.
    pub fn scheme(mut self, scheme: PaymentScheme) -> Self {
        self.scheme = Some(scheme);
        self
    }

    /// Set the resource path being accessed
    pub fn resource(mut self, resource: impl Into<String>) -> Self {
        self.resource = resource.into();
        self
    }

    /// Set a description for the payment (shown to user)
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Set a memo to include in the transaction
    ///
    /// For shielded transactions, this is encrypted and only visible to the recipient.
    pub fn memo(mut self, memo: impl Into<String>) -> Self {
        self.memo = Some(memo.into());
        self
    }

    /// Set a unique payment ID for tracking
    ///
    /// Can be used to correlate payments with specific requests.
    pub fn payment_id(mut self, id: impl Into<String>) -> Self {
        self.payment_id = Some(id.into());
        self
    }

    /// Generate a random payment ID
    pub fn random_payment_id(mut self) -> Self {
        use rand::Rng;
        let id: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(16)
            .map(char::from)
            .collect();
        self.payment_id = Some(id);
        self
    }

    /// Set how long the payment requirement is valid (in seconds)
    ///
    /// Default is 900 seconds (15 minutes).
    pub fn max_age_seconds(mut self, seconds: u64) -> Self {
        self.max_age_seconds = seconds;
        self
    }

    /// Set maximum age in minutes
    pub fn max_age_minutes(mut self, minutes: u64) -> Self {
        self.max_age_seconds = minutes * 60;
        self
    }

    /// Set minimum confirmations required before accepting payment
    ///
    /// Default is 1. Use 0 for accepting unconfirmed transactions (not recommended).
    pub fn min_confirmations(mut self, confirmations: u32) -> Self {
        self.min_confirmations = confirmations;
        self
    }

    /// Accept unconfirmed transactions (0 confirmations)
    ///
    /// ⚠️ Warning: Accepting unconfirmed transactions has higher double-spend risk.
    pub fn accept_unconfirmed(mut self) -> Self {
        self.min_confirmations = 0;
        self
    }

    /// Build the payment requirements
    pub fn build(self) -> X402Result<PaymentRequirements> {
        let address = self.address.ok_or(X402Error::MissingField("address"))?;
        let amount_zatoshis = self
            .amount_zatoshis
            .ok_or(X402Error::MissingField("amount"))?;

        if amount_zatoshis == 0 {
            return Err(X402Error::InvalidAmount(
                "Amount must be greater than 0".into(),
            ));
        }

        let scheme = self
            .scheme
            .or_else(|| PaymentScheme::from_address(&address))
            .ok_or_else(|| X402Error::InvalidAddress("Cannot detect address type".into()))?;

        let expires_at = Utc::now() + Duration::seconds(self.max_age_seconds as i64);

        let req = PaymentRequirements {
            version: crate::X402_VERSION.to_string(),
            scheme,
            address,
            amount_zatoshis,
            network: self.network,
            expires_at,
            min_confirmations: self.min_confirmations,
            resource: self.resource,
            description: self.description,
            payment_id: self.payment_id,
            memo: self.memo,
        };

        req.validate()?;
        Ok(req)
    }

    /// Build and return HTTP headers for a 402 response
    pub fn build_headers(self) -> X402Result<X402Headers> {
        let req = self.build()?;
        build_402_headers(&req)
    }
}

/// Quick builder for common use cases
impl X402Builder {
    /// Create a payment for API access
    ///
    /// ```rust
    /// use zkpf_x402::X402Builder;
    ///
    /// let payment = X402Builder::api_payment(
    ///     "zs1...",
    ///     0.001,
    ///     "/api/expensive-endpoint"
    /// ).build().unwrap();
    /// ```
    pub fn api_payment(
        address: impl Into<String>,
        amount_zec: f64,
        resource: impl Into<String>,
    ) -> Self {
        Self::new()
            .address(address)
            .amount_zec(amount_zec)
            .resource(resource)
            .description("API access fee")
            .random_payment_id()
    }

    /// Create a micropayment (small amounts, faster confirmation)
    ///
    /// Uses 0 confirmations for fast access, suitable for small amounts.
    pub fn micropayment(address: impl Into<String>, amount_zec: f64) -> Self {
        Self::new()
            .address(address)
            .amount_zec(amount_zec)
            .accept_unconfirmed()
            .max_age_minutes(5)
            .random_payment_id()
    }

    /// Create a high-value payment (more confirmations required)
    ///
    /// Requires 6 confirmations for security, longer expiry time.
    pub fn secure_payment(address: impl Into<String>, amount_zec: f64) -> Self {
        Self::new()
            .address(address)
            .amount_zec(amount_zec)
            .min_confirmations(6)
            .max_age_minutes(60)
            .random_payment_id()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builder_basic() {
        let payment = X402Builder::new()
            .address("zs1testaddress1234567890")
            .amount_zec(1.0)
            .build()
            .unwrap();

        assert_eq!(payment.address, "zs1testaddress1234567890");
        assert_eq!(payment.amount_zatoshis, 100_000_000);
        assert_eq!(payment.scheme, PaymentScheme::Sapling);
    }

    #[test]
    fn test_builder_transparent() {
        let payment = X402Builder::new()
            .address("t1testaddress1234567890")
            .amount_zatoshis(1000)
            .build()
            .unwrap();

        assert_eq!(payment.scheme, PaymentScheme::Transparent);
    }

    #[test]
    fn test_builder_missing_address() {
        let result = X402Builder::new().amount_zec(1.0).build();

        assert!(result.is_err());
    }

    #[test]
    fn test_builder_missing_amount() {
        let result = X402Builder::new()
            .address("zs1testaddress1234567890")
            .build();

        assert!(result.is_err());
    }

    #[test]
    fn test_api_payment_shorthand() {
        let payment = X402Builder::api_payment("zs1test", 0.001, "/api/data")
            .build()
            .unwrap();

        assert!(payment.payment_id.is_some());
        assert_eq!(payment.description, Some("API access fee".to_string()));
    }

    #[test]
    fn test_headers_generation() {
        let headers = X402Builder::new()
            .address("zs1testaddress1234567890")
            .amount_zec(0.5)
            .build_headers()
            .unwrap();

        assert!(!headers.is_empty());
        assert!(headers.get(crate::HEADER_PAYMENT_ADDRESS).is_some());
    }
}

