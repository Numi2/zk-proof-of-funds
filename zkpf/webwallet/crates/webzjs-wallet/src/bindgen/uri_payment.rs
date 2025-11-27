//! WASM bindings for URI-Encapsulated Payments
//!
//! This module provides JavaScript-accessible APIs for creating, parsing, and
//! handling URI-Encapsulated Payments as specified in the ZIP proposal.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::error::Error;

/// Bech32 HRPs for payment keys
const MAINNET_KEY_HRP: &str = "zkey";
const TESTNET_KEY_HRP: &str = "zkeytest";
const MAINNET_HOST: &str = "pay.withzcash.com";
const TESTNET_HOST: &str = "pay.testzcash.com";

/// A URI-Encapsulated Payment
///
/// This represents a payment that can be sent via any secure messaging channel.
/// The URI encodes the capability to claim funds from an on-chain transaction.
#[wasm_bindgen]
#[derive(Clone)]
pub struct UriPayment {
    /// The payment amount in zatoshis
    amount_zats: u64,
    /// The amount as a formatted string
    amount_str: String,
    /// Optional description
    description: Option<String>,
    /// The ephemeral payment key (32 bytes)
    key: [u8; 32],
    /// Whether this is for testnet
    is_testnet: bool,
    /// The payment index (if derived from seed)
    payment_index: Option<u32>,
}

#[wasm_bindgen]
impl UriPayment {
    /// Parse a URI-Encapsulated Payment from a URI string
    ///
    /// # Arguments
    /// * `uri` - The full URI string (e.g., https://pay.withzcash.com:65536/v1#amount=1.23&key=...)
    ///
    /// # Returns
    /// A parsed UriPayment object
    #[wasm_bindgen(constructor)]
    pub fn new(uri: &str) -> Result<UriPayment, Error> {
        parse_payment_uri(uri)
    }

    /// Create a new URI payment with the given parameters
    ///
    /// # Arguments
    /// * `amount_zats` - The payment amount in zatoshis
    /// * `description` - Optional description for the payment
    /// * `is_testnet` - Whether this is for testnet
    #[wasm_bindgen(js_name = "create")]
    pub fn create(
        amount_zats: u64,
        description: Option<String>,
        is_testnet: bool,
    ) -> Result<UriPayment, Error> {
        // Generate a random key
        let mut key = [0u8; 32];
        getrandom::getrandom(&mut key)
            .map_err(|e| Error::Generic(format!("Failed to generate random key: {}", e)))?;

        Ok(UriPayment {
            amount_zats,
            amount_str: format_zec_amount(amount_zats),
            description,
            key,
            is_testnet,
            payment_index: None,
        })
    }

    /// Get the payment amount in zatoshis
    #[wasm_bindgen(getter)]
    pub fn amount_zats(&self) -> u64 {
        self.amount_zats
    }

    /// Get the payment amount in ZEC (as a formatted string)
    #[wasm_bindgen(getter, js_name = "amountZec")]
    pub fn amount_zec(&self) -> String {
        self.amount_str.clone()
    }

    /// Get the payment description
    #[wasm_bindgen(getter)]
    pub fn description(&self) -> Option<String> {
        self.description.clone()
    }

    /// Get the payment key as bytes
    #[wasm_bindgen(getter, js_name = "keyBytes")]
    pub fn key_bytes(&self) -> Vec<u8> {
        self.key.to_vec()
    }

    /// Check if this payment is for testnet
    #[wasm_bindgen(getter, js_name = "isTestnet")]
    pub fn is_testnet(&self) -> bool {
        self.is_testnet
    }

    /// Get the payment index (if derived from seed)
    #[wasm_bindgen(getter, js_name = "paymentIndex")]
    pub fn payment_index(&self) -> Option<u32> {
        self.payment_index
    }

    /// Generate the full URI string
    #[wasm_bindgen(js_name = "toUri")]
    pub fn to_uri(&self) -> String {
        let host = if self.is_testnet { TESTNET_HOST } else { MAINNET_HOST };
        let key_encoded = encode_key(&self.key, self.is_testnet);
        
        let mut fragment = format!("amount={}&key={}", self.amount_str, key_encoded);
        
        if let Some(ref desc) = self.description {
            let encoded_desc = percent_encode(desc);
            fragment = format!("amount={}&desc={}&key={}", self.amount_str, encoded_desc, key_encoded);
        }
        
        format!("https://{}:65536/v1#{}", host, fragment)
    }

    /// Generate a shareable message with the payment URI
    #[wasm_bindgen(js_name = "toShareableMessage")]
    pub fn to_shareable_message(&self) -> String {
        let uri = self.to_uri();
        let amount = &self.amount_str;
        let desc = self.description.as_deref().unwrap_or("Payment");
        
        format!(
            "This message contains a Zcash payment of {} ZEC for \"{}\".\n\n\
             Click the following link to view and receive the funds:\n\n\
             {}\n\n\
             If you do not yet have a Zcash wallet, see: https://z.cash/wallets",
            amount, desc, uri
        )
    }

    /// Get a short display string for the payment
    #[wasm_bindgen(js_name = "displayShort")]
    pub fn display_short(&self) -> String {
        let key_encoded = encode_key(&self.key, self.is_testnet);
        let key_preview = if key_encoded.len() > 12 {
            format!("{}...{}", &key_encoded[..8], &key_encoded[key_encoded.len()-4..])
        } else {
            key_encoded
        };
        
        if let Some(ref desc) = self.description {
            format!("{} ZEC - {} ({})", self.amount_str, desc, key_preview)
        } else {
            format!("{} ZEC ({})", self.amount_str, key_preview)
        }
    }
}

/// Information about a URI payment status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[wasm_bindgen(inspectable)]
pub struct UriPaymentStatus {
    /// Current state of the payment
    state: String,
    /// Number of confirmations (if on-chain)
    confirmations: Option<u32>,
    /// Whether the payment can be finalized
    can_finalize: bool,
    /// Whether the payment has been finalized
    is_finalized: bool,
    /// Error message if payment is invalid
    error: Option<String>,
}

#[wasm_bindgen]
impl UriPaymentStatus {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> String {
        self.state.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn confirmations(&self) -> Option<u32> {
        self.confirmations
    }

    #[wasm_bindgen(getter, js_name = "canFinalize")]
    pub fn can_finalize(&self) -> bool {
        self.can_finalize
    }

    #[wasm_bindgen(getter, js_name = "isFinalized")]
    pub fn is_finalized(&self) -> bool {
        self.is_finalized
    }

    #[wasm_bindgen(getter)]
    pub fn error(&self) -> Option<String> {
        self.error.clone()
    }
}

impl UriPaymentStatus {
    pub fn pending() -> Self {
        Self {
            state: "pending".to_string(),
            confirmations: None,
            can_finalize: false,
            is_finalized: false,
            error: None,
        }
    }

    pub fn unconfirmed(confirmations: u32) -> Self {
        Self {
            state: "unconfirmed".to_string(),
            confirmations: Some(confirmations),
            can_finalize: false,
            is_finalized: false,
            error: None,
        }
    }

    pub fn ready_to_finalize(confirmations: u32) -> Self {
        Self {
            state: "ready".to_string(),
            confirmations: Some(confirmations),
            can_finalize: true,
            is_finalized: false,
            error: None,
        }
    }

    pub fn finalized() -> Self {
        Self {
            state: "finalized".to_string(),
            confirmations: None,
            can_finalize: false,
            is_finalized: true,
            error: None,
        }
    }

    pub fn invalid(error: String) -> Self {
        Self {
            state: "invalid".to_string(),
            confirmations: None,
            can_finalize: false,
            is_finalized: false,
            error: Some(error),
        }
    }
}

/// Parse a payment URI
fn parse_payment_uri(uri_str: &str) -> Result<UriPayment, Error> {
    // Simple URL parsing without external crate
    let uri_str = uri_str.trim();
    
    // Check scheme
    if !uri_str.starts_with("https://") {
        return Err(Error::Generic("URI must use https scheme".to_string()));
    }
    
    // Find the fragment
    let fragment_start = uri_str.find('#')
        .ok_or_else(|| Error::Generic("URI must contain fragment parameters".to_string()))?;
    
    let base = &uri_str[8..fragment_start]; // Skip "https://"
    let fragment = &uri_str[fragment_start + 1..];
    
    // Determine network from host
    let is_testnet = if base.starts_with(TESTNET_HOST) {
        true
    } else if base.starts_with(MAINNET_HOST) {
        false
    } else {
        return Err(Error::Generic(format!("Unknown host in URI: {}", base)));
    };
    
    // Parse fragment parameters
    let mut amount: Option<String> = None;
    let mut description: Option<String> = None;
    let mut key_str: Option<String> = None;
    
    for param in fragment.split('&') {
        let mut parts = param.splitn(2, '=');
        let name = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        
        match name {
            "amount" => amount = Some(value.to_string()),
            "desc" => description = Some(percent_decode(value)?),
            "key" => key_str = Some(value.to_string()),
            _ => {} // Ignore unknown parameters
        }
    }
    
    // Validate required parameters
    let amount_str = amount.ok_or_else(|| Error::Generic("Missing amount parameter".to_string()))?;
    let key_encoded = key_str.ok_or_else(|| Error::Generic("Missing key parameter".to_string()))?;
    
    // Parse amount
    let amount_zats = parse_zec_amount(&amount_str)?;
    
    // Decode key
    let key = decode_key(&key_encoded, is_testnet)?;
    
    Ok(UriPayment {
        amount_zats,
        amount_str,
        description,
        key,
        is_testnet,
        payment_index: None,
    })
}

/// Encode a payment key using Bech32m
fn encode_key(key: &[u8; 32], is_testnet: bool) -> String {
    use bech32::{Bech32m, Hrp};
    
    let hrp_str = if is_testnet { TESTNET_KEY_HRP } else { MAINNET_KEY_HRP };
    let hrp = Hrp::parse(hrp_str).expect("valid HRP");
    bech32::encode::<Bech32m>(hrp, key).expect("valid encoding")
}

/// Decode a Bech32m-encoded payment key
fn decode_key(encoded: &str, expected_testnet: bool) -> Result<[u8; 32], Error> {
    let (hrp, data) = bech32::decode(encoded)
        .map_err(|e| Error::Generic(format!("Invalid key encoding: {}", e)))?;
    
    // Validate HRP
    let expected_hrp = if expected_testnet { TESTNET_KEY_HRP } else { MAINNET_KEY_HRP };
    if hrp.as_str() != expected_hrp {
        return Err(Error::Generic(format!(
            "Key HRP mismatch: expected {}, got {}",
            expected_hrp,
            hrp.as_str()
        )));
    }
    
    // Validate data length
    if data.len() != 32 {
        return Err(Error::Generic(format!(
            "Invalid key length: expected 32 bytes, got {}",
            data.len()
        )));
    }
    
    let mut key = [0u8; 32];
    key.copy_from_slice(&data);
    Ok(key)
}

/// Parse a ZEC amount string to zatoshis
fn parse_zec_amount(amount_str: &str) -> Result<u64, Error> {
    let amount_str = amount_str.trim();
    
    if amount_str.is_empty() {
        return Err(Error::Generic("Empty amount".to_string()));
    }
    
    let parts: Vec<&str> = amount_str.split('.').collect();
    
    if parts.len() > 2 {
        return Err(Error::Generic(format!("Invalid amount format: {}", amount_str)));
    }
    
    let whole_part = parts[0];
    let frac_part = if parts.len() == 2 { parts[1] } else { "" };
    
    // Check decimal places (max 8)
    if frac_part.len() > 8 {
        return Err(Error::Generic(format!(
            "Amount has too many decimal places (max 8): {}",
            amount_str
        )));
    }
    
    // Parse whole part
    let whole_zats: u64 = if whole_part.is_empty() {
        0
    } else {
        whole_part.parse::<u64>()
            .map_err(|e| Error::Generic(format!("Invalid amount: {}", e)))?
            .checked_mul(100_000_000)
            .ok_or_else(|| Error::Generic("Amount overflow".to_string()))?
    };
    
    // Parse fractional part
    let frac_zats: u64 = if frac_part.is_empty() {
        0
    } else {
        let padded = format!("{:0<8}", frac_part);
        padded[..8].parse::<u64>()
            .map_err(|e| Error::Generic(format!("Invalid amount fraction: {}", e)))?
    };
    
    whole_zats.checked_add(frac_zats)
        .ok_or_else(|| Error::Generic("Amount overflow".to_string()))
}

/// Format zatoshis as a ZEC amount string
fn format_zec_amount(zats: u64) -> String {
    let whole = zats / 100_000_000;
    let frac = zats % 100_000_000;
    
    if frac == 0 {
        format!("{}", whole)
    } else {
        let frac_str = format!("{:08}", frac);
        let trimmed = frac_str.trim_end_matches('0');
        format!("{}.{}", whole, trimmed)
    }
}

/// Percent-encode a string for URI
fn percent_encode(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 3);
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                result.push(c);
            }
            ' ' => {
                result.push_str("%20");
            }
            _ => {
                for byte in c.to_string().as_bytes() {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    result
}

/// Percent-decode a URI string
fn percent_decode(s: &str) -> Result<String, Error> {
    let mut result = Vec::new();
    let mut chars = s.chars().peekable();
    
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() != 2 {
                return Err(Error::Generic("Invalid percent encoding".to_string()));
            }
            let byte = u8::from_str_radix(&hex, 16)
                .map_err(|_| Error::Generic("Invalid percent encoding".to_string()))?;
            result.push(byte);
        } else if c == '+' {
            result.push(b' ');
        } else {
            result.extend(c.to_string().as_bytes());
        }
    }
    
    String::from_utf8(result)
        .map_err(|e| Error::Generic(format!("Invalid UTF-8 in decoded string: {}", e)))
}

/// Validate if a string looks like a payment URI
#[wasm_bindgen(js_name = "isPaymentUri")]
pub fn is_payment_uri(s: &str) -> bool {
    let s = s.trim();
    (s.starts_with("https://pay.withzcash.com") || 
     s.starts_with("https://pay.testzcash.com")) &&
    s.contains("#") &&
    s.contains("amount=") &&
    s.contains("key=")
}

/// Extract the amount from a payment URI without full parsing
#[wasm_bindgen(js_name = "extractUriAmount")]
pub fn extract_uri_amount(uri: &str) -> Option<String> {
    let fragment_start = uri.find('#')?;
    let fragment = &uri[fragment_start + 1..];
    
    for param in fragment.split('&') {
        if let Some(value) = param.strip_prefix("amount=") {
            return Some(value.to_string());
        }
    }
    
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_parse() {
        let payment = UriPayment::create(123_000_000, Some("Test".to_string()), false).unwrap();
        let uri = payment.to_uri();
        
        assert!(uri.starts_with("https://pay.withzcash.com:65536/v1#"));
        assert!(uri.contains("amount=1.23"));
        assert!(uri.contains("desc=Test"));
        assert!(uri.contains("key=zkey1"));
        
        let parsed = UriPayment::new(&uri).unwrap();
        assert_eq!(parsed.amount_zats(), 123_000_000);
        assert_eq!(parsed.description(), Some("Test".to_string()));
    }

    #[test]
    fn test_amount_formatting() {
        assert_eq!(format_zec_amount(100_000_000), "1");
        assert_eq!(format_zec_amount(123_456_789), "1.23456789");
        assert_eq!(format_zec_amount(1000), "0.00001");
    }

    #[test]
    fn test_is_payment_uri() {
        assert!(is_payment_uri("https://pay.withzcash.com:65536/v1#amount=1&key=zkey1abc"));
        assert!(!is_payment_uri("https://example.com"));
        assert!(!is_payment_uri("not a uri"));
    }
}

