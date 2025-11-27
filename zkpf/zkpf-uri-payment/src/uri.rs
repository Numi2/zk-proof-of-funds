//! URI parsing and generation for Payment-Encapsulating URIs
//!
//! ## URI Format
//!
//! ```text
//! https://pay.withzcash.com:65536/v1#amount=1.23&desc=Payment+for+foo&key=zkey1...
//! ```
//!
//! The URI uses HTTPS scheme with an intentionally invalid port (65536) to prevent
//! accidental network requests while still allowing deep linking on mobile platforms.

use bech32::{Bech32m, Hrp};
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use std::str::FromStr;

use crate::{
    EphemeralPaymentKey, Error, Result, 
    MAINNET_HOST, MAINNET_KEY_HRP, TESTNET_HOST, TESTNET_KEY_HRP, URI_PATH,
};

/// Network selection for URI generation
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum UriNetwork {
    /// Zcash mainnet
    #[default]
    Mainnet,
    /// Zcash testnet
    Testnet,
}

impl UriNetwork {
    /// Get the host for this network
    pub fn host(&self) -> &'static str {
        match self {
            Self::Mainnet => MAINNET_HOST,
            Self::Testnet => TESTNET_HOST,
        }
    }

    /// Get the Bech32 HRP for keys on this network
    pub fn key_hrp(&self) -> &'static str {
        match self {
            Self::Mainnet => MAINNET_KEY_HRP,
            Self::Testnet => TESTNET_KEY_HRP,
        }
    }

    /// Detect network from host
    pub fn from_host(host: &str) -> Option<Self> {
        if host == MAINNET_HOST {
            Some(Self::Mainnet)
        } else if host == TESTNET_HOST {
            Some(Self::Testnet)
        } else {
            None
        }
    }

    /// Detect network from Bech32 HRP
    pub fn from_key_hrp(hrp: &str) -> Option<Self> {
        if hrp == MAINNET_KEY_HRP {
            Some(Self::Mainnet)
        } else if hrp == TESTNET_KEY_HRP {
            Some(Self::Testnet)
        } else {
            None
        }
    }
}

/// A parsed Payment-Encapsulating URI
#[derive(Debug, Clone)]
pub struct PaymentUri {
    /// The payment amount in ZEC (as a string to preserve formatting)
    amount: String,
    /// The amount in zatoshis
    amount_zats: u64,
    /// Optional description
    description: Option<String>,
    /// The ephemeral payment key
    key: EphemeralPaymentKey,
    /// The network
    network: UriNetwork,
}

impl PaymentUri {
    /// Get the amount as a formatted string
    pub fn amount_str(&self) -> &str {
        &self.amount
    }

    /// Get the amount in zatoshis
    pub fn amount_zats(&self) -> u64 {
        self.amount_zats
    }

    /// Get the amount in ZEC
    pub fn amount_zec(&self) -> f64 {
        self.amount_zats as f64 / 100_000_000.0
    }

    /// Get the description
    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    /// Get a reference to the payment key
    pub fn key(&self) -> &EphemeralPaymentKey {
        &self.key
    }

    /// Consume self and return the payment key
    pub fn into_key(self) -> EphemeralPaymentKey {
        self.key
    }

    /// Get the network
    pub fn network(&self) -> UriNetwork {
        self.network
    }

    /// Generate the full URI string
    pub fn to_uri_string(&self) -> String {
        let host = self.network.host();
        let key_encoded = encode_key(&self.key, self.network);
        
        let mut fragment = format!("amount={}&key={}", self.amount, key_encoded);
        
        if let Some(ref desc) = self.description {
            let encoded_desc = utf8_percent_encode(desc, NON_ALPHANUMERIC).to_string();
            fragment = format!("amount={}&desc={}&key={}", self.amount, encoded_desc, key_encoded);
        }
        
        // Note: We use port 65536 conceptually, but represent it as :65536 in the string
        // Even though it's not a valid TCP port, it works for URL parsing and deep linking
        format!("https://{}:65536/{}#{}", host, URI_PATH, fragment)
    }

    /// Generate a short display version (for showing to users)
    pub fn display_short(&self) -> String {
        let key_str = encode_key(&self.key, self.network);
        let key_preview = if key_str.len() > 12 {
            format!("{}...{}", &key_str[..8], &key_str[key_str.len()-4..])
        } else {
            key_str
        };
        
        if let Some(ref desc) = self.description {
            format!("{} ZEC - {} ({})", self.amount, desc, key_preview)
        } else {
            format!("{} ZEC ({})", self.amount, key_preview)
        }
    }
}

impl FromStr for PaymentUri {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        parse_uri(s)
    }
}

impl std::fmt::Display for PaymentUri {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_uri_string())
    }
}

/// Builder for constructing Payment URIs
pub struct PaymentUriBuilder {
    amount_zats: u64,
    description: Option<String>,
    key: EphemeralPaymentKey,
    network: UriNetwork,
}

impl PaymentUriBuilder {
    /// Create a new URI builder with required parameters
    pub fn new(key: EphemeralPaymentKey, amount_zats: u64) -> Self {
        Self {
            amount_zats,
            description: None,
            key,
            network: UriNetwork::Mainnet,
        }
    }

    /// Set the network
    pub fn network(mut self, network: UriNetwork) -> Self {
        self.network = network;
        self
    }

    /// Set an optional description
    pub fn description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Build the payment URI
    pub fn build(self) -> PaymentUri {
        PaymentUri {
            amount: format_zec_amount(self.amount_zats),
            amount_zats: self.amount_zats,
            description: self.description,
            key: self.key,
            network: self.network,
        }
    }
}

/// Parse a Payment-Encapsulating URI
pub fn parse_uri(uri_str: &str) -> Result<PaymentUri> {
    // Parse as URL
    let url = url::Url::parse(uri_str)?;

    // Validate scheme
    if url.scheme() != "https" {
        return Err(Error::InvalidUri("Scheme must be https".to_string()));
    }

    // Validate and extract host
    let host = url.host_str()
        .ok_or_else(|| Error::InvalidUri("Missing host".to_string()))?;
    
    let network = UriNetwork::from_host(host)
        .ok_or_else(|| Error::InvalidUri(format!("Unknown host: {}", host)))?;

    // Validate port (should be 65536, but browsers may reject this)
    // We're lenient here and accept the URL even without the port
    if let Some(port) = url.port() {
        // Port 65536 will be parsed as 0 due to overflow, or may error
        // We accept any port for compatibility
        let _ = port;
    }

    // Validate path
    let path = url.path();
    if path != format!("/{}", URI_PATH) && path != format!("/{}/", URI_PATH) {
        return Err(Error::InvalidUri(format!("Invalid path: {}", path)));
    }

    // Parse fragment parameters
    let fragment = url.fragment()
        .ok_or(Error::MissingParameter("fragment"))?;

    let mut amount: Option<String> = None;
    let mut description: Option<String> = None;
    let mut key_str: Option<String> = None;

    for param in fragment.split('&') {
        let mut parts = param.splitn(2, '=');
        let name = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");

        match name {
            "amount" => {
                amount = Some(value.to_string());
            }
            "desc" => {
                let decoded = percent_decode_str(value)
                    .decode_utf8()
                    .map_err(|e| Error::InvalidUri(format!("Invalid desc encoding: {}", e)))?;
                description = Some(decoded.into_owned());
            }
            "key" => {
                key_str = Some(value.to_string());
            }
            _ => {
                // Ignore unknown parameters for forward compatibility
            }
        }
    }

    // Validate required parameters
    let amount_str = amount.ok_or(Error::MissingParameter("amount"))?;
    let key_encoded = key_str.ok_or(Error::MissingParameter("key"))?;

    // Parse amount
    let amount_zats = parse_zec_amount(&amount_str)?;

    // Decode key
    let key = decode_key(&key_encoded)?;

    Ok(PaymentUri {
        amount: amount_str,
        amount_zats,
        description,
        key,
        network,
    })
}

/// Encode a payment key using Bech32m
fn encode_key(key: &EphemeralPaymentKey, network: UriNetwork) -> String {
    let hrp = Hrp::parse(network.key_hrp()).expect("valid HRP");
    bech32::encode::<Bech32m>(hrp, key.as_bytes()).expect("valid encoding")
}

/// Decode a Bech32m-encoded payment key
fn decode_key(encoded: &str) -> Result<EphemeralPaymentKey> {
    let (hrp, data) = bech32::decode(encoded)
        .map_err(|e| Error::InvalidKeyEncoding(e.to_string()))?;

    // Validate HRP
    let hrp_str = hrp.as_str();
    let _network = UriNetwork::from_key_hrp(hrp_str)
        .ok_or_else(|| Error::InvalidKeyEncoding(format!("Unknown HRP: {}", hrp_str)))?;

    // Validate data length
    if data.len() != 32 {
        return Err(Error::InvalidKeyEncoding(format!(
            "Expected 32 bytes, got {}",
            data.len()
        )));
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&data);

    Ok(EphemeralPaymentKey::from_bytes(key_bytes))
}

/// Parse a ZEC amount string to zatoshis
fn parse_zec_amount(amount_str: &str) -> Result<u64> {
    let amount_str = amount_str.trim();
    
    if amount_str.is_empty() {
        return Err(Error::InvalidAmount("Empty amount".to_string()));
    }

    // Split on decimal point
    let parts: Vec<&str> = amount_str.split('.').collect();
    
    if parts.len() > 2 {
        return Err(Error::InvalidAmount(format!("Multiple decimal points: {}", amount_str)));
    }

    let whole_part = parts[0];
    let frac_part = if parts.len() == 2 { parts[1] } else { "" };

    // Validate no invalid characters
    if !whole_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(Error::InvalidAmount(format!("Invalid whole part: {}", whole_part)));
    }
    if !frac_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(Error::InvalidAmount(format!("Invalid fractional part: {}", frac_part)));
    }

    // Check decimal places (max 8)
    if frac_part.len() > 8 {
        return Err(Error::TooManyDecimalPlaces(amount_str.to_string()));
    }

    // Parse whole part
    let whole_zats: u64 = if whole_part.is_empty() {
        0
    } else {
        whole_part.parse::<u64>()
            .map_err(|e| Error::InvalidAmount(format!("Invalid whole part: {}", e)))?
            .checked_mul(100_000_000)
            .ok_or_else(|| Error::InvalidAmount("Amount overflow".to_string()))?
    };

    // Parse fractional part (pad to 8 digits)
    let frac_zats: u64 = if frac_part.is_empty() {
        0
    } else {
        let padded = format!("{:0<8}", frac_part);
        padded[..8].parse::<u64>()
            .map_err(|e| Error::InvalidAmount(format!("Invalid fractional part: {}", e)))?
    };

    whole_zats.checked_add(frac_zats)
        .ok_or_else(|| Error::InvalidAmount("Amount overflow".to_string()))
}

/// Format zatoshis as a ZEC amount string
fn format_zec_amount(zats: u64) -> String {
    let whole = zats / 100_000_000;
    let frac = zats % 100_000_000;
    
    if frac == 0 {
        format!("{}", whole)
    } else {
        // Format fraction and strip trailing zeros
        let frac_str = format!("{:08}", frac);
        let trimmed = frac_str.trim_end_matches('0');
        format!("{}.{}", whole, trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn test_amount_parsing() {
        assert_eq!(parse_zec_amount("1").unwrap(), 100_000_000);
        assert_eq!(parse_zec_amount("1.0").unwrap(), 100_000_000);
        assert_eq!(parse_zec_amount("1.23").unwrap(), 123_000_000);
        assert_eq!(parse_zec_amount("0.00001").unwrap(), 1000);
        assert_eq!(parse_zec_amount("0.00000001").unwrap(), 1);
        assert_eq!(parse_zec_amount("123.45678901").unwrap_err().to_string().contains("decimal"), true);
    }

    #[test]
    fn test_amount_formatting() {
        assert_eq!(format_zec_amount(100_000_000), "1");
        assert_eq!(format_zec_amount(123_000_000), "1.23");
        assert_eq!(format_zec_amount(1000), "0.00001");
        assert_eq!(format_zec_amount(1), "0.00000001");
        assert_eq!(format_zec_amount(123_456_789), "1.23456789");
    }

    #[test]
    fn test_key_encoding_roundtrip() {
        let key = EphemeralPaymentKey::random(&mut OsRng);
        let encoded = encode_key(&key, UriNetwork::Mainnet);
        let decoded = decode_key(&encoded).unwrap();
        
        assert_eq!(key.as_bytes(), decoded.as_bytes());
        assert!(encoded.starts_with("zkey1"));
    }

    #[test]
    fn test_uri_builder() {
        let key = EphemeralPaymentKey::from_bytes([42u8; 32]);
        let uri = PaymentUriBuilder::new(key, 123_000_000)
            .description("Test payment")
            .network(UriNetwork::Mainnet)
            .build();
        
        assert_eq!(uri.amount_zats(), 123_000_000);
        assert_eq!(uri.amount_str(), "1.23");
        assert_eq!(uri.description(), Some("Test payment"));
        
        let uri_str = uri.to_uri_string();
        assert!(uri_str.starts_with("https://pay.withzcash.com:65536/v1#"));
        assert!(uri_str.contains("amount=1.23"));
        assert!(uri_str.contains("desc=Test%20payment"));
        assert!(uri_str.contains("key=zkey1"));
    }

    #[test]
    fn test_uri_parsing() {
        let key = EphemeralPaymentKey::from_bytes([42u8; 32]);
        let original = PaymentUriBuilder::new(key, 123_000_000)
            .description("Test payment")
            .build();
        
        let uri_str = original.to_uri_string();
        let parsed = parse_uri(&uri_str).unwrap();
        
        assert_eq!(parsed.amount_zats(), 123_000_000);
        assert_eq!(parsed.amount_str(), "1.23");
        assert_eq!(parsed.description(), Some("Test payment"));
        assert_eq!(parsed.key().as_bytes(), original.key().as_bytes());
    }

    #[test]
    fn test_uri_without_description() {
        let key = EphemeralPaymentKey::from_bytes([42u8; 32]);
        let uri = PaymentUriBuilder::new(key, 100_000_000).build();
        
        let uri_str = uri.to_uri_string();
        let parsed = parse_uri(&uri_str).unwrap();
        
        assert_eq!(parsed.description(), None);
        assert_eq!(parsed.amount_zats(), 100_000_000);
    }

    #[test]
    fn test_testnet_uri() {
        let key = EphemeralPaymentKey::from_bytes([42u8; 32]);
        let uri = PaymentUriBuilder::new(key, 100_000_000)
            .network(UriNetwork::Testnet)
            .build();
        
        let uri_str = uri.to_uri_string();
        assert!(uri_str.contains("pay.testzcash.com"));
        assert!(uri_str.contains("zkeytest1"));
        
        let parsed = parse_uri(&uri_str).unwrap();
        assert_eq!(parsed.network(), UriNetwork::Testnet);
    }
}

