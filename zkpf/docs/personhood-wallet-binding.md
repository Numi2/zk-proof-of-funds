# Wallet-Bound Personhood

This document describes the wallet-bound personhood system, which allows users to prove they are a unique real person without revealing any personal information.

## Overview

The personhood system uses [ZKPassport](https://zkpassport.id) to verify that a user has a valid passport, then binds that verification to their Zcash wallet. The result is:

- **For users**: A "Verified as unique person" badge in their wallet
- **For the system**: Protection against bots and sybil attacks
- **For privacy**: No personal information is ever stored or transmitted

## Identifiers

### personhood_id

A unique identifier from ZKPassport that represents "this is a unique person."

- Derived from passport data using zero-knowledge proofs
- Scoped to `zkpf-wallet-binding-v1` so it's unique to our application
- We never see or store the underlying passport data
- One person gets one `personhood_id` per domain+scope

### wallet_binding_id

A deterministic identifier for a wallet, derived from the UFVK (Unified Full Viewing Key).

```
wallet_binding_id = BLAKE2b-256("zkpf-wallet-binding" || ufvk)
```

- Stable across sessions
- Doesn't expose the viewing key
- Allows us to track which wallets are verified

## User Flow

1. **User clicks "Verify with your passport"** in wallet settings
2. **QR code appears** - user scans with ZKPassport app on their phone
3. **Passport scan** - user taps their passport to their phone (NFC)
4. **ZK proof generated** - proves personhood without revealing data
5. **Wallet signs a challenge** - proves control of this wallet
6. **Backend stores binding** - links personhood_id to wallet_binding_id
7. **UI shows "Verified"** - user is done

## Technical Architecture

### Frontend Components

```
zkpf/web/src/
├── types/personhood.ts          # TypeScript types
├── utils/personhood.ts          # Core utilities
├── hooks/usePersonhood.ts       # React hook
└── components/wallet/
    ├── PersonhoodSettings.tsx   # UI component
    └── PersonhoodSettings.css   # Styles
```

### Backend Components

```
zkpf/zkpf-backend/src/
└── personhood.rs                # Rust module with:
    - PersonhoodStore            # sled database
    - bind_wallet_handler        # POST /api/personhood/bind-wallet
    - status_handler             # GET /api/personhood/status
```

## API Reference

### POST /api/personhood/bind-wallet

Binds a wallet to a verified personhood identity.

**Request:**
```json
{
  "challenge": {
    "personhood_id": "zkp_abc123...",
    "wallet_binding_id": "deadbeef1234...",
    "issued_at": 1700000000000,
    "version": 1
  },
  "challenge_json": "{\"personhood_id\":\"zkp_abc123...\",\"wallet_binding_id\":\"deadbeef1234...\",\"issued_at\":1700000000000,\"version\":1}",
  "signature": "ed25519_signature_hex...",
  "wallet_pubkey": "ed25519_pubkey_hex..."
}
```

**Response (success):**
```json
{
  "status": "ok",
  "personhood_id": "zkp_abc123...",
  "wallet_binding_id": "deadbeef1234...",
  "active_bindings_count": 1
}
```

**Error responses:**
- `400 challenge_expired` - Challenge older than 10 minutes
- `400 invalid_signature` - Ed25519 signature verification failed
- `400 invalid_input` - Malformed request
- `403 too_many_wallet_bindings` - Person has 3 wallets already
- `403 personhood_not_active` - Personhood was revoked/blocked

### GET /api/personhood/status

Check personhood status for a wallet.

**Query parameters:**
- `wallet_binding_id` - The wallet binding ID to check

**Response:**
```json
{
  "personhood_verified": true,
  "personhood_id": "zkp_abc123...",
  "bindings_count_for_person": 2
}
```

## Signature Scheme

Since the Zcash web wallet only stores viewing keys (not spending keys), we derive an Ed25519 signing key from the UFVK:

```
private_key = BLAKE2b-256("zkpf-personhood-signing-v1" || ufvk)
public_key  = Ed25519_PublicKey(private_key)
```

This proves control of the wallet because:
- Only someone with the UFVK can derive this key
- The derivation is deterministic
- The UFVK is secret (stored in localStorage)

## Policy

- **Maximum 3 wallets per person** - One person can bind up to 3 wallets
- **Idempotent rebinding** - Re-binding the same wallet is a no-op (returns success)
- **Challenge freshness** - Challenges expire after 10 minutes
- **No PII storage** - Only identifiers and timestamps are stored

## Privacy Guarantees

What we **DO NOT** store:
- Passport name, date of birth, nationality
- Passport number or any document identifiers
- Photos or biometric data
- Viewing keys, spending keys, or addresses
- Any personally identifiable information

What we **DO** store:
- `personhood_id` (opaque ZKPassport identifier)
- `wallet_binding_id` (derived from UFVK)
- Timestamps (first_seen, last_seen, created_at)
- Simple counts and flags

## Error Handling

The UI provides clear messages for all error cases:

| Error | User Message |
|-------|-------------|
| User cancels | "You cancelled the passport verification. Your wallet is still fully usable." |
| Timeout | "The passport scan timed out. Please try again when ready." |
| SDK error | "Passport verification failed. Please try again." |
| Signing failed | "Failed to sign with wallet. Please try again." |
| Too many wallets | "This passport has already been used with too many wallets." |
| Network error | "Network error. Please check your connection." |

## Testing

### Backend Tests

Run with:
```bash
cargo test -p zkpf-backend --lib -- personhood
```

Test cases:
- Happy path (new person + new wallet)
- Idempotent rebind (same pair twice)
- Exceed binding limit (4th wallet)
- Invalid signature
- Expired challenge
- Status for unbound vs bound wallet

### Frontend Tests

The frontend utilities can be tested with:
- `computeWalletBindingId` determinism tests
- Mock ZKPassport SDK for error handling
- Integration tests with real backend

### Manual Acceptance Testing

1. **Fresh user flow**:
   - Create new wallet
   - Click "Verify with your passport"
   - Scan QR with ZKPassport app
   - Complete passport scan
   - See "Verified" status

2. **Cancellation**:
   - Start verification
   - Click Cancel
   - Verify wallet still works normally

3. **Network failure**:
   - Start verification
   - Disable network mid-flow
   - Verify clear error message
   - Verify retry works when network restored

## Database Schema

Using sled (embedded key-value store):

**Tree: `credentials`**
- Key: `personhood_id`
- Value: JSON of `PersonhoodCredential`

**Tree: `links`**
- Key: `{personhood_id}:{link_id}`
- Value: JSON of `WalletPersonhoodLink`

```rust
struct PersonhoodCredential {
    personhood_id: String,
    status: PersonhoodStatus, // active, revoked, blocked
    first_seen_at: u64,
    last_seen_at: u64,
    last_bind_at: Option<u64>,
}

struct WalletPersonhoodLink {
    id: u64,
    personhood_id: String,
    wallet_binding_id: String,
    created_at: u64,
    revoked_at: Option<u64>,
}
```

## Future Enhancements

- **Revocation** - Allow users to unbind a wallet
- **Admin tools** - Block/unblock personhood IDs
- **Rate limiting** - Prevent abuse of bind endpoint
- **Audit logging** - Track verification events
- **Multiple scopes** - Different personhood contexts for different features
