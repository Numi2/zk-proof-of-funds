# zkpf-x402

**x402 Payment Required Protocol for Zcash (ZEC)**

A complete implementation of the x402 protocol enabling pay-per-request APIs with Zcash cryptocurrency payments. This crate provides everything needed to accept ZEC payments in your HTTP API.

## Features

- 🔒 **Privacy-First**: Full support for shielded Sapling transactions (zs1... addresses)
- 🚀 **Ready-to-Use Middleware**: Drop-in Axum/Tower middleware for instant integration
- 💰 **Flexible Pricing**: Fixed, path-based, or custom pricing strategies
- ✅ **Payment Verification**: Built-in verification with customizable backends
- 📦 **Zero-Config Options**: Sensible defaults for common use cases

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
zkpf-x402 = "0.1"

# For Axum middleware support:
zkpf-x402 = { version = "0.1", features = ["axum-middleware"] }
```

## Quick Start

### 1. Simple Payment Requirement Generation

```rust
use zkpf_x402::{X402Builder, ZecNetwork};

// Create a payment requirement
let payment = X402Builder::new()
    .address("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")
    .amount_zec(0.001)  // 0.001 ZEC
    .resource("/api/premium")
    .description("Premium API access")
    .max_age_minutes(15)
    .build()
    .unwrap();

// Get HTTP 402 headers
let headers = payment.to_headers();
```

### 2. Axum Middleware Integration

```rust
use axum::{Router, routing::get};
use zkpf_x402::{
    middleware::{X402Config, X402Layer, FixedPrice},
    verify::MemoryVerifier,
    ZecNetwork,
};

#[tokio::main]
async fn main() {
    // Configuration
    let config = X402Config::new("zs1your_address...")
        .network(ZecNetwork::Mainnet)
        .min_confirmations(1);

    // Pricing: 0.001 ZEC per request
    let pricing = FixedPrice::zec(0.001);

    // Verifier (use MemoryVerifier for testing, LightwalletdVerifier for production)
    let verifier = MemoryVerifier::new();

    // Build router with x402 protection
    let app = Router::new()
        .route("/api/premium", get(premium_handler))
        .layer(X402Layer::new(config, pricing, verifier));

    // Start server...
}
```

### 3. Path-Based Pricing

```rust
use zkpf_x402::middleware::PathPricing;

let pricing = PathPricing::new()
    .add_path("/api/cheap", 1_000)        // 0.00001 ZEC
    .add_path("/api/standard", 100_000)   // 0.001 ZEC
    .add_path("/api/premium", 1_000_000)  // 0.01 ZEC
    .default_price(10_000);               // 0.0001 ZEC for unmatched paths
```

## Protocol Overview

The x402 protocol flow:

```
┌──────────┐                         ┌──────────┐
│  Client  │                         │  Server  │
└────┬─────┘                         └────┬─────┘
     │                                    │
     │  1. GET /api/premium               │
     │ ──────────────────────────────────>│
     │                                    │
     │  2. 402 Payment Required           │
     │     X-Payment-Address: zs1...      │
     │     X-Payment-Amount: 100000       │
     │ <──────────────────────────────────│
     │                                    │
     │  3. Send ZEC to address            │
     │ ─────────────────────────────>     │ (blockchain)
     │                                    │
     │  4. GET /api/premium               │
     │     X-Payment: <txid>              │
     │ ──────────────────────────────────>│
     │                                    │
     │  5. 200 OK + data                  │
     │ <──────────────────────────────────│
     │                                    │
```

## HTTP Headers

### Server Response (402 Payment Required)

| Header | Description | Example |
|--------|-------------|---------|
| `X-Payment-Required` | Full JSON requirements | `{"address":"zs1...","amount_zatoshis":100000,...}` |
| `X-Payment-Address` | Destination address | `zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly` |
| `X-Payment-Amount` | Amount in zatoshis | `100000` |
| `X-Payment-Scheme` | Payment type | `zcash:sapling` |
| `X-Payment-Network` | Network | `mainnet` or `testnet` |
| `X-Payment-Expires` | ISO 8601 expiry | `2025-11-29T12:00:00Z` |
| `X-Payment-Min-Confirmations` | Required confirmations | `1` |
| `X-Payment-Resource` | Protected resource | `/api/premium` |

### Client Request (with payment)

| Header | Description | Example |
|--------|-------------|---------|
| `X-Payment` | Transaction ID or proof | `abc123...` (64 hex chars) |
| `Authorization` | Alternative auth | `X402 abc123...` |

## Address Types

### Shielded (Recommended)

```rust
// Sapling address (zs1...) - Full privacy
X402Builder::new()
    .address("zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly")
    .amount_zec(0.001)
    .build()
```

### Transparent

```rust
// Transparent address (t1...) - Visible on chain
X402Builder::new()
    .address("t1Rv4exT7bqhZqi2j7xz8bUHDMxwosrjADU")
    .amount_zec(0.001)
    .build()
```

### Unified (Future)

```rust
// Unified address (u1...) - Multiple receivers
X402Builder::new()
    .address("u1...")
    .amount_zec(0.001)
    .build()
```

## Payment Verification

### Memory Verifier (Testing)

```rust
use zkpf_x402::verify::MemoryVerifier;

let verifier = MemoryVerifier::new();

// Register a payment (simulates blockchain confirmation)
verifier.register_payment(
    "abc123...",  // txid
    100_000,      // amount in zatoshis
    "zs1...",     // address
    6             // confirmations
);
```

### Custom Verifier

```rust
use zkpf_x402::verify::{PaymentVerifier, PaymentStatus, CallbackVerifier};

let verifier = CallbackVerifier::new(|proof, requirements| {
    // Your custom verification logic
    // Query your database, lightwalletd, etc.
    
    if check_payment(&proof.txid, requirements.amount_zatoshis) {
        Ok(PaymentStatus::Verified { 
            confirmations: 6, 
            block_height: Some(2_000_000) 
        })
    } else {
        Ok(PaymentStatus::NotFound)
    }
});
```

## Convenience Builders

```rust
// API payment with auto-generated payment ID
let payment = X402Builder::api_payment("zs1...", 0.001, "/api/data")
    .build()?;

// Micropayment (0 confirmations for speed)
let payment = X402Builder::micropayment("zs1...", 0.00001)
    .build()?;

// High-value payment (6 confirmations for security)
let payment = X402Builder::secure_payment("zs1...", 1.0)
    .build()?;
```

## Client-Side Integration

### JavaScript/TypeScript

```typescript
async function callProtectedAPI(url: string): Promise<Response> {
    // Initial request
    let response = await fetch(url);
    
    if (response.status === 402) {
        const requirements = JSON.parse(
            response.headers.get('X-Payment-Required') || '{}'
        );
        
        // Show payment UI to user
        const txid = await sendZecPayment(
            requirements.address,
            requirements.amount_zatoshis
        );
        
        // Retry with payment proof
        response = await fetch(url, {
            headers: {
                'X-Payment': txid
            }
        });
    }
    
    return response;
}
```

### cURL

```bash
# Initial request (gets 402)
curl -v https://api.example.com/premium

# After payment, retry with txid
curl -H "X-Payment: abc123..." https://api.example.com/premium

# Or use Authorization header
curl -H "Authorization: X402 abc123..." https://api.example.com/premium
```

## Examples

Run the examples:

```bash
# Simple 402 response generation
cargo run --example simple_402

# Client-side handling demo
cargo run --example client

# Full Axum server with x402 protection
cargo run --example axum_server --features axum-middleware
```

## Feature Flags

| Feature | Description |
|---------|-------------|
| `default` | Core functionality with HTTP types |
| `http-core` | HTTP header types support |
| `axum-middleware` | Axum/Tower middleware integration |
| `lightwalletd` | Lightwalletd verification (gRPC) |
| `full` | All features enabled |

## Security Considerations

1. **Use shielded addresses** (zs1...) for maximum privacy
2. **Set appropriate confirmations** based on payment amount:
   - Micropayments: 0-1 confirmations
   - Standard: 1-3 confirmations
   - High-value: 6+ confirmations
3. **Validate payment amounts** - always verify the amount matches requirements
4. **Use unique payment IDs** to prevent replay attacks
5. **Set reasonable expiry times** - 5-15 minutes is typical

## License

MIT OR Apache-2.0

## Related Projects

- [x402.org](https://x402.org) - x402 protocol specification
- [z402.cash](https://z402.cash) - Zcash x402 extension
- [zcash](https://z.cash) - Zcash cryptocurrency

