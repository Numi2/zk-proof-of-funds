//! WebSocket server for PCD Keeper events.
//!
//! Exposes keeper events to frontend clients over WebSocket, enabling
//! real-time updates of sync status, tachystamp submissions, and errors.
//!
//! # Protocol
//!
//! Messages are JSON-encoded with the following structure:
//!
//! ```json
//! {
//!   "type": "event_type",
//!   "data": { ... }
//! }
//! ```
//!
//! ## Supported Events
//!
//! - `keeper_started` - Keeper has started
//! - `keeper_stopped` - Keeper has stopped
//! - `sync_started` - PCD sync in progress
//! - `sync_completed` - PCD sync finished
//! - `tachystamp_queued` - Tachystamp added to queue
//! - `tachystamp_submitted` - Tachystamp sent to Mina Rail
//! - `epoch_boundary` - New epoch started
//! - `warning` - Non-fatal warning
//! - `error` - Error occurred
//! - `status_update` - Periodic status update

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, RwLock};
use thiserror::Error;

use crate::pcd_keeper::{KeeperEvent, KeeperStatus, PcdKeeperConfig};

// ═══════════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/// WebSocket server errors.
#[derive(Debug, Error)]
pub enum WsServerError {
    #[error("Server already running")]
    AlreadyRunning,

    #[error("Server not running")]
    NotRunning,

    #[error("Bind failed: {0}")]
    BindFailed(String),

    #[error("Connection error: {0}")]
    ConnectionError(String),
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

/// Outbound WebSocket message (server to client).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum WsOutboundMessage {
    /// Connection established.
    Connected {
        /// Session ID.
        session_id: String,
        /// Server version.
        server_version: String,
    },

    /// Keeper started.
    KeeperStarted {
        /// Configuration summary.
        config_summary: ConfigSummary,
    },

    /// Keeper stopped.
    KeeperStopped {
        /// Reason.
        reason: String,
    },

    /// Sync started.
    SyncStarted {
        /// Starting height.
        from_height: u64,
        /// Target height.
        to_height: u64,
    },

    /// Sync completed.
    SyncCompleted {
        /// New height.
        new_height: u64,
        /// Blocks synced.
        blocks_synced: u64,
        /// Notes discovered.
        notes_discovered: u32,
        /// Duration in ms.
        duration_ms: u64,
        /// Whether successful.
        success: bool,
        /// Error message if failed.
        error: Option<String>,
    },

    /// Tachystamp queued.
    TachystampQueued {
        /// Policy ID.
        policy_id: u64,
        /// Epoch.
        epoch: u64,
        /// Queue position.
        queue_position: usize,
    },

    /// Tachystamp submitted.
    TachystampSubmitted {
        /// Policy ID.
        policy_id: u64,
        /// Epoch.
        epoch: u64,
        /// Tachystamp ID.
        tachystamp_id: String,
    },

    /// Epoch boundary crossed.
    EpochBoundary {
        /// Old epoch.
        old_epoch: u64,
        /// New epoch.
        new_epoch: u64,
    },

    /// Warning.
    Warning {
        /// Warning code.
        code: String,
        /// Warning message.
        message: String,
    },

    /// Error.
    Error {
        /// Error code.
        code: String,
        /// Error message.
        message: String,
        /// Whether recoverable.
        recoverable: bool,
    },

    /// Periodic status update.
    StatusUpdate {
        /// Current status.
        status: KeeperStatusDto,
    },

    /// Response to a request.
    Response {
        /// Request ID.
        request_id: String,
        /// Success.
        success: bool,
        /// Response data.
        data: Option<serde_json::Value>,
        /// Error message.
        error: Option<String>,
    },
}

/// Inbound WebSocket message (client to server).
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum WsInboundMessage {
    /// Subscribe to events.
    Subscribe {
        /// Event types to subscribe to (empty = all).
        event_types: Vec<String>,
    },

    /// Unsubscribe from events.
    Unsubscribe {
        /// Event types to unsubscribe from.
        event_types: Vec<String>,
    },

    /// Request current status.
    GetStatus {
        /// Request ID for response correlation.
        request_id: String,
    },

    /// Request sync.
    RequestSync {
        /// Request ID.
        request_id: String,
    },

    /// Ping (keepalive).
    Ping {
        /// Timestamp.
        timestamp: u64,
    },
}

/// Configuration summary for clients.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    /// Minimum blocks behind.
    pub min_blocks_behind: u64,
    /// Maximum blocks behind.
    pub max_blocks_behind: u64,
    /// Poll interval.
    pub poll_interval_secs: u64,
    /// Auto submit enabled.
    pub auto_submit_tachystamps: bool,
    /// Epoch strategy.
    pub epoch_strategy: String,
}

impl From<&PcdKeeperConfig> for ConfigSummary {
    fn from(config: &PcdKeeperConfig) -> Self {
        Self {
            min_blocks_behind: config.min_blocks_behind,
            max_blocks_behind: config.max_blocks_behind,
            poll_interval_secs: config.poll_interval_secs,
            auto_submit_tachystamps: config.auto_submit_tachystamps,
            epoch_strategy: format!("{:?}", config.epoch_submission_strategy),
        }
    }
}

/// Keeper status DTO for WebSocket.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeeperStatusDto {
    /// Is running.
    pub is_running: bool,
    /// PCD height.
    pub pcd_height: u64,
    /// Chain height.
    pub chain_height: u64,
    /// Blocks behind.
    pub blocks_behind: u64,
    /// Last sync timestamp.
    pub last_sync_at: Option<u64>,
    /// Pending tachystamps.
    pub pending_tachystamps: usize,
    /// Total syncs.
    pub total_syncs: u64,
    /// Total tachystamps submitted.
    pub total_tachystamps_submitted: u64,
    /// Current epoch.
    pub current_epoch: Option<u64>,
}

impl From<&KeeperStatus> for KeeperStatusDto {
    fn from(status: &KeeperStatus) -> Self {
        Self {
            is_running: status.is_running,
            pcd_height: status.pcd_height,
            chain_height: status.chain_height,
            blocks_behind: status.blocks_behind,
            last_sync_at: status.last_sync_at,
            pending_tachystamps: status.pending_tachystamps,
            total_syncs: status.total_syncs,
            total_tachystamps_submitted: status.total_tachystamps_submitted,
            current_epoch: status.current_epoch.as_ref().map(|e| e.epoch),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ═══════════════════════════════════════════════════════════════════════════════

/// WebSocket server configuration.
#[derive(Clone, Debug)]
pub struct WsServerConfig {
    /// Bind address.
    pub bind_addr: SocketAddr,
    /// Status update interval.
    pub status_interval: Duration,
    /// Maximum connections.
    pub max_connections: usize,
}

impl Default for WsServerConfig {
    fn default() -> Self {
        Self {
            bind_addr: "127.0.0.1:3001".parse().unwrap(),
            status_interval: Duration::from_secs(5),
            max_connections: 100,
        }
    }
}

/// WebSocket server handle.
#[derive(Clone)]
pub struct WsServerHandle {
    /// Command sender.
    command_tx: mpsc::Sender<WsCommand>,
    /// Server stats.
    stats: Arc<WsServerStats>,
}

impl WsServerHandle {
    /// Get server statistics.
    pub fn stats(&self) -> &WsServerStats {
        &self.stats
    }

    /// Broadcast a message to all connected clients.
    pub async fn broadcast(&self, message: WsOutboundMessage) -> Result<(), WsServerError> {
        self.command_tx
            .send(WsCommand::Broadcast(message))
            .await
            .map_err(|_| WsServerError::NotRunning)
    }

    /// Stop the server.
    pub async fn stop(&self) -> Result<(), WsServerError> {
        self.command_tx
            .send(WsCommand::Stop)
            .await
            .map_err(|_| WsServerError::NotRunning)
    }
}

/// Server statistics.
#[derive(Debug, Default)]
pub struct WsServerStats {
    /// Active connections.
    pub active_connections: AtomicU64,
    /// Total connections ever.
    pub total_connections: AtomicU64,
    /// Messages sent.
    pub messages_sent: AtomicU64,
    /// Messages received.
    pub messages_received: AtomicU64,
}

/// Internal server command.
enum WsCommand {
    Broadcast(WsOutboundMessage),
    Stop,
}

/// WebSocket server for keeper events.
///
/// This is a placeholder implementation. In production, you would use
/// `tokio-tungstenite` or `axum` with WebSocket support.
pub struct KeeperWsServer {
    /// Configuration.
    config: WsServerConfig,
    /// Keeper event receiver.
    event_rx: Option<broadcast::Receiver<KeeperEvent>>,
    /// Status fetcher.
    status_fetcher: Option<Box<dyn Fn() -> KeeperStatus + Send + Sync>>,
    /// Request handler.
    request_handler: Option<Box<dyn Fn(WsInboundMessage) + Send + Sync>>,
}

impl KeeperWsServer {
    /// Create a new WebSocket server.
    pub fn new(config: WsServerConfig) -> Self {
        Self {
            config,
            event_rx: None,
            status_fetcher: None,
            request_handler: None,
        }
    }

    /// Set the keeper event source.
    pub fn with_events(mut self, event_rx: broadcast::Receiver<KeeperEvent>) -> Self {
        self.event_rx = Some(event_rx);
        self
    }

    /// Set the status fetcher function.
    pub fn with_status_fetcher<F>(mut self, fetcher: F) -> Self
    where
        F: Fn() -> KeeperStatus + Send + Sync + 'static,
    {
        self.status_fetcher = Some(Box::new(fetcher));
        self
    }

    /// Start the server.
    ///
    /// Note: This is a simplified implementation. For production use,
    /// integrate with `axum` or `warp` WebSocket handlers.
    pub async fn start(self) -> Result<WsServerHandle, WsServerError> {
        let (command_tx, mut command_rx) = mpsc::channel(32);
        let stats = Arc::new(WsServerStats::default());

        let handle = WsServerHandle {
            command_tx,
            stats: stats.clone(),
        };

        // Spawn the server task
        let config = self.config.clone();
        let event_rx = self.event_rx;

        tokio::spawn(async move {
            tracing::info!(
                addr = %config.bind_addr,
                "PCD Keeper WebSocket server starting"
            );

            // In a real implementation, this would:
            // 1. Bind to the socket
            // 2. Accept connections
            // 3. Handle WebSocket upgrade
            // 4. Forward events to connected clients
            //
            // For now, we just handle commands and forward events

            let mut event_rx = event_rx;
            let mut status_interval = tokio::time::interval(config.status_interval);

            loop {
                tokio::select! {
                    // Handle commands
                    Some(cmd) = command_rx.recv() => {
                        match cmd {
                            WsCommand::Stop => {
                                tracing::info!("WebSocket server stopping");
                                break;
                            }
                            WsCommand::Broadcast(msg) => {
                                // In a real implementation, send to all clients
                                stats.messages_sent.fetch_add(1, Ordering::Relaxed);
                                tracing::debug!("Would broadcast: {:?}", msg);
                            }
                        }
                    }

                    // Forward keeper events
                    event = async {
                        if let Some(ref mut rx) = event_rx {
                            rx.recv().await.ok()
                        } else {
                            None
                        }
                    } => {
                        if let Some(event) = event {
                            let ws_msg = keeper_event_to_ws_message(event);
                            stats.messages_sent.fetch_add(1, Ordering::Relaxed);
                            tracing::debug!("Would send event: {:?}", ws_msg);
                        }
                    }

                    // Periodic status updates
                    _ = status_interval.tick() => {
                        // In a real implementation, fetch status and broadcast
                        tracing::trace!("Status update tick");
                    }
                }
            }

            tracing::info!("WebSocket server stopped");
        });

        Ok(handle)
    }
}

/// Convert a keeper event to a WebSocket message.
fn keeper_event_to_ws_message(event: KeeperEvent) -> WsOutboundMessage {
    match event {
        KeeperEvent::Started { config } => WsOutboundMessage::KeeperStarted {
            config_summary: ConfigSummary::from(&config),
        },
        KeeperEvent::Stopped { reason } => WsOutboundMessage::KeeperStopped { reason },
        KeeperEvent::SyncStarted { from_height, to_height } => {
            WsOutboundMessage::SyncStarted { from_height, to_height }
        }
        KeeperEvent::SyncCompleted { result } => match result {
            crate::pcd_keeper::SyncResult::Success {
                new_height,
                blocks_synced,
                notes_discovered,
                duration_ms,
            } => WsOutboundMessage::SyncCompleted {
                new_height,
                blocks_synced,
                notes_discovered,
                duration_ms,
                success: true,
                error: None,
            },
            crate::pcd_keeper::SyncResult::Skipped { reason } => WsOutboundMessage::SyncCompleted {
                new_height: 0,
                blocks_synced: 0,
                notes_discovered: 0,
                duration_ms: 0,
                success: true,
                error: Some(reason),
            },
            crate::pcd_keeper::SyncResult::Failed { error, .. } => WsOutboundMessage::SyncCompleted {
                new_height: 0,
                blocks_synced: 0,
                notes_discovered: 0,
                duration_ms: 0,
                success: false,
                error: Some(error),
            },
        },
        KeeperEvent::TachystampQueued {
            policy_id,
            epoch,
            queue_position,
        } => WsOutboundMessage::TachystampQueued {
            policy_id,
            epoch,
            queue_position,
        },
        KeeperEvent::TachystampSubmitted {
            policy_id,
            epoch,
            tachystamp_id,
        } => WsOutboundMessage::TachystampSubmitted {
            policy_id,
            epoch,
            tachystamp_id,
        },
        KeeperEvent::EpochBoundary { old_epoch, new_epoch } => {
            WsOutboundMessage::EpochBoundary { old_epoch, new_epoch }
        }
        KeeperEvent::Warning { code, message } => WsOutboundMessage::Warning { code, message },
        KeeperEvent::Error {
            code,
            message,
            recoverable,
        } => WsOutboundMessage::Error {
            code,
            message,
            recoverable,
        },
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = WsServerConfig::default();
        assert_eq!(config.bind_addr.port(), 3001);
        assert_eq!(config.max_connections, 100);
    }

    #[test]
    fn test_outbound_message_serialization() {
        let msg = WsOutboundMessage::SyncStarted {
            from_height: 100,
            to_height: 200,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("sync_started"));
        assert!(json.contains("100"));
    }

    #[test]
    fn test_inbound_message_deserialization() {
        let json = r#"{"type":"get_status","data":{"request_id":"123"}}"#;
        let msg: WsInboundMessage = serde_json::from_str(json).unwrap();
        match msg {
            WsInboundMessage::GetStatus { request_id } => {
                assert_eq!(request_id, "123");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_keeper_status_dto() {
        let status = KeeperStatus {
            is_running: true,
            pcd_height: 1000,
            chain_height: 1050,
            blocks_behind: 50,
            last_sync_at: Some(12345),
            last_sync_result: None,
            pending_tachystamps: 2,
            current_epoch: None,
            total_syncs: 10,
            total_tachystamps_submitted: 5,
            gas_spent_this_epoch: 0,
            next_action: None,
        };
        
        let dto = KeeperStatusDto::from(&status);
        assert!(dto.is_running);
        assert_eq!(dto.blocks_behind, 50);
    }
}

