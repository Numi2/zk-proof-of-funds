//! HTTP headers for x402 protocol

use crate::{
    PaymentProof, PaymentRequirements, X402Error, X402Result,
    HEADER_PAYMENT_ADDRESS, HEADER_PAYMENT_AMOUNT, HEADER_PAYMENT_EXPIRES,
    HEADER_PAYMENT_MIN_CONFIRMATIONS, HEADER_PAYMENT_NETWORK,
    HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_RESOURCE, HEADER_PAYMENT_SCHEME,
};

/// Header key-value pair
#[derive(Debug, Clone)]
pub struct Header {
    pub name: String,
    pub value: String,
}

impl Header {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}

/// Collection of x402 headers for 402 response
#[derive(Debug, Clone, Default)]
pub struct X402Headers {
    headers: Vec<Header>,
}

impl X402Headers {
    /// Create new empty headers
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a header
    pub fn add(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.headers.push(Header::new(name, value));
    }

    /// Get all headers as an iterator
    pub fn iter(&self) -> impl Iterator<Item = &Header> {
        self.headers.iter()
    }

    /// Get headers as Vec of (name, value) tuples
    pub fn to_vec(&self) -> Vec<(String, String)> {
        self.headers
            .iter()
            .map(|h| (h.name.clone(), h.value.clone()))
            .collect()
    }

    /// Get a header value by name
    pub fn get(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case(name))
            .map(|h| h.value.as_str())
    }

    /// Get the number of headers
    pub fn len(&self) -> usize {
        self.headers.len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.headers.is_empty()
    }
}

impl IntoIterator for X402Headers {
    type Item = Header;
    type IntoIter = std::vec::IntoIter<Header>;

    fn into_iter(self) -> Self::IntoIter {
        self.headers.into_iter()
    }
}

/// Wrapper for parsing incoming payment headers
pub struct PaymentHeaders {
    /// Raw payment proof header value
    pub payment_proof: Option<String>,
    /// Raw authorization header value  
    pub authorization: Option<String>,
}

impl PaymentHeaders {
    /// Create from raw header values
    pub fn new(payment_proof: Option<String>, authorization: Option<String>) -> Self {
        Self {
            payment_proof,
            authorization,
        }
    }

    /// Extract payment proof from headers
    pub fn extract_proof(&self) -> X402Result<PaymentProof> {
        // First try X-Payment header
        if let Some(ref value) = self.payment_proof {
            return PaymentProof::from_header_value(value);
        }

        // Try Authorization header with X402 scheme
        if let Some(ref auth) = self.authorization {
            if let Some(token) = auth.strip_prefix("X402 ") {
                return PaymentProof::from_header_value(token.trim());
            }
            if let Some(token) = auth.strip_prefix("Bearer ") {
                // Also accept Bearer for compatibility
                return PaymentProof::from_header_value(token.trim());
            }
        }

        Err(X402Error::MissingField("payment proof"))
    }
}

/// Build x402 headers from payment requirements
pub fn build_402_headers(req: &PaymentRequirements) -> X402Result<X402Headers> {
    let mut headers = X402Headers::new();

    // Full JSON requirements
    headers.add(HEADER_PAYMENT_REQUIRED, req.to_json()?);

    // Individual headers for easy parsing
    headers.add(HEADER_PAYMENT_SCHEME, req.scheme.as_str());
    headers.add(HEADER_PAYMENT_ADDRESS, &req.address);
    headers.add(HEADER_PAYMENT_AMOUNT, req.amount_zatoshis.to_string());
    headers.add(HEADER_PAYMENT_NETWORK, req.network.as_str());
    headers.add(HEADER_PAYMENT_EXPIRES, req.expires_at.to_rfc3339());
    headers.add(
        HEADER_PAYMENT_MIN_CONFIRMATIONS,
        req.min_confirmations.to_string(),
    );
    headers.add(HEADER_PAYMENT_RESOURCE, &req.resource);

    Ok(headers)
}

/// Parse x402 headers into payment requirements
pub fn parse_402_headers(headers: &X402Headers) -> X402Result<PaymentRequirements> {
    // Try to parse from full JSON header first
    if let Some(json) = headers.get(HEADER_PAYMENT_REQUIRED) {
        return PaymentRequirements::from_json(json);
    }

    // Fall back to individual headers
    let address = headers
        .get(HEADER_PAYMENT_ADDRESS)
        .ok_or(X402Error::MissingField("address"))?
        .to_string();

    let amount_str = headers
        .get(HEADER_PAYMENT_AMOUNT)
        .ok_or(X402Error::MissingField("amount"))?;
    let amount_zatoshis: u64 = amount_str
        .parse()
        .map_err(|_| X402Error::InvalidAmount(amount_str.to_string()))?;

    let mut req = PaymentRequirements::new(address, amount_zatoshis);

    if let Some(scheme) = headers.get(HEADER_PAYMENT_SCHEME) {
        if let Some(s) = crate::PaymentScheme::from_str(scheme) {
            req.scheme = s;
        }
    }

    if let Some(network) = headers.get(HEADER_PAYMENT_NETWORK) {
        if let Some(n) = crate::ZecNetwork::from_str(network) {
            req.network = n;
        }
    }

    if let Some(expires) = headers.get(HEADER_PAYMENT_EXPIRES) {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(expires) {
            req.expires_at = dt.with_timezone(&chrono::Utc);
        }
    }

    if let Some(confirmations) = headers.get(HEADER_PAYMENT_MIN_CONFIRMATIONS) {
        if let Ok(c) = confirmations.parse() {
            req.min_confirmations = c;
        }
    }

    if let Some(resource) = headers.get(HEADER_PAYMENT_RESOURCE) {
        req.resource = resource.to_string();
    }

    Ok(req)
}

#[cfg(feature = "http-core")]
impl From<X402Headers> for http::HeaderMap {
    fn from(headers: X402Headers) -> Self {
        let mut map = http::HeaderMap::new();
        for header in headers.headers {
            if let (Ok(name), Ok(value)) = (
                http::header::HeaderName::try_from(&header.name),
                http::header::HeaderValue::try_from(&header.value),
            ) {
                map.insert(name, value);
            }
        }
        map
    }
}

#[cfg(feature = "http-core")]
impl From<&http::HeaderMap> for X402Headers {
    fn from(map: &http::HeaderMap) -> Self {
        let mut headers = X402Headers::new();
        for (name, value) in map.iter() {
            if let Ok(v) = value.to_str() {
                headers.add(name.as_str(), v);
            }
        }
        headers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PaymentRequirements;

    #[test]
    fn test_header_roundtrip() {
        let req = PaymentRequirements::new("zs1test1234567890".to_string(), 100_000_000);
        let headers = build_402_headers(&req).unwrap();

        assert!(headers.get(HEADER_PAYMENT_ADDRESS).is_some());
        assert_eq!(
            headers.get(HEADER_PAYMENT_AMOUNT),
            Some("100000000")
        );
    }

    #[test]
    fn test_payment_proof_extraction() {
        let txid = "a".repeat(64);
        
        // Test X-Payment header
        let headers = PaymentHeaders::new(Some(txid.clone()), None);
        let proof = headers.extract_proof().unwrap();
        assert_eq!(proof.txid, txid);

        // Test Authorization header
        let headers = PaymentHeaders::new(None, Some(format!("X402 {}", txid)));
        let proof = headers.extract_proof().unwrap();
        assert_eq!(proof.txid, txid);
    }
}

