//! # zkpf-x402: x402 Payment Required Protocol for Zcash
//!
//! This crate provides a complete implementation of the x402 protocol for receiving
//! Zcash (ZEC) payments in HTTP APIs. x402 enables "pay-per-request" APIs using the
//! HTTP 402 Payment Required status code.
//!
//! ## Features
//!
//! - **Payment Requirements Builder**: Create x402 payment requirements with shielded
//!   or transparent Zcash addresses
//! - **Payment Verification**: Verify ZEC payments against lightwalletd
//! - **Framework Middleware**: Ready-to-use middleware for Axum, Tower, and other frameworks
//! - **Privacy-First**: Full support for Sapling shielded transactions
//!
//! ## Quick Start
//!
//! ```rust,ignore
//! use zkpf_x402::{X402Builder, ZecNetwork, PaymentScheme};
//!
//! // Create a payment requirement
//! let payment = X402Builder::new()
//!     .address("zs1...")  // Your Zcash shielded address
//!     .amount_zec(0.001)  // Amount in ZEC
//!     .resource("/api/premium-data")
//!     .description("API access fee")
//!     .max_age_seconds(300)  // Payment valid for 5 minutes
//!     .build()?;
//!
//! // Convert to HTTP 402 response headers
//! let headers = payment.to_headers();
//! ```
//!
//! ## x402 Protocol Overview
//!
//! The x402 protocol uses the HTTP 402 "Payment Required" status code to enable
//! cryptocurrency payments for API access. The flow is:
//!
//! 1. **Client Request**: Client requests a protected resource
//! 2. **402 Response**: Server returns 402 with payment requirements in headers
//! 3. **Payment**: Client sends payment to the specified address
//! 4. **Proof**: Client includes payment proof (txid) in `X-Payment` header
//! 5. **Verification**: Server verifies payment and grants access
//!
//! ## Headers
//!
//! ### Server Response (402)
//! - `X-Payment-Required`: JSON object with payment requirements
//! - `X-Payment-Scheme`: Payment scheme (e.g., "zcash:sapling", "zcash:transparent")
//! - `X-Payment-Address`: Destination address for payment
//! - `X-Payment-Amount`: Amount required (in zatoshis)
//! - `X-Payment-Network`: Network ("mainnet" or "testnet")
//! - `X-Payment-Expires`: ISO 8601 expiration timestamp
//!
//! ### Client Request (with payment)
//! - `X-Payment`: Payment proof (txid or signature)
//! - `Authorization`: Bearer token with payment details (alternative)
//!
//! ## Shielded vs Transparent Addresses
//!
//! This crate supports both shielded (Sapling) and transparent addresses:
//!
//! - **Shielded (Sapling)**: Addresses starting with "zs1..." - Provides full transaction
//!   privacy, hiding sender, receiver, and amount
//! - **Transparent**: Addresses starting with "t1..." - Like Bitcoin, fully visible on chain
//!
//! For maximum privacy, use shielded addresses. The crate can optionally generate
//! ephemeral receiving addresses for each payment using the URI-encapsulated payments
//! mechanism from ZIP-324.

pub mod builder;
pub mod error;
pub mod headers;
pub mod payment;
pub mod verify;
pub mod tracking;
pub mod qr;

#[cfg(feature = "axum-middleware")]
pub mod middleware;

#[cfg(any(feature = "lightwalletd", feature = "lightwalletd-rest"))]
pub mod lightwalletd;

pub use builder::X402Builder;
pub use error::{X402Error, X402Result};
pub use headers::{PaymentHeaders, X402Headers};
pub use payment::{PaymentProof, PaymentRequirements, PaymentScheme, ZecNetwork};
pub use verify::{PaymentStatus, PaymentVerifier};
pub use tracking::{PaymentTracker, TrackedPayment, TrackedPaymentState};
pub use qr::payment_uri;

#[cfg(feature = "qrcode")]
pub use qr::{generate_qr, generate_data_uri, QrOptions, QrFormat};

#[cfg(any(feature = "lightwalletd", feature = "lightwalletd-rest"))]
pub use lightwalletd::{LightwalletdConfig, LightwalletdVerifier};

#[cfg(feature = "lightwalletd-rest")]
pub use lightwalletd::LightwalletdRestVerifier;

/// x402 protocol version
pub const X402_VERSION: &str = "1.0";

/// Header name for payment requirements (JSON)
pub const HEADER_PAYMENT_REQUIRED: &str = "X-Payment-Required";

/// Header name for payment scheme
pub const HEADER_PAYMENT_SCHEME: &str = "X-Payment-Scheme";

/// Header name for payment address
pub const HEADER_PAYMENT_ADDRESS: &str = "X-Payment-Address";

/// Header name for payment amount (in zatoshis)
pub const HEADER_PAYMENT_AMOUNT: &str = "X-Payment-Amount";

/// Header name for network
pub const HEADER_PAYMENT_NETWORK: &str = "X-Payment-Network";

/// Header name for expiration time
pub const HEADER_PAYMENT_EXPIRES: &str = "X-Payment-Expires";

/// Header name for minimum confirmations required
pub const HEADER_PAYMENT_MIN_CONFIRMATIONS: &str = "X-Payment-Min-Confirmations";

/// Header name for resource identifier
pub const HEADER_PAYMENT_RESOURCE: &str = "X-Payment-Resource";

/// Header name for payment proof (client sends)
pub const HEADER_PAYMENT_PROOF: &str = "X-Payment";

/// Alternative authorization header prefix
pub const AUTH_SCHEME_X402: &str = "X402";

/// One ZEC in zatoshis
pub const ZATOSHIS_PER_ZEC: u64 = 100_000_000;

/// Convert ZEC to zatoshis
#[inline]
pub fn zec_to_zatoshis(zec: f64) -> u64 {
    (zec * ZATOSHIS_PER_ZEC as f64).round() as u64
}

/// Convert zatoshis to ZEC
#[inline]
pub fn zatoshis_to_zec(zats: u64) -> f64 {
    zats as f64 / ZATOSHIS_PER_ZEC as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zec_conversion() {
        assert_eq!(zec_to_zatoshis(1.0), 100_000_000);
        assert_eq!(zec_to_zatoshis(0.001), 100_000);
        assert_eq!(zec_to_zatoshis(0.00000001), 1);
        
        assert_eq!(zatoshis_to_zec(100_000_000), 1.0);
        assert_eq!(zatoshis_to_zec(1000), 0.00001);
    }
}

