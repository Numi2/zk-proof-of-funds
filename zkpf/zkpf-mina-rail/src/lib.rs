//! # zkpf-mina-rail
//!
//! Mina Recursive Rail for Tachyon tachystamp aggregation.
//!
//! This crate implements a Mina-based app-chain whose purpose is to:
//! 1. Ingest Tachyon tachystamps and nullifier shard proofs
//! 2. Recursively aggregate them into a single succinct proof of global correctness
//! 3. Produce one "Mina proof" per epoch that Zcash/Tachyon L1 can verify
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                           Tachyon L1 (Zcash)                                 │
//! │                                                                              │
//! │  Nullifier shards      Tachystamps        Balance proofs                     │
//! │       │                    │                   │                             │
//! └───────┼────────────────────┼───────────────────┼─────────────────────────────┘
//!         │                    │                   │
//!         ▼                    ▼                   ▼
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                        Mina Recursive Rail                                   │
//! │                                                                              │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                    Tachystamp Ingestion Layer                        │    │
//! │  │                                                                      │    │
//! │  │  • Receive tachystamps from Tachyon L1 via bridge                    │    │
//! │  │  • Validate format and extract nullifier/commitment data             │    │
//! │  │  • Queue for aggregation                                             │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                    Recursive Aggregation Layer                       │    │
//! │  │                                                                      │    │
//! │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │    │
//! │  │  │ Shard 0  │  │ Shard 1  │  │ Shard 2  │  │ Shard n  │             │    │
//! │  │  │  proof   │  │  proof   │  │  proof   │  │  proof   │             │    │
//! │  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘             │    │
//! │  │       │             │             │             │                    │    │
//! │  │       └──────┬──────┴──────┬──────┴──────┬──────┘                    │    │
//! │  │              ▼             ▼             ▼                           │    │
//! │  │         ┌─────────────────────────────────────┐                      │    │
//! │  │         │   Pickles IVC Aggregation Tree      │                      │    │
//! │  │         │   (Binary tree of proof folding)    │                      │    │
//! │  │         └─────────────────┬───────────────────┘                      │    │
//! │  │                           │                                          │    │
//! │  │                           ▼                                          │    │
//! │  │                  ┌─────────────────┐                                 │    │
//! │  │                  │   Epoch Proof   │                                 │    │
//! │  │                  │   (Single IVC)  │                                 │    │
//! │  │                  └─────────────────┘                                 │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! │                                    │                                         │
//! │                                    ▼                                         │
//! │  ┌─────────────────────────────────────────────────────────────────────┐    │
//! │  │                    State Publication Layer                           │    │
//! │  │                                                                      │    │
//! │  │  • Commit epoch proof to Mina state                                  │    │
//! │  │  • Publish nullifier set root                                        │    │
//! │  │  • Bridge epoch proof back to Tachyon L1                             │    │
//! │  └─────────────────────────────────────────────────────────────────────┘    │
//! └─────────────────────────────────────────────────────────────────────────────┘
//!                                      │
//!                                      ▼
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                           Tachyon L1 (Zcash)                                 │
//! │                                                                              │
//! │  Verify single Mina epoch proof instead of full local Ragu tree             │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Benefits
//!
//! 1. **Offloads PCD computation**: Mina's battle-tested recursion VM handles
//!    the expensive proof aggregation
//! 2. **Constant verification cost**: L1 only verifies one proof per epoch
//! 3. **Parallelizable**: Different shards can be aggregated in parallel
//! 4. **Incremental**: IVC allows adding proofs one at a time
//!
//! ## Epoch Flow
//!
//! 1. **Collect phase**: Tachystamps accumulate during epoch
//! 2. **Aggregate phase**: Recursive folding produces epoch proof
//! 3. **Publish phase**: Epoch proof committed to Mina state
//! 4. **Bridge phase**: Epoch proof bridged to Tachyon L1
//! 5. **Verify phase**: L1 verifies single epoch proof

pub mod aggregator;
pub mod bridge;
pub mod circuit;
pub mod ivc;
pub mod tachystamp;
pub mod types;

#[cfg(feature = "server")]
pub mod server;

pub use aggregator::{EpochAggregator, ShardAggregator};
pub use circuit::{TachystampCircuit, AggregationCircuit};
pub use ivc::{IVCProver, IVCVerifier, IVCAccumulator, IVCConfig, IVCError, aggregate_shard_proofs_ivc};
pub use tachystamp::{Tachystamp, NullifierShard, ShardProof};
pub use types::{EpochProof, EpochState, MinaRailConfig};
