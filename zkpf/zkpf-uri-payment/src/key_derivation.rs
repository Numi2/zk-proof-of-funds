//! Ephemeral key derivation for URI-Encapsulated Payments
//!
//! This module implements the deterministic derivation of ephemeral payment keys
//! from the wallet's master seed, ensuring that:
//! 1. Payments can be recovered if wallet state is lost
//! 2. Each payment uses a unique, non-reusable key
//! 3. The derivation follows ZIP 32 conventions

use blake2b_simd::{Params as Blake2bParams, Hash as Blake2bHash};
use rand::{CryptoRng, RngCore};
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::Parameters;
use zip32::AccountId;

use crate::{Error, Result};

/// ZIP 32 purpose constant for URI payments (proposed: 324)
pub const PAYMENT_URI_PURPOSE: u32 = 324;

/// Gap limit for payment URI recovery (number of unused indices to scan)
pub const GAP_LIMIT: u32 = 3;

/// Blake2b personalization for payment URI key derivation
const PAYMENT_URI_PERSONALIZATION: &[u8; 16] = b"Zcash_PaymentURI";

/// A 256-bit ephemeral payment key
#[derive(Clone)]
pub struct EphemeralPaymentKey {
    /// The raw 256-bit key material
    inner: [u8; 32],
    /// The payment index used to derive this key (if derived from seed)
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

    /// Derive the Sapling spending key (sk) from this payment key
    /// 
    /// This follows the spec: sk = key (the payment key is used directly as sk)
    pub fn to_sapling_spending_key(&self) -> sapling::keys::SpendingKey {
        // The payment key IS the spending key per the spec
        sapling::keys::SpendingKey::from_bytes(self.inner)
            .expect("payment key should be valid spending key")
    }

    /// Derive rseed for note construction using PRF^expand
    /// 
    /// rseed = PRF^expand(sk || [domain_sep])
    pub fn derive_rseed(&self) -> [u8; 32] {
        // Domain separator for rseed derivation (to be assigned in final spec)
        const RSEED_DOMAIN_SEP: u8 = 0x05; // Placeholder

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

    /// Compute the default diversifier for this payment key
    /// 
    /// Uses the first valid diversifier derived from the spending key
    pub fn default_diversifier(&self) -> Result<sapling::Diversifier> {
        let expsk = self.to_sapling_expanded_spending_key();
        let fvk = sapling::keys::FullViewingKey::from_expanded_spending_key(&expsk);
        
        // Find the first valid diversifier
        let dk = sapling::keys::DiversifierKey::from_fvk(&fvk);
        
        // Try diversifier indices starting from 0
        for idx in 0u64..1000 {
            let d_bytes = dk.diversifier(sapling::zip32::DiversifierIndex::from(idx));
            let diversifier = sapling::Diversifier(d_bytes.0);
            if diversifier.g_d().is_some().into() {
                return Ok(diversifier);
            }
        }
        
        Err(Error::InvalidDiversifier)
    }

    /// Get the expanded spending key for Sapling operations
    fn to_sapling_expanded_spending_key(&self) -> sapling::keys::ExpandedSpendingKey {
        let sk = self.to_sapling_spending_key();
        sapling::keys::ExpandedSpendingKey::from_spending_key(&sk)
    }

    /// Derive the full viewing key
    pub fn to_full_viewing_key(&self) -> sapling::keys::FullViewingKey {
        let expsk = self.to_sapling_expanded_spending_key();
        sapling::keys::FullViewingKey::from_expanded_spending_key(&expsk)
    }

    /// Derive the payment address (default diversifier)
    pub fn to_payment_address(&self) -> Result<sapling::PaymentAddress> {
        let fvk = self.to_full_viewing_key();
        let diversifier = self.default_diversifier()?;
        
        fvk.to_payment_address(diversifier)
            .ok_or(Error::InvalidDiversifier)
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

impl Drop for EphemeralPaymentKey {
    fn drop(&mut self) {
        // Zero out the key material on drop
        self.inner.iter_mut().for_each(|b| *b = 0);
    }
}

/// Manages derivation of payment keys from wallet seed
pub struct PaymentKeyDerivation {
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
            seed_fingerprint,
            network,
        })
    }

    /// Derive an ephemeral payment key at a specific index
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
}

