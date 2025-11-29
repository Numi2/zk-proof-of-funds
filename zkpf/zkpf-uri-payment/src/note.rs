//! Payment note construction for URI-Encapsulated Payments
//!
//! This module handles the deterministic construction of Sapling notes
//! from payment keys and amounts.

use sapling::{note::Rseed, Note, PaymentAddress, Diversifier};
use zcash_protocol::value::Zatoshis;

use crate::{EphemeralPaymentKey, Error, Result, STANDARD_FEE_ZATS};

/// A derived payment note with all necessary metadata
#[derive(Debug, Clone)]
pub struct DerivedPaymentNote {
    /// The Sapling note
    note: Note,
    /// The diversifier used
    diversifier: Diversifier,
    /// The payment address
    address: PaymentAddress,
    /// The amount in zatoshis (excluding fee)
    amount_zats: u64,
    /// The rseed used
    rseed: Rseed,
}

impl DerivedPaymentNote {
    /// Get the underlying Sapling note
    pub fn note(&self) -> &Note {
        &self.note
    }

    /// Get the diversifier
    pub fn diversifier(&self) -> &Diversifier {
        &self.diversifier
    }

    /// Get the payment address
    pub fn address(&self) -> &PaymentAddress {
        &self.address
    }

    /// Get the amount in zatoshis (the amount the recipient receives, excluding fee)
    pub fn amount_zats(&self) -> u64 {
        self.amount_zats
    }

    /// Get the total amount including fee (what the sender pays)
    pub fn total_with_fee(&self) -> u64 {
        self.amount_zats.saturating_add(STANDARD_FEE_ZATS)
    }

    /// Get the rseed
    pub fn rseed(&self) -> &Rseed {
        &self.rseed
    }

    /// Compute the note commitment (extracted)
    /// 
    /// Returns the extracted note commitment suitable for inclusion in the commitment tree.
    pub fn extracted_commitment(&self) -> sapling::note::ExtractedNoteCommitment {
        self.note.cmu()
    }

    /// Get the nullifier for this note given the viewing key and position
    pub fn nullifier(
        &self,
        viewing_key: &sapling::keys::FullViewingKey,
        position: u64,
    ) -> sapling::Nullifier {
        self.note.nf(&viewing_key.vk.nk, position)
    }

    /// Get the nullifier for this note using the payment key
    pub fn nullifier_from_key(
        &self,
        key: &EphemeralPaymentKey,
        position: u64,
    ) -> sapling::Nullifier {
        let fvk = key.to_full_viewing_key();
        self.note.nf(&fvk.vk.nk, position)
    }
}

/// Builder for constructing payment notes from ephemeral keys
pub struct PaymentNoteBuilder {
    /// The ephemeral payment key
    key: EphemeralPaymentKey,
}

impl PaymentNoteBuilder {
    /// Create a new payment note builder
    pub fn new(key: EphemeralPaymentKey) -> Self {
        Self { key }
    }

    /// Build a payment note for the given amount
    ///
    /// # Arguments
    /// * `amount_zats` - The payment amount in zatoshis (NOT including fee)
    ///
    /// # Returns
    /// A derived payment note that can be used to construct a transaction
    pub fn build(self, amount_zats: u64) -> Result<DerivedPaymentNote> {
        // Validate amount
        let value = Zatoshis::from_u64(amount_zats)
            .map_err(|e| Error::NoteConstruction(format!("Invalid amount: {}", e)))?;

        // Get the payment address
        let address = self.key.to_payment_address()?;
        let diversifier = self.key.default_diversifier()?;

        // Derive rseed deterministically
        let rseed_bytes = self.key.derive_rseed();
        let rseed = Rseed::AfterZip212(rseed_bytes);

        // Construct the note
        let note = Note::from_parts(
            address,
            sapling::value::NoteValue::from_raw(value.into()),
            rseed,
        );

        Ok(DerivedPaymentNote {
            note,
            diversifier,
            address,
            amount_zats,
            rseed,
        })
    }

    /// Get a reference to the underlying key
    pub fn key(&self) -> &EphemeralPaymentKey {
        &self.key
    }
}

/// Verify that a note matches the expected derivation from a payment key.
/// 
/// This function creates a note from the given key and amount, then compares
/// its commitment to the expected value. Useful for validating received URIs.
pub fn verify_note_derivation(
    key: &EphemeralPaymentKey,
    amount_zats: u64,
    expected_cmu: &sapling::note::ExtractedNoteCommitment,
) -> Result<bool> {
    let builder = PaymentNoteBuilder::new(key.clone());
    let derived_note = builder.build(amount_zats)?;
    
    // Compare the extracted note commitments
    Ok(derived_note.extracted_commitment().to_bytes() == expected_cmu.to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;

    #[test]
    fn test_note_construction() {
        let key = EphemeralPaymentKey::random(&mut OsRng);
        let builder = PaymentNoteBuilder::new(key);
        
        let note = builder.build(100_000_000).unwrap(); // 1 ZEC
        
        assert_eq!(note.amount_zats(), 100_000_000);
        assert_eq!(note.total_with_fee(), 100_000_000 + STANDARD_FEE_ZATS);
    }

    #[test]
    fn test_deterministic_note() {
        let key_bytes = [42u8; 32];
        
        let key1 = EphemeralPaymentKey::from_bytes(key_bytes);
        let key2 = EphemeralPaymentKey::from_bytes(key_bytes);
        
        let note1 = PaymentNoteBuilder::new(key1).build(100_000).unwrap();
        let note2 = PaymentNoteBuilder::new(key2).build(100_000).unwrap();
        
        // Same key + same amount = same note commitment
        assert_eq!(
            note1.extracted_commitment().to_bytes(),
            note2.extracted_commitment().to_bytes()
        );
    }

    #[test]
    fn test_different_amounts_different_notes() {
        let key_bytes = [42u8; 32];
        
        let key1 = EphemeralPaymentKey::from_bytes(key_bytes);
        let key2 = EphemeralPaymentKey::from_bytes(key_bytes);
        
        let note1 = PaymentNoteBuilder::new(key1).build(100_000).unwrap();
        let note2 = PaymentNoteBuilder::new(key2).build(200_000).unwrap();
        
        assert_ne!(
            note1.extracted_commitment().to_bytes(),
            note2.extracted_commitment().to_bytes()
        );
    }
}
