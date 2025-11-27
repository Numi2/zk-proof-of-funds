//! Integration tests for the Starknet rails HTTP service.

use axum_test::TestServer;
use serde_json::json;
use zkpf_rails_starknet::app_router;
use zkpf_starknet_l2::RAIL_ID_STARKNET_L2;

/// Create a test server.
fn create_server() -> TestServer {
    TestServer::new(app_router()).expect("should create test server")
}

#[tokio::test]
async fn test_health_endpoint() {
    let server = create_server();
    let response = server.get("/health").await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert_eq!(body["status"], "ok");
    assert_eq!(body["rail_id"], RAIL_ID_STARKNET_L2);
}

#[tokio::test]
async fn test_info_endpoint() {
    let server = create_server();
    let response = server.get("/rails/starknet/info").await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert_eq!(body["rail_id"], RAIL_ID_STARKNET_L2);
    assert!(body["features"]["account_abstraction"].as_bool().unwrap());
    assert!(body["features"]["defi_positions"].as_bool().unwrap());
}

#[tokio::test]
async fn test_status_endpoint() {
    let server = create_server();
    let response = server.get("/rails/starknet/status").await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert_eq!(body["rail_id"], RAIL_ID_STARKNET_L2);
    assert!(body["features"]["batch_verification"].as_bool().unwrap());
    // RPC won't be connected in test environment
    assert!(!body["rpc"]["connected"].as_bool().unwrap_or(false));
}

#[tokio::test]
async fn test_proof_generation() {
    let server = create_server();
    
    let request = json!({
        "holder_id": "test-holder-123",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
                "class_hash": "0x0",
                "native_balance": 5000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert!(body["success"].as_bool().unwrap());
    assert!(body["bundle"].is_object());
    assert_eq!(body["bundle"]["rail_id"], RAIL_ID_STARKNET_L2);
    assert!(body["error"].is_null());
}

#[tokio::test]
async fn test_proof_generation_insufficient_funds() {
    let server = create_server();
    
    let request = json!({
        "holder_id": "test-holder-123",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 10000000000000000000u64, // 10 ETH threshold
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x001",
                "class_hash": "0x0",
                "native_balance": 1000000000000000000u128, // Only 1 ETH
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert!(!body["success"].as_bool().unwrap());
    assert!(body["bundle"].is_null());
    assert!(body["error"].as_str().unwrap().contains("insufficient"));
    assert_eq!(body["error_code"], "INVALID_INPUT");
}

#[tokio::test]
async fn test_verify_proof() {
    let server = create_server();
    
    // First generate a proof
    let gen_request = json!({
        "holder_id": "test-holder-123",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x001",
                "class_hash": "0x0",
                "native_balance": 5000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let gen_response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&gen_request)
        .await;
    
    let gen_body: serde_json::Value = gen_response.json();
    let bundle = &gen_body["bundle"];
    
    // Now verify the proof
    let verify_request = json!({
        "bundle": bundle,
        "policy_id": 200001
    });
    
    let verify_response = server
        .post("/rails/starknet/verify")
        .json(&verify_request)
        .await;
    
    verify_response.assert_status_ok();
    let verify_body: serde_json::Value = verify_response.json();
    
    assert!(verify_body["valid"].as_bool().unwrap());
    assert!(verify_body["error"].is_null());
}

#[tokio::test]
async fn test_verify_proof_wrong_policy() {
    let server = create_server();
    
    // Generate a proof
    let gen_request = json!({
        "holder_id": "test-holder-123",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x001",
                "class_hash": "0x0",
                "native_balance": 5000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let gen_response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&gen_request)
        .await;
    
    let gen_body: serde_json::Value = gen_response.json();
    let bundle = &gen_body["bundle"];
    
    // Try to verify with wrong policy ID
    let verify_request = json!({
        "bundle": bundle,
        "policy_id": 999999 // Wrong policy
    });
    
    let verify_response = server
        .post("/rails/starknet/verify")
        .json(&verify_request)
        .await;
    
    verify_response.assert_status_ok();
    let verify_body: serde_json::Value = verify_response.json();
    
    assert!(!verify_body["valid"].as_bool().unwrap());
    assert_eq!(verify_body["error_code"], "POLICY_MISMATCH");
}

#[tokio::test]
async fn test_batch_verify() {
    let server = create_server();
    
    // Generate two proofs
    let gen_request1 = json!({
        "holder_id": "holder-1",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x001",
                "class_hash": "0x0",
                "native_balance": 5000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let gen_response1 = server
        .post("/rails/starknet/proof-of-funds")
        .json(&gen_request1)
        .await;
    let bundle1 = gen_response1.json::<serde_json::Value>()["bundle"].clone();
    
    let gen_request2 = json!({
        "holder_id": "holder-2",
        "policy_id": 200002,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500001,
            "block_hash": "0x5678",
            "timestamp": 1700000001,
            "accounts": [{
                "address": "0x002",
                "class_hash": "0x0",
                "native_balance": 3000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let gen_response2 = server
        .post("/rails/starknet/proof-of-funds")
        .json(&gen_request2)
        .await;
    let bundle2 = gen_response2.json::<serde_json::Value>()["bundle"].clone();
    
    // Batch verify
    let batch_request = json!({
        "bundles": [
            {"bundle": bundle1, "policy_id": 200001},
            {"bundle": bundle2, "policy_id": 200002}
        ]
    });
    
    let batch_response = server
        .post("/rails/starknet/verify-batch")
        .json(&batch_request)
        .await;
    
    batch_response.assert_status_ok();
    let batch_body: serde_json::Value = batch_response.json();
    
    assert!(batch_body["all_valid"].as_bool().unwrap());
    assert_eq!(batch_body["results"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn test_build_snapshot_no_rpc() {
    let server = create_server();
    
    let request = json!({
        "accounts": ["0x001", "0x002"],
        "tokens": null
    });
    
    let response = server
        .post("/rails/starknet/build-snapshot")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    // Should fail because RPC is not configured in test
    assert!(!body["success"].as_bool().unwrap());
    assert!(body["error"].as_str().unwrap().contains("RPC"));
}

#[tokio::test]
async fn test_build_snapshot_empty_accounts() {
    let server = create_server();
    
    let request = json!({
        "accounts": [],
        "tokens": null
    });
    
    let response = server
        .post("/rails/starknet/build-snapshot")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert!(!body["success"].as_bool().unwrap());
    assert!(body["error"].as_str().unwrap().contains("no accounts"));
}

#[tokio::test]
async fn test_get_balance_no_rpc() {
    let server = create_server();
    
    let request = json!({
        "account": "0x001",
        "token": null
    });
    
    let response = server
        .post("/rails/starknet/get-balance")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    // Should fail because RPC is not configured
    assert!(!body["success"].as_bool().unwrap());
    assert!(body["error"].as_str().is_some());
}

#[tokio::test]
async fn test_verify_wrong_rail_id() {
    let server = create_server();
    
    // First generate a valid proof, then tamper with the rail_id
    let gen_request = json!({
        "holder_id": "tamper-test",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 1000000000000000000u64,
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [{
                "address": "0x001",
                "class_hash": "0x0",
                "native_balance": 5000000000000000000u128,
                "token_balances": [],
                "defi_positions": []
            }]
        }
    });
    
    let gen_response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&gen_request)
        .await;
    
    let mut bundle: serde_json::Value = gen_response.json::<serde_json::Value>()["bundle"].clone();
    
    // Tamper with the rail_id
    bundle["rail_id"] = json!("WRONG_RAIL");
    
    let verify_request = json!({
        "bundle": bundle,
        "policy_id": 200001
    });
    
    let response = server
        .post("/rails/starknet/verify")
        .json(&verify_request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert!(!body["valid"].as_bool().unwrap());
    assert_eq!(body["error_code"], "RAIL_MISMATCH");
}

#[tokio::test]
async fn test_multi_account_proof() {
    let server = create_server();
    
    let request = json!({
        "holder_id": "multi-account-test",
        "policy_id": 200001,
        "verifier_scope_id": 42,
        "current_epoch": 1700000000,
        "threshold": 4000000000000000000u64, // 4 ETH threshold
        "currency_code": 1027,
        "asset_filter": null,
        "snapshot": {
            "chain_id": "SN_SEPOLIA",
            "block_number": 500000,
            "block_hash": "0x1234",
            "timestamp": 1700000000,
            "accounts": [
                {
                    "address": "0x001",
                    "class_hash": "0x0",
                    "native_balance": 2000000000000000000u128, // 2 ETH
                    "token_balances": [],
                    "defi_positions": []
                },
                {
                    "address": "0x002",
                    "class_hash": "0x0",
                    "native_balance": 3000000000000000000u128, // 3 ETH
                    "token_balances": [],
                    "defi_positions": []
                }
            ]
        }
    });
    
    let response = server
        .post("/rails/starknet/proof-of-funds")
        .json(&request)
        .await;
    
    response.assert_status_ok();
    let body: serde_json::Value = response.json();
    
    assert!(body["success"].as_bool().unwrap());
    
    // Should prove 5 ETH total
    let bundle = &body["bundle"];
    assert_eq!(
        bundle["public_inputs"]["proven_sum"].as_u64().unwrap(),
        5000000000000000000u64
    );
}

