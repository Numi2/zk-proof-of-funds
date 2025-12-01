//! Payment tracking and persistence
//! Numan Thabit
//! Track payment states and handle retries, expiration, and confirmation polling.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use crate::{PaymentRequirements, PaymentStatus, X402Error, X402Result};

/// State of a tracked payment
#[derive(Debug, Clone)]
pub enum TrackedPaymentState {
    /// Waiting for user to make payment
    AwaitingPayment {
        created_at: Instant,
    },
    /// Payment submitted, waiting for confirmation
    Submitted {
        txid: String,
        submitted_at: Instant,
        last_check: Instant,
        confirmations: u32,
    },
    /// Payment confirmed and verified
    Confirmed {
        txid: String,
        confirmations: u32,
        confirmed_at: Instant,
    },
    /// Payment expired (not submitted in time)
    Expired,
    /// Payment failed verification
    Failed {
        reason: String,
    },
}

/// A tracked payment with full context
#[derive(Debug, Clone)]
pub struct TrackedPayment {
    /// Unique payment ID
    pub payment_id: String,
    /// The payment requirements
    pub requirements: PaymentRequirements,
    /// Current state
    pub state: TrackedPaymentState,
    /// Number of verification attempts
    pub verification_attempts: u32,
    /// Client identifier (IP, user ID, etc.)
    pub client_id: Option<String>,
    /// Additional metadata
    pub metadata: HashMap<String, String>,
}

impl TrackedPayment {
    /// Create a new tracked payment
    pub fn new(payment_id: String, requirements: PaymentRequirements) -> Self {
        Self {
            payment_id,
            requirements,
            state: TrackedPaymentState::AwaitingPayment {
                created_at: Instant::now(),
            },
            verification_attempts: 0,
            client_id: None,
            metadata: HashMap::new(),
        }
    }

    /// Check if this payment is still valid (not expired)
    pub fn is_valid(&self) -> bool {
        !matches!(self.state, TrackedPaymentState::Expired | TrackedPaymentState::Failed { .. })
            && !self.requirements.is_expired()
    }

    /// Check if payment is confirmed
    pub fn is_confirmed(&self) -> bool {
        matches!(self.state, TrackedPaymentState::Confirmed { .. })
    }

    /// Get the transaction ID if submitted
    pub fn txid(&self) -> Option<&str> {
        match &self.state {
            TrackedPaymentState::Submitted { txid, .. } => Some(txid),
            TrackedPaymentState::Confirmed { txid, .. } => Some(txid),
            _ => None,
        }
    }

    /// Mark payment as submitted
    pub fn submit(&mut self, txid: String) {
        self.state = TrackedPaymentState::Submitted {
            txid,
            submitted_at: Instant::now(),
            last_check: Instant::now(),
            confirmations: 0,
        };
    }

    /// Update confirmation count
    pub fn update_confirmations(&mut self, confirmations: u32) {
        if let TrackedPaymentState::Submitted { txid, submitted_at, .. } = &self.state {
            if confirmations >= self.requirements.min_confirmations {
                self.state = TrackedPaymentState::Confirmed {
                    txid: txid.clone(),
                    confirmations,
                    confirmed_at: Instant::now(),
                };
            } else {
                self.state = TrackedPaymentState::Submitted {
                    txid: txid.clone(),
                    submitted_at: *submitted_at,
                    last_check: Instant::now(),
                    confirmations,
                };
            }
        }
    }

    /// Mark as failed
    pub fn fail(&mut self, reason: impl Into<String>) {
        self.state = TrackedPaymentState::Failed {
            reason: reason.into(),
        };
    }

    /// Mark as expired
    pub fn expire(&mut self) {
        self.state = TrackedPaymentState::Expired;
    }
}

/// Payment tracker with in-memory storage
///
/// For production, implement the `PaymentStore` trait with a database backend.
#[derive(Clone)]
pub struct PaymentTracker {
    payments: Arc<RwLock<HashMap<String, TrackedPayment>>>,
    /// How often to check pending payments
    poll_interval: Duration,
    /// Maximum verification attempts before giving up
    max_verification_attempts: u32,
}

impl Default for PaymentTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl PaymentTracker {
    /// Create a new payment tracker
    pub fn new() -> Self {
        Self {
            payments: Arc::new(RwLock::new(HashMap::new())),
            poll_interval: Duration::from_secs(10),
            max_verification_attempts: 30,
        }
    }

    /// Set poll interval
    pub fn with_poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = interval;
        self
    }

    /// Create a new payment and start tracking it
    pub fn create_payment(&self, requirements: PaymentRequirements) -> TrackedPayment {
        let payment_id = requirements
            .payment_id
            .clone()
            .unwrap_or_else(generate_payment_id);

        let payment = TrackedPayment::new(payment_id.clone(), requirements);

        let mut payments = self.payments.write().unwrap();
        payments.insert(payment_id, payment.clone());

        payment
    }

    /// Get a payment by ID
    pub fn get_payment(&self, payment_id: &str) -> Option<TrackedPayment> {
        let payments = self.payments.read().unwrap();
        payments.get(payment_id).cloned()
    }

    /// Submit a payment (user has sent funds)
    pub fn submit_payment(&self, payment_id: &str, txid: String) -> X402Result<()> {
        let mut payments = self.payments.write().unwrap();
        
        let payment = payments
            .get_mut(payment_id)
            .ok_or_else(|| X402Error::PaymentNotFound(payment_id.to_string()))?;

        if !payment.is_valid() {
            return Err(X402Error::PaymentExpired(
                payment.requirements.expires_at.to_rfc3339(),
            ));
        }

        payment.submit(txid);
        Ok(())
    }

    /// Update payment status after verification
    pub fn update_status(&self, payment_id: &str, status: PaymentStatus) -> X402Result<()> {
        let mut payments = self.payments.write().unwrap();
        
        let payment = payments
            .get_mut(payment_id)
            .ok_or_else(|| X402Error::PaymentNotFound(payment_id.to_string()))?;

        payment.verification_attempts += 1;

        match status {
            PaymentStatus::Verified { confirmations, .. } => {
                payment.update_confirmations(confirmations);
            }
            PaymentStatus::Pending { confirmations } => {
                payment.update_confirmations(confirmations);
            }
            PaymentStatus::NotFound => {
                if payment.verification_attempts >= self.max_verification_attempts {
                    payment.fail("Payment not found after maximum attempts");
                }
            }
            PaymentStatus::AmountMismatch { expected, actual } => {
                payment.fail(format!(
                    "Amount mismatch: expected {} zatoshis, got {}",
                    expected, actual
                ));
            }
            PaymentStatus::AddressMismatch => {
                payment.fail("Payment sent to wrong address");
            }
            PaymentStatus::Failed(reason) => {
                payment.fail(reason);
            }
        }

        Ok(())
    }

    /// Check if a payment is verified
    pub fn is_verified(&self, payment_id: &str) -> bool {
        let payments = self.payments.read().unwrap();
        payments
            .get(payment_id)
            .map(|p| p.is_confirmed())
            .unwrap_or(false)
    }

    /// Clean up expired payments
    pub fn cleanup_expired(&self) {
        let mut payments = self.payments.write().unwrap();
        
        for payment in payments.values_mut() {
            if payment.requirements.is_expired() && payment.is_valid() {
                payment.expire();
            }
        }

        // Remove very old entries (older than 24 hours)
        let cutoff = Instant::now() - Duration::from_secs(86400);
        payments.retain(|_, p| match &p.state {
            TrackedPaymentState::Confirmed { confirmed_at, .. } => *confirmed_at > cutoff,
            TrackedPaymentState::Expired => false, // Remove expired immediately
            TrackedPaymentState::Failed { .. } => false, // Remove failed immediately
            _ => true,
        });
    }

    /// Get all pending payments (for polling)
    pub fn get_pending_payments(&self) -> Vec<TrackedPayment> {
        let payments = self.payments.read().unwrap();
        payments
            .values()
            .filter(|p| matches!(p.state, TrackedPaymentState::Submitted { .. }))
            .cloned()
            .collect()
    }

    /// Get payment statistics
    pub fn stats(&self) -> PaymentStats {
        let payments = self.payments.read().unwrap();
        
        let mut stats = PaymentStats::default();
        
        for payment in payments.values() {
            match &payment.state {
                TrackedPaymentState::AwaitingPayment { .. } => stats.awaiting += 1,
                TrackedPaymentState::Submitted { .. } => stats.pending += 1,
                TrackedPaymentState::Confirmed { .. } => {
                    stats.confirmed += 1;
                    stats.total_amount += payment.requirements.amount_zatoshis;
                }
                TrackedPaymentState::Expired => stats.expired += 1,
                TrackedPaymentState::Failed { .. } => stats.failed += 1,
            }
        }
        
        stats
    }
}

/// Payment statistics
#[derive(Debug, Default, Clone)]
pub struct PaymentStats {
    /// Payments awaiting user action
    pub awaiting: usize,
    /// Payments submitted, waiting for confirmation
    pub pending: usize,
    /// Confirmed payments
    pub confirmed: usize,
    /// Expired payments
    pub expired: usize,
    /// Failed payments
    pub failed: usize,
    /// Total confirmed amount in zatoshis
    pub total_amount: u64,
}

/// Generate a random payment ID
fn generate_payment_id() -> String {
    use rand::Rng;
    let id: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(24)
        .map(char::from)
        .collect();
    format!("pay_{}", id)
}

/// Trait for persistent payment storage
///
/// Implement this trait to store payments in a database.
pub trait PaymentStore: Send + Sync {
    /// Save a payment
    fn save(&self, payment: &TrackedPayment) -> X402Result<()>;
    
    /// Load a payment by ID
    fn load(&self, payment_id: &str) -> X402Result<Option<TrackedPayment>>;
    
    /// List pending payments
    fn list_pending(&self) -> X402Result<Vec<TrackedPayment>>;
    
    /// Delete a payment
    fn delete(&self, payment_id: &str) -> X402Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_payment_tracking() {
        let tracker = PaymentTracker::new();
        
        let requirements = PaymentRequirements::new("zs1test".to_string(), 100_000);
        let payment = tracker.create_payment(requirements);
        
        assert!(payment.is_valid());
        assert!(!payment.is_confirmed());
        
        // Submit payment
        tracker.submit_payment(&payment.payment_id, "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd".to_string())
            .unwrap();
        
        // Get and verify state
        let updated = tracker.get_payment(&payment.payment_id).unwrap();
        assert!(matches!(updated.state, TrackedPaymentState::Submitted { .. }));
    }

    #[test]
    fn test_confirmation_tracking() {
        let tracker = PaymentTracker::new();
        
        let mut requirements = PaymentRequirements::new("zs1test".to_string(), 100_000);
        requirements.min_confirmations = 3;
        
        let payment = tracker.create_payment(requirements);
        let payment_id = payment.payment_id.clone();
        
        tracker.submit_payment(&payment_id, "a".repeat(64)).unwrap();
        
        // Update with 1 confirmation
        tracker.update_status(&payment_id, PaymentStatus::Pending { confirmations: 1 }).unwrap();
        
        let updated = tracker.get_payment(&payment_id).unwrap();
        assert!(!updated.is_confirmed());
        
        // Update with 3 confirmations
        tracker.update_status(&payment_id, PaymentStatus::Verified { 
            confirmations: 3, 
            block_height: Some(1000) 
        }).unwrap();
        
        let confirmed = tracker.get_payment(&payment_id).unwrap();
        assert!(confirmed.is_confirmed());
    }

    #[test]
    fn test_payment_id_generation() {
        let id1 = generate_payment_id();
        let id2 = generate_payment_id();
        
        assert!(id1.starts_with("pay_"));
        assert_ne!(id1, id2);
        assert!(id1.len() > 20);
    }
}

