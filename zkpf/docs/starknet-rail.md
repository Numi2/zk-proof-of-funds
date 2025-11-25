# Starknet L2 Rail

The Starknet L2 rail enables zero-knowledge proof-of-funds over Starknet accounts, DeFi positions, and vault shares. This document describes the architecture, integration, and usage.

## Overview

Starknet offers unique advantages for zkpf:

- **Native Account Abstraction**: All accounts are smart contracts, enabling session keys and batched signatures without additional infrastructure.
- **STARK-friendly Cryptography**: Pedersen hash and ECDSA over the Stark curve are zk-friendly.
- **Rich DeFi Ecosystem**: Prove ownership across JediSwap, Nostra, zkLend, Ekubo, and other protocols.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                        zkpf Starknet Rail                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────┐ │
│  │ zkpf-starknet-l2 │    │ zkpf-rails-starknet│    │   Cairo      │ │
│  │                  │    │                   │    │  Contracts   │ │
│  │  • Circuit       │◄──►│  • HTTP API       │◄──►│              │ │
│  │  • State reader  │    │  • Proof gen      │    │ • Attestation│ │
│  │  • AA wallet     │    │  • Verification   │    │   Registry   │ │
│  │  • Types         │    │                   │    │ • Verifier   │ │
│  └──────────────────┘    └───────────────────┘    └──────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Rust Crates

| Crate | Purpose |
|-------|---------|
| `zkpf-starknet-l2` | Core circuit, types, state reader, and AA wallet integration |
| `zkpf-rails-starknet` | HTTP service exposing Starknet PoF endpoints |

### Cairo Contracts

| Contract | Purpose |
|----------|---------|
| `AttestationRegistry.cairo` | On-chain attestation storage for Starknet dApps |
| `ZkpfVerifier.cairo` | Optional on-chain proof verification |
| `ZkpfGatedLending.cairo` | Example DeFi integration |

## Public Input Layout (V3_STARKNET)

The Starknet rail uses a V3_STARKNET public input layout:

| Index | Field | Description |
|-------|-------|-------------|
| 0 | `threshold_raw` | Minimum balance required |
| 1 | `required_currency_code` | Asset code (ETH=1027, STRK=22691, USD=840) |
| 2 | `current_epoch` | Unix timestamp for epoch |
| 3 | `verifier_scope_id` | Domain separator |
| 4 | `policy_id` | Policy identifier |
| 5 | `nullifier` | Replay protection hash |
| 6 | `custodian_pubkey_hash` | Zeroed for non-custodial rails |
| 7 | `block_number` | Starknet block number at snapshot |
| 8 | `account_commitment` | H(account_addresses) |
| 9 | `holder_binding` | H(holder_id || account_commitment) |
| 10 | `proven_sum` | Actual proven sum (optional) |

## Usage

### 1. Configure Policies

Add Starknet policies to `config/policies.json`:

```json
{
  "policy_id": 200001,
  "threshold_raw": 1000000000000000000,
  "required_currency_code": 1027,
  "verifier_scope_id": 400,
  "rail_id": "STARKNET_L2",
  "label": "Starknet ≥ 1 ETH",
  "category": "STARKNET"
}
```

### 2. Build Account Snapshot

```bash
curl -X POST http://localhost:3001/rails/starknet/build-snapshot \
  -H "Content-Type: application/json" \
  -d '{
    "accounts": [
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
    ],
    "tokens": [
      "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
    ]
  }'
```

### 3. Generate Proof

```bash
curl -X POST http://localhost:3001/rails/starknet/proof-of-funds \
  -H "Content-Type: application/json" \
  -d '{
    "holder_id": "my-holder-id",
    "policy_id": 200001,
    "verifier_scope_id": 400,
    "current_epoch": 1700000000,
    "threshold": 1000000000000000000,
    "currency_code": 1027,
    "asset_filter": "ETH",
    "snapshot": {
      "chain_id": "SN_SEPOLIA",
      "block_number": 123456,
      "block_hash": "0x...",
      "timestamp": 1700000000,
      "accounts": [...]
    }
  }'
```

### 4. Verify on Starknet

```cairo
// In your Cairo contract
let verifier = IZkpfVerifierDispatcher { contract_address: verifier_addr };
let has_pof = verifier.check_attestation(holder_id, policy_id, snapshot_id);
assert(has_pof, 'PoF required for this action');
```

## Account Abstraction Integration

### Session Keys

The Starknet rail supports account abstraction natively:

```rust
use zkpf_starknet_l2::wallet::{SessionKeyConfig, SessionKeyAuth};

// Create session key for proof signing
let session = SessionKeyConfig {
    public_key: "0x...",
    allowed_methods: vec!["sign_pof_message".into()],
    expires_at: now + 3600, // 1 hour
    max_value_per_call: None,
    max_total_value: None,
};

// Use session key for signing
let auth = SessionKeyAuth {
    config: session,
    authorization_signature: vec!["0x...".into()],
};
```

### Batched Signatures

For multi-account proofs, batch signatures efficiently:

```rust
use zkpf_starknet_l2::wallet::prepare_batch_request;

let batch = prepare_batch_request(
    "holder-123",
    200001, // policy_id
    1700000000, // epoch
    vec!["0x1...".into(), "0x2...".into()], // accounts
    Some(session_auth),
);
```

## DeFi Position Support

The Starknet rail can prove ownership of DeFi positions:

### Supported Protocols

| Protocol | Position Types |
|----------|----------------|
| JediSwap | LP tokens |
| Nostra | Lending, borrowing |
| zkLend | Deposits, collateral |
| Ekubo | Concentrated liquidity |
| Haiko | Vault shares |

### Position Snapshot Example

```json
{
  "defi_positions": [
    {
      "protocol": "Nostra",
      "position_type": "LENDING",
      "contract_address": "0x...",
      "value": 5000000000000000000,
      "usd_value": 10000000000
    }
  ]
}
```

## Cairo Contracts Deployment

### Deploy AttestationRegistry

```bash
cd zkpf/contracts/starknet
scarb build

# Deploy using starkli or sncast
starkli deploy \
  --account your-account.json \
  --rpc https://starknet-sepolia.public.blastapi.io \
  target/dev/zkpf_starknet_AttestationRegistry.sierra.json \
  --constructor-calldata <admin_address>
```

### Deploy ZkpfVerifier

```bash
starkli deploy \
  --account your-account.json \
  --rpc https://starknet-sepolia.public.blastapi.io \
  target/dev/zkpf_starknet_ZkpfVerifier.sierra.json \
  --constructor-calldata <admin_address> <registry_address> <chain_id>
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZKPF_STARKNET_RPC_URL` | Starknet RPC endpoint | None |
| `ZKPF_STARKNET_CHAIN_ID` | Chain identifier | `SN_SEPOLIA` |
| `PORT` | Rails service port | `3001` |

## Multi-Rail Manifest Configuration

Add Starknet to your multi-rail manifest:

```json
{
  "rails": [
    {
      "rail_id": "STARKNET_L2",
      "circuit_version": 3,
      "manifest_path": "artifacts/starknet/manifest.json",
      "layout": "V3_STARKNET"
    }
  ]
}
```

## Security Considerations

1. **Nullifier Replay**: Nullifiers are scoped to `(scope_id, policy_id, epoch)` to prevent replay attacks.

2. **Account Commitment**: The account commitment binds the proof to specific addresses, preventing address substitution.

3. **Holder Binding**: The holder binding ties the proof to a specific identity without revealing addresses.

4. **Session Key Limits**: Session keys have configurable expiration and value limits.

5. **On-Chain Verification**: For high-value operations, use on-chain proof verification via `ZkpfVerifier.cairo`.

## Future Work

1. **Cairo-native Circuit**: Implement the PoF circuit directly in Cairo for native STARK verification.

2. **Cross-L2 Proofs**: Enable proving across multiple L2s (Starknet + zkSync + Scroll).

3. **Recursive Proofs**: Use STARK recursion for aggregating many account proofs.

4. **Real-time DeFi**: Stream position values for dynamic PoF requirements.

