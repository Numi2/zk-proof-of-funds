//! zkpf-mina-relayer
//!
//! Relayer service that propagates Mina attestations to target chains.
//!
//! Architecture:
//! 1. Listen for attestation events from Mina zkApp
//! 2. Queue attestations for relay
//! 3. Submit to target chains (EVM, Starknet, etc.)
//! 4. Handle retries and failures

mod config;
mod mina_listener;
mod queue;
mod submitters;

use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{info, warn, error};

use crate::config::RelayerConfig;
use crate::mina_listener::MinaListener;
use crate::queue::AttestationQueue;
use crate::submitters::{EvmSubmitter, StarknetSubmitter, Submitter};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "zkpf_mina_relayer=info".into()),
        )
        .init();

    // Load configuration
    dotenvy::dotenv().ok();
    let config = RelayerConfig::from_env()?;

    info!("Starting zkpf-mina-relayer");
    info!("Mina GraphQL: {}", config.mina_graphql_url);
    info!("Target chains: {:?}", config.target_chains);

    // Create channels for attestation flow
    let (attestation_tx, attestation_rx) = mpsc::channel(1000);

    // Create components
    let mina_listener = MinaListener::new(
        config.mina_graphql_url.clone(),
        config.zkapp_address.clone(),
        attestation_tx,
    );

    let queue = Arc::new(AttestationQueue::new(attestation_rx));

    // Create submitters for each target chain
    let mut submitters: Vec<Box<dyn Submitter + Send + Sync>> = vec![];

    for chain in &config.target_chains {
        match chain.as_str() {
            "ethereum" | "sepolia" => {
                if let Some(ref rpc) = config.ethereum_rpc_url {
                    info!("Enabling Ethereum submitter");
                    submitters.push(Box::new(EvmSubmitter::new(
                        rpc.clone(),
                        config.bridge_address.clone().unwrap_or_default(),
                        config.relayer_private_key.clone(),
                    )?));
                }
            }
            "starknet" | "starknet_sepolia" | "starknet_mainnet" => {
                if let Some(ref rpc) = config.starknet_rpc_url {
                    info!("Enabling Starknet submitter");
                    submitters.push(Box::new(StarknetSubmitter::new(
                        rpc.clone(),
                        config.starknet_bridge_address.clone().unwrap_or_default(),
                        config.starknet_account_address.clone(),
                        config.starknet_private_key.clone(),
                        Some(if chain == "starknet_mainnet" { 
                            "SN_MAIN".to_string() 
                        } else { 
                            "SN_SEPOLIA".to_string() 
                        }),
                    )?));
                }
            }
            _ => {
                warn!("Unknown target chain: {}", chain);
            }
        }
    }

    // Spawn listener task
    let listener_handle = tokio::spawn(async move {
        if let Err(e) = mina_listener.run().await {
            error!("Mina listener error: {}", e);
        }
    });

    // Spawn metrics logging task
    let metrics_queue = Arc::clone(&queue);
    let metrics_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let summary = metrics_queue.metrics.summary();
            let queue_len = metrics_queue.len().await;
            let dlq_len = metrics_queue.dead_letter_len().await;
            info!(
                "Relayer metrics: {} | retry_queue={} | dead_letter={}",
                summary, queue_len, dlq_len
            );
        }
    });

    // Spawn submitter tasks
    let submitter_handles: Vec<_> = submitters
        .into_iter()
        .map(|submitter| {
            let queue_clone = Arc::clone(&queue);
            tokio::spawn(async move {
                loop {
                    if let Some(attestation) = queue_clone.pop().await {
                        let attestation_id = hex::encode(&attestation.attestation_id[..8]);
                        
                        match submitter.submit(&attestation).await {
                            Ok(tx_hash) => {
                                info!(
                                    "Submitted attestation {} to {}: {}",
                                    attestation_id,
                                    submitter.chain_name(),
                                    tx_hash
                                );
                                queue_clone.record_success();
                            }
                            Err(e) => {
                                let error_msg = e.to_string();
                                error!(
                                    "Failed to submit {} to {}: {}",
                                    attestation_id,
                                    submitter.chain_name(),
                                    error_msg
                                );
                                // Re-queue for retry with error message
                                queue_clone.push_with_error(attestation, error_msg).await;
                            }
                        }
                    }
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            })
        })
        .collect();

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;
    info!("Shutting down relayer...");

    // Log final metrics
    let final_metrics = queue.metrics.summary();
    info!("Final metrics: {}", final_metrics);

    // Cancel tasks
    listener_handle.abort();
    metrics_handle.abort();
    for handle in submitter_handles {
        handle.abort();
    }

    Ok(())
}

