//! Trial decryption for Orchard notes using proper Zcash cryptographic APIs.
//!
//! This module provides trial decryption functionality using `zcash_note_encryption`
//! with `OrchardDomain` for cryptographically correct note detection during sync.
//!
//! # Implementation
//!
//! Uses the standard Zcash trial decryption approach:
//! 1. Parse UFVK to extract Orchard Full Viewing Key
//! 2. Derive Incoming Viewing Key (IVK) for both external and internal scopes
//! 3. For each compact action, construct an `orchard::note_encryption::CompactAction`
//! 4. Use `try_compact_note_decryption` with `OrchardDomain` for proper cryptographic decryption
//! 5. If decryption succeeds, the note belongs to this wallet

use orchard::keys::{FullViewingKey, PreparedIncomingViewingKey, Scope};
use orchard::note::{ExtractedNoteCommitment, Nullifier};
use orchard::note_encryption::{CompactAction, OrchardDomain};
use subtle::CtOption;
use tracing::{debug, trace};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};

use crate::WalletError;

/// Decrypted note data from a successfully decrypted compact action.
#[derive(Debug, Clone)]
pub struct DecryptedNote {
    /// Note value in zatoshis.
    pub value: u64,
    /// Note commitment (cmx).
    pub cmx: [u8; 32],
    /// Recipient diversifier.
    pub diversifier: [u8; 11],
    /// The nullifier for spending this note.
    pub nullifier: [u8; 32],
}

/// Trial decryptor for Orchard notes using proper Zcash cryptographic APIs.
///
/// Holds prepared incoming viewing keys for efficient repeated decryption
/// attempts during sync.
pub struct OrchardDecryptor {
    /// Prepared IVK for external scope (receiving).
    prepared_ivk_external: PreparedIncomingViewingKey,
    /// Prepared IVK for internal scope (change).
    prepared_ivk_internal: PreparedIncomingViewingKey,
    /// Full viewing key (needed for nullifier derivation).
    fvk: FullViewingKey,
}

impl OrchardDecryptor {
    /// Create a new decryptor from UFVK bytes.
    ///
    /// # Arguments
    /// * `ufvk_bytes` - Raw bytes of the unified full viewing key
    ///
    /// # Errors
    /// Returns an error if the UFVK cannot be parsed or doesn't contain
    /// an Orchard component.
    pub fn from_ufvk_bytes(ufvk_bytes: &[u8]) -> Result<Self, WalletError> {
        if ufvk_bytes.len() < 96 {
            return Err(WalletError::InvalidFvk(
                "UFVK bytes too short to contain Orchard FVK".into()
            ));
        }
        
        // Try to extract Orchard FVK from the UFVK bytes
        let fvk = Self::parse_orchard_fvk_from_ufvk(ufvk_bytes)?;
        
        // Derive IVKs for both scopes
        let ivk_external = fvk.to_ivk(Scope::External);
        let ivk_internal = fvk.to_ivk(Scope::Internal);
        
        Ok(Self {
            prepared_ivk_external: PreparedIncomingViewingKey::new(&ivk_external),
            prepared_ivk_internal: PreparedIncomingViewingKey::new(&ivk_internal),
            fvk,
        })
    }
    
    /// Parse the Orchard FVK component from UFVK bytes.
    ///
    /// A UFVK is encoded as a series of typecodes followed by data.
    /// Orchard typecode is 0x03.
    fn parse_orchard_fvk_from_ufvk(ufvk_bytes: &[u8]) -> Result<FullViewingKey, WalletError> {
        // UFVK encoding:
        // - Each component has: 1-byte typecode, 2-byte length (little endian), then data
        // - Orchard typecode = 0x03
        // - Orchard FVK is 96 bytes
        
        let mut offset = 0;
        while offset + 3 <= ufvk_bytes.len() {
            let typecode = ufvk_bytes[offset];
            let length = u16::from_le_bytes([
                ufvk_bytes[offset + 1],
                ufvk_bytes[offset + 2],
            ]) as usize;
            offset += 3;
            
            if offset + length > ufvk_bytes.len() {
                break;
            }
            
            if typecode == 0x03 && length == 96 {
                // Found Orchard FVK
                let fvk_bytes: [u8; 96] = ufvk_bytes[offset..offset + 96]
                    .try_into()
                    .map_err(|_| WalletError::InvalidFvk("Invalid Orchard FVK length".into()))?;
                
                return FullViewingKey::from_bytes(&fvk_bytes)
                    .ok_or_else(|| WalletError::InvalidFvk(
                        "Failed to parse Orchard FullViewingKey from bytes".into()
                    ));
            }
            
            offset += length;
        }
        
        // If we didn't find the Orchard component using UFVK structure,
        // try interpreting the bytes directly as an Orchard FVK
        // (for backwards compatibility with raw FVK input)
        if ufvk_bytes.len() >= 96 {
            let fvk_bytes: [u8; 96] = ufvk_bytes[..96]
                .try_into()
                .map_err(|_| WalletError::InvalidFvk("Invalid raw FVK length".into()))?;
            
            if let Some(fvk) = FullViewingKey::from_bytes(&fvk_bytes) {
                debug!("Parsed raw Orchard FVK bytes (not UFVK encoded)");
                return Ok(fvk);
            }
        }
        
        Err(WalletError::InvalidFvk(
            "UFVK does not contain valid Orchard FVK component".into()
        ))
    }
    
    /// Attempt to decrypt a compact Orchard action using proper Zcash APIs.
    ///
    /// Uses `orchard::note_encryption::CompactAction` and `OrchardDomain` with
    /// `zcash_note_encryption::try_compact_note_decryption` for cryptographically
    /// correct trial decryption.
    ///
    /// # Arguments
    /// * `nullifier_bytes` - 32-byte nullifier from the action
    /// * `cmx_bytes` - 32-byte note commitment (x-coordinate)
    /// * `ephemeral_key_bytes` - 32-byte ephemeral public key
    /// * `ciphertext` - 52-byte compact ciphertext (first 52 bytes of encCiphertext)
    ///
    /// # Returns
    /// `Some(DecryptedNote)` if decryption succeeds (note belongs to us),
    /// `None` if decryption fails (note doesn't belong to us).
    pub fn try_decrypt_compact_action(
        &self,
        nullifier_bytes: &[u8; 32],
        cmx_bytes: &[u8; 32],
        ephemeral_key_bytes: &[u8; 32],
        ciphertext: &[u8],
    ) -> Option<DecryptedNote> {
        // Validate ciphertext length
        if ciphertext.len() < 52 {
            trace!("Ciphertext too short for compact decryption: {} bytes", ciphertext.len());
            return None;
        }
        
        // Parse the note commitment
        let cmx_opt: CtOption<ExtractedNoteCommitment> = ExtractedNoteCommitment::from_bytes(cmx_bytes);
        if cmx_opt.is_none().into() {
            trace!("Failed to parse cmx");
            return None;
        }
        let cmx: ExtractedNoteCommitment = cmx_opt.unwrap();
        
        // Parse nullifier
        let nullifier = Nullifier::from_bytes(nullifier_bytes)
            .expect("nullifier should be 32 bytes");
        
        // Parse ephemeral key using zcash_note_encryption's public EphemeralKeyBytes
        let ephemeral_key = EphemeralKeyBytes(*ephemeral_key_bytes);
        
        // Create compact ciphertext array
        let enc_ciphertext: [u8; 52] = ciphertext[..52].try_into().ok()?;
        
        // Create the orchard CompactAction using the public constructor
        let compact_action = CompactAction::from_parts(
            nullifier,
            cmx,
            ephemeral_key,
            enc_ciphertext,
        );
        
        // Create the Orchard domain for this action
        let domain = OrchardDomain::for_compact_action(&compact_action);
        
        // Try external scope first (receiving addresses)
        if let Some((note, recipient)) = try_compact_note_decryption(
            &domain,
            &self.prepared_ivk_external,
            &compact_action,
        ) {
            debug!("Decrypted note with external IVK, value: {} zatoshi", note.value().inner());
            
            // Derive nullifier for this note using the FVK
            let nf = note.nullifier(&self.fvk);
            
            return Some(DecryptedNote {
                value: note.value().inner(),
                cmx: *cmx_bytes,
                diversifier: *recipient.diversifier().as_array(),
                nullifier: nf.to_bytes(),
            });
        }
        
        // Try internal scope (change addresses)
        if let Some((note, recipient)) = try_compact_note_decryption(
            &domain,
            &self.prepared_ivk_internal,
            &compact_action,
        ) {
            debug!("Decrypted note with internal IVK (change), value: {} zatoshi", note.value().inner());
            
            // Derive nullifier for this note using the FVK
            let nf = note.nullifier(&self.fvk);
            
            return Some(DecryptedNote {
                value: note.value().inner(),
                cmx: *cmx_bytes,
                diversifier: *recipient.diversifier().as_array(),
                nullifier: nf.to_bytes(),
            });
        }
        
        None
    }
    
    /// Simplified version for compact blocks that don't include nullifier.
    /// Uses a zero nullifier for the domain construction.
    pub fn try_decrypt_compact_action_no_nullifier(
        &self,
        cmx_bytes: &[u8; 32],
        ephemeral_key_bytes: &[u8; 32],
        ciphertext: &[u8],
    ) -> Option<DecryptedNote> {
        // For compact blocks without nullifier, use zero nullifier
        let zero_nullifier = [0u8; 32];
        self.try_decrypt_compact_action(&zero_nullifier, cmx_bytes, ephemeral_key_bytes, ciphertext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_decryptor_requires_valid_ufvk() {
        // Too short
        let result = OrchardDecryptor::from_ufvk_bytes(&[0u8; 32]);
        assert!(result.is_err());
        
        // Invalid bytes (all zeros don't form valid FVK)
        let result = OrchardDecryptor::from_ufvk_bytes(&[0u8; 128]);
        assert!(result.is_err());
    }
}
