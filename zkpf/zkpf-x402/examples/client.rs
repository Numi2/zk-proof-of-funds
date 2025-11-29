//! Example: x402 client implementation
//!
//! This example shows how to handle x402 responses as a client.
//!
//! Run with:
//! ```bash
//! cargo run --example client
//! ```

use zkpf_x402::{
    headers::{parse_402_headers, X402Headers},
    PaymentProof, PaymentRequirements,
    HEADER_PAYMENT_ADDRESS, HEADER_PAYMENT_AMOUNT, HEADER_PAYMENT_NETWORK,
    HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_SCHEME,
};

fn main() {
    println!("=== x402 Client Implementation Demo ===\n");

    // Simulate receiving a 402 response with headers
    let mock_response = create_mock_402_response();
    
    println!("1. Received 402 Payment Required response");
    println!("   Status: 402 Payment Required\n");

    // Parse the x402 headers
    println!("2. Parsing x402 headers:");
    let headers = parse_headers_from_response(&mock_response);
    
    // Method 1: Parse from full JSON header
    if let Some(json) = headers.get(HEADER_PAYMENT_REQUIRED) {
        println!("   Found X-Payment-Required header");
        match PaymentRequirements::from_json(json) {
            Ok(req) => {
                print_payment_requirements(&req);
            }
            Err(e) => println!("   Error parsing: {}", e),
        }
    }
    println!();

    // Method 2: Parse individual headers
    println!("3. Individual header parsing:");
    if let Some(addr) = headers.get(HEADER_PAYMENT_ADDRESS) {
        println!("   Address: {}", addr);
    }
    if let Some(amount) = headers.get(HEADER_PAYMENT_AMOUNT) {
        println!("   Amount: {} zatoshis", amount);
    }
    if let Some(scheme) = headers.get(HEADER_PAYMENT_SCHEME) {
        println!("   Scheme: {}", scheme);
    }
    if let Some(network) = headers.get(HEADER_PAYMENT_NETWORK) {
        println!("   Network: {}", network);
    }
    println!();

    // Simulate making a payment
    println!("4. Simulating payment flow:");
    let requirements = parse_402_headers(&headers).unwrap();
    
    println!("   a) User wallet receives payment request:");
    println!("      - Send {} ZEC to {}", 
             requirements.amount_zec(),
             &requirements.address[..20]);
    println!("      - Memo: {:?}", requirements.memo);
    println!();

    // After payment is made, create proof
    let fake_txid = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    println!("   b) Payment sent, txid: {}...", &fake_txid[..16]);
    
    let proof = PaymentProof::new(fake_txid)
        .with_confirmations(1)
        .with_payment_id(requirements.payment_id.unwrap_or_default());
    println!();

    // Create the payment header for the retry request
    println!("5. Creating retry request with payment proof:");
    
    // Option 1: X-Payment header with just txid
    println!("   Option A - Simple (just txid):");
    println!("   X-Payment: {}", fake_txid);
    println!();
    
    // Option 2: X-Payment header with full proof
    let header_value = proof.to_header_value().unwrap();
    println!("   Option B - Full proof (base64 JSON):");
    println!("   X-Payment: {}", header_value);
    println!();
    
    // Option 3: Authorization header
    println!("   Option C - Authorization header:");
    println!("   Authorization: X402 {}", fake_txid);
    println!();

    // Example curl commands
    println!("6. Example curl commands:");
    println!();
    println!("   # Initial request (will get 402):");
    println!("   curl -v https://api.example.com/premium");
    println!();
    println!("   # Retry with payment proof:");
    println!("   curl -H 'X-Payment: {}' https://api.example.com/premium", fake_txid);
    println!();
    println!("   # Or with Authorization header:");
    println!("   curl -H 'Authorization: X402 {}' https://api.example.com/premium", fake_txid);
    println!();

    println!("=== Demo Complete ===");
}

fn create_mock_402_response() -> Vec<(String, String)> {
    use zkpf_x402::X402Builder;
    
    let headers = X402Builder::new()
        .address("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")
        .amount_zec(0.001)
        .resource("/api/premium")
        .description("Premium API access")
        .payment_id("pay_demo123")
        .max_age_minutes(15)
        .build_headers()
        .unwrap();
    
    headers.to_vec()
}

fn parse_headers_from_response(response: &[(String, String)]) -> X402Headers {
    let mut headers = X402Headers::new();
    for (name, value) in response {
        headers.add(name, value);
    }
    headers
}

fn print_payment_requirements(req: &PaymentRequirements) {
    println!("   Payment Requirements:");
    println!("     Address: {}", req.address);
    println!("     Amount: {} ZEC ({} zatoshis)", req.amount_zec(), req.amount_zatoshis);
    println!("     Scheme: {}", req.scheme);
    println!("     Network: {}", req.network);
    println!("     Expires: {}", req.expires_at);
    println!("     Resource: {}", req.resource);
    if let Some(ref desc) = req.description {
        println!("     Description: {}", desc);
    }
    if let Some(ref id) = req.payment_id {
        println!("     Payment ID: {}", id);
    }
}

