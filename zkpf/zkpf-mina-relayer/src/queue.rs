//! Attestation queue for reliable delivery.

use std::collections::VecDeque;
use tokio::sync::{mpsc, Mutex};
use serde::{Deserialize, Serialize};

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
}

/// Attestation queue with retry support.
pub struct AttestationQueue {
    queue: Mutex<VecDeque<QueuedAttestation>>,
    receiver: Mutex<mpsc::Receiver<QueuedAttestation>>,
}

impl AttestationQueue {
    pub fn new(receiver: mpsc::Receiver<QueuedAttestation>) -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            receiver: Mutex::new(receiver),
        }
    }

    /// Pop the next attestation to process.
    pub async fn pop(&self) -> Option<QueuedAttestation> {
        // First check the retry queue
        {
            let mut queue = self.queue.lock().await;
            if let Some(attestation) = queue.pop_front() {
                return Some(attestation);
            }
        }

        // Then check for new attestations from receiver
        let mut receiver = self.receiver.lock().await;
        receiver.recv().await
    }

    /// Push an attestation back for retry.
    pub async fn push(&self, mut attestation: QueuedAttestation) {
        attestation.retries += 1;
        let mut queue = self.queue.lock().await;
        queue.push_back(attestation);
    }

    /// Get the current queue size.
    pub async fn len(&self) -> usize {
        let queue = self.queue.lock().await;
        queue.len()
    }
}

