//! Example: Axum server with x402 payment gating
//!
//! This example demonstrates how to create an API that requires ZEC payments.
//!
//! Run with:
//! ```bash
//! cargo run --example axum_server --features axum-middleware
//! ```

use axum::{
    extract::Path,
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use zkpf_x402::{
    middleware::{PathPricing, X402Config, X402Layer},
    verify::MemoryVerifier,
    ZecNetwork,
};

// Your receiving address - replace with your actual Zcash address
const RECEIVING_ADDRESS: &str = "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly";

#[tokio::main]
async fn main() {
    println!("🔒 Starting x402-protected API server...\n");

    // Create payment verifier (in production, connect to lightwalletd)
    let verifier = MemoryVerifier::new();
    
    // For demo: pre-register a test payment
    let test_txid = "a".repeat(64);
    verifier.register_payment(&test_txid, 100_000, RECEIVING_ADDRESS, 6);
    println!("📝 Demo: Pre-registered test payment with txid: {}...", &test_txid[..16]);

    // x402 configuration
    let config = X402Config::new(RECEIVING_ADDRESS)
        .network(ZecNetwork::Mainnet)
        .min_confirmations(1)
        .max_age_seconds(900); // 15 minutes

    // Create pricing - different prices for different endpoints
    let pricing = PathPricing::new()
        .add_path("/api/premium", 100_000)    // 0.001 ZEC
        .add_path("/api/data", 10_000)         // 0.0001 ZEC  
        .add_path("/api/expensive", 1_000_000) // 0.01 ZEC
        .default_price(1_000);                 // 0.00001 ZEC for other paths

    // Build protected routes
    let protected_routes = Router::new()
        .route("/api/premium", get(premium_handler))
        .route("/api/data", get(data_handler))
        .route("/api/expensive", get(expensive_handler))
        .route("/api/default/:id", get(default_handler))
        .layer(X402Layer::new(config, pricing, verifier));

    // Free routes (no payment required)
    let free_routes = Router::new()
        .route("/", get(home_handler))
        .route("/health", get(health_handler))
        .route("/pricing", get(pricing_handler));

    // Combine routes
    let app = Router::new()
        .merge(free_routes)
        .merge(protected_routes);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("🚀 Server running at http://{}", addr);
    println!("\n📋 Endpoints:");
    println!("   FREE:");
    println!("     GET /         - Home page");
    println!("     GET /health   - Health check");
    println!("     GET /pricing  - View pricing info");
    println!("\n   PAID (x402):");
    println!("     GET /api/premium    - 0.001 ZEC");
    println!("     GET /api/data       - 0.0001 ZEC");
    println!("     GET /api/expensive  - 0.01 ZEC");
    println!("     GET /api/default/*  - 0.00001 ZEC");
    println!("\n💡 Test with:");
    println!("   curl -v http://localhost:3000/api/premium");
    println!("   curl -H 'X-Payment: {}' http://localhost:3000/api/premium", test_txid);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn home_handler() -> Json<Value> {
    Json(json!({
        "name": "x402 Demo API",
        "version": "1.0.0",
        "description": "API endpoints protected by Zcash payments",
        "documentation": "/pricing"
    }))
}

async fn health_handler() -> Json<Value> {
    Json(json!({
        "status": "healthy",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

async fn pricing_handler() -> Json<Value> {
    Json(json!({
        "receiving_address": RECEIVING_ADDRESS,
        "network": "mainnet",
        "currency": "ZEC",
        "endpoints": {
            "/api/premium": {
                "price_zec": 0.001,
                "price_zatoshis": 100_000,
                "description": "Premium API access"
            },
            "/api/data": {
                "price_zec": 0.0001,
                "price_zatoshis": 10_000,
                "description": "Data endpoint"
            },
            "/api/expensive": {
                "price_zec": 0.01,
                "price_zatoshis": 1_000_000,
                "description": "Expensive operation"
            },
            "/api/default/*": {
                "price_zec": 0.00001,
                "price_zatoshis": 1_000,
                "description": "Default pricing for other endpoints"
            }
        },
        "payment_instructions": {
            "1": "Make request to protected endpoint",
            "2": "Receive 402 Payment Required response with payment details",
            "3": "Send ZEC to the address in X-Payment-Address header",
            "4": "Include transaction ID in X-Payment header",
            "5": "Retry the request"
        }
    }))
}

async fn premium_handler() -> Json<Value> {
    Json(json!({
        "status": "success",
        "message": "Welcome to the premium API!",
        "data": {
            "premium_feature_1": "enabled",
            "premium_feature_2": "enabled",
            "access_level": "premium"
        }
    }))
}

async fn data_handler() -> Json<Value> {
    Json(json!({
        "status": "success",
        "data": {
            "records": [
                {"id": 1, "value": "data_1"},
                {"id": 2, "value": "data_2"},
                {"id": 3, "value": "data_3"}
            ],
            "total": 3
        }
    }))
}

async fn expensive_handler() -> Json<Value> {
    Json(json!({
        "status": "success",
        "message": "Expensive operation completed",
        "computation_time_ms": 1234,
        "result": "complex_result_data"
    }))
}

async fn default_handler(Path(id): Path<String>) -> Json<Value> {
    Json(json!({
        "status": "success",
        "resource_id": id,
        "data": format!("Resource data for {}", id)
    }))
}

