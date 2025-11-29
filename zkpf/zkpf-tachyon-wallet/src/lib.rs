//! zkpf-tachyon-wallet
//!
//! Unified multi-chain wallet coordinator for zkpf, inspired by Tachyon.
//!
//! # Design Philosophy
//!
//! The Tachyon wallet uses each chain **only for its comparative advantage**:
//!
//! | Chain    | Role                                           | Why                                    |
//! |----------|------------------------------------------------|----------------------------------------|
//! | Zcash    | Privacy-preserving balance proofs              | Gold-standard shielded UTXOs           |
//! | Mina     | PCD/recursive SNARK state compression          | Constant-size proofs via recursion     |
//! | Starknet | Heavy computation, DeFi position proving       | Cheap STARK proving, rich DeFi         |
//! | Axelar   | Cross-chain proof & attestation transport      | Proven GMP infrastructure              |
//! | NEAR     | TEE-backed private AI agent                    | Confidential compute for wallet intel  |
//!
//! # Core Invariants
//!
//! 1. **Never bridge assets** - Only proofs and attestations cross chains
//! 2. **Privacy preservation** - Zcash ledger indistinguishability is a hard constraint
//! 3. **Proof composition** - Rails produce proofs; Mina aggregates; Axelar transports
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                        TachyonWallet Coordinator                         │
//! ├─────────────────────────────────────────────────────────────────────────┤
//! │                                                                          │
//! │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
//! │  │  ZcashRail   │  │  MinaRail    │  │ StarknetRail │  │  NEARAgent  │ │
//! │  │              │  │              │  │              │  │             │ │
//! │  │ • Shielded   │  │ • Recursive  │  │ • DeFi PoF   │  │ • AI Intel  │ │
//! │  │   balance    │  │   agg hub    │  │ • Session    │  │ • Private   │ │
//! │  │ • Note tree  │  │ • zkBridge   │  │   keys       │  │   compute   │ │
//! │  │ • PCZT flow  │  │ • State comp │  │ • Account AA │  │ • TEE vault │ │
//! │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
//! │         │                 │                 │                 │        │
//! │         └────────────┬────┴─────────────────┴─────────────────┘        │
//! │                      │                                                  │
//! │                      ▼                                                  │
//! │              ┌───────────────────┐                                      │
//! │              │  AxelarTransport  │                                      │
//! │              │  • GMP messages   │                                      │
//! │              │  • PoF receipts   │                                      │
//! │              │  • Attestations   │                                      │
//! │              └───────────────────┘                                      │
//! │                                                                          │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```

pub mod aggregator;
pub mod attestation;
pub mod config;
pub mod coordinator;
pub mod error;
pub mod rails;
pub mod state;
pub mod transport;
pub mod types;

#[cfg(feature = "near")]
pub mod near_agent;

pub use aggregator::{ProofAggregator, AggregationStrategy};
pub use attestation::{UnifiedAttestation, AttestationProof};
pub use config::{TachyonConfig, RailConfig, ChainEndpoint, RailCapability};
pub use coordinator::TachyonWallet;
pub use error::TachyonError;
pub use rails::{Rail, RailId};
pub use state::{UnifiedBalance, ChainBalance, ProofState, WalletState};
pub use transport::{AxelarTransport, CrossChainMessage};
pub use types::*;

/// Version of the Tachyon wallet protocol.
pub const TACHYON_VERSION: u32 = 1;

/// Maximum number of proofs that can be aggregated in a single Mina recursive proof.
pub const MAX_AGGREGATED_PROOFS: usize = 16;

/// Default validity window for cross-chain attestations (24 hours).
pub const DEFAULT_ATTESTATION_VALIDITY_SECS: u64 = 86400;

