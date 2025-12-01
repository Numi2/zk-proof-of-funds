//! zkpf-near-tee
//!
//! NEAR TEE-backed private AI agent for zkpf wallet intelligence.
//!
//! # Design Philosophy
//!
//! NEAR provides TEE (Trusted Execution Environment) capabilities that enable:
//! - **Private AI inference**: Run AI models in confidential compute enclaves
//! - **Wallet intelligence**: Smart suggestions without exposing transaction data
//! - **Secure key management**: TEE-protected key derivation and signing
//! - **Cross-chain orchestration**: Coordinate multi-chain operations privately
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                        NEAR TEE Agent Architecture                       │
//! ├─────────────────────────────────────────────────────────────────────────┤
//! │                                                                          │
//! │  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────┐ │
//! │  │   TEE Enclave    │    │   AI Inference    │    │  Key Management  │ │
//! │  │                  │    │                   │    │                  │ │
//! │  │ • Intel SGX/TDX  │    │ • Local LLM       │    │ • Key derivation │ │
//! │  │ • AMD SEV        │    │ • Privacy filter  │    │ • Signing ops    │ │
//! │  │ • Attestation    │    │ • Intent parsing  │    │ • Rotation       │ │
//! │  └────────┬─────────┘    └─────────┬─────────┘    └────────┬─────────┘ │
//! │           │                        │                       │           │
//! │           └────────────────────────┼───────────────────────┘           │
//! │                                    │                                    │
//! │                                    ▼                                    │
//! │                         ┌────────────────────┐                          │
//! │                         │   Agent Contract   │                          │
//! │                         │   (NEAR Account)   │                          │
//! │                         │                    │                          │
//! │                         │ • State storage    │                          │
//! │                         │ • Access control   │                          │
//! │                         │ • Cross-chain msg  │                          │
//! │                         └────────────────────┘                          │
//! │                                                                          │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! # Security Model
//!
//! 1. **Data never leaves TEE**: All sensitive operations happen in the enclave
//! 2. **Attestation required**: Agent proves it's running in genuine TEE
//! 3. **Minimal disclosure**: AI outputs are filtered to prevent data leakage
//! 4. **Key isolation**: Private keys never exist outside the TEE

pub mod agent;
pub mod attestation;
pub mod chain_abstraction;
pub mod crypto;
pub mod error;
pub mod inference;
#[cfg(feature = "websocket")]
pub mod keeper_ws;
pub mod lightwalletd_client;
pub mod mina_rail_client;
pub mod pcd_keeper;
pub mod rpc;
pub mod shade_agent;
pub mod types;

pub use agent::{NearAgent, AgentConfig, AgentCapability};
pub use attestation::{TeeAttestation, TeeProvider, verify_attestation};
pub use chain_abstraction::{
    ChainAbstractionService, ChainAbstractionConfig, ChainAbstractionError,
    UnifiedAccount, ChainAddress,
    CrossChainIntent, IntentResolution, ResolvedTransaction,
    GasToken, GasAbstractionConfig, GasPaymentRequest, GasPaymentResult,
    MultichainSignatureRequest, MultichainSignatureResult, SignatureScheme,
};
pub use crypto::{TeeKeyManager, EncryptedPayload, SignedMessage};
pub use error::NearTeeError;
pub use inference::{AiInference, InferenceRequest, InferenceResult, PrivacyFilter};
pub use shade_agent::{
    ShadeAgentCoordinator, ShadeAgentConfig, ShadeAgentError,
    ChainType, ChainKey, ChainKeyRegistry,
    TachyonIntent, IntentResult,
    GasConfig, GasPaymentToken, GasEstimate,
};
pub use pcd_keeper::{
    PcdKeeper, PcdKeeperConfig, PcdKeeperError,
    KeeperHandle, KeeperStatus, KeeperEvent,
    EpochStrategy, EpochInfo,
    PcdState, BlockDelta, NoteIdentifier, NullifierIdentifier,
    Tachystamp, TachystampProof, PendingTachystamp,
    SyncResult, ScheduledAction, ScheduledActionType,
};
pub use lightwalletd_client::{
    LightwalletdClient, LightwalletdConfig, LightwalletdError,
    LightdInfo, TreeState, CompactBlock,
};
pub use mina_rail_client::{
    MinaRailClient, MinaRailConfig, MinaRailError,
    MinaRailStatus, MinaRailEpochState, MinaRailEpochProof,
    SubmitTachystampResponse,
};
#[cfg(feature = "websocket")]
pub use keeper_ws::{
    KeeperWsServer, WsServerConfig, WsServerHandle,
    WsOutboundMessage, WsInboundMessage, KeeperStatusDto,
};
pub use types::*;

/// Version of the NEAR TEE agent protocol.
pub const NEAR_TEE_VERSION: u32 = 1;

/// Default TEE attestation validity (1 hour).
pub const DEFAULT_ATTESTATION_VALIDITY_SECS: u64 = 3600;

/// Maximum AI response tokens.
pub const MAX_INFERENCE_TOKENS: usize = 2048;

