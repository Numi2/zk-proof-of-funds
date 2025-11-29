//! # URI-Encapsulated Payments for Zcash
//!
//! This crate implements URI-Encapsulated Payments as specified in the ZIP proposal,
//! enabling sending Zcash payments via secure messaging apps like Signal or WhatsApp.
//!
//! ## Overview
//!
//! A Payment-Encapsulating URI represents the capability to claim Zcash funds from
//! specific on-chain transactions. The URI encodes:
//! - The payment amount
//! - An optional description
//! - A 256-bit key used to derive the ephemeral spending key
//!
//! ## URI Format
//!
//! ```text
//! https://pay.withzcash.com:65535/v1#amount=1.23&desc=Payment+for+foo&key=...
//! ```
//!
//! The key is encoded using Bech32 with HRP "zkey" for mainnet or "zkeytest" for testnet.

mod error;
mod key_derivation;
mod note;
mod uri;

pub use error::{Error, Result};
pub use key_derivation::{
    EphemeralPaymentKey, PaymentKeyDerivation, GAP_LIMIT, PAYMENT_URI_PURPOSE,
};
pub use note::{verify_note_derivation, DerivedPaymentNote, PaymentNoteBuilder};
pub use uri::{PaymentUri, PaymentUriBuilder, UriNetwork};

/// Standard transaction fee for fully-shielded transactions (0.00001 ZEC = 1000 zatoshis)
pub const STANDARD_FEE_ZATS: u64 = 1000;

/// Current version and path component of the URI format
pub const URI_VERSION: &str = "v1";

/// Default host for mainnet
pub const MAINNET_HOST: &str = "pay.withzcash.com";

/// Default host for testnet
pub const TESTNET_HOST: &str = "pay.testzcash.com";

/// An unusual high port number (maximum valid TCP port).
/// This is unlikely to have an HTTP server running, providing some protection
/// against accidental HTTP requests while still allowing URL parsing.
/// Note: The primary security comes from the key being in the URL fragment
/// (never sent to servers) and the domain not resolving.
pub const URI_PORT: u16 = 65535;

/// Bech32 HRP for mainnet payment keys
pub const MAINNET_KEY_HRP: &str = "zkey";

/// Bech32 HRP for testnet payment keys
pub const TESTNET_KEY_HRP: &str = "zkeytest";

/// Payment status as observed on the blockchain
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaymentStatus {
    /// Transaction not yet mined (may be in mempool)
    Pending,
    /// Transaction mined but not enough confirmations
    Unconfirmed { confirmations: u32 },
    /// Transaction confirmed and notes are spendable
    ReadyToFinalize { confirmations: u32 },
    /// Notes have been spent (payment finalized or cancelled)
    Finalized,
    /// Payment is invalid (wrong amount, notes don't exist, etc.)
    Invalid,
}

/// Lifecycle state of a URI payment from sender's perspective
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SentPaymentState {
    /// Transaction being constructed
    Creating,
    /// Transaction broadcast, awaiting confirmation
    Pending,
    /// Confirmed on-chain, awaiting recipient finalization
    AwaitingFinalization,
    /// Recipient has finalized the payment
    Finalized,
    /// Sender cancelled the payment
    Cancelled,
}

/// Lifecycle state of a URI payment from recipient's perspective
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceivedPaymentState {
    /// URI received, checking blockchain
    Checking,
    /// Notes not yet on blockchain
    Pending,
    /// Ready to finalize
    ReadyToFinalize,
    /// Finalization transaction broadcast
    Finalizing,
    /// Successfully finalized
    Finalized,
    /// Payment is invalid or was cancelled
    Invalid,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants() {
        assert_eq!(URI_VERSION, "v1");
        assert_eq!(MAINNET_HOST, "pay.withzcash.com");
        assert_eq!(STANDARD_FEE_ZATS, 1000);
    }
}

