//! zkpf-omni-bridge
//!
//! Omni Bridge SDK integration for zkpf cross-chain asset transfers.
//!
//! # Overview
//!
//! The Omni Bridge (successor to Rainbow Bridge) provides secure cross-chain
//! communication and asset transfers between NEAR, Ethereum, Arbitrum, Base,
//! and Solana. This crate integrates the Omni Bridge SDK with the zkpf wallet
//! infrastructure.
//!
//! # Design Philosophy
//!
//! While the Tachyon wallet's core design is "never bridge assets, only proofs",
//! the Omni Bridge integration enables:
//!
//! 1. **Bridged token attestations**: Prove ownership of bridged assets
//! 2. **Cross-chain liquidity**: Enable DeFi operations across chains
//! 3. **Unified balance proofs**: Aggregate proofs across bridged positions
//!
//! # Supported Chains
//!
//! | Chain     | Role in zkpf                           | Bridge Support        |
//! |-----------|----------------------------------------|-----------------------|
//! | NEAR      | TEE compute, contract hub              | Native                |
//! | Ethereum  | DeFi positions, ERC20 bridging         | EVM Bridge Client     |
//! | Arbitrum  | L2 DeFi, lower gas                     | EVM Bridge Client     |
//! | Base      | Coinbase ecosystem, stablecoins        | EVM Bridge Client     |
//! | Solana    | High-throughput, SPL tokens            | Solana Bridge Client  |
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                        Omni Bridge Integration                          │
//! ├─────────────────────────────────────────────────────────────────────────┤
//! │                                                                          │
//! │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
//! │  │ NEAR Client  │  │ EVM Client   │  │Solana Client │  │  Wormhole   │ │
//! │  │              │  │              │  │              │  │   VAAs      │ │
//! │  │ • State      │  │ • ETH/ARB/   │  │ • SPL tokens │  │ • Cross-    │ │
//! │  │ • Tokens     │  │   Base       │  │ • Programs   │  │   chain     │ │
//! │  │ • Contracts  │  │ • ERC20      │  │ • Accounts   │  │   proofs    │ │
//! │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
//! │         │                 │                 │                 │        │
//! │         └────────────┬────┴─────────────────┴─────────────────┘        │
//! │                      │                                                  │
//! │                      ▼                                                  │
//! │              ┌───────────────────┐                                      │
//! │              │  OmniConnector    │                                      │
//! │              │  • Token bridging │                                      │
//! │              │  • Metadata mgmt  │                                      │
//! │              │  • Cross-chain tx │                                      │
//! │              └───────────────────┘                                      │
//! │                                                                          │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```

pub mod bridge;
pub mod chains;
pub mod config;
pub mod error;
pub mod proof;
pub mod tokens;
pub mod transfer;
pub mod types;

pub use bridge::{OmniBridge, BridgeCapability};
pub use chains::{ChainConfig, SupportedChain};
pub use config::{OmniBridgeConfig, BridgeEndpoint};
pub use error::OmniBridgeError;
pub use proof::{BridgedAssetProof, CrossChainAttestation};
pub use tokens::{TokenInfo, BridgedToken, TokenRegistry};
pub use transfer::{TransferRequest, TransferResult, TransferStatus};
pub use types::*;

/// Rail identifier for Omni Bridge.
pub const RAIL_ID_OMNI_BRIDGE: &str = "OMNI_BRIDGE";

/// Version of the Omni Bridge integration.
pub const OMNI_BRIDGE_VERSION: u32 = 1;

/// Default transfer timeout (10 minutes).
pub const DEFAULT_TRANSFER_TIMEOUT_SECS: u64 = 600;

/// Maximum number of concurrent transfers.
pub const MAX_CONCURRENT_TRANSFERS: usize = 10;

