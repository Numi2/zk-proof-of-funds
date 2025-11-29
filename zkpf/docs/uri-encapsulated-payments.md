# URI-Encapsulated Payments for Zcash

> Send ZEC via Signal, WhatsApp, or any secure messaging app — no address exchange needed.

## Overview

URI-Encapsulated Payments enable sending Zcash via any secure messaging channel. The sender creates an ephemeral wallet, transfers funds to it, and shares a URI containing the spending key. The recipient clicks the link to claim the funds.

### Key Features

- **No address exchange required** — send funds using existing messaging contacts
- **Works without recipient wallet** — they can install one later to claim
- **Cancellable** — sender can reclaim unclaimed funds
- **Recoverable** — payments can be recovered from wallet backup
- **Privacy-preserving** — on-chain footprint indistinguishable from normal transactions

## URI Format

```
https://pay.withzcash.com:65535/v1#amount=1.23&desc=Payment+for+foo&key=zkey1...
```

### Components

| Component | Description |
|-----------|-------------|
| `https://` | HTTPS scheme for deep linking |
| `pay.withzcash.com` | Mainnet host (or `pay.testzcash.com` for testnet) |
| `:65535` | Maximum valid TCP port (unlikely to have HTTP server) |
| `/v1` | Version path |
| `#amount=` | Payment amount in ZEC |
| `&desc=` | Optional percent-encoded description |
| `&key=` | Bech32m-encoded 256-bit payment key |

### Key Encoding

Payment keys use Bech32m encoding with HRP:
- Mainnet: `zkey1...`
- Testnet: `zkeytest1...`

## Lifecycle

### 1. Creating a Payment

```
┌─────────────────────────────────────────────────────────┐
│  SENDER WALLET                                          │
│                                                         │
│  1. Derive ephemeral key from seed (ZIP 32)            │
│  2. Generate payment address from key                   │
│  3. Create transaction sending amount + fee             │
│  4. Broadcast transaction                               │
│  5. Generate URI with key + amount                      │
│  6. Share URI via messaging app                         │
└─────────────────────────────────────────────────────────┘
```

### 2. Receiving a Payment

```
┌─────────────────────────────────────────────────────────┐
│  RECIPIENT WALLET                                       │
│                                                         │
│  1. Parse URI to extract key + amount                   │
│  2. Derive address from key                             │
│  3. Query blockchain for notes at address               │
│  4. Verify amount and confirmations                     │
│  5. Display "Ready to Finalize" status                  │
│  6. On finalize: spend notes to own address             │
└─────────────────────────────────────────────────────────┘
```

### 3. Wallet Recovery

When restoring from backup:

1. Derive payment keys starting from index 0
2. Use gap limit (N=3) to determine when to stop
3. Scan chain for notes addressed to derived keys
4. Recover any unfinalised payments

## Implementation

### Rust Crate (`zkpf-uri-payment`)

Core logic for key derivation, note construction, and URI parsing:

```rust
use zkpf_uri_payment::{
    EphemeralPaymentKey,
    PaymentKeyDerivation,
    PaymentNoteBuilder,
    PaymentUri,
    PaymentUriBuilder,
};

// Create a payment
let key = EphemeralPaymentKey::random(&mut rng);
let uri = PaymentUriBuilder::new(key, 123_000_000) // 1.23 ZEC in zatoshis
    .description("Payment for coffee")
    .build();

println!("Share this: {}", uri.to_uri_string());

// Parse a received URI
let parsed = PaymentUri::from_str(&uri_string)?;
let note = PaymentNoteBuilder::new(parsed.key().clone())
    .build(parsed.amount_zats())?;
```

### WASM Bindings (`webzjs-wallet`)

JavaScript-accessible APIs for browser wallets:

```typescript
import { UriPayment, isPaymentUri } from '@chainsafe/webzjs-wallet';

// Create payment
const payment = UriPayment.create(123_000_000n, "Coffee", false);
const uri = payment.toUri();
const message = payment.toShareableMessage();

// Parse payment
if (isPaymentUri(inputUri)) {
  const received = new UriPayment(inputUri);
  console.log(`Amount: ${received.amountZec} ZEC`);
  console.log(`Description: ${received.description}`);
}
```

### React Components

Full UI implementation in `web/src/components/uri-payment/`:

- `URIPaymentPage` — Main unified interface
- `URIPaymentCreate` — Create and share payments
- `URIPaymentReceive` — Verify and finalize payments
- `URIPaymentHistory` — View sent/received history
- `URIPaymentDeepLink` — Handle incoming URI links

## Security Considerations

### The URI is a Bearer Token

The payment URI contains the spending key. **Anyone with the URI can claim the funds.** Only share via end-to-end encrypted channels.

### Defense in Depth

Multiple layers prevent accidental fund loss:

1. **Unusual port (65535)** — Maximum valid port, unlikely to have HTTP server
2. **Fragment identifier** — Key is never sent to servers (critical security layer)
3. **No DNS record** — Domain should not resolve
4. **App whitelist** — Only approved wallets can handle URIs

### Best Practices

- ✅ Use Signal, WhatsApp, or other E2EE messengers
- ✅ Verify recipient identity before sending
- ✅ Cancel unclaimed payments promptly
- ❌ Don't share via email, SMS, or public channels
- ❌ Don't use as "cold wallet" storage
- ❌ Don't share the same URI with multiple people

## Key Derivation

Payment keys are derived deterministically from the wallet seed:

```
Path: m_Sapling / 324' / coin_type' / payment_index'

key = BLAKE2b-256(extended_spending_key, personal="Zcash_PaymentURI")
```

This ensures:
- Keys are unique and non-reusable
- Payments can be recovered from seed backup
- No additional secrets need to be stored

### Gap Limit

When recovering, scan until N=3 consecutive indices have no on-chain notes. This balances:
- Cost of scanning multiple IVKs
- Risk of missing funds from out-of-order creation

## Network Compatibility

| Network | Host | Key HRP |
|---------|------|---------|
| Mainnet | `pay.withzcash.com` | `zkey` |
| Testnet | `pay.testzcash.com` | `zkeytest` |

## Fee Structure

The sender includes the standard fee (0.00001 ZEC) in the payment:

```
Sender pays:  amount + 0.00001 ZEC
Recipient gets: amount (after finalization tx fee)
```

## Future Extensions

Potential enhancements under consideration:

- Multi-note payments for amounts requiring change
- Stealth memo field for additional metadata
- Time-locked payments with automatic cancellation
- Batch payment creation for airdrops

## References

- [ZIP 321: Payment Request URIs](https://zips.z.cash/zip-0321)
- [ZIP 32: Shielded Hierarchical Deterministic Wallets](https://zips.z.cash/zip-0032)
- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)
- [Bech32m Encoding](https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki)

