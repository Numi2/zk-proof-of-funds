//! Example: Simple x402 response generation
//!
//! This example shows how to generate x402 payment requirements
//! without using the middleware (for custom integration).
//!
//! Run with:
//! ```bash
//! cargo run --example simple_402
//! ```

use zkpf_x402::{X402Builder, ZecNetwork, PaymentProof};

fn main() {
    println!("=== x402 Payment Requirements Builder Demo ===\n");

    // Example 1: Basic payment requirement
    println!("1. Basic payment requirement:");
    let payment = X402Builder::new()
        .address("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")
        .amount_zec(0.001)
        .resource("/api/data")
        .build()
        .unwrap();

    println!("   Address: {}", payment.address);
    println!("   Amount: {} ZEC ({} zatoshis)", payment.amount_zec(), payment.amount_zatoshis);
    println!("   Scheme: {}", payment.scheme);
    println!("   Expires: {}", payment.expires_at);
    println!();

    // Example 2: With all options
    println!("2. Full-featured payment requirement:");
    let payment = X402Builder::new()
        .address("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")
        .amount_zatoshis(500_000) // 0.005 ZEC
        .network(ZecNetwork::Mainnet)
        .resource("/api/premium/endpoint")
        .description("Premium API access - 24 hour pass")
        .memo("user:12345") // Encrypted memo in shielded tx
        .payment_id("pay_abc123")
        .max_age_minutes(30)
        .min_confirmations(3)
        .build()
        .unwrap();

    println!("   Payment ID: {:?}", payment.payment_id);
    println!("   Description: {:?}", payment.description);
    println!("   Min confirmations: {}", payment.min_confirmations);
    println!("   JSON:\n   {}", serde_json::to_string_pretty(&payment).unwrap());
    println!();

    // Example 3: Shorthand builders
    println!("3. Shorthand builders:");
    
    // API payment
    let api_payment = X402Builder::api_payment(
        "zs1test...", 
        0.0001, 
        "/api/call"
    ).build().unwrap();
    println!("   API Payment: {} zatoshis for {}", api_payment.amount_zatoshis, api_payment.resource);

    // Micropayment (0 confirmations for speed)
    let micro = X402Builder::micropayment("zs1test...", 0.00001)
        .build()
        .unwrap();
    println!("   Micropayment: {} zatoshis, {} confirmations", 
             micro.amount_zatoshis, micro.min_confirmations);

    // Secure payment (6 confirmations)
    let secure = X402Builder::secure_payment("zs1test...", 1.0)
        .build()
        .unwrap();
    println!("   Secure Payment: {} zatoshis, {} confirmations",
             secure.amount_zatoshis, secure.min_confirmations);
    println!();

    // Example 4: Generate HTTP headers
    println!("4. HTTP 402 headers:");
    let headers = X402Builder::new()
        .address("zs1example...")
        .amount_zec(0.01)
        .resource("/premium")
        .build_headers()
        .unwrap();

    for (name, value) in headers.to_vec() {
        // Truncate long values for display
        let display_value = if value.len() > 60 {
            format!("{}...", &value[..60])
        } else {
            value
        };
        println!("   {}: {}", name, display_value);
    }
    println!();

    // Example 5: Payment proof handling
    println!("5. Payment proof handling:");
    let txid = "abc123def456789012345678901234567890123456789012345678901234abcd";
    
    // Simple proof (just txid)
    let proof = PaymentProof::new(txid);
    println!("   Simple proof - txid: {}...", &proof.txid[..16]);

    // Full proof with metadata
    let full_proof = PaymentProof::new(txid)
        .with_confirmations(6)
        .with_block_height(2_000_000)
        .with_payment_id("pay_abc123");
    println!("   Full proof: {:?}", full_proof);

    // Encode for header
    let header_value = full_proof.to_header_value().unwrap();
    println!("   Header value: {}...", &header_value[..40]);

    // Decode from header
    let decoded = PaymentProof::from_header_value(&header_value).unwrap();
    println!("   Decoded txid: {}...", &decoded.txid[..16]);
    println!();

    // Example 6: Transparent address
    println!("6. Transparent address (t-addr):");
    let transparent = X402Builder::new()
        .address("t1XYZ...")  // Transparent address
        .amount_zec(0.1)
        .build()
        .unwrap();
    println!("   Scheme: {} (auto-detected)", transparent.scheme);
    println!();

    println!("=== Demo Complete ===");
}

