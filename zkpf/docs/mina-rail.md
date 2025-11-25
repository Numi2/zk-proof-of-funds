# Mina Recursive Proof Hub Rail

The Mina rail enables zkpf to serve as a **cross-chain compliance layer** by wrapping zkpf ProofBundles into Mina-native recursive proofs. This allows other chains (EVM, Starknet, etc.) to verify proof-of-funds attestations through Mina's lightweight nodes.

## Overview

### What Mina Gives You

- **zkApps with native ZK**: Proofs generated off-chain (e.g., browser) and verified on-chain
- **Recursive proofs**: Wrap multiple proofs into a single, smaller proof
- **zkBridges**: Propagate verified information to other chains
- **Light client footprint**: Institutional verifiers can self-verify cheaply

### How zkpf Fits

1. **ProofBundle wrapping**: Existing zkpf proofs from any rail are wrapped into Mina-native recursive proofs
2. **Cross-chain attestations**: The Mina zkApp emits attestations that other chains can query
3. **Privacy preservation**: Original proofs and addresses remain hidden; only the attestation bit is propagated

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         zkpf Mina Recursive Hub                                 │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────────┐ │
│  │   zkpf-mina     │    │ zkpf-rails-mina  │    │    Mina zkApps            │ │
│  │                 │    │                  │    │                           │ │
│  │  • Circuit      │◄──►│  • HTTP API      │◄──►│ • ZkpfVerifier           │ │
│  │  • State mgmt   │    │  • Proof wrap    │    │ • AttestationRegistry    │ │
│  │  • Types        │    │  • Attestations  │    │ • ZkBridge               │ │
│  │  • GraphQL      │    │  • Bridge msgs   │    │                           │ │
│  └─────────────────┘    └──────────────────┘    └───────────────────────────┘ │
│                                                                                 │
│                                    ▼                                           │
│                         ┌──────────────────────┐                               │
│                         │    zkBridges         │                               │
│                         │                      │                               │
│                         │  ┌───────────────┐   │                               │
│                         │  │   Ethereum    │   │                               │
│                         │  │   Starknet    │   │                               │
│                         │  │   Polygon     │   │                               │
│                         │  │   Arbitrum    │   │                               │
│                         │  │   ...         │   │                               │
│                         │  └───────────────┘   │                               │
│                         └──────────────────────┘                               │
│                                                                                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Components

### Rust Crates

| Crate | Purpose |
|-------|---------|
| `zkpf-mina` | Core circuit, types, state management, and GraphQL client |
| `zkpf-rails-mina` | HTTP service exposing Mina PoF endpoints |

### Mina zkApp Contracts

| Contract | Purpose |
|----------|---------|
| `ZkpfVerifier` | Verifies zkpf ProofBundles and creates attestations |
| `AttestationRegistry` | Merkle tree storage for efficient attestation queries |
| `ZkBridge` | Generates cross-chain bridge messages |

## Public Input Layout (V4_MINA)

The Mina rail uses a V4_MINA public input layout:

| Index | Field | Description |
|-------|-------|-------------|
| 0 | `threshold_raw` | Minimum balance required |
| 1 | `required_currency_code` | Asset code (ETH=1027, USD=840, etc.) |
| 2 | `current_epoch` | Unix timestamp for epoch |
| 3 | `verifier_scope_id` | Domain separator |
| 4 | `policy_id` | Policy identifier |
| 5 | `nullifier` | Replay protection hash |
| 6 | `custodian_pubkey_hash` | Zeroed for non-custodial rails |
| 7 | `mina_slot` | Mina global slot at proof creation |
| 8 | `recursive_proof_commitment` | Hash of wrapped recursive proof |
| 9 | `zkapp_commitment` | Commitment to the verifier zkApp |
| 10 | `proven_sum` | Aggregated proven sum |

## Usage

### 1. Configure Policies

Add Mina policies to `config/policies.json`:

```json
{
  "policy_id": 300001,
  "threshold_raw": 1000000000000000000,
  "required_currency_code": 1027,
  "verifier_scope_id": 500,
  "rail_id": "MINA_RECURSIVE",
  "label": "Cross-chain ≥ 1 ETH (via Mina)",
  "category": "MINA"
}
```

### 2. Wrap Source Proofs

```bash
curl -X POST http://localhost:3002/rails/mina/wrap-proofs \
  -H "Content-Type: application/json" \
  -d '{
    "holder_id": "my-holder-id",
    "policy_id": 300001,
    "verifier_scope_id": 500,
    "current_epoch": 1700000000,
    "currency_code": 1027,
    "mina_slot": 500000,
    "source_proofs": [
      {
        "bundle": {
          "rail_id": "STARKNET_L2",
          "circuit_version": 3,
          "proof": "...",
          "public_inputs": { ... }
        },
        "rail_metadata": {
          "chain_id": "SN_SEPOLIA",
          "block_number": 123456
        }
      }
    ]
  }'
```

### 3. Verify Recursive Proof

```bash
curl -X POST http://localhost:3002/rails/mina/verify \
  -H "Content-Type: application/json" \
  -d '{
    "bundle": { ... }
  }'
```

### 4. Submit Attestation to zkApp

```bash
curl -X POST http://localhost:3002/rails/mina/submit-attestation \
  -H "Content-Type: application/json" \
  -d '{
    "bundle": { ... },
    "mina_slot": 500000,
    "validity_window_slots": 7200
  }'
```

### 5. Query Attestation

```bash
curl -X POST http://localhost:3002/rails/mina/query-attestation \
  -H "Content-Type: application/json" \
  -d '{
    "holder_binding": "0x...",
    "policy_id": 300001,
    "epoch": 1700000000
  }'
```

### 6. Create Bridge Message

```bash
curl -X POST http://localhost:3002/rails/mina/bridge-message \
  -H "Content-Type: application/json" \
  -d '{
    "holder_binding": "0x...",
    "policy_id": 300001,
    "epoch": 1700000000,
    "target_chain": "ethereum"
  }'
```

## Cross-Chain Integration

### For EVM Chains

Contracts on EVM chains can verify Mina attestations using the bridge message:

```solidity
interface IZkpfMinaBridge {
    struct AttestationQuery {
        bytes32 holderBinding;
        uint64 policyId;
        uint64 epoch;
    }
    
    function hasValidPoF(
        AttestationQuery calldata query,
        bytes calldata minaProof
    ) external view returns (bool);
}

// Usage in your contract
contract MyDeFiProtocol {
    IZkpfMinaBridge public bridge;
    
    function accessRestrictedFeature(
        bytes32 holderBinding,
        uint64 policyId,
        bytes calldata minaProof
    ) external {
        require(
            bridge.hasValidPoF(
                IZkpfMinaBridge.AttestationQuery(holderBinding, policyId, block.timestamp / 1 days),
                minaProof
            ),
            "PoF required"
        );
        // ... restricted logic
    }
}
```

### For Starknet

```cairo
#[starknet::interface]
trait IZkpfMinaBridge<TContractState> {
    fn has_valid_pof(
        ref self: TContractState,
        holder_binding: felt252,
        policy_id: u64,
        epoch: u64,
        mina_proof: Array<felt252>
    ) -> bool;
}

// Usage
fn access_restricted_feature(ref self: ContractState, mina_proof: Array<felt252>) {
    let bridge = IZkpfMinaBridgeDispatcher { contract_address: self.bridge_address.read() };
    assert(
        bridge.has_valid_pof(caller_binding, POLICY_ID, current_epoch, mina_proof),
        'PoF required'
    );
    // ... restricted logic
}
```

## Mina zkApp Deployment

### Prerequisites

```bash
cd zkpf/contracts/mina
npm install
npm run build
```

### Deploy ZkpfVerifier

```typescript
import { ZkpfVerifier } from '@zkpf/mina-contracts';
import { Mina, PrivateKey } from 'o1js';

// Connect to network
const network = Mina.Network('https://proxy.testworld.minaprotocol.network/graphql');
Mina.setActiveInstance(network);

// Deploy
const deployerKey = PrivateKey.fromBase58('...');
const zkAppKey = PrivateKey.random();
const zkApp = new ZkpfVerifier(zkAppKey.toPublicKey());

await ZkpfVerifier.compile();

const tx = await Mina.transaction(deployerKey.toPublicKey(), async () => {
  await zkApp.deploy();
});
await tx.prove();
await tx.sign([deployerKey, zkAppKey]).send();

console.log('Deployed at:', zkAppKey.toPublicKey().toBase58());
```

### Deploy AttestationRegistry

```typescript
import { AttestationRegistry } from '@zkpf/mina-contracts';

const registryKey = PrivateKey.random();
const registry = new AttestationRegistry(registryKey.toPublicKey());

await AttestationRegistry.compile();

const tx = await Mina.transaction(deployerKey.toPublicKey(), async () => {
  await registry.deploy();
});
await tx.prove();
await tx.sign([deployerKey, registryKey]).send();
```

### Deploy ZkBridge

```typescript
import { ZkBridge } from '@zkpf/mina-contracts';

const bridgeKey = PrivateKey.random();
const bridge = new ZkBridge(bridgeKey.toPublicKey());

await ZkBridge.compile();

const tx = await Mina.transaction(deployerKey.toPublicKey(), async () => {
  await bridge.deploy();
});
await tx.prove();
await tx.sign([deployerKey, bridgeKey]).send();

// Link to registry
const linkTx = await Mina.transaction(deployerKey.toPublicKey(), async () => {
  await bridge.setRegistry(registryKey.toPublicKey());
});
await linkTx.prove();
await linkTx.sign([deployerKey]).send();
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZKPF_MINA_NETWORK` | Mina network (mainnet/testnet/berkeley) | `testnet` |
| `ZKPF_MINA_GRAPHQL_URL` | Mina GraphQL endpoint | None |
| `ZKPF_MINA_ZKAPP_ADDRESS` | zkApp verifier address | None |
| `PORT` | Rails service port | `3002` |

## Multi-Rail Aggregation

The Mina rail can aggregate proofs from multiple source rails:

```json
{
  "source_proofs": [
    {
      "bundle": { "rail_id": "STARKNET_L2", ... },
      "rail_metadata": { "chain_id": "SN_SEPOLIA" }
    },
    {
      "bundle": { "rail_id": "ORCHARD", ... },
      "rail_metadata": { "block_height": 2500000 }
    },
    {
      "bundle": { "rail_id": "CUSTODIAL", ... },
      "rail_metadata": { "custodian": "example_bank" }
    }
  ]
}
```

This creates a single Mina attestation covering all source proofs, which can then be queried by any target chain.

## Security Considerations

1. **Recursive Proof Soundness**: The Mina recursive proof wraps source proofs cryptographically; tampering is computationally infeasible.

2. **Nullifier Scoping**: Nullifiers are scoped to `(scope_id, policy_id, epoch)` to prevent replay across different contexts.

3. **Attestation Expiry**: All attestations have a validity window (default 24 hours) to limit staleness.

4. **Admin Controls**: zkApp admin can revoke attestations and update supported rails if needed.

5. **Bridge Message Integrity**: Bridge messages include Merkle proofs of inclusion for independent verification.

6. **Light Client Verification**: Mina's 22KB blockchain snapshots enable trustless verification without full node.

## Compliance Use Cases

### KYC-Preserving Access Control

1. User proves bank balance ≥ $10,000 via custodial rail
2. Proof is wrapped into Mina attestation
3. DeFi protocol on Ethereum checks attestation via bridge
4. User accesses feature without revealing identity or exact balance

### Cross-Border Compliance

1. Institution proves reserves across multiple jurisdictions
2. Proofs from different custodians are aggregated on Mina
3. Regulators query Mina light client for aggregate compliance status
4. No individual account data leaves source jurisdictions

### Multi-Chain Portfolio Proof

1. User has assets on Ethereum, Starknet, and Zcash
2. Generates PoF on each chain
3. All proofs wrapped into single Mina attestation
4. Any chain can verify total portfolio meets threshold

## Future Work

1. **Full Halo2→Mina Verification**: Implement direct verification of bn256 proofs in o1js for stronger guarantees.

2. **Optimistic Bridges**: Add challenge period for high-value attestations.

3. **Threshold Attestations**: Support for multi-party computation of attestations.

4. **Real-time Updates**: WebSocket subscriptions for attestation state changes.

5. **IPFS Integration**: Store extended metadata on IPFS with zkApp references.

## API Reference

### `POST /rails/mina/wrap-proofs`

Wrap source proofs into a Mina recursive proof.

**Request:**
```json
{
  "holder_id": "string",
  "policy_id": 100,
  "verifier_scope_id": 42,
  "current_epoch": 1700000000,
  "currency_code": 1027,
  "mina_slot": 500000,
  "zkapp_address": "B62q...",
  "source_proofs": [...]
}
```

**Response:**
```json
{
  "success": true,
  "bundle": { ... },
  "attestation": { ... }
}
```

### `POST /rails/mina/verify`

Verify a Mina recursive proof bundle.

### `POST /rails/mina/submit-attestation`

Submit an attestation to the zkApp.

### `POST /rails/mina/query-attestation`

Query an attestation by holder binding, policy ID, and epoch.

### `POST /rails/mina/bridge-message`

Create a bridge message for cross-chain verification.

### `GET /rails/mina/info`

Get rail information and supported features.

### `GET /health`

Health check endpoint.

