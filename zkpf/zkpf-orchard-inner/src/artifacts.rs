//! zkpf-orchard-inner/artifacts
//!
//! This module intentionally remains **minimal**: the canonical bn256 proving and
//! verification artifacts for the Orchard rail live in
//! `zkpf-zcash-orchard-circuit`.  Callers that need params / vk / pk for the
//! outer circuit should depend on that crate directly.
//!
//! The inner Orchard circuit (over Pasta) may in the future define its own
//! artifact format here, but that will be expressed purely in terms of the
//! `OrchardPofProver` trait and `OrchardPofInput` data model, without
//! introducing a second bn256/KZG stack.
use serde::{Deserialize, Serialize};

/// Opaque serialized artifacts for a potential inner Orchard PoF circuit.
///
/// These bytes are **not** used by the current bn256 outer circuit; they are
/// reserved for a future implementation of the inner (Pasta) circuit that
/// implements `OrchardPofProver`.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OrchardInnerArtifacts {
    pub params: Vec<u8>,
    pub vk: Vec<u8>,
    pub pk: Vec<u8>,
}
