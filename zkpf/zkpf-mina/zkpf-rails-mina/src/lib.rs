//! zkpf-rails-mina library
//!
//! Axum-based HTTP service for Mina recursive proof-of-funds hub.

use std::env;

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use zkpf_common::ProofBundle;
use zkpf_mina::{
    create_attestation, prove_mina_recursive, verify_mina_proof, AttestationQuery,
    AttestationQueryResponse, HolderId, MinaAttestation, MinaPublicMeta, MinaRailError,
    PublicMetaInputs, SourceProofInput, RAIL_ID_MINA,
    // Mina Proof of State types
    MinaProofOfStatePublicInputs, CANDIDATE_CHAIN_LENGTH,
    verify_proof_of_state_binding, create_proof_of_state_bundle, verify_proof_of_state_bundle,
    // Starknet integration types
    wrap_starknet_proof, wrap_starknet_proofs, validate_starknet_bundle,
    CrossChainAttestationInfo, StarknetChainId, StarknetProofMetadata, StarknetWrapConfig,
};

// Environment variables
const MINA_NETWORK_ENV: &str = "ZKPF_MINA_NETWORK";
const MINA_GRAPHQL_ENV: &str = "ZKPF_MINA_GRAPHQL_URL";
const MINA_ZKAPP_ENV: &str = "ZKPF_MINA_ZKAPP_ADDRESS";
const DEFAULT_NETWORK: &str = "testnet";

/// Application state
#[derive(Clone)]
pub struct AppState {
    pub network: String,
    pub network_id_numeric: u32,
    pub graphql_url: Option<String>,
    pub zkapp_address: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        let network = env::var(MINA_NETWORK_ENV).unwrap_or_else(|_| DEFAULT_NETWORK.to_string());
        let network_id_numeric = match network.as_str() {
            "mainnet" => 0,
            "testnet" => 1,
            "berkeley" => 2,
            _ => 3,
        };
        let graphql_url = env::var(MINA_GRAPHQL_ENV).ok();
        let zkapp_address = env::var(MINA_ZKAPP_ENV).ok();

        Self {
            network,
            network_id_numeric,
            graphql_url,
            zkapp_address,
        }
    }
}

/// Build the router.
pub fn app_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState::default();

    Router::new()
        .route("/health", get(health))
        .route("/rails/mina/info", get(info))
        .route("/rails/mina/wrap-proofs", post(wrap_proofs))
        .route("/rails/mina/verify", post(verify_proof))
        .route("/rails/mina/submit-attestation", post(submit_attestation))
        .route("/rails/mina/query-attestation", post(query_attestation))
        .route("/rails/mina/bridge-message", post(create_bridge_message))
        // Starknet → Mina integration endpoints
        .route("/rails/mina/starknet/wrap", post(wrap_starknet))
        .route("/rails/mina/starknet/wrap-batch", post(wrap_starknet_batch))
        .route("/rails/mina/starknet/validate", post(validate_starknet))
        // Mina Proof of State endpoints (lambdaclass/mina_bridge integration)
        .route("/rails/mina/proof-of-state/verify", post(verify_proof_of_state))
        .route("/rails/mina/proof-of-state/create-bundle", post(create_pos_bundle))
        .route("/rails/mina/proof-of-state/verify-bundle", post(verify_pos_bundle))
        .layer(cors)
        .with_state(state)
}

/// Health check endpoint.
async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "rail_id": RAIL_ID_MINA
    }))
}

/// Rail info endpoint.
async fn info(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "rail_id": RAIL_ID_MINA,
        "network": state.network,
        "network_id_numeric": state.network_id_numeric,
        "graphql_configured": state.graphql_url.is_some(),
        "zkapp_address": state.zkapp_address,
        "features": {
            "recursive_proofs": true,
            "cross_chain_attestations": true,
            "multi_rail_aggregation": true,
            "zk_bridges": true,
            "max_source_proofs": zkpf_mina::MINA_MAX_SOURCE_PROOFS
        },
        "integrations": {
            "starknet": {
                "enabled": true,
                "supported_chains": ["SN_MAIN", "SN_SEPOLIA"],
                "endpoints": {
                    "wrap": "/rails/mina/starknet/wrap",
                    "wrap_batch": "/rails/mina/starknet/wrap-batch",
                    "validate": "/rails/mina/starknet/validate"
                }
            }
        }
    }))
}

/// Wrap proofs request - wraps source proofs into Mina recursive proof.
#[derive(Debug, Deserialize)]
pub struct WrapProofsRequest {
    /// Holder identifier.
    pub holder_id: HolderId,
    /// Policy ID to use.
    pub policy_id: u64,
    /// Verifier scope ID.
    pub verifier_scope_id: u64,
    /// Current epoch (Unix timestamp).
    pub current_epoch: u64,
    /// Currency code.
    pub currency_code: u32,
    /// Mina global slot.
    pub mina_slot: u64,
    /// zkApp address (optional, uses configured default).
    pub zkapp_address: Option<String>,
    /// Source proofs to wrap.
    pub source_proofs: Vec<SourceProofInput>,
}

/// Wrap proofs response.
#[derive(Debug, Serialize)]
pub struct WrapProofsResponse {
    pub success: bool,
    pub bundle: Option<ProofBundle>,
    pub attestation: Option<MinaAttestation>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Wrap source proofs into a Mina recursive proof.
async fn wrap_proofs(
    State(state): State<AppState>,
    Json(req): Json<WrapProofsRequest>,
) -> Result<Json<WrapProofsResponse>, ApiError> {
    // Build metadata
    let zkapp_address = req
        .zkapp_address
        .or(state.zkapp_address.clone())
        .unwrap_or_default();

    let mina_meta = MinaPublicMeta {
        network_id: state.network.clone(),
        network_id_numeric: state.network_id_numeric,
        global_slot: req.mina_slot,
        zkapp_address,
        recursive_proof_commitment: [0u8; 32], // Computed by prove_mina_recursive
        source_rail_ids: vec![],               // Computed by prove_mina_recursive
    };

    let public_meta = PublicMetaInputs {
        policy_id: req.policy_id,
        verifier_scope_id: req.verifier_scope_id,
        current_epoch: req.current_epoch,
        required_currency_code: req.currency_code,
    };

    // Generate recursive proof
    match prove_mina_recursive(&req.source_proofs, &req.holder_id, &mina_meta, &public_meta) {
        Ok(bundle) => {
            // Create attestation record
            let attestation = create_attestation(&bundle, &mina_meta, 7200).ok();

            Ok(Json(WrapProofsResponse {
                success: true,
                bundle: Some(bundle),
                attestation,
                error: None,
                error_code: None,
            }))
        }
        Err(e) => Ok(Json(WrapProofsResponse {
            success: false,
            bundle: None,
            attestation: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Verify proof request.
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub bundle: ProofBundle,
}

/// Verify proof response.
#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Verify a Mina recursive proof.
async fn verify_proof(
    State(_state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    match verify_mina_proof(&req.bundle) {
        Ok(valid) => Ok(Json(VerifyResponse {
            valid,
            error: None,
            error_code: None,
        })),
        Err(e) => Ok(Json(VerifyResponse {
            valid: false,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Submit attestation request.
#[derive(Debug, Deserialize)]
pub struct SubmitAttestationRequest {
    pub bundle: ProofBundle,
    pub mina_slot: u64,
    pub validity_window_slots: Option<u64>,
}

/// Submit attestation response.
#[derive(Debug, Serialize)]
pub struct SubmitAttestationResponse {
    pub success: bool,
    pub attestation: Option<MinaAttestation>,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Submit an attestation to the zkApp.
async fn submit_attestation(
    State(state): State<AppState>,
    Json(req): Json<SubmitAttestationRequest>,
) -> Result<Json<SubmitAttestationResponse>, ApiError> {
    let validity_window = req.validity_window_slots.unwrap_or(7200);

    let mina_meta = MinaPublicMeta {
        network_id: state.network.clone(),
        network_id_numeric: state.network_id_numeric,
        global_slot: req.mina_slot,
        zkapp_address: state.zkapp_address.unwrap_or_default(),
        recursive_proof_commitment: [0u8; 32],
        source_rail_ids: vec![],
    };

    match create_attestation(&req.bundle, &mina_meta, validity_window) {
        Ok(attestation) => {
            // In a real implementation, this would submit to the zkApp
            // For now, we just return the attestation
            Ok(Json(SubmitAttestationResponse {
                success: true,
                attestation: Some(attestation),
                tx_hash: None, // Would be populated after zkApp submission
                error: None,
                error_code: None,
            }))
        }
        Err(e) => Ok(Json(SubmitAttestationResponse {
            success: false,
            attestation: None,
            tx_hash: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Query attestation endpoint.
async fn query_attestation(
    State(_state): State<AppState>,
    Json(_req): Json<AttestationQuery>,
) -> Result<Json<AttestationQueryResponse>, ApiError> {
    // In a real implementation, this would query the zkApp state
    // For now, we return a placeholder response
    Ok(Json(AttestationQueryResponse {
        has_valid_attestation: false,
        attestation: None,
        mina_slot: 0,
        proof_of_inclusion: None,
    }))
}

/// Bridge message request.
#[derive(Debug, Deserialize)]
pub struct BridgeMessageRequest {
    pub holder_binding: String, // hex-encoded
    pub policy_id: u64,
    pub epoch: u64,
    pub target_chain: String,
}

/// Bridge message response.
#[derive(Debug, Serialize)]
pub struct BridgeMessageResponse {
    pub success: bool,
    pub message: Option<zkpf_mina::types::BridgeMessage>,
    pub encoded_message: Option<String>, // For use in target chain
    pub error: Option<String>,
}

/// Create a bridge message for cross-chain attestation.
async fn create_bridge_message(
    State(_state): State<AppState>,
    Json(req): Json<BridgeMessageRequest>,
) -> Result<Json<BridgeMessageResponse>, ApiError> {
    // Parse holder binding
    let holder_binding_bytes = hex::decode(&req.holder_binding)
        .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "invalid holder_binding hex"))?;

    if holder_binding_bytes.len() != 32 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "holder_binding must be 32 bytes",
        ));
    }

    let mut holder_binding = [0u8; 32];
    holder_binding.copy_from_slice(&holder_binding_bytes);

    // Create bridge message
    let message = zkpf_mina::types::BridgeMessage {
        source_chain: "mina".to_string(),
        target_chain: req.target_chain,
        message_type: zkpf_mina::types::BridgeMessageType::AttestationResult,
        holder_binding,
        policy_id: req.policy_id,
        epoch: req.epoch,
        has_pof: false, // Would be populated from zkApp state query
        mina_slot: 0,   // Would be current slot
        merkle_proof: vec![],
        state_root: [0u8; 32],
    };

    // Encode message for target chain
    let encoded = serde_json::to_string(&message)
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    Ok(Json(BridgeMessageResponse {
        success: true,
        message: Some(message),
        encoded_message: Some(encoded),
        error: None,
    }))
}

// ============================================================================
// Starknet → Mina Integration Endpoints
// ============================================================================

/// Request for wrapping a single Starknet proof into Mina.
#[derive(Debug, Serialize, Deserialize)]
pub struct WrapStarknetRequest {
    /// The Starknet proof bundle to wrap.
    pub starknet_bundle: zkpf_common::ProofBundle,
    /// Holder identifier (must match Starknet proof holder).
    pub holder_id: String,
    /// Current Mina global slot.
    pub mina_slot: u64,
    /// Optional zkApp address (uses default if not specified).
    pub zkapp_address: Option<String>,
    /// Starknet chain ID (e.g., "SN_MAIN", "SN_SEPOLIA").
    pub chain_id: Option<String>,
    /// Attestation validity window in Mina slots (default: 7200).
    pub validity_window_slots: Option<u64>,
}

/// Response for Starknet wrapping.
#[derive(Debug, Serialize, Deserialize)]
pub struct WrapStarknetResponse {
    pub success: bool,
    pub bundle: Option<zkpf_common::ProofBundle>,
    pub starknet_metadata: Option<StarknetProofMetadata>,
    pub attestation_info: Option<CrossChainAttestationInfo>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Wrap a single Starknet proof into a Mina recursive proof.
async fn wrap_starknet(
    State(state): State<AppState>,
    Json(req): Json<WrapStarknetRequest>,
) -> Result<Json<WrapStarknetResponse>, ApiError> {
    // Validate the Starknet bundle first
    if let Err(e) = validate_starknet_bundle(&req.starknet_bundle) {
        return Ok(Json(WrapStarknetResponse {
            success: false,
            bundle: None,
            starknet_metadata: None,
            attestation_info: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        }));
    }

    // Parse chain_id if provided
    let chain_id = req.chain_id.as_ref().and_then(|s| StarknetChainId::from_str(s));

    // Build wrap configuration
    let config = StarknetWrapConfig {
        holder_id: req.holder_id,
        mina_slot: req.mina_slot,
        zkapp_address: req.zkapp_address.or(state.zkapp_address.clone()),
        chain_id,
        validity_window_slots: req.validity_window_slots,
    };

    // Perform wrapping
    match wrap_starknet_proof(req.starknet_bundle, config) {
        Ok(result) => Ok(Json(WrapStarknetResponse {
            success: true,
            bundle: Some(result.bundle),
            starknet_metadata: Some(result.starknet_metadata),
            attestation_info: Some(result.attestation_info),
            error: None,
            error_code: None,
        })),
        Err(e) => Ok(Json(WrapStarknetResponse {
            success: false,
            bundle: None,
            starknet_metadata: None,
            attestation_info: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Request for wrapping multiple Starknet proofs into Mina.
#[derive(Debug, Serialize, Deserialize)]
pub struct WrapStarknetBatchRequest {
    /// The Starknet proof bundles to wrap.
    pub starknet_bundles: Vec<zkpf_common::ProofBundle>,
    /// Holder identifier (must match Starknet proof holder).
    pub holder_id: String,
    /// Current Mina global slot.
    pub mina_slot: u64,
    /// Optional zkApp address.
    pub zkapp_address: Option<String>,
    /// Starknet chain ID.
    pub chain_id: Option<String>,
    /// Attestation validity window in Mina slots.
    pub validity_window_slots: Option<u64>,
}

/// Wrap multiple Starknet proofs into a single Mina recursive proof.
async fn wrap_starknet_batch(
    State(state): State<AppState>,
    Json(req): Json<WrapStarknetBatchRequest>,
) -> Result<Json<WrapStarknetResponse>, ApiError> {
    if req.starknet_bundles.is_empty() {
        return Ok(Json(WrapStarknetResponse {
            success: false,
            bundle: None,
            starknet_metadata: None,
            attestation_info: None,
            error: Some("at least one Starknet bundle is required".to_string()),
            error_code: Some("INVALID_INPUT".to_string()),
        }));
    }

    // Validate all bundles
    for (idx, bundle) in req.starknet_bundles.iter().enumerate() {
        if let Err(e) = validate_starknet_bundle(bundle) {
            return Ok(Json(WrapStarknetResponse {
                success: false,
                bundle: None,
                starknet_metadata: None,
                attestation_info: None,
                error: Some(format!("bundle[{}] validation failed: {}", idx, e)),
                error_code: Some(error_code(&e)),
            }));
        }
    }

    // Parse chain_id
    let chain_id = req.chain_id.as_ref().and_then(|s| StarknetChainId::from_str(s));

    // Build wrap configuration
    let config = StarknetWrapConfig {
        holder_id: req.holder_id,
        mina_slot: req.mina_slot,
        zkapp_address: req.zkapp_address.or(state.zkapp_address.clone()),
        chain_id,
        validity_window_slots: req.validity_window_slots,
    };

    // Perform batch wrapping
    match wrap_starknet_proofs(req.starknet_bundles, config) {
        Ok(result) => Ok(Json(WrapStarknetResponse {
            success: true,
            bundle: Some(result.bundle),
            starknet_metadata: Some(result.starknet_metadata),
            attestation_info: Some(result.attestation_info),
            error: None,
            error_code: None,
        })),
        Err(e) => Ok(Json(WrapStarknetResponse {
            success: false,
            bundle: None,
            starknet_metadata: None,
            attestation_info: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Request for validating a Starknet bundle (without wrapping).
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateStarknetRequest {
    /// The Starknet proof bundle to validate.
    pub starknet_bundle: zkpf_common::ProofBundle,
}

/// Response for Starknet validation.
#[derive(Debug, Serialize, Deserialize)]
pub struct ValidateStarknetResponse {
    pub valid: bool,
    pub metadata: Option<StarknetProofMetadata>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Validate a Starknet bundle (check if it can be wrapped).
async fn validate_starknet(
    State(_state): State<AppState>,
    Json(req): Json<ValidateStarknetRequest>,
) -> Result<Json<ValidateStarknetResponse>, ApiError> {
    // Validate the bundle
    if let Err(e) = validate_starknet_bundle(&req.starknet_bundle) {
        return Ok(Json(ValidateStarknetResponse {
            valid: false,
            metadata: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        }));
    }

    // Extract metadata
    match StarknetProofMetadata::from_bundle(&req.starknet_bundle) {
        Ok(metadata) => Ok(Json(ValidateStarknetResponse {
            valid: true,
            metadata: Some(metadata),
            error: None,
            error_code: None,
        })),
        Err(e) => Ok(Json(ValidateStarknetResponse {
            valid: false,
            metadata: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// API error type.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, message: &str) -> Self {
        Self {
            status,
            message: message.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({
            "error": self.message,
        });
        (self.status, Json(body)).into_response()
    }
}

impl From<MinaRailError> for ApiError {
    fn from(err: MinaRailError) -> Self {
        ApiError {
            status: StatusCode::BAD_REQUEST,
            message: err.to_string(),
        }
    }
}

fn error_code(err: &MinaRailError) -> String {
    match err {
        MinaRailError::GraphQL(_) => "GRAPHQL_ERROR".into(),
        MinaRailError::InvalidInput(_) => "INVALID_INPUT".into(),
        MinaRailError::Proof(_) => "PROOF_ERROR".into(),
        MinaRailError::State(_) => "STATE_ERROR".into(),
        MinaRailError::ZkApp(_) => "ZKAPP_ERROR".into(),
        MinaRailError::Network(_) => "NETWORK_ERROR".into(),
        MinaRailError::Bridge(_) => "BRIDGE_ERROR".into(),
        MinaRailError::NotImplemented(_) => "NOT_IMPLEMENTED".into(),
    }
}

// ============================================================================
// Mina Proof of State Endpoints (lambdaclass/mina_bridge integration)
// ============================================================================

/// Request for verifying Mina Proof of State binding.
#[derive(Debug, Deserialize)]
pub struct VerifyProofOfStateRequest {
    /// Bridge tip state hash.
    pub bridge_tip_state_hash: String, // hex-encoded
    /// Candidate chain state hashes (16).
    pub candidate_chain_state_hashes: Vec<String>, // hex-encoded
    /// Candidate chain ledger hashes (16).
    pub candidate_chain_ledger_hashes: Vec<String>, // hex-encoded
    /// Holder identifier.
    pub holder_id: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Current epoch.
    pub current_epoch: u64,
    /// Verifier scope ID.
    pub verifier_scope_id: u64,
}

/// Response for Mina Proof of State verification.
#[derive(Debug, Serialize)]
pub struct VerifyProofOfStateResponse {
    pub success: bool,
    pub mina_digest: Option<String>, // hex-encoded
    pub holder_binding: Option<String>, // hex-encoded
    pub nullifier: Option<String>, // hex-encoded
    pub error: Option<String>,
}

/// Verify Mina Proof of State binding.
async fn verify_proof_of_state(
    State(_state): State<AppState>,
    Json(req): Json<VerifyProofOfStateRequest>,
) -> Result<Json<VerifyProofOfStateResponse>, ApiError> {
    // Parse and validate inputs
    let public_inputs = match parse_proof_of_state_inputs(&req) {
        Ok(inputs) => inputs,
        Err(e) => {
            return Ok(Json(VerifyProofOfStateResponse {
                success: false,
                mina_digest: None,
                holder_binding: None,
                nullifier: None,
                error: Some(e),
            }));
        }
    };

    // Verify binding
    match verify_proof_of_state_binding(
        &public_inputs,
        &req.holder_id,
        req.policy_id,
        req.current_epoch,
        req.verifier_scope_id,
    ) {
        Ok(rail_inputs) => {
            let nullifier = rail_inputs.compute_nullifier();
            Ok(Json(VerifyProofOfStateResponse {
                success: true,
                mina_digest: Some(hex::encode(rail_inputs.mina_digest)),
                holder_binding: Some(hex::encode(rail_inputs.holder_binding)),
                nullifier: Some(hex::encode(nullifier)),
                error: None,
            }))
        }
        Err(e) => Ok(Json(VerifyProofOfStateResponse {
            success: false,
            mina_digest: None,
            holder_binding: None,
            nullifier: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Request for creating a Proof of State bundle.
#[derive(Debug, Deserialize)]
pub struct CreatePoSBundleRequest {
    /// Bridge tip state hash.
    pub bridge_tip_state_hash: String,
    /// Candidate chain state hashes (16).
    pub candidate_chain_state_hashes: Vec<String>,
    /// Candidate chain ledger hashes (16).
    pub candidate_chain_ledger_hashes: Vec<String>,
    /// Holder identifier.
    pub holder_id: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Verifier scope ID.
    pub verifier_scope_id: u64,
    /// Current epoch.
    pub current_epoch: u64,
    /// Currency code.
    pub currency_code: u32,
    /// Mina global slot.
    pub mina_slot: u64,
}

/// Response for creating a Proof of State bundle.
#[derive(Debug, Serialize)]
pub struct CreatePoSBundleResponse {
    pub success: bool,
    pub bundle: Option<zkpf_common::ProofBundle>,
    pub mina_digest: Option<String>,
    pub error: Option<String>,
}

/// Create a zkpf ProofBundle from Mina Proof of State.
async fn create_pos_bundle(
    State(state): State<AppState>,
    Json(req): Json<CreatePoSBundleRequest>,
) -> Result<Json<CreatePoSBundleResponse>, ApiError> {
    // Parse inputs
    let public_inputs = match parse_proof_of_state_inputs_from_bundle_req(&req) {
        Ok(inputs) => inputs,
        Err(e) => {
            return Ok(Json(CreatePoSBundleResponse {
                success: false,
                bundle: None,
                mina_digest: None,
                error: Some(e),
            }));
        }
    };

    // Build metadata
    let meta = PublicMetaInputs {
        policy_id: req.policy_id,
        verifier_scope_id: req.verifier_scope_id,
        current_epoch: req.current_epoch,
        required_currency_code: req.currency_code,
    };

    let mina_meta = MinaPublicMeta {
        network_id: state.network.clone(),
        network_id_numeric: state.network_id_numeric,
        global_slot: req.mina_slot,
        zkapp_address: state.zkapp_address.unwrap_or_default(),
        recursive_proof_commitment: [0u8; 32],
        source_rail_ids: vec![],
    };

    // Create bundle
    match create_proof_of_state_bundle(&public_inputs, &req.holder_id, &meta, &mina_meta) {
        Ok(bundle) => {
            let mina_digest = public_inputs.compute_digest();
            Ok(Json(CreatePoSBundleResponse {
                success: true,
                bundle: Some(bundle),
                mina_digest: Some(hex::encode(mina_digest)),
                error: None,
            }))
        }
        Err(e) => Ok(Json(CreatePoSBundleResponse {
            success: false,
            bundle: None,
            mina_digest: None,
            error: Some(e.to_string()),
        })),
    }
}

/// Request for verifying a Proof of State bundle.
#[derive(Debug, Deserialize)]
pub struct VerifyPoSBundleRequest {
    pub bundle: zkpf_common::ProofBundle,
}

/// Response for verifying a Proof of State bundle.
#[derive(Debug, Serialize)]
pub struct VerifyPoSBundleResponse {
    pub valid: bool,
    pub mina_digest: Option<String>,
    pub holder_binding: Option<String>,
    pub error: Option<String>,
}

/// Verify a Mina Proof of State bundle.
async fn verify_pos_bundle(
    State(_state): State<AppState>,
    Json(req): Json<VerifyPoSBundleRequest>,
) -> Result<Json<VerifyPoSBundleResponse>, ApiError> {
    match verify_proof_of_state_bundle(&req.bundle) {
        Ok(valid) => {
            let mina_digest = req.bundle.public_inputs.snapshot_anchor_orchard
                .map(hex::encode);
            let holder_binding = req.bundle.public_inputs.holder_binding
                .map(hex::encode);

            Ok(Json(VerifyPoSBundleResponse {
                valid,
                mina_digest,
                holder_binding,
                error: None,
            }))
        }
        Err(e) => Ok(Json(VerifyPoSBundleResponse {
            valid: false,
            mina_digest: None,
            holder_binding: None,
            error: Some(e.to_string()),
        })),
    }
}

// === Helper functions for parsing ===

fn parse_proof_of_state_inputs(
    req: &VerifyProofOfStateRequest,
) -> Result<MinaProofOfStatePublicInputs, String> {
    // Parse bridge tip
    let bridge_tip = parse_hex_32(&req.bridge_tip_state_hash)
        .map_err(|e| format!("invalid bridge_tip_state_hash: {}", e))?;

    // Parse state hashes
    if req.candidate_chain_state_hashes.len() != CANDIDATE_CHAIN_LENGTH {
        return Err(format!(
            "expected {} candidate_chain_state_hashes, got {}",
            CANDIDATE_CHAIN_LENGTH,
            req.candidate_chain_state_hashes.len()
        ));
    }

    let mut state_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
    for (i, hash) in req.candidate_chain_state_hashes.iter().enumerate() {
        state_hashes[i] = parse_hex_32(hash)
            .map_err(|e| format!("invalid candidate_chain_state_hashes[{}]: {}", i, e))?;
    }

    // Parse ledger hashes
    if req.candidate_chain_ledger_hashes.len() != CANDIDATE_CHAIN_LENGTH {
        return Err(format!(
            "expected {} candidate_chain_ledger_hashes, got {}",
            CANDIDATE_CHAIN_LENGTH,
            req.candidate_chain_ledger_hashes.len()
        ));
    }

    let mut ledger_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
    for (i, hash) in req.candidate_chain_ledger_hashes.iter().enumerate() {
        ledger_hashes[i] = parse_hex_32(hash)
            .map_err(|e| format!("invalid candidate_chain_ledger_hashes[{}]: {}", i, e))?;
    }

    Ok(MinaProofOfStatePublicInputs {
        bridge_tip_state_hash: bridge_tip,
        candidate_chain_state_hashes: state_hashes,
        candidate_chain_ledger_hashes: ledger_hashes,
    })
}

fn parse_proof_of_state_inputs_from_bundle_req(
    req: &CreatePoSBundleRequest,
) -> Result<MinaProofOfStatePublicInputs, String> {
    // Parse bridge tip
    let bridge_tip = parse_hex_32(&req.bridge_tip_state_hash)
        .map_err(|e| format!("invalid bridge_tip_state_hash: {}", e))?;

    // Parse state hashes
    if req.candidate_chain_state_hashes.len() != CANDIDATE_CHAIN_LENGTH {
        return Err(format!(
            "expected {} candidate_chain_state_hashes, got {}",
            CANDIDATE_CHAIN_LENGTH,
            req.candidate_chain_state_hashes.len()
        ));
    }

    let mut state_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
    for (i, hash) in req.candidate_chain_state_hashes.iter().enumerate() {
        state_hashes[i] = parse_hex_32(hash)
            .map_err(|e| format!("invalid candidate_chain_state_hashes[{}]: {}", i, e))?;
    }

    // Parse ledger hashes
    if req.candidate_chain_ledger_hashes.len() != CANDIDATE_CHAIN_LENGTH {
        return Err(format!(
            "expected {} candidate_chain_ledger_hashes, got {}",
            CANDIDATE_CHAIN_LENGTH,
            req.candidate_chain_ledger_hashes.len()
        ));
    }

    let mut ledger_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
    for (i, hash) in req.candidate_chain_ledger_hashes.iter().enumerate() {
        ledger_hashes[i] = parse_hex_32(hash)
            .map_err(|e| format!("invalid candidate_chain_ledger_hashes[{}]: {}", i, e))?;
    }

    Ok(MinaProofOfStatePublicInputs {
        bridge_tip_state_hash: bridge_tip,
        candidate_chain_state_hashes: state_hashes,
        candidate_chain_ledger_hashes: ledger_hashes,
    })
}

fn parse_hex_32(s: &str) -> Result<[u8; 32], String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s).map_err(|e| e.to_string())?;
    if bytes.len() != 32 {
        return Err(format!("expected 32 bytes, got {}", bytes.len()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

