//! Payment verification for x402

use crate::{PaymentProof, PaymentRequirements, X402Error, X402Result};

/// Status of a payment verification
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PaymentStatus {
    /// Payment verified successfully
    Verified {
        confirmations: u32,
        block_height: Option<u32>,
    },
    /// Payment is pending (not enough confirmations)
    Pending { confirmations: u32 },
    /// Payment not found on chain
    NotFound,
    /// Payment found but amount doesn't match
    AmountMismatch { expected: u64, actual: u64 },
    /// Payment found but address doesn't match
    AddressMismatch,
    /// Payment verification failed
    Failed(String),
}

impl PaymentStatus {
    /// Check if payment is verified
    pub fn is_verified(&self) -> bool {
        matches!(self, PaymentStatus::Verified { .. })
    }

    /// Check if payment is pending (found but not enough confirmations)
    pub fn is_pending(&self) -> bool {
        matches!(self, PaymentStatus::Pending { .. })
    }

    /// Get confirmations if available
    pub fn confirmations(&self) -> Option<u32> {
        match self {
            PaymentStatus::Verified { confirmations, .. } => Some(*confirmations),
            PaymentStatus::Pending { confirmations } => Some(*confirmations),
            _ => None,
        }
    }
}

/// Payment verifier trait
///
/// Implement this trait to provide custom payment verification logic.
pub trait PaymentVerifier: Send + Sync {
    /// Verify a payment proof against requirements
    fn verify(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus>;
}

/// In-memory payment verifier for testing and simple use cases
///
/// Stores accepted payments in memory. Useful for development and testing.
#[derive(Debug, Clone)]
pub struct MemoryVerifier {
    /// Accepted payments: txid -> (amount, address, confirmations)
    payments: std::sync::Arc<std::sync::RwLock<std::collections::HashMap<String, (u64, String, u32)>>>,
}

impl Default for MemoryVerifier {
    fn default() -> Self {
        Self {
            payments: std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        }
    }
}

impl MemoryVerifier {
    /// Create a new memory verifier
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a payment as accepted
    ///
    /// Used for testing or when payments are confirmed out-of-band.
    pub fn register_payment(&self, txid: &str, amount: u64, address: &str, confirmations: u32) {
        let mut payments = self.payments.write().unwrap();
        payments.insert(txid.to_string(), (amount, address.to_string(), confirmations));
    }

    /// Remove a payment
    pub fn remove_payment(&self, txid: &str) {
        let mut payments = self.payments.write().unwrap();
        payments.remove(txid);
    }

    /// Check if a payment exists
    pub fn has_payment(&self, txid: &str) -> bool {
        let payments = self.payments.read().unwrap();
        payments.contains_key(txid)
    }
}

impl PaymentVerifier for MemoryVerifier {
    fn verify(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        // Validate proof format
        proof.validate()?;

        // Check if payment requirements have expired
        if requirements.is_expired() {
            return Err(X402Error::PaymentExpired(
                requirements.expires_at.to_rfc3339(),
            ));
        }

        // Look up payment
        let payments = self.payments.read().unwrap();
        match payments.get(&proof.txid) {
            Some((amount, address, confirmations)) => {
                // Verify address matches
                if address != &requirements.address {
                    return Ok(PaymentStatus::AddressMismatch);
                }

                // Verify amount matches
                if *amount < requirements.amount_zatoshis {
                    return Ok(PaymentStatus::AmountMismatch {
                        expected: requirements.amount_zatoshis,
                        actual: *amount,
                    });
                }

                // Check confirmations
                if *confirmations < requirements.min_confirmations {
                    return Ok(PaymentStatus::Pending {
                        confirmations: *confirmations,
                    });
                }

                Ok(PaymentStatus::Verified {
                    confirmations: *confirmations,
                    block_height: None,
                })
            }
            None => Ok(PaymentStatus::NotFound),
        }
    }
}

/// Callback-based verifier for custom verification logic
pub struct CallbackVerifier<F>
where
    F: Fn(&PaymentProof, &PaymentRequirements) -> X402Result<PaymentStatus> + Send + Sync,
{
    callback: F,
}

impl<F> CallbackVerifier<F>
where
    F: Fn(&PaymentProof, &PaymentRequirements) -> X402Result<PaymentStatus> + Send + Sync,
{
    /// Create a new callback verifier
    pub fn new(callback: F) -> Self {
        Self { callback }
    }
}

impl<F> PaymentVerifier for CallbackVerifier<F>
where
    F: Fn(&PaymentProof, &PaymentRequirements) -> X402Result<PaymentStatus> + Send + Sync,
{
    fn verify(
        &self,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        (self.callback)(proof, requirements)
    }
}

/// Always-accept verifier for testing
///
/// ⚠️ NEVER use in production! This accepts any payment proof without verification.
#[derive(Debug, Clone, Copy)]
pub struct AlwaysAcceptVerifier;

impl PaymentVerifier for AlwaysAcceptVerifier {
    fn verify(
        &self,
        proof: &PaymentProof,
        _requirements: &PaymentRequirements,
    ) -> X402Result<PaymentStatus> {
        proof.validate()?;
        Ok(PaymentStatus::Verified {
            confirmations: 999,
            block_height: Some(0),
        })
    }
}

/// Verification helper functions
pub mod helpers {
    use super::*;

    /// Quick verification check - returns true if payment is valid
    pub fn is_payment_valid<V: PaymentVerifier>(
        verifier: &V,
        proof: &PaymentProof,
        requirements: &PaymentRequirements,
    ) -> bool {
        verifier
            .verify(proof, requirements)
            .map(|s| s.is_verified())
            .unwrap_or(false)
    }

    /// Extract txid from various formats
    pub fn normalize_txid(input: &str) -> X402Result<String> {
        let txid = input.trim();
        
        // Remove any 0x prefix (common mistake)
        let txid = txid.strip_prefix("0x").unwrap_or(txid);
        
        // Validate length and format
        if txid.len() != 64 {
            return Err(X402Error::InvalidPaymentProof(format!(
                "Invalid txid length: expected 64, got {}",
                txid.len()
            )));
        }
        
        if !txid.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(X402Error::InvalidPaymentProof(
                "Transaction ID must be hexadecimal".into(),
            ));
        }
        
        Ok(txid.to_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_verifier() {
        let verifier = MemoryVerifier::new();
        let txid = "a".repeat(64);

        // Register a payment
        verifier.register_payment(&txid, 100_000_000, "zs1test", 3);

        // Create requirements and proof
        let requirements = PaymentRequirements::new("zs1test".to_string(), 100_000_000);
        let proof = PaymentProof::new(&txid);

        // Verify
        let status = verifier.verify(&proof, &requirements).unwrap();
        assert!(status.is_verified());
    }

    #[test]
    fn test_insufficient_confirmations() {
        let verifier = MemoryVerifier::new();
        let txid = "b".repeat(64);

        verifier.register_payment(&txid, 100_000_000, "zs1test", 0);

        let mut requirements = PaymentRequirements::new("zs1test".to_string(), 100_000_000);
        requirements.min_confirmations = 3;
        let proof = PaymentProof::new(&txid);

        let status = verifier.verify(&proof, &requirements).unwrap();
        assert!(status.is_pending());
        assert_eq!(status.confirmations(), Some(0));
    }

    #[test]
    fn test_amount_mismatch() {
        let verifier = MemoryVerifier::new();
        let txid = "c".repeat(64);

        verifier.register_payment(&txid, 50_000_000, "zs1test", 3);

        let requirements = PaymentRequirements::new("zs1test".to_string(), 100_000_000);
        let proof = PaymentProof::new(&txid);

        let status = verifier.verify(&proof, &requirements).unwrap();
        assert!(matches!(status, PaymentStatus::AmountMismatch { .. }));
    }

    #[test]
    fn test_normalize_txid() {
        let txid = "a".repeat(64);
        
        assert_eq!(helpers::normalize_txid(&txid).unwrap(), txid);
        assert_eq!(helpers::normalize_txid(&format!("0x{}", txid)).unwrap(), txid);
        assert_eq!(helpers::normalize_txid(&format!("  {}  ", txid)).unwrap(), txid);
        
        assert!(helpers::normalize_txid("tooshort").is_err());
        assert!(helpers::normalize_txid(&"g".repeat(64)).is_err()); // invalid hex
    }
}

