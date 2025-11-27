//! Mina event listener.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tracing::{info, warn, debug};

use crate::queue::QueuedAttestation;

/// Mina zkApp event listener.
pub struct MinaListener {
    graphql_url: String,
    zkapp_address: String,
    sender: mpsc::Sender<QueuedAttestation>,
    last_processed_slot: u64,
}

impl MinaListener {
    pub fn new(
        graphql_url: String,
        zkapp_address: String,
        sender: mpsc::Sender<QueuedAttestation>,
    ) -> Self {
        Self {
            graphql_url,
            zkapp_address,
            sender,
            last_processed_slot: 0,
        }
    }

    /// Run the listener loop.
    pub async fn run(&self) -> Result<()> {
        info!("Starting Mina listener for zkApp: {}", self.zkapp_address);

        let client = reqwest::Client::new();

        loop {
            // Query for new events
            match self.fetch_events(&client).await {
                Ok(events) => {
                    for event in events {
                        debug!("Processing event: {:?}", event);
                        
                        let attestation = QueuedAttestation {
                            attestation_id: event.attestation_id,
                            holder_binding: event.holder_binding,
                            policy_id: event.policy_id,
                            epoch: event.epoch,
                            mina_slot: event.mina_slot,
                            expires_at_slot: event.expires_at_slot,
                            state_root: event.state_root,
                            merkle_proof: event.merkle_proof,
                            retries: 0,
                            retry_after: 0,
                            target_chain: None,
                            last_error: None,
                        };

                        if let Err(e) = self.sender.send(attestation).await {
                            warn!("Failed to queue attestation: {}", e);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch events: {}", e);
                }
            }

            // Wait before next poll
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
        }
    }

    async fn fetch_events(&self, client: &reqwest::Client) -> Result<Vec<AttestationEvent>> {
        // Query zkApp events via GraphQL
        let query = r#"
            query($address: PublicKey!, $afterSlot: Int) {
                events(publicKey: $address, afterSlot: $afterSlot) {
                    blockInfo {
                        globalSlotSinceGenesis
                    }
                    eventData {
                        data
                    }
                }
            }
        "#;

        let variables = serde_json::json!({
            "address": self.zkapp_address,
            "afterSlot": self.last_processed_slot
        });

        let response = client
            .post(&self.graphql_url)
            .json(&serde_json::json!({
                "query": query,
                "variables": variables
            }))
            .send()
            .await?;

        let body: serde_json::Value = response.json().await?;

        // Parse events (simplified - real impl would parse properly)
        let mut events = Vec::new();

        if let Some(event_list) = body["data"]["events"].as_array() {
            for event in event_list {
                if let Some(data) = event["eventData"]["data"].as_array() {
                    // Parse attestation event data
                    // This is simplified - real parsing depends on zkApp event format
                    if data.len() >= 6 {
                        events.push(AttestationEvent {
                            attestation_id: parse_field(&data[0]),
                            holder_binding: parse_field(&data[1]),
                            policy_id: parse_u64(&data[2]),
                            epoch: parse_u64(&data[3]),
                            mina_slot: event["blockInfo"]["globalSlotSinceGenesis"]
                                .as_u64()
                                .unwrap_or(0),
                            expires_at_slot: parse_u64(&data[4]),
                            state_root: parse_field(&data[5]),
                            merkle_proof: vec![], // Would be populated from event data
                        });
                    }
                }
            }
        }

        Ok(events)
    }
}

/// Attestation event from Mina zkApp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationEvent {
    pub attestation_id: [u8; 32],
    pub holder_binding: [u8; 32],
    pub policy_id: u64,
    pub epoch: u64,
    pub mina_slot: u64,
    pub expires_at_slot: u64,
    pub state_root: [u8; 32],
    pub merkle_proof: Vec<[u8; 32]>,
}

fn parse_field(value: &serde_json::Value) -> [u8; 32] {
    let s = value.as_str().unwrap_or("0");
    let bytes = hex::decode(s.trim_start_matches("0x")).unwrap_or_default();
    let mut arr = [0u8; 32];
    let len = bytes.len().min(32);
    arr[..len].copy_from_slice(&bytes[..len]);
    arr
}

fn parse_u64(value: &serde_json::Value) -> u64 {
    value.as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| value.as_u64())
        .unwrap_or(0)
}

