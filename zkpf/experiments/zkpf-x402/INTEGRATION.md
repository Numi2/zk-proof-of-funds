# x402 ZEC Integration Guide

This guide walks you through integrating x402 ZEC payments into your API **step by step**.

## Prerequisites

- A Zcash wallet with a receiving address
- For mainnet: A funded wallet with ZEC
- For testing: Use testnet first!

## Step 1: Get Your Receiving Address

You need a Zcash address to receive payments. You can use:

### Shielded Address (Recommended - Private)
Format: `zs1...` (starts with "zs1")

Get one from:
- [Zashi Wallet](https://zashi.co) (mobile)
- [Ywallet](https://ywallet.app) (mobile/desktop)
- [Zecwallet Lite](https://zecwallet.co) (desktop)
- CLI: `zcash-cli z_getnewaddress`

### Transparent Address (Public - Like Bitcoin)
Format: `t1...` or `t3...`

These are simpler but **all transactions are public**.

## Step 2: Install the SDK

### Rust Backend

```toml
[dependencies]
zkpf-x402 = { version = "0.1", features = ["axum-middleware"] }
```

### TypeScript/JavaScript Frontend

```bash
npm install @numi2/x402-client
# or
yarn add @numi2/x402-client
```

## Step 3: Backend Integration

### Option A: Axum Middleware (Easiest)

```rust
use axum::{Router, routing::get};
use zkpf_x402::{
    middleware::{X402Config, X402Layer, FixedPrice},
    verify::MemoryVerifier,
    ZecNetwork,
};

// Your Zcash address - CHANGE THIS!
const MY_ADDRESS: &str = "zs1...your_address_here...";

#[tokio::main]
async fn main() {
    // Configuration
    let config = X402Config::new(MY_ADDRESS)
        .network(ZecNetwork::Mainnet)
        .min_confirmations(1);

    // Price: 0.001 ZEC per request
    let pricing = FixedPrice::zec(0.001);

    // For testing - accepts pre-registered payments
    // For production - use LightwalletdVerifier
    let verifier = MemoryVerifier::new();

    let app = Router::new()
        .route("/api/premium", get(|| async { "Premium content!" }))
        .layer(X402Layer::new(config, pricing, verifier));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

### Option B: Manual Integration

```rust
use zkpf_x402::{X402Builder, PaymentProof, verify::MemoryVerifier, PaymentVerifier};

// In your handler:
async fn premium_endpoint(payment_header: Option<String>) -> Response {
    let verifier = MemoryVerifier::new();
    
    // Check for payment proof
    if let Some(txid) = payment_header {
        let proof = PaymentProof::new(txid);
        let requirements = create_requirements();
        
        match verifier.verify(&proof, &requirements) {
            Ok(status) if status.is_verified() => {
                // Payment verified - serve content
                return Response::ok("Premium content!");
            }
            Ok(status) if status.is_pending() => {
                // Still waiting for confirmations
                return Response::status(402)
                    .header("X-Payment-Status", "pending")
                    .body("Payment pending confirmation");
            }
            _ => {
                // Payment not valid
            }
        }
    }
    
    // No payment - return 402 with requirements
    let requirements = X402Builder::new()
        .address("zs1...")
        .amount_zec(0.001)
        .resource("/api/premium")
        .build()
        .unwrap();
    
    Response::status(402)
        .headers(requirements.to_headers())
        .body("Payment required")
}
```

## Step 4: Frontend Integration

### React App

```tsx
import { X402Provider, useX402Fetch } from '@zkpf/x402-client/react';

// Wrap your app
function App() {
  return (
    <X402Provider>
      <MyApp />
    </X402Provider>
  );
}

// Use in components
function PremiumContent() {
  const x402Fetch = useX402Fetch();
  const [data, setData] = useState(null);
  
  const loadContent = async () => {
    // This automatically handles 402 responses!
    const response = await x402Fetch('/api/premium');
    const data = await response.json();
    setData(data);
  };
  
  return (
    <button onClick={loadContent}>
      Load Premium Content (0.001 ZEC)
    </button>
  );
}
```

### Vanilla JavaScript

```javascript
import { X402Client } from '@zkpf/x402-client';

const client = new X402Client({
  onPaymentRequired: async (requirements) => {
    // Show payment dialog to user
    const confirmed = confirm(
      `Pay ${requirements.amount_zatoshis / 100000000} ZEC to access this resource?`
    );
    
    if (!confirmed) return null;
    
    // Open wallet app with payment URI
    const uri = `zcash:${requirements.address}?amount=${requirements.amount_zatoshis / 100000000}`;
    window.open(uri);
    
    // Ask user for transaction ID
    const txid = prompt('Enter the transaction ID after payment:');
    return txid;
  }
});

// Use it
const response = await client.fetch('/api/premium');
```

## Step 5: Testing

### Test with Pre-Registered Payments

```rust
let verifier = MemoryVerifier::new();

// Register a test payment
verifier.register_payment(
    "0".repeat(64).as_str(),  // Fake txid
    100_000,                   // Amount (0.001 ZEC)
    "zs1...",                  // Your address
    6                          // Confirmations
);

// Now requests with X-Payment: 0000...0000 will work
```

### Test with cURL

```bash
# Get payment requirements
curl -v http://localhost:3000/api/premium

# Submit with payment proof
curl -H "X-Payment: 0000000000000000000000000000000000000000000000000000000000000000" \
     http://localhost:3000/api/premium
```

### Use Testnet First!

```rust
let config = X402Config::new("ztestaddr...")
    .network(ZecNetwork::Testnet);
```

Get testnet ZEC from the [Zcash Testnet Faucet](https://faucet.testnet.z.cash).

## Step 6: Production Deployment

### 1. Use Real Verification

Replace `MemoryVerifier` with `LightwalletdVerifier`:

```rust
use zkpf_x402::LightwalletdVerifier;

let verifier = LightwalletdVerifier::new(); // Mainnet
// or
let verifier = LightwalletdVerifier::testnet(); // Testnet
```

### 2. Configure Confirmations

For different risk levels:

```rust
// Micropayments (< $1): 0-1 confirmations
.min_confirmations(0)

// Standard payments: 1-3 confirmations  
.min_confirmations(1)

// High-value (> $100): 6+ confirmations
.min_confirmations(6)
```

### 3. Set Reasonable Expiry

```rust
.max_age_minutes(15)  // 15 minutes to pay
```

### 4. Use Payment IDs

Track payments with unique IDs:

```rust
let payment = X402Builder::new()
    .address("zs1...")
    .amount_zec(0.001)
    .random_payment_id()  // Auto-generate
    .build();

// Access the ID
println!("Payment ID: {:?}", payment.payment_id);
```

## Common Issues & Solutions

### "Payment not found"

1. **Transaction not yet broadcast**: Wait for the wallet to broadcast
2. **Wrong network**: Make sure you're using mainnet/testnet consistently
3. **Wrong txid format**: Must be 64 hex characters (lowercase)

### "Amount mismatch"

The payment amount doesn't match what was required. Users must send the **exact** amount (or more).

### "Address mismatch"

Payment was sent to a different address. This can happen if:
- Multiple instances running with different addresses
- User sent to wrong address

### "Insufficient confirmations"

Payment is found but not yet confirmed. The user needs to wait for more blocks.

### Payment expired

The 402 response has an expiry time. If the user takes too long to pay, they need to request a new payment.

## Security Checklist

- [ ] Use shielded addresses (zs1...) for privacy
- [ ] Set appropriate confirmation requirements
- [ ] Use HTTPS in production
- [ ] Validate all inputs
- [ ] Log payment attempts for auditing
- [ ] Have a refund policy for failed services

## Getting Help

- Open an issue on GitHub
- Check the [examples](./examples/)
- Read the [API documentation](./README.md)

