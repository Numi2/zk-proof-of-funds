//! Attestation queue for reliable delivery.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex};
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

/// Maximum number of retries before discarding an attestation.
pub const MAX_RETRIES: u32 = 5;

/// Base delay for exponential backoff (in seconds).
const BASE_RETRY_DELAY_SECS: u64 = 5;

/// Maximum delay between retries (in seconds).
const MAX_RETRY_DELAY_SECS: u64 = 300; // 5 minutes

/// Queued attestation for relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedAttestation {
    pub attestation_id: [u8; 32],
    pub holder_binding: [u8; 32],
    pub policy_id: u64,
    pub epoch: u64,
    pub mina_slot: u64,
    pub expires_at_slot: u64,
    pub state_root: [u8; 32],
    pub merkle_proof: Vec<[u8; 32]>,
    pub retries: u32,
    /// Timestamp when the attestation can be retried (epoch millis).
    #[serde(default)]
    pub retry_after: u64,
    /// Target chain for this attestation.
    #[serde(default)]
    pub target_chain: Option<String>,
    /// Error message from last failed attempt.
    #[serde(default)]
    pub last_error: Option<String>,
}

impl QueuedAttestation {
    /// Check if this attestation should be retried.
    pub fn should_retry(&self) -> bool {
        self.retries < MAX_RETRIES
    }

    /// Get the delay before the next retry (exponential backoff).
    pub fn retry_delay(&self) -> Duration {
        let delay_secs = BASE_RETRY_DELAY_SECS * 2u64.pow(self.retries.min(6));
        Duration::from_secs(delay_secs.min(MAX_RETRY_DELAY_SECS))
    }

    /// Check if the retry delay has elapsed.
    pub fn is_ready_for_retry(&self) -> bool {
        if self.retry_after == 0 {
            return true;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        now >= self.retry_after
    }

    /// Check if the attestation has expired.
    pub fn is_expired(&self, current_slot: u64) -> bool {
        current_slot > self.expires_at_slot
    }
}

/// Queue metrics for monitoring.
#[derive(Debug, Default)]
pub struct QueueMetrics {
    /// Total attestations received.
    pub received: AtomicU64,
    /// Total attestations successfully submitted.
    pub submitted: AtomicU64,
    /// Total attestations that failed after max retries.
    pub failed: AtomicU64,
    /// Total attestations that expired.
    pub expired: AtomicU64,
    /// Current queue depth (retry queue).
    pub queue_depth: AtomicU64,
    /// Total retries performed.
    pub retries: AtomicU64,
}

impl QueueMetrics {
    /// Create new metrics.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a received attestation.
    pub fn record_received(&self) {
        self.received.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a successful submission.
    pub fn record_submitted(&self) {
        self.submitted.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a failed attestation (after max retries).
    pub fn record_failed(&self) {
        self.failed.fetch_add(1, Ordering::Relaxed);
    }

    /// Record an expired attestation.
    pub fn record_expired(&self) {
        self.expired.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a retry.
    pub fn record_retry(&self) {
        self.retries.fetch_add(1, Ordering::Relaxed);
    }

    /// Update queue depth.
    pub fn set_queue_depth(&self, depth: u64) {
        self.queue_depth.store(depth, Ordering::Relaxed);
    }

    /// Get metrics as a displayable summary.
    pub fn summary(&self) -> String {
        format!(
            "received={}, submitted={}, failed={}, expired={}, retries={}, queue_depth={}",
            self.received.load(Ordering::Relaxed),
            self.submitted.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
            self.expired.load(Ordering::Relaxed),
            self.retries.load(Ordering::Relaxed),
            self.queue_depth.load(Ordering::Relaxed),
        )
    }
}

/// Attestation queue with retry support and metrics.
pub struct AttestationQueue {
    /// Retry queue (attestations that need to be retried).
    queue: Mutex<VecDeque<QueuedAttestation>>,
    /// Dead letter queue (attestations that exceeded max retries).
    dead_letter: Mutex<VecDeque<QueuedAttestation>>,
    /// Receiver for new attestations.
    receiver: Mutex<mpsc::Receiver<QueuedAttestation>>,
    /// Queue metrics.
    pub metrics: QueueMetrics,
    /// Maximum dead letter queue size.
    max_dead_letter_size: usize,
}

impl AttestationQueue {
    /// Create a new attestation queue.
    pub fn new(receiver: mpsc::Receiver<QueuedAttestation>) -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            dead_letter: Mutex::new(VecDeque::new()),
            receiver: Mutex::new(receiver),
            metrics: QueueMetrics::new(),
            max_dead_letter_size: 1000,
        }
    }

    /// Create with custom dead letter queue size.
    pub fn with_dead_letter_size(receiver: mpsc::Receiver<QueuedAttestation>, size: usize) -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            dead_letter: Mutex::new(VecDeque::new()),
            receiver: Mutex::new(receiver),
            metrics: QueueMetrics::new(),
            max_dead_letter_size: size,
        }
    }

    /// Pop the next attestation to process.
    /// 
    /// Priority:
    /// 1. Retry queue (if ready for retry)
    /// 2. New attestations from receiver
    pub async fn pop(&self) -> Option<QueuedAttestation> {
        // First check the retry queue for ready items
        {
            let mut queue = self.queue.lock().await;
            
            // Find the first item ready for retry
            let ready_idx = queue.iter().position(|a| a.is_ready_for_retry());
            
            if let Some(idx) = ready_idx {
                let attestation = queue.remove(idx)?;
                self.metrics.set_queue_depth(queue.len() as u64);
                return Some(attestation);
            }
        }

        // Then check for new attestations from receiver (with timeout)
        let mut receiver = self.receiver.lock().await;
        match tokio::time::timeout(Duration::from_millis(100), receiver.recv()).await {
            Ok(Some(attestation)) => {
                self.metrics.record_received();
                Some(attestation)
            }
            _ => None,
        }
    }

    /// Push an attestation back for retry.
    /// 
    /// If max retries exceeded, moves to dead letter queue.
    pub async fn push(&self, mut attestation: QueuedAttestation) {
        attestation.retries += 1;
        self.metrics.record_retry();

        if !attestation.should_retry() {
            warn!(
                "Attestation {:?} exceeded max retries ({}), moving to dead letter queue",
                hex::encode(&attestation.attestation_id[..8]),
                attestation.retries
            );
            self.metrics.record_failed();
            self.push_dead_letter(attestation).await;
            return;
        }

        // Set retry_after timestamp with exponential backoff
        let delay = attestation.retry_delay();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        attestation.retry_after = now + delay.as_millis() as u64;

        debug!(
            "Queuing attestation {:?} for retry {} in {:?}",
            hex::encode(&attestation.attestation_id[..8]),
            attestation.retries,
            delay
        );

        let mut queue = self.queue.lock().await;
        queue.push_back(attestation);
        self.metrics.set_queue_depth(queue.len() as u64);
    }

    /// Push an attestation with error message.
    pub async fn push_with_error(&self, mut attestation: QueuedAttestation, error: String) {
        attestation.last_error = Some(error);
        self.push(attestation).await;
    }

    /// Push to dead letter queue.
    async fn push_dead_letter(&self, attestation: QueuedAttestation) {
        let mut dlq = self.dead_letter.lock().await;
        dlq.push_back(attestation);
        
        // Trim if over size limit (FIFO)
        while dlq.len() > self.max_dead_letter_size {
            dlq.pop_front();
        }
    }

    /// Get the current retry queue size.
    pub async fn len(&self) -> usize {
        let queue = self.queue.lock().await;
        queue.len()
    }

    /// Get the dead letter queue size.
    pub async fn dead_letter_len(&self) -> usize {
        let dlq = self.dead_letter.lock().await;
        dlq.len()
    }

    /// Check if the queue is empty.
    pub async fn is_empty(&self) -> bool {
        let queue = self.queue.lock().await;
        queue.is_empty()
    }

    /// Drain expired attestations from the queue.
    pub async fn drain_expired(&self, current_slot: u64) -> Vec<QueuedAttestation> {
        let mut queue = self.queue.lock().await;
        let mut expired = Vec::new();
        
        queue.retain(|a| {
            if a.is_expired(current_slot) {
                expired.push(a.clone());
                self.metrics.record_expired();
                false
            } else {
                true
            }
        });
        
        self.metrics.set_queue_depth(queue.len() as u64);
        expired
    }

    /// Get a snapshot of dead letter queue for inspection.
    pub async fn get_dead_letters(&self, limit: usize) -> Vec<QueuedAttestation> {
        let dlq = self.dead_letter.lock().await;
        dlq.iter().take(limit).cloned().collect()
    }

    /// Clear the dead letter queue.
    pub async fn clear_dead_letters(&self) {
        let mut dlq = self.dead_letter.lock().await;
        dlq.clear();
    }

    /// Record a successful submission.
    pub fn record_success(&self) {
        self.metrics.record_submitted();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_attestation() -> QueuedAttestation {
        QueuedAttestation {
            attestation_id: [0u8; 32],
            holder_binding: [1u8; 32],
            policy_id: 1,
            epoch: 1000,
            mina_slot: 500,
            expires_at_slot: 1000,
            state_root: [2u8; 32],
            merkle_proof: vec![],
            retries: 0,
            retry_after: 0,
            target_chain: None,
            last_error: None,
        }
    }

    #[test]
    fn test_should_retry() {
        let mut attestation = sample_attestation();
        assert!(attestation.should_retry());
        
        attestation.retries = MAX_RETRIES;
        assert!(!attestation.should_retry());
    }

    #[test]
    fn test_retry_delay() {
        let mut attestation = sample_attestation();
        
        attestation.retries = 0;
        assert_eq!(attestation.retry_delay(), Duration::from_secs(5));
        
        attestation.retries = 1;
        assert_eq!(attestation.retry_delay(), Duration::from_secs(10));
        
        attestation.retries = 2;
        assert_eq!(attestation.retry_delay(), Duration::from_secs(20));
        
        // Should cap at MAX_RETRY_DELAY_SECS
        attestation.retries = 10;
        assert_eq!(attestation.retry_delay(), Duration::from_secs(MAX_RETRY_DELAY_SECS));
    }

    #[test]
    fn test_is_ready_for_retry() {
        let mut attestation = sample_attestation();
        assert!(attestation.is_ready_for_retry());
        
        // Set retry_after to far future
        attestation.retry_after = u64::MAX / 2;
        assert!(!attestation.is_ready_for_retry());
        
        // Set to past
        attestation.retry_after = 0;
        assert!(attestation.is_ready_for_retry());
    }

    #[test]
    fn test_is_expired() {
        let attestation = sample_attestation();
        assert!(!attestation.is_expired(500));
        assert!(!attestation.is_expired(1000));
        assert!(attestation.is_expired(1001));
    }

    #[test]
    fn test_metrics() {
        let metrics = QueueMetrics::new();
        
        metrics.record_received();
        metrics.record_received();
        metrics.record_submitted();
        metrics.record_retry();
        
        assert_eq!(metrics.received.load(Ordering::Relaxed), 2);
        assert_eq!(metrics.submitted.load(Ordering::Relaxed), 1);
        assert_eq!(metrics.retries.load(Ordering::Relaxed), 1);
    }
}

