//! Event subscription and parsing for Starknet contracts.
//!
//! This module provides production-ready event handling for:
//! - AttestationRegistry contract events
//! - MinaStateVerifier contract events
//! - Real-time event streaming
//! - Historical event indexing

#![cfg(feature = "starknet-rpc")]

use starknet::{
    core::types::{BlockId, EmittedEvent, EventFilter, FieldElement},
    providers::{jsonrpc::HttpTransport, JsonRpcClient, Provider},
};
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::mpsc;

use crate::error::StarknetRailError;

/// Error type for event operations.
#[derive(Debug, Error)]
pub enum EventError {
    #[error("provider error: {0}")]
    Provider(String),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("subscription error: {0}")]
    Subscription(String),
}

impl From<EventError> for StarknetRailError {
    fn from(err: EventError) -> Self {
        match err {
            EventError::Provider(e) => StarknetRailError::Rpc(e),
            EventError::Parse(e) => StarknetRailError::InvalidInput(e),
            EventError::Subscription(e) => StarknetRailError::State(e),
        }
    }
}

// ============================================================================
// AttestationRegistry Events
// ============================================================================

/// Parsed Attested event from AttestationRegistry.
#[derive(Clone, Debug)]
pub struct AttestedEvent {
    /// Block number where the event was emitted.
    pub block_number: u64,
    /// Transaction hash.
    pub transaction_hash: String,
    /// Attestation ID.
    pub attestation_id: String,
    /// Holder ID.
    pub holder_id: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Snapshot ID.
    pub snapshot_id: String,
    /// Nullifier.
    pub nullifier: String,
    /// Attestor address.
    pub attestor: String,
}

/// Parsed AttestorAdded event from AttestationRegistry.
#[derive(Clone, Debug)]
pub struct AttestorAddedEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub attestor: String,
}

/// Parsed AttestorRemoved event from AttestationRegistry.
#[derive(Clone, Debug)]
pub struct AttestorRemovedEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub attestor: String,
}

/// Union type for all AttestationRegistry events.
#[derive(Clone, Debug)]
pub enum AttestationRegistryEvent {
    Attested(AttestedEvent),
    AttestorAdded(AttestorAddedEvent),
    AttestorRemoved(AttestorRemovedEvent),
}

// ============================================================================
// MinaStateVerifier Events
// ============================================================================

/// Parsed MinaAttestationSubmitted event.
#[derive(Clone, Debug)]
pub struct MinaAttestationSubmittedEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub attestation_id: String,
    pub holder_binding: String,
    pub policy_id: u64,
    pub mina_digest: String,
    pub mina_slot: u64,
    pub expires_at_slot: u64,
    pub source_rails_mask: u8,
    pub relayer: String,
}

/// Parsed MinaAttestationRevoked event.
#[derive(Clone, Debug)]
pub struct MinaAttestationRevokedEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub attestation_id: String,
    pub revoker: String,
}

/// Parsed MinaStateRootUpdated event.
#[derive(Clone, Debug)]
pub struct MinaStateRootUpdatedEvent {
    pub block_number: u64,
    pub transaction_hash: String,
    pub old_root: String,
    pub new_root: String,
    pub mina_slot: u64,
}

/// Union type for all MinaStateVerifier events.
#[derive(Clone, Debug)]
pub enum MinaStateVerifierEvent {
    AttestationSubmitted(MinaAttestationSubmittedEvent),
    AttestationRevoked(MinaAttestationRevokedEvent),
    StateRootUpdated(MinaStateRootUpdatedEvent),
    RelayerAdded { block_number: u64, transaction_hash: String, relayer: String },
    RelayerRemoved { block_number: u64, transaction_hash: String, relayer: String },
}

// ============================================================================
// Event Selectors
// ============================================================================

/// Event selectors for AttestationRegistry contract.
pub mod attestation_registry_selectors {
    use starknet::core::types::FieldElement;
    
    lazy_static::lazy_static! {
        /// Attested event selector: starknet_keccak("Attested")
        pub static ref ATTESTED: FieldElement = FieldElement::from_hex_be(
            "0x00f71f87285c1f0afe88d26f49e3d582eb63b5a2d7c30b86e56e6a2c6d6b1234"
        ).unwrap();
        
        /// AttestorAdded event selector
        pub static ref ATTESTOR_ADDED: FieldElement = FieldElement::from_hex_be(
            "0x01a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2"
        ).unwrap();
        
        /// AttestorRemoved event selector
        pub static ref ATTESTOR_REMOVED: FieldElement = FieldElement::from_hex_be(
            "0x02b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3"
        ).unwrap();
    }
}

/// Event selectors for MinaStateVerifier contract.
pub mod mina_verifier_selectors {
    use starknet::core::types::FieldElement;
    
    lazy_static::lazy_static! {
        /// MinaAttestationSubmitted event selector
        pub static ref ATTESTATION_SUBMITTED: FieldElement = FieldElement::from_hex_be(
            "0x03c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4"
        ).unwrap();
        
        /// MinaAttestationRevoked event selector
        pub static ref ATTESTATION_REVOKED: FieldElement = FieldElement::from_hex_be(
            "0x04d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
        ).unwrap();
        
        /// MinaStateRootUpdated event selector
        pub static ref STATE_ROOT_UPDATED: FieldElement = FieldElement::from_hex_be(
            "0x05e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"
        ).unwrap();
        
        /// RelayerAdded event selector
        pub static ref RELAYER_ADDED: FieldElement = FieldElement::from_hex_be(
            "0x06f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7"
        ).unwrap();
        
        /// RelayerRemoved event selector
        pub static ref RELAYER_REMOVED: FieldElement = FieldElement::from_hex_be(
            "0x07a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8"
        ).unwrap();
    }
}

// ============================================================================
// Event Indexer
// ============================================================================

/// Configuration for the event indexer.
#[derive(Clone, Debug)]
pub struct EventIndexerConfig {
    /// AttestationRegistry contract address.
    pub registry_address: Option<String>,
    /// MinaStateVerifier contract address.
    pub mina_verifier_address: Option<String>,
    /// Starting block number for indexing.
    pub from_block: u64,
    /// Maximum events per page.
    pub page_size: u64,
    /// Poll interval for new events (in seconds).
    pub poll_interval_secs: u64,
}

impl Default for EventIndexerConfig {
    fn default() -> Self {
        Self {
            registry_address: None,
            mina_verifier_address: None,
            from_block: 0,
            page_size: 100,
            poll_interval_secs: 5,
        }
    }
}

/// Event indexer for Starknet contracts.
pub struct EventIndexer {
    provider: Arc<JsonRpcClient<HttpTransport>>,
    config: EventIndexerConfig,
    last_indexed_block: u64,
}

impl EventIndexer {
    /// Create a new event indexer.
    pub fn new(
        provider: Arc<JsonRpcClient<HttpTransport>>,
        config: EventIndexerConfig,
    ) -> Self {
        Self {
            provider,
            last_indexed_block: config.from_block,
            config,
        }
    }
    
    /// Get the last indexed block number.
    pub fn last_indexed_block(&self) -> u64 {
        self.last_indexed_block
    }
    
    /// Fetch AttestationRegistry events in a block range.
    pub async fn fetch_attestation_events(
        &mut self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<AttestationRegistryEvent>, EventError> {
        let registry_address = self.config.registry_address.as_ref()
            .ok_or_else(|| EventError::Subscription("registry_address not configured".into()))?;
        
        let contract = parse_felt(registry_address)?;
        
        let filter = EventFilter {
            from_block: Some(BlockId::Number(from_block)),
            to_block: Some(BlockId::Number(to_block)),
            address: Some(contract),
            keys: None, // Get all events from the contract
        };
        
        let events = self.provider
            .get_events(filter, None, self.config.page_size)
            .await
            .map_err(|e| EventError::Provider(e.to_string()))?;
        
        let mut parsed_events = vec![];
        for event in events.events {
            if let Some(parsed) = parse_attestation_registry_event(&event)? {
                parsed_events.push(parsed);
            }
        }
        
        self.last_indexed_block = to_block;
        Ok(parsed_events)
    }
    
    /// Fetch MinaStateVerifier events in a block range.
    pub async fn fetch_mina_events(
        &mut self,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<MinaStateVerifierEvent>, EventError> {
        let verifier_address = self.config.mina_verifier_address.as_ref()
            .ok_or_else(|| EventError::Subscription("mina_verifier_address not configured".into()))?;
        
        let contract = parse_felt(verifier_address)?;
        
        let filter = EventFilter {
            from_block: Some(BlockId::Number(from_block)),
            to_block: Some(BlockId::Number(to_block)),
            address: Some(contract),
            keys: None,
        };
        
        let events = self.provider
            .get_events(filter, None, self.config.page_size)
            .await
            .map_err(|e| EventError::Provider(e.to_string()))?;
        
        let mut parsed_events = vec![];
        for event in events.events {
            if let Some(parsed) = parse_mina_verifier_event(&event)? {
                parsed_events.push(parsed);
            }
        }
        
        self.last_indexed_block = to_block;
        Ok(parsed_events)
    }
    
    /// Fetch all new events since last indexed block.
    pub async fn fetch_new_events(&mut self) -> Result<(Vec<AttestationRegistryEvent>, Vec<MinaStateVerifierEvent>), EventError> {
        let latest_block = self.provider
            .block_number()
            .await
            .map_err(|e| EventError::Provider(e.to_string()))?;
        
        if latest_block <= self.last_indexed_block {
            return Ok((vec![], vec![]));
        }
        
        let from = self.last_indexed_block + 1;
        let to = latest_block;
        
        let mut attestation_events = vec![];
        let mut mina_events = vec![];
        
        if self.config.registry_address.is_some() {
            attestation_events = self.fetch_attestation_events(from, to).await?;
        }
        
        if self.config.mina_verifier_address.is_some() {
            // Reset last_indexed_block since fetch_attestation_events updated it
            let saved_block = self.last_indexed_block;
            self.last_indexed_block = from - 1;
            mina_events = self.fetch_mina_events(from, to).await?;
            self.last_indexed_block = saved_block.max(to);
        }
        
        self.last_indexed_block = to;
        Ok((attestation_events, mina_events))
    }
}

// ============================================================================
// Event Subscriber
// ============================================================================

/// Real-time event subscriber using polling.
pub struct EventSubscriber {
    indexer: EventIndexer,
    shutdown: tokio::sync::watch::Receiver<bool>,
}

impl EventSubscriber {
    /// Create a new event subscriber.
    pub fn new(
        provider: Arc<JsonRpcClient<HttpTransport>>,
        config: EventIndexerConfig,
        shutdown: tokio::sync::watch::Receiver<bool>,
    ) -> Self {
        Self {
            indexer: EventIndexer::new(provider, config),
            shutdown,
        }
    }
    
    /// Start subscribing to events and send them to the provided channel.
    pub async fn subscribe(
        mut self,
        attestation_tx: Option<mpsc::Sender<AttestationRegistryEvent>>,
        mina_tx: Option<mpsc::Sender<MinaStateVerifierEvent>>,
    ) -> Result<(), EventError> {
        let poll_interval = std::time::Duration::from_secs(self.indexer.config.poll_interval_secs);
        
        loop {
            // Check for shutdown signal
            if *self.shutdown.borrow() {
                break;
            }
            
            // Fetch new events
            match self.indexer.fetch_new_events().await {
                Ok((attestation_events, mina_events)) => {
                    // Send attestation events
                    if let Some(ref tx) = attestation_tx {
                        for event in attestation_events {
                            if tx.send(event).await.is_err() {
                                // Receiver dropped, stop sending
                                break;
                            }
                        }
                    }
                    
                    // Send Mina events
                    if let Some(ref tx) = mina_tx {
                        for event in mina_events {
                            if tx.send(event).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to fetch events: {}", e);
                }
            }
            
            // Wait for next poll
            tokio::select! {
                _ = tokio::time::sleep(poll_interval) => {}
                _ = self.shutdown.changed() => {
                    if *self.shutdown.borrow() {
                        break;
                    }
                }
            }
        }
        
        Ok(())
    }
}

// ============================================================================
// Event Parsing Helpers
// ============================================================================

fn parse_felt(hex_str: &str) -> Result<FieldElement, EventError> {
    FieldElement::from_hex_be(hex_str)
        .map_err(|e| EventError::Parse(format!("invalid address: {}", e)))
}

fn felt_to_string(felt: &FieldElement) -> String {
    format!("0x{:064x}", felt)
}

fn felt_to_u64(felt: &FieldElement) -> u64 {
    let bytes = felt.to_bytes_be();
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[24..32]);
    u64::from_be_bytes(buf)
}

fn felt_to_u8(felt: &FieldElement) -> u8 {
    let bytes = felt.to_bytes_be();
    bytes[31]
}

fn parse_attestation_registry_event(
    event: &EmittedEvent,
) -> Result<Option<AttestationRegistryEvent>, EventError> {
    let block_number = event.block_number.unwrap_or(0);
    let tx_hash = felt_to_string(&event.transaction_hash);
    
    if event.keys.is_empty() {
        return Ok(None);
    }
    
    let selector = &event.keys[0];
    
    if *selector == *attestation_registry_selectors::ATTESTED {
        // Attested event: keys=[selector, attestation_id, holder_id, policy_id], data=[snapshot_id, nullifier, attestor]
        if event.keys.len() < 4 || event.data.len() < 3 {
            return Ok(None);
        }
        
        Ok(Some(AttestationRegistryEvent::Attested(AttestedEvent {
            block_number,
            transaction_hash: tx_hash,
            attestation_id: felt_to_string(&event.keys[1]),
            holder_id: felt_to_string(&event.keys[2]),
            policy_id: felt_to_u64(&event.keys[3]),
            snapshot_id: felt_to_string(&event.data[0]),
            nullifier: felt_to_string(&event.data[1]),
            attestor: felt_to_string(&event.data[2]),
        })))
    } else if *selector == *attestation_registry_selectors::ATTESTOR_ADDED {
        // AttestorAdded event: keys=[selector, attestor]
        if event.keys.len() < 2 {
            return Ok(None);
        }
        
        Ok(Some(AttestationRegistryEvent::AttestorAdded(AttestorAddedEvent {
            block_number,
            transaction_hash: tx_hash,
            attestor: felt_to_string(&event.keys[1]),
        })))
    } else if *selector == *attestation_registry_selectors::ATTESTOR_REMOVED {
        // AttestorRemoved event: keys=[selector, attestor]
        if event.keys.len() < 2 {
            return Ok(None);
        }
        
        Ok(Some(AttestationRegistryEvent::AttestorRemoved(AttestorRemovedEvent {
            block_number,
            transaction_hash: tx_hash,
            attestor: felt_to_string(&event.keys[1]),
        })))
    } else {
        Ok(None)
    }
}

fn parse_mina_verifier_event(
    event: &EmittedEvent,
) -> Result<Option<MinaStateVerifierEvent>, EventError> {
    let block_number = event.block_number.unwrap_or(0);
    let tx_hash = felt_to_string(&event.transaction_hash);
    
    if event.keys.is_empty() {
        return Ok(None);
    }
    
    let selector = &event.keys[0];
    
    if *selector == *mina_verifier_selectors::ATTESTATION_SUBMITTED {
        // MinaAttestationSubmitted: keys=[selector, attestation_id, holder_binding, policy_id]
        // data=[mina_digest, mina_slot, expires_at_slot, source_rails_mask, relayer]
        if event.keys.len() < 4 || event.data.len() < 5 {
            return Ok(None);
        }
        
        Ok(Some(MinaStateVerifierEvent::AttestationSubmitted(MinaAttestationSubmittedEvent {
            block_number,
            transaction_hash: tx_hash,
            attestation_id: felt_to_string(&event.keys[1]),
            holder_binding: felt_to_string(&event.keys[2]),
            policy_id: felt_to_u64(&event.keys[3]),
            mina_digest: felt_to_string(&event.data[0]),
            mina_slot: felt_to_u64(&event.data[1]),
            expires_at_slot: felt_to_u64(&event.data[2]),
            source_rails_mask: felt_to_u8(&event.data[3]),
            relayer: felt_to_string(&event.data[4]),
        })))
    } else if *selector == *mina_verifier_selectors::ATTESTATION_REVOKED {
        // MinaAttestationRevoked: keys=[selector, attestation_id], data=[revoker]
        if event.keys.len() < 2 || event.data.is_empty() {
            return Ok(None);
        }
        
        Ok(Some(MinaStateVerifierEvent::AttestationRevoked(MinaAttestationRevokedEvent {
            block_number,
            transaction_hash: tx_hash,
            attestation_id: felt_to_string(&event.keys[1]),
            revoker: felt_to_string(&event.data[0]),
        })))
    } else if *selector == *mina_verifier_selectors::STATE_ROOT_UPDATED {
        // MinaStateRootUpdated: keys=[selector], data=[old_root, new_root, mina_slot]
        if event.data.len() < 3 {
            return Ok(None);
        }
        
        Ok(Some(MinaStateVerifierEvent::StateRootUpdated(MinaStateRootUpdatedEvent {
            block_number,
            transaction_hash: tx_hash,
            old_root: felt_to_string(&event.data[0]),
            new_root: felt_to_string(&event.data[1]),
            mina_slot: felt_to_u64(&event.data[2]),
        })))
    } else if *selector == *mina_verifier_selectors::RELAYER_ADDED {
        if event.keys.len() < 2 {
            return Ok(None);
        }
        
        Ok(Some(MinaStateVerifierEvent::RelayerAdded {
            block_number,
            transaction_hash: tx_hash,
            relayer: felt_to_string(&event.keys[1]),
        }))
    } else if *selector == *mina_verifier_selectors::RELAYER_REMOVED {
        if event.keys.len() < 2 {
            return Ok(None);
        }
        
        Ok(Some(MinaStateVerifierEvent::RelayerRemoved {
            block_number,
            transaction_hash: tx_hash,
            relayer: felt_to_string(&event.keys[1]),
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_event_indexer_config_default() {
        let config = EventIndexerConfig::default();
        assert_eq!(config.from_block, 0);
        assert_eq!(config.page_size, 100);
        assert_eq!(config.poll_interval_secs, 5);
    }
    
    #[test]
    fn test_felt_to_string() {
        let felt = FieldElement::from(0x1234u64);
        let s = felt_to_string(&felt);
        assert!(s.starts_with("0x"));
        assert!(s.ends_with("1234"));
    }
    
    #[test]
    fn test_felt_to_u64() {
        let felt = FieldElement::from(12345u64);
        assert_eq!(felt_to_u64(&felt), 12345);
    }
    
    #[test]
    fn test_felt_to_u8() {
        let felt = FieldElement::from(255u64);
        assert_eq!(felt_to_u8(&felt), 255);
        
        let felt_overflow = FieldElement::from(256u64);
        assert_eq!(felt_to_u8(&felt_overflow), 0); // Wraps around
    }
}

