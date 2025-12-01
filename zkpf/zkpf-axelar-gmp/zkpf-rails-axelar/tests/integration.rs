//! Integration tests for the Axelar Cross-Chain Private Credit Rail
//!
//! These tests verify the end-to-end flow of:
//! 1. Issuing ZEC credentials
//! 2. Broadcasting credentials to multiple chains
//! 3. Querying credential status
//! 4. Revoking credentials
//! 5. Credit line calculations

use axum_test::TestServer;
use serde_json::json;
use zkpf_rails_axelar::app_router;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

fn create_test_server() -> TestServer {
    TestServer::new(app_router()).unwrap()
}

fn random_hex32() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("0x{:064x}", seed)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH & INFO TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_health_endpoint() {
    let server = create_test_server();

    let response = server.get("/health").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["rail_id"], "AXELAR_GMP");
}

#[tokio::test]
async fn test_info_endpoint() {
    let server = create_test_server();

    let response = server.get("/rails/axelar/info").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["rail_id"], "AXELAR_GMP");
    assert!(body["features"]["gmp_broadcast"].as_bool().unwrap());
    assert!(body["features"]["evm_support"].as_bool().unwrap());
    assert!(body["features"]["cosmos_support"].as_bool().unwrap());
}

#[tokio::test]
async fn test_supported_chains() {
    let server = create_test_server();

    let response = server.get("/rails/axelar/chains/supported").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    let evm_chains = body["evm_chains"].as_array().unwrap();
    let cosmos_chains = body["cosmos_chains"].as_array().unwrap();

    assert!(!evm_chains.is_empty());
    assert!(!cosmos_chains.is_empty());

    // Check ethereum is in EVM chains
    assert!(evm_chains.iter().any(|c| c["name"] == "ethereum"));

    // Check osmosis is in Cosmos chains
    assert!(cosmos_chains.iter().any(|c| c["name"] == "osmosis"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN SUBSCRIPTION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_subscribe_and_unsubscribe_chain() {
    let server = create_test_server();

    // Subscribe to a chain
    let response = server
        .post("/rails/axelar/subscribe")
        .json(&json!({
            "chain_name": "arbitrum",
            "receiver_contract": "0x1234567890abcdef1234567890abcdef12345678"
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["success"].as_bool().unwrap());
    assert_eq!(body["chain_name"], "arbitrum");

    // Check subscriptions
    let response = server.get("/rails/axelar/subscriptions").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["active"], 1);

    // Unsubscribe
    let response = server
        .post("/rails/axelar/unsubscribe")
        .json(&json!({"chain_name": "arbitrum"}))
        .await;
    response.assert_status_ok();

    // Check subscriptions again
    let response = server.get("/rails/axelar/subscriptions").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["active"], 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZEC TIER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_list_tiers() {
    let server = create_test_server();

    let response = server.get("/rails/axelar/zec/tiers").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    let tiers = body["tiers"].as_array().unwrap();

    assert_eq!(tiers.len(), 6);

    // Check tier values
    assert_eq!(tiers[0]["value"], 0);
    assert_eq!(tiers[0]["name"], "0.1+ ZEC");
    assert_eq!(tiers[0]["threshold_zec"], 0.1);

    assert_eq!(tiers[2]["value"], 2);
    assert_eq!(tiers[2]["name"], "10+ ZEC");
    assert_eq!(tiers[2]["threshold_zec"], 10.0);

    assert_eq!(tiers[4]["value"], 4);
    assert_eq!(tiers[4]["name"], "1000+ ZEC");
    assert_eq!(tiers[4]["threshold_zec"], 1000.0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL ISSUANCE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_issue_zec_credential() {
    let server = create_test_server();

    let account_tag = random_hex32();
    let state_root = random_hex32();
    let proof_commitment = random_hex32();
    let attestation_hash = random_hex32();

    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": account_tag,
            "tier": 3, // TIER_100 (100+ ZEC)
            "state_root": state_root,
            "block_height": 2000000,
            "proof_commitment": proof_commitment,
            "attestation_hash": attestation_hash,
            "validity_window": 3600 // 1 hour
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["success"].as_bool().unwrap());
    assert!(body["credential_id"].as_str().is_some());
    assert_eq!(body["tier"], "100+ ZEC");
    assert!(body["expires_at"].as_u64().is_some());
}

#[tokio::test]
async fn test_issue_credential_invalid_tier() {
    let server = create_test_server();

    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": random_hex32(),
            "tier": 99, // Invalid tier
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;

    response.assert_status(axum::http::StatusCode::BAD_REQUEST);

    let body: serde_json::Value = response.json();
    assert_eq!(body["error_code"], "INVALID_TIER");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL QUERY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_get_credential() {
    let server = create_test_server();

    let account_tag = random_hex32();

    // Issue a credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": &account_tag,
            "tier": 2, // TIER_10
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();

    // Get the credential
    let response = server
        .get(&format!("/rails/axelar/zec/credential/{}", credential_id))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["credential_id"], credential_id);
    assert_eq!(body["tier"], "10+ ZEC");
    assert_eq!(body["tier_value"], 2);
    assert!(!body["revoked"].as_bool().unwrap());
    assert!(body["is_valid"].as_bool().unwrap());
}

#[tokio::test]
async fn test_get_account_credentials() {
    let server = create_test_server();

    let account_tag = random_hex32();

    // Issue multiple credentials for the same account
    for tier in [1, 2, 3] {
        let response = server
            .post("/rails/axelar/zec/issue")
            .json(&json!({
                "account_tag": &account_tag,
                "tier": tier,
                "state_root": random_hex32(),
                "block_height": 2000000 + tier,
                "proof_commitment": random_hex32(),
                "attestation_hash": random_hex32()
            }))
            .await;
        response.assert_status_ok();
    }

    // Get all credentials for the account
    let account_tag_clean = account_tag.strip_prefix("0x").unwrap_or(&account_tag);
    let response = server
        .get(&format!("/rails/axelar/zec/credentials/{}", account_tag_clean))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert_eq!(body["count"], 3);
    assert_eq!(body["credentials"].as_array().unwrap().len(), 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL CHECK TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_check_credential_meets_tier() {
    let server = create_test_server();

    let account_tag = random_hex32();

    // Issue a Tier 100 credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": &account_tag,
            "tier": 3, // TIER_100
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    // Check with min_tier = 2 (TIER_10) - should pass
    let response = server
        .post("/rails/axelar/zec/check")
        .json(&json!({
            "account_tag": &account_tag,
            "min_tier": 2
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["has_credential"].as_bool().unwrap());
    assert_eq!(body["tier"], "100+ ZEC");

    // Check with min_tier = 4 (TIER_1000) - should fail
    let response = server
        .post("/rails/axelar/zec/check")
        .json(&json!({
            "account_tag": &account_tag,
            "min_tier": 4
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(!body["has_credential"].as_bool().unwrap());
}

// ═══════════════════════════════════════════════════════════════════════════════
// BROADCAST TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_broadcast_credential() {
    let server = create_test_server();

    // Subscribe to chains first
    for chain in ["ethereum", "arbitrum", "optimism"] {
        server
            .post("/rails/axelar/subscribe")
            .json(&json!({
                "chain_name": chain,
                "receiver_contract": format!("0x{}receiver", chain)
            }))
            .await;
    }

    // Issue a credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": random_hex32(),
            "tier": 3,
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();

    // Broadcast to all chains
    let response = server
        .post("/rails/axelar/zec/broadcast")
        .json(&json!({
            "credential_id": credential_id
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["success"].as_bool().unwrap());
    assert!(body["broadcast_id"].as_str().is_some());
    assert_eq!(body["chains_broadcast"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn test_broadcast_to_specific_chain() {
    let server = create_test_server();

    // Subscribe to a chain
    server
        .post("/rails/axelar/subscribe")
        .json(&json!({
            "chain_name": "base",
            "receiver_contract": "0xbasereceiver"
        }))
        .await;

    // Issue a credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": random_hex32(),
            "tier": 2,
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();

    // Broadcast to specific chain
    let response = server
        .post(&"/rails/axelar/zec/broadcast/base".to_string())
        .json(&json!({
            "credential_id": credential_id
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["success"].as_bool().unwrap());
    assert_eq!(body["chains_broadcast"].as_array().unwrap().len(), 1);
    assert_eq!(body["chains_broadcast"][0], "base");
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVOCATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_revoke_credential() {
    let server = create_test_server();

    let account_tag = random_hex32();

    // Issue a credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": &account_tag,
            "tier": 3,
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();

    // Verify credential is valid
    let response = server
        .get(&format!("/rails/axelar/zec/credential/{}", credential_id))
        .await;
    let body: serde_json::Value = response.json();
    assert!(body["is_valid"].as_bool().unwrap());
    assert!(!body["revoked"].as_bool().unwrap());

    // Revoke the credential
    let response = server
        .post("/rails/axelar/zec/revoke")
        .json(&json!({
            "credential_id": credential_id,
            "reason": 0, // USER_REQUESTED
            "broadcast": false
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["success"].as_bool().unwrap());

    // Verify credential is now revoked
    let response = server
        .get(&format!("/rails/axelar/zec/credential/{}", credential_id))
        .await;
    let body: serde_json::Value = response.json();
    assert!(!body["is_valid"].as_bool().unwrap());
    assert!(body["revoked"].as_bool().unwrap());

    // Check credential should fail
    let response = server
        .post("/rails/axelar/zec/check")
        .json(&json!({
            "account_tag": &account_tag,
            "min_tier": 0
        }))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(!body["has_credential"].as_bool().unwrap());
}

#[tokio::test]
async fn test_broadcast_revoked_credential_fails() {
    let server = create_test_server();

    // Subscribe to a chain
    server
        .post("/rails/axelar/subscribe")
        .json(&json!({
            "chain_name": "polygon",
            "receiver_contract": "0xpolyreceiver"
        }))
        .await;

    // Issue a credential
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": random_hex32(),
            "tier": 2,
            "state_root": random_hex32(),
            "block_height": 2000000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32()
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();

    // Revoke it
    server
        .post("/rails/axelar/zec/revoke")
        .json(&json!({
            "credential_id": credential_id,
            "reason": 1, // BALANCE_DROPPED
            "broadcast": false
        }))
        .await;

    // Try to broadcast - should fail
    let response = server
        .post("/rails/axelar/zec/broadcast")
        .json(&json!({
            "credential_id": credential_id
        }))
        .await;

    response.assert_status(axum::http::StatusCode::FORBIDDEN);

    let body: serde_json::Value = response.json();
    assert_eq!(body["error_code"], "CREDENTIAL_REVOKED");
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE STATS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_bridge_stats() {
    let server = create_test_server();

    let response = server.get("/rails/axelar/zec/bridge/stats").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["total_broadcast"].as_u64().is_some());
    assert!(body["successful"].as_u64().is_some());
    assert!(body["failed"].as_u64().is_some());
}

#[tokio::test]
async fn test_pending_broadcasts() {
    let server = create_test_server();

    let response = server.get("/rails/axelar/zec/bridge/pending").await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["count"].as_u64().is_some());
    assert!(body["pending"].as_array().is_some());
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAS ESTIMATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_estimate_gas() {
    let server = create_test_server();

    // Subscribe to multiple chains
    for chain in ["ethereum", "arbitrum"] {
        server
            .post("/rails/axelar/subscribe")
            .json(&json!({
                "chain_name": chain,
                "receiver_contract": format!("0x{}receiver", chain)
            }))
            .await;
    }

    let response = server
        .post("/rails/axelar/estimate-gas")
        .json(&json!({}))
        .await;
    response.assert_status_ok();

    let body: serde_json::Value = response.json();
    assert!(body["total"].as_u64().unwrap() > 0);
    assert!(body["estimates"].as_object().is_some());
}

// ═══════════════════════════════════════════════════════════════════════════════
// END-TO-END FLOW TEST
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_full_credit_rail_flow() {
    let server = create_test_server();

    // 1. Set up chain subscriptions
    for (chain, receiver) in [
        ("ethereum", "0xEthReceiver"),
        ("arbitrum", "0xArbReceiver"),
        ("osmosis", "osmo1receiver"),
    ] {
        let response = server
            .post("/rails/axelar/subscribe")
            .json(&json!({
                "chain_name": chain,
                "receiver_contract": receiver
            }))
            .await;
        response.assert_status_ok();
    }

    // 2. Generate a Zcash PoF credential (simulating wallet generating proof)
    let account_tag = random_hex32();
    let response = server
        .post("/rails/axelar/zec/issue")
        .json(&json!({
            "account_tag": &account_tag,
            "tier": 3, // 100+ ZEC tier
            "state_root": random_hex32(),
            "block_height": 2500000,
            "proof_commitment": random_hex32(),
            "attestation_hash": random_hex32(),
            "validity_window": 86400 // 24 hours
        }))
        .await;
    response.assert_status_ok();

    let issue_body: serde_json::Value = response.json();
    let credential_id = issue_body["credential_id"].as_str().unwrap();
    assert_eq!(issue_body["tier"], "100+ ZEC");

    // 3. Broadcast credential to all chains
    let response = server
        .post("/rails/axelar/zec/broadcast")
        .json(&json!({"credential_id": credential_id}))
        .await;
    response.assert_status_ok();

    let broadcast_body: serde_json::Value = response.json();
    assert!(broadcast_body["success"].as_bool().unwrap());
    assert_eq!(broadcast_body["chains_broadcast"].as_array().unwrap().len(), 3);

    // 4. Verify credential status on-chain queries would work
    let response = server
        .post("/rails/axelar/zec/check")
        .json(&json!({
            "account_tag": &account_tag,
            "min_tier": 2 // 10+ ZEC minimum
        }))
        .await;
    response.assert_status_ok();

    let check_body: serde_json::Value = response.json();
    assert!(check_body["has_credential"].as_bool().unwrap());
    assert!(check_body["time_remaining"].as_u64().unwrap() > 0);

    // 5. User balance drops - revoke the credential
    let response = server
        .post("/rails/axelar/zec/revoke")
        .json(&json!({
            "credential_id": credential_id,
            "reason": 1, // BALANCE_DROPPED
            "broadcast": true
        }))
        .await;
    response.assert_status_ok();

    let revoke_body: serde_json::Value = response.json();
    assert!(revoke_body["success"].as_bool().unwrap());
    assert!(!revoke_body["chains_notified"].as_array().unwrap().is_empty());

    // 6. Verify credential is no longer valid
    let response = server
        .post("/rails/axelar/zec/check")
        .json(&json!({
            "account_tag": &account_tag,
            "min_tier": 0
        }))
        .await;
    response.assert_status_ok();

    let check_body: serde_json::Value = response.json();
    assert!(!check_body["has_credential"].as_bool().unwrap());
}

