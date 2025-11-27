//! Wallet State Machine with ZK Proofs
//!
//! This module implements an abstract wallet state machine where:
//! - `S`: Public commitment to wallet state (no secrets)
//! - `π`: ZK proof that `S` is consistent with previous state and block history
//!
//! # State Model
//!
//! The wallet state is represented as a compact, hash-based commitment:
//! ```text
//! WalletState = {
//!     height:          u64    - Last processed block height
//!     anchor:          Fr     - Orchard Merkle tree root (or accumulator root)
//!     notes_root:      Fr     - Commitment to unspent notes set
//!     nullifiers_root: Fr     - Commitment to spent nullifiers set
//!     version:         u32    - State version / circuit ID
//! }
//!
//! S = Poseidon(height || anchor || notes_root || nullifiers_root || version)
//! ```
//!
//! # State Transitions
//!
//! Per-block transitions update the state based on:
//! - New notes discovered for the wallet
//! - Nullifiers spent by the wallet
//! - New anchor after the block

pub mod circuit;
pub mod state;
pub mod transition;

pub use circuit::{WalletStateTransitionCircuit, WalletStateTransitionInput};
pub use state::{BlockDelta, WalletState, WalletStateCommitment, WALLET_STATE_VERSION};
pub use transition::{apply_transition, verify_transition_witness};

