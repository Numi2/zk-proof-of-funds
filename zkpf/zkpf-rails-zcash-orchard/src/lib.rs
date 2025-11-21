//! zkpf-rails-zcash-orchard
//!
//! HTTP rail service that turns Orchard FVK + threshold + snapshot height into a `ProofBundle`.
//! This crate is intentionally light: it validates input, calls the Orchard wallet snapshot
//! builder, derives public meta inputs, and then calls the Orchard rail circuit wrapper.
//!
//! The current implementation wires all the types and error handling but returns an error
//! from `prove_orchard_pof` until the circuit is implemented.

use axum::{routing::post, Json, Router};
use serde::Deserialize;
use thiserror::Error;
use zkpf_common::ProofBundle;
use zkpf_zcash_orchard_circuit::{
    prove_orchard_pof, OrchardPublicMeta, OrchardRailError, PublicMetaInputs, RAIL_ID_ZCASH_ORCHARD,
};
use zkpf_zcash_orchard_wallet::{build_snapshot_for_fvk, OrchardFvk};

/// Request body for the Orchard rail proof-of-funds API.
#[derive(Debug, Deserialize)]
pub struct OrchardProofOfFundsRequest {
    pub holder_id: String,
    pub fvk: String,
    pub threshold_zats: u64,
    pub snapshot_height: u32,
    pub policy_id: u64,
    pub scope_id: u64,
    pub epoch: u64,
    /// Numeric code used by the global zkpf policy catalog to represent ZEC.
    pub currency_code_zec: u32,
}

/// Response body: the standard zkpf `ProofBundle`.
pub type OrchardProofOfFundsResponse = ProofBundle;

/// Errors surfaced by the Orchard rail HTTP API.
#[derive(Debug, Error)]
pub enum RailApiError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl From<OrchardRailError> for RailApiError {
    fn from(err: OrchardRailError) -> Self {
        match err {
            OrchardRailError::InvalidInput(msg) | OrchardRailError::Wallet(msg) => {
                RailApiError::BadRequest(msg)
            }
            OrchardRailError::NotImplemented => {
                RailApiError::Internal("Orchard rail circuit not implemented".into())
            }
        }
    }
}

#[derive(serde::Serialize)]
struct ErrorBody {
    error: String,
}

impl axum::response::IntoResponse for RailApiError {
    fn into_response(self) -> axum::response::Response {
        use axum::http::StatusCode;
        let status = match self {
            RailApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            RailApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = ErrorBody {
            error: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}

/// Build the router exposing the Orchard rail API.
pub fn router() -> Router {
    Router::new().route(
        "/rails/zcash-orchard/proof-of-funds",
        post(proof_of_funds_handler),
    )
}

async fn proof_of_funds_handler(
    Json(req): Json<OrchardProofOfFundsRequest>,
) -> Result<Json<OrchardProofOfFundsResponse>, RailApiError> {
    if req.threshold_zats == 0 {
        return Err(RailApiError::BadRequest(
            "threshold_zats must be > 0".into(),
        ));
    }

    // Treat the FVK as opaque and never log it.
    let fvk = OrchardFvk {
        encoded: req.fvk.clone(),
    };

    let snapshot = build_snapshot_for_fvk(&fvk, req.snapshot_height)?;

    let orchard_meta = OrchardPublicMeta {
        chain_id: "ZEC".to_string(),
        pool_id: "ORCHARD".to_string(),
        block_height: snapshot.height,
        anchor_orchard: snapshot.anchor,
        holder_binding: [0u8; 32], // TODO: H(holder_id || fvk_bytes) in real impl
    };

    let public_meta = PublicMetaInputs {
        policy_id: req.policy_id,
        verifier_scope_id: req.scope_id,
        current_epoch: req.epoch,
        required_currency_code: req.currency_code_zec,
    };

    let bundle = prove_orchard_pof(
        &snapshot,
        &fvk,
        &req.holder_id,
        req.threshold_zats,
        &orchard_meta,
        &public_meta,
    )?;

    // In a multi-rail verifier, this rail_id would be propagated alongside the bundle.
    let _ = RAIL_ID_ZCASH_ORCHARD;

    Ok(Json(bundle))
}


