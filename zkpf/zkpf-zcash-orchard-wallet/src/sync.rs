//! Real lightwalletd synchronization for Orchard wallet.
//!
//! This module provides actual lightwalletd gRPC synchronization to fetch:
//! - Orchard note commitment tree state
//! - Merkle paths (witnesses) for specific notes
//! - Current chain tip height
//!
//! # Usage
//!
//! Enable the `lightwalletd` feature to use this module:
//! ```toml
//! zkpf-zcash-orchard-wallet = { version = "0.1", features = ["lightwalletd"] }
//! ```

#[cfg(feature = "lightwalletd")]
pub mod lightwalletd_client;

#[cfg(feature = "lightwalletd")]
pub mod db;

#[cfg(feature = "lightwalletd")]
pub mod tree;

#[cfg(feature = "lightwalletd")]
pub use lightwalletd_client::{LightwalletdClient, SyncProgress, SyncResult};

#[cfg(feature = "lightwalletd")]
pub use db::WalletDb;

#[cfg(feature = "lightwalletd")]
pub use tree::OrchardTree;

