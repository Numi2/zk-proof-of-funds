use axum::{
    body::{self, Body},
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use tower::util::ServiceExt;
use zkpf_backend::{
    app_router, AppState, EpochConfig, NullifierStore, PolicyExpectations, PolicyStore,
};
use zkpf_common::ArtifactManifest;
use zkpf_test_fixtures::{fixtures, TestFixtures};

const BODY_LIMIT: usize = usize::MAX;

fn test_app() -> (axum::Router, ArtifactManifest) {
    let fixtures_ref = fixtures();
    let artifacts = fixtures_ref.artifacts();
    let manifest = artifacts.manifest.clone();
    let epoch = fixtures_ref.public_inputs().current_epoch;
    let policy_store = fixture_policy_store(fixtures_ref);
    let state = AppState::with_components(
        artifacts,
        EpochConfig::fixed(epoch),
        NullifierStore::in_memory(),
        policy_store,
    );
    (app_router(state), manifest)
}

fn fixture_policy(fixtures: &TestFixtures) -> PolicyExpectations {
    let public = fixtures.public_inputs();
    PolicyExpectations {
        threshold_raw: public.threshold_raw,
        required_currency_code: public.required_currency_code,
        required_custodian_id: public.required_custodian_id,
        verifier_scope_id: public.verifier_scope_id,
        policy_id: public.policy_id,
    }
}

fn fixture_policy_store(fixtures: &TestFixtures) -> PolicyStore {
    PolicyStore::from_policies(vec![fixture_policy(fixtures)])
}

#[tokio::test]
async fn params_endpoint_returns_manifest_metadata() {
    let (app, manifest) = test_app();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/zkpf/params")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("params response");

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .unwrap();
    let value: Value = serde_json::from_slice(&body_bytes).unwrap();

    assert_eq!(
        value["circuit_version"].as_u64().unwrap() as u32,
        manifest.circuit_version
    );
    assert_eq!(
        value["manifest_version"].as_u64().unwrap() as u32,
        manifest.manifest_version
    );
    assert_eq!(value["params_hash"], manifest.params.blake3);
    assert_eq!(value["vk_hash"], manifest.vk.blake3);
    assert_eq!(value["pk_hash"], manifest.pk.blake3);

    assert!(value["params"].as_array().is_some());
    assert!(value["vk"].as_array().is_some());
    assert!(value["pk"].as_array().is_some());
}

#[tokio::test]
async fn verify_endpoint_accepts_fixture_proof() {
    let fixtures = fixtures();
    let artifacts = fixtures.artifacts();
    let epoch = fixtures.public_inputs().current_epoch;
    let state = AppState::with_components(
        artifacts,
        EpochConfig::fixed(epoch),
        NullifierStore::in_memory(),
        fixture_policy_store(fixtures),
    );
    let app = app_router(state);
    let policy_id = fixtures.public_inputs().policy_id;

    let request_body = json!({
        "circuit_version": fixtures.bundle().circuit_version,
        "proof": fixtures.proof(),
        "public_inputs": fixtures.public_inputs_bytes(),
        "policy_id": policy_id,
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/zkpf/verify")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .expect("verify response");

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(payload["valid"], true);
    assert!(payload["error"].is_null());
}

#[tokio::test]
async fn verify_endpoint_rejects_replayed_nullifier() {
    let fixtures = fixtures();
    let artifacts = fixtures.artifacts();
    let epoch = fixtures.public_inputs().current_epoch;
    let state = AppState::with_components(
        artifacts,
        EpochConfig::fixed(epoch),
        NullifierStore::in_memory(),
        fixture_policy_store(fixtures),
    );
    let app = app_router(state);
    let policy_id = fixtures.public_inputs().policy_id;

    let request_body = json!({
        "circuit_version": fixtures.bundle().circuit_version,
        "proof": fixtures.proof(),
        "public_inputs": fixtures.public_inputs_bytes(),
        "policy_id": policy_id,
    });
    let body_bytes = serde_json::to_vec(&request_body).unwrap();

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/zkpf/verify")
                .header("content-type", "application/json")
                .body(Body::from(body_bytes.clone()))
                .unwrap(),
        )
        .await
        .expect("first verify");
    assert_eq!(first.status(), StatusCode::OK);
    let payload: Value =
        serde_json::from_slice(&body::to_bytes(first.into_body(), BODY_LIMIT).await.unwrap())
            .unwrap();
    assert_eq!(payload["valid"], true);

    let second = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/zkpf/verify")
                .header("content-type", "application/json")
                .body(Body::from(body_bytes))
                .unwrap(),
        )
        .await
        .expect("second verify");
    assert_eq!(second.status(), StatusCode::OK);
    let payload: Value = serde_json::from_slice(
        &body::to_bytes(second.into_body(), BODY_LIMIT)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(payload["valid"], false);
    assert_eq!(
        payload["error"].as_str(),
        Some("nullifier already spent for this scope/policy")
    );
}

#[tokio::test]
async fn verify_bundle_endpoint_accepts_fixture_bundle() {
    let fixtures = fixtures();
    let artifacts = fixtures.artifacts();
    let epoch = fixtures.public_inputs().current_epoch;
    let state = AppState::with_components(
        artifacts,
        EpochConfig::fixed(epoch),
        NullifierStore::in_memory(),
        fixture_policy_store(fixtures),
    );
    let app = app_router(state);
    let policy_id = fixtures.public_inputs().policy_id;

    let request_body = json!({
        "policy_id": policy_id,
        "bundle": fixtures.bundle(),
    });

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/zkpf/verify-bundle")
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&request_body).unwrap()))
                .unwrap(),
        )
        .await
        .expect("verify bundle");

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(payload["valid"], true);
    assert!(payload["error"].is_null());
}

#[tokio::test]
async fn epoch_endpoint_reports_server_epoch() {
    let fixtures = fixtures();
    let artifacts = fixtures.artifacts();
    let epoch = fixtures.public_inputs().current_epoch;
    let state = AppState::with_epoch_config(artifacts, EpochConfig::fixed(epoch));
    let app = app_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/zkpf/epoch")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("epoch response");

    assert_eq!(response.status(), StatusCode::OK);
    let body_bytes = body::to_bytes(response.into_body(), BODY_LIMIT)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(payload["current_epoch"].as_u64(), Some(epoch));
    assert_eq!(payload["max_drift_secs"].as_u64(), Some(0));
}
