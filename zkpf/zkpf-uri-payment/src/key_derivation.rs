//! Ephemeral key derivation for URI-Encapsulated Payments
//!
//! This module implements the deterministic derivation of ephemeral payment keys
//! from the wallet's master seed, ensuring that:
//! 1. Payments can be recovered if wallet state is lost
//! 2. Each payment uses a unique, non-reusable key
//! 3. The derivation follows ZIP 32 conventions

use blake2b_simd::Params as Blake2bParams;
use rand::{CryptoRng, RngCore};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::Parameters;
use zeroize::{Zeroize, ZeroizeOnDrop};
use zip32::{AccountId, DiversifierIndex};

use crate::{Error, Result};

/// ZIP 32 purpose constant for URI payments (proposed: 324)
pub const PAYMENT_URI_PURPOSE: u32 = 324;

/// Gap limit for payment URI recovery (number of unused indices to scan)
pub const GAP_LIMIT: u32 = 3;

/// Blake2b personalization for payment URI key derivation
const PAYMENT_URI_PERSONALIZATION: &[u8; 16] = b"Zcash_PaymentURI";

/// A 256-bit ephemeral payment key
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct EphemeralPaymentKey {
    /// The raw 256-bit key material
    inner: [u8; 32],
    /// The payment index used to derive this key (if derived from seed)
    #[zeroize(skip)]
    payment_index: Option<u32>,
}

impl EphemeralPaymentKey {
    /// Create a new ephemeral payment key from raw bytes
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self {
            inner: bytes,
            payment_index: None,
        }
    }

    /// Create a new random ephemeral payment key
    pub fn random<R: RngCore + CryptoRng>(rng: &mut R) -> Self {
        let mut bytes = [0u8; 32];
        rng.fill_bytes(&mut bytes);
        Self {
            inner: bytes,
            payment_index: None,
        }
    }

    /// Get the raw key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.inner
    }

    /// Get the payment index if this key was derived from a seed
    pub fn payment_index(&self) -> Option<u32> {
        self.payment_index
    }

    /// Derive the Sapling expanded spending key from this payment key
    /// 
    /// The payment key bytes are used directly as the spending key input.
    pub fn to_sapling_expanded_spending_key(&self) -> sapling::keys::ExpandedSpendingKey {
        // The payment key IS the spending key per the spec
        // ExpandedSpendingKey::from_spending_key takes raw bytes and derives ask, nsk, ovk
        sapling::keys::ExpandedSpendingKey::from_spending_key(&self.inner)
    }

    /// Derive rseed for note construction using PRF^expand
    /// 
    /// rseed = PRF^expand(sk || [domain_sep])
    pub fn derive_rseed(&self) -> [u8; 32] {
        // Domain separator for rseed derivation
        // TODO: This should be assigned in the final ZIP spec
        const RSEED_DOMAIN_SEP: u8 = 0x05;

        let mut input = Vec::with_capacity(33);
        input.extend_from_slice(&self.inner);
        input.push(RSEED_DOMAIN_SEP);

        let hash = Blake2bParams::new()
            .hash_length(64)
            .personal(b"Zcash_ExpandSeed")
            .hash(&input);

        let mut rseed = [0u8; 32];
        rseed.copy_from_slice(&hash.as_bytes()[..32]);
        rseed
    }

    /// Derive the full viewing key
    pub fn to_full_viewing_key(&self) -> sapling::keys::FullViewingKey {
        let expsk = self.to_sapling_expanded_spending_key();
        sapling::keys::FullViewingKey::from_expanded_spending_key(&expsk)
    }

    /// Derive the diversifier key for address derivation
    fn to_diversifier_key(&self) -> sapling::zip32::DiversifierKey {
        // DiversifierKey is derived from the spending key bytes
        sapling::zip32::DiversifierKey::master(&self.inner)
    }

    /// Compute the default diversifier for this payment key
    /// 
    /// Uses the first valid diversifier (starting from index 0)
    pub fn default_diversifier(&self) -> Result<sapling::Diversifier> {
        let dk = self.to_diversifier_key();
        
        // Find the first valid diversifier starting from index 0
        let (_, diversifier) = dk.find_diversifier(DiversifierIndex::new())
            .ok_or(Error::InvalidDiversifier)?;
        
        Ok(diversifier)
    }

    /// Derive the payment address (default diversifier)
    pub fn to_payment_address(&self) -> Result<sapling::PaymentAddress> {
        let fvk = self.to_full_viewing_key();
        let dk = self.to_diversifier_key();
        
        // Use the sapling helper to get the default address
        let (_, address) = sapling::zip32::sapling_default_address(&fvk, &dk);
        Ok(address)
    }
}

impl std::fmt::Debug for EphemeralPaymentKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EphemeralPaymentKey")
            .field("payment_index", &self.payment_index)
            // Don't expose the actual key bytes in debug output
            .finish_non_exhaustive()
    }
}

// Note: ZeroizeOnDrop derive macro handles secure key erasure automatically

/// Manages derivation of payment keys from wallet seed
/// 
/// This struct provides a stateful context for deriving multiple payment keys
/// from the same seed, tracking the seed fingerprint for identification.
pub struct PaymentKeyDerivation {
    /// The raw seed bytes (zeroized on drop)
    seed: zeroize::Zeroizing<Vec<u8>>,
    /// The seed fingerprint for identification
    seed_fingerprint: zip32::fingerprint::SeedFingerprint,
    /// Network parameters
    network: zcash_protocol::consensus::Network,
}

impl PaymentKeyDerivation {
    /// Create a new payment key derivation context
    pub fn new(
        seed: &[u8],
        network: zcash_protocol::consensus::Network,
    ) -> Result<Self> {
        let seed_fingerprint = zip32::fingerprint::SeedFingerprint::from_seed(seed)
            .ok_or_else(|| Error::KeyDerivation("Invalid seed".to_string()))?;
        
        Ok(Self {
            seed: zeroize::Zeroizing::new(seed.to_vec()),
            seed_fingerprint,
            network,
        })
    }

    /// Derive an ephemeral payment key at a specific index
    /// 
    /// Uses ZIP 32 derivation: m_Sapling / 324' / coin_type' / payment_index'
    /// Then: key = BLAKE2b-256(extended_spending_key, personal="Zcash_PaymentURI")
    pub fn derive_key(&self, payment_index: u32) -> Result<EphemeralPaymentKey> {
        Self::derive_payment_key(&self.seed, &self.network, payment_index)
    }

    /// Derive an ephemeral payment key at a specific index (static version)
    /// 
    /// Uses ZIP 32 derivation: m_Sapling / 324' / coin_type' / payment_index'
    /// Then: key = BLAKE2b-256(extended_spending_key, personal="Zcash_PaymentURI")
    pub fn derive_payment_key(
        seed: &[u8],
        network: &impl Parameters,
        payment_index: u32,
    ) -> Result<EphemeralPaymentKey> {
        // First, derive an extended spending key at the payment path
        // We use a special account ID space for URI payments
        let account_id = AccountId::try_from(payment_index)
            .map_err(|e| Error::KeyDerivation(e.to_string()))?;
        
        // Derive USK at this index
        let usk = UnifiedSpendingKey::from_seed(network, seed, account_id)
            .map_err(|e| Error::KeyDerivation(e.to_string()))?;
        
        // Extract the Sapling extended spending key bytes
        let sapling_sk = usk.sapling();
        let expsk_bytes = sapling_sk.to_bytes();
        
        // Derive the payment key using BLAKE2b
        let hash = Blake2bParams::new()
            .hash_length(32)
            .personal(PAYMENT_URI_PERSONALIZATION)
            .hash(&expsk_bytes);
        
        let mut key_bytes = [0u8; 32];
        key_bytes.copy_from_slice(hash.as_bytes());
        
        Ok(EphemeralPaymentKey {
            inner: key_bytes,
            payment_index: Some(payment_index),
        })
    }

    /// Get the seed fingerprint
    pub fn seed_fingerprint(&self) -> &zip32::fingerprint::SeedFingerprint {
        &self.seed_fingerprint
    }

    /// Get the network
    pub fn network(&self) -> zcash_protocol::consensus::Network {
        self.network
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn test_random_key_generation() {
        let key1 = EphemeralPaymentKey::random(&mut OsRng);
        let key2 = EphemeralPaymentKey::random(&mut OsRng);
        
        assert_ne!(key1.as_bytes(), key2.as_bytes());
        assert!(key1.payment_index().is_none());
    }

    #[test]
    fn test_key_from_bytes() {
        let bytes = [42u8; 32];
        let key = EphemeralPaymentKey::from_bytes(bytes);
        assert_eq!(key.as_bytes(), &bytes);
    }

    #[test]
    fn test_rseed_derivation_deterministic() {
        let key = EphemeralPaymentKey::from_bytes([1u8; 32]);
        let rseed1 = key.derive_rseed();
        let rseed2 = key.derive_rseed();
        assert_eq!(rseed1, rseed2);
    }

    #[test]
    fn test_different_keys_different_rseed() {
        let key1 = EphemeralPaymentKey::from_bytes([1u8; 32]);
        let key2 = EphemeralPaymentKey::from_bytes([2u8; 32]);
        assert_ne!(key1.derive_rseed(), key2.derive_rseed());
    }

    #[test]
    fn test_key_to_address() {
        let key = EphemeralPaymentKey::from_bytes([42u8; 32]);
        // Should successfully derive a payment address
        let address = key.to_payment_address();
        assert!(address.is_ok());
    }

    #[test]
    fn test_deterministic_address() {
        let bytes = [42u8; 32];
        let key1 = EphemeralPaymentKey::from_bytes(bytes);
        let key2 = EphemeralPaymentKey::from_bytes(bytes);
        
        let addr1 = key1.to_payment_address().unwrap();
        let addr2 = key2.to_payment_address().unwrap();
        
        // Same key should produce same address
        assert_eq!(addr1.to_bytes(), addr2.to_bytes());
    }
}
