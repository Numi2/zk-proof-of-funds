//! Chain submitters for attestation relay.

mod evm;

pub use evm::EvmSubmitter;

use anyhow::Result;
use async_trait::async_trait;

use crate::queue::QueuedAttestation;

/// Trait for chain submitters.
#[async_trait]
pub trait Submitter {
    /// Get the chain name.
    fn chain_name(&self) -> &str;

    /// Submit an attestation to the target chain.
    async fn submit(&self, attestation: &QueuedAttestation) -> Result<String>;

    /// Check if the submitter is healthy.
    async fn health_check(&self) -> Result<bool>;
}

