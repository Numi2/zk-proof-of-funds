# Axelar GMP Rail – Interchain Proof-of-Funds

The Axelar GMP rail enables zkpf attestations to be broadcast across chains via Axelar's **General Message Passing (GMP)** protocol. This transforms zkpf into interchain middleware, allowing dApps on any Axelar-connected chain to trust PoF status without custom bridges.

## Overview

### What Axelar GMP Gives You

- **General Message Passing**: Arbitrary data/function calls across EVM and Cosmos chains, not just token transfers
- **Unified Security**: Re-uses Axelar's existing security model and validator set
- **Broad Connectivity**: 50+ chains including Ethereum, L2s, and Cosmos ecosystem
- **Programmable Actions**: Trigger remote contract calls based on PoF receipts

### How zkpf Fits

- Use Axelar GMP as the standard way to broadcast PoF events/receipts from `AttestationRegistry` to any connected chain
- Let dApps on non-EVM chains subscribe to PoF status without custom bridges
- Enable interchain credit lines and undercollateralized lending based on remote PoF

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         zkpf Axelar GMP Rail                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Origin Chain (e.g., Ethereum)          │  Destination Chains                │
│  ┌─────────────────────────────────┐    │  ┌─────────────────────────────┐  │
│  │   AttestationRegistry.sol       │    │  │   PoFReceiver.sol (EVM)     │  │
│  │         ↓                       │    │  │   pof_receiver.rs (Cosmos)  │  │
│  │   AttestationBridge.sol         │───►│  │         ↓                   │  │
│  │         ↓                       │    │  │   Local dApps can query     │  │
│  │   Axelar Gateway               │    │  │   PoF status natively       │  │
│  └─────────────────────────────────┘    │  └─────────────────────────────┘  │
│                                          │                                    │
│  ┌─────────────────────────────────┐    │  ┌─────────────────────────────┐  │
│  │   zkpf-rails-axelar             │    │  │   Osmosis, Neutron, Sei,    │  │
│  │   (HTTP service)                │    │  │   Arbitrum, Optimism, Base  │  │
│  └─────────────────────────────────┘    │  └─────────────────────────────┘  │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### Solidity Contracts

| Contract | Purpose |
|----------|---------|
| `IAxelarGateway.sol` | Interface for Axelar Gateway and Gas Service |
| `AttestationBridge.sol` | Broadcasts PoF receipts via GMP to subscribed chains |
| `PoFReceiver.sol` | Receives and stores PoF receipts on destination EVM chains |

### Rust Crates

| Crate | Purpose |
|-------|---------|
| `zkpf-axelar-gmp` | Types, encoding, and chain configurations for Axelar GMP |
| `zkpf-rails-axelar` | HTTP service exposing Axelar PoF endpoints |

### CosmWasm Contract

| Contract | Purpose |
|----------|---------|
| `pof_receiver.rs` | CosmWasm contract for Cosmos chains (Osmosis, Neutron, etc.) |

## PoF Receipt Format

```rust
struct PoFReceipt {
    holder_id: [u8; 32],         // Pseudonymous holder identifier
    policy_id: u64,              // Policy under which proof was verified
    snapshot_id: [u8; 32],       // Snapshot identifier
    chain_id_origin: u64,        // Chain where attestation was recorded
    attestation_hash: [u8; 32],  // Hash of the full attestation
    validity_window: u64,        // Seconds until receipt expires
    issued_at: u64,              // Timestamp when attestation was issued
}
```

## Usage

### 1. Deploy Contracts

#### Origin Chain (e.g., Ethereum)

```bash
# Deploy AttestationBridge
forge create contracts/axelar/AttestationBridge.sol:AttestationBridge \
  --constructor-args \
    $AXELAR_GATEWAY \
    $AXELAR_GAS_SERVICE \
    $ATTESTATION_REGISTRY \
    $CHAIN_ID
```

#### Destination EVM Chain

```bash
# Deploy PoFReceiver
forge create contracts/axelar/PoFReceiver.sol:PoFReceiver \
  --constructor-args $AXELAR_GATEWAY
```

#### Destination Cosmos Chain

```bash
# Build and deploy CosmWasm contract
cd contracts/axelar/cosmwasm
cargo wasm
# Deploy via wasmd or appropriate chain CLI
```

### 2. Configure Subscriptions

```bash
# Subscribe a chain to receive broadcasts
curl -X POST http://localhost:3002/rails/axelar/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "chain_name": "osmosis",
    "receiver_contract": "osmo1abc..."
  }'
```

### 3. Broadcast PoF Receipts

```bash
# Broadcast to all subscribed chains
curl -X POST http://localhost:3002/rails/axelar/broadcast \
  -H "Content-Type: application/json" \
  -d '{
    "holder_id": "0x1234...",
    "policy_id": 300001,
    "snapshot_id": "0x5678...",
    "attestation_hash": "0xabcd...",
    "validity_window": 86400
  }'
```

### 4. Query PoF Status on Destination Chain

#### EVM (Solidity)
```solidity
IPoFReceiver receiver = IPoFReceiver(receiverAddress);
(bool hasPoF, StoredReceipt memory receipt) = receiver.checkPoF(holderId, policyId);
require(hasPoF, "PoF required");
```

#### Cosmos (CosmWasm)
```rust
let resp: CheckPoFResponse = deps.querier.query_wasm_smart(
    receiver_addr,
    &QueryMsg::CheckPoF { 
        holder_id: holder_id.to_string(), 
        policy_id: policy_id.into() 
    },
)?;
assert!(resp.has_pof, "PoF required");
```

## Interchain Actions

The Axelar GMP rail supports programmable interchain actions triggered by PoF receipts:

### Credit Lines

```json
{
  "policy_id": 300100,
  "rail_id": "AXELAR_GMP",
  "axelar_config": {
    "broadcast_chains": ["osmosis", "neutron"],
    "action_type": "CREDIT_LINE",
    "credit_params": {
      "max_credit_multiplier": 0.5,
      "interest_rate_bps": 500
    }
  }
}
```

When a holder proves ≥ 1 ETH on Ethereum:
1. PoF receipt broadcasts to Osmosis/Neutron
2. Remote lending protocol sees valid PoF
3. Protocol grants credit line up to 50% of proven balance
4. No collateral required on the destination chain

### Undercollateralized Borrowing

```json
{
  "action_type": "BORROW_WHITELIST",
  "borrow_params": {
    "max_ltv_bps": 8000
  }
}
```

### Custom Actions

```json
{
  "action_type": "CUSTOM",
  "custom_action": {
    "action_name": "mint_nft",
    "payload": "0x..."
  }
}
```

## Supported Chains

### EVM Chains

| Chain | Status | Gateway Address |
|-------|--------|-----------------|
| Ethereum | ✅ Production | `0x4F4495243837681061C4743b74B3eEdf548D56A5` |
| Arbitrum | ✅ Production | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Optimism | ✅ Production | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Base | ✅ Production | `0xe432150cce91c13a887f7D836923d5597adD8E31` |
| Polygon | ✅ Production | `0x6f015F16De9fC8791b234eF68D486d2bF203FBA8` |
| Avalanche | ✅ Production | `0x5029C0EFf6C34351a0CEc334542cDb22c7928f78` |
| Scroll | ✅ Production | See Axelar docs |
| zkSync Era | ✅ Production | See Axelar docs |
| Linea | ✅ Production | See Axelar docs |
| Blast | ✅ Production | See Axelar docs |

### Cosmos Chains

| Chain | Status | Notes |
|-------|--------|-------|
| Osmosis | ✅ Production | CosmWasm |
| Neutron | ✅ Production | CosmWasm |
| Sei | ✅ Production | CosmWasm + EVM |
| Injective | ✅ Production | CosmWasm |
| Celestia | ✅ Production | Via Axelar |
| dYdX | ✅ Production | Cosmos SDK |

## API Reference

### Health & Info

```
GET /health
GET /rails/axelar/info
```

### Chain Management

```
GET  /rails/axelar/chains              # List subscribed chains
GET  /rails/axelar/chains/supported    # List all supported chains
GET  /rails/axelar/subscriptions       # List active subscriptions
POST /rails/axelar/subscribe           # Subscribe a chain
POST /rails/axelar/unsubscribe         # Unsubscribe a chain
```

### Broadcasting

```
POST /rails/axelar/broadcast           # Broadcast to all chains
POST /rails/axelar/broadcast/:chain    # Broadcast to specific chain
```

### Receiving (Demo)

```
POST /rails/axelar/receive             # Receive GMP message
```

### Queries

```
POST /rails/axelar/check-pof           # Check PoF status
GET  /rails/axelar/receipt/:holder/:policy  # Get specific receipt
```

### Gas Estimation

```
POST /rails/axelar/estimate-gas        # Estimate broadcast gas
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ZKPF_AXELAR_GATEWAY` | Axelar Gateway contract address | None |
| `ZKPF_AXELAR_GAS_SERVICE` | Axelar Gas Service address | None |
| `ZKPF_ORIGIN_CHAIN_ID` | Origin chain ID | `1` |
| `ZKPF_ORIGIN_CHAIN_NAME` | Axelar chain identifier | `ethereum` |
| `ZKPF_AXELAR_VALIDITY_WINDOW` | Default receipt validity (seconds) | `86400` |
| `PORT` | Service port | `3002` |

## Security Considerations

### Trusted Sources

The `PoFReceiver` contract maintains a list of trusted source bridges:

```solidity
function addTrustedSource(
    string calldata chainName,
    string calldata bridgeContract
) external onlyAdmin;
```

Only messages from trusted sources are processed. This prevents:
- Forged PoF receipts from malicious contracts
- Cross-chain replay attacks
- Unauthorized attestation injection

### Receipt Expiration

All PoF receipts have a validity window. After expiration:
- `checkPoF()` returns `false`
- dApps must request a fresh proof
- Stale receipts cannot be exploited

### Nullifier Enforcement

The origin chain's `AttestationRegistry` enforces nullifiers. Even if the same attestation is broadcast multiple times, the underlying proof cannot be double-spent.

## Integration Examples

### Osmosis Lending Protocol

```rust
// In your Osmosis lending contract
fn execute_borrow(
    deps: DepsMut,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    // Query PoF receiver
    let pof_status: CheckPoFResponse = deps.querier.query_wasm_smart(
        POF_RECEIVER_ADDR,
        &QueryMsg::CheckPoF {
            holder_id: info.sender.to_string(),
            policy_id: LENDING_POLICY_ID.into(),
        },
    )?;
    
    if !pof_status.has_pof {
        return Err(ContractError::PoFRequired {});
    }
    
    // Calculate max borrow based on PoF threshold
    let max_borrow = calculate_credit_line(pof_status.receipt)?;
    ensure!(amount <= max_borrow, ContractError::ExceedsCredit {});
    
    // Proceed with undercollateralized borrow
    process_borrow(deps, info, amount)
}
```

### Arbitrum DEX with PoF Gating

```solidity
contract GatedDEX {
    IPoFReceiver public pofReceiver;
    uint256 public requiredPolicyId;
    
    function swapWithPoF(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external {
        (bool hasPoF,) = pofReceiver.checkPoF(
            keccak256(abi.encodePacked(msg.sender)),
            requiredPolicyId
        );
        require(hasPoF, "PoF required for high-value swaps");
        
        _executeSwap(tokenIn, tokenOut, amountIn);
    }
}
```

## Troubleshooting

### "Untrusted Source" Error

Ensure the source bridge is added as a trusted source on the receiver:

```bash
# On the receiver contract
cast send $RECEIVER "addTrustedSource(string,string)" "ethereum" "$BRIDGE_ADDRESS"
```

### "Receipt Expired" Error

The validity window has passed. Request a new attestation:

```bash
curl -X POST http://localhost:3000/zkpf/attest \
  -d '{ "holder_id": "...", "policy_id": 300001, "bundle": {...} }'
```

### Gas Estimation Failing

Check that:
1. Gas service is configured correctly
2. Sufficient ETH/native token for gas payment
3. Destination chain is supported by Axelar

## Future Work

1. **Automatic Broadcast on Attestation**: Wire the `AttestationRegistry` to automatically trigger GMP broadcasts when attestations are recorded.

2. **Pull-Based Queries**: Enable destination chains to query PoF status on-demand via GMP callbacks.

3. **Recursive Proofs**: Aggregate multiple PoF proofs into a single cross-chain proof for efficiency.

4. **Cross-L2 Aggregation**: Prove solvency across multiple L2s and broadcast the aggregate to any chain.

5. **IBC Integration**: Native IBC support for Cosmos chains without going through Axelar.

## References

- [Axelar Documentation](https://docs.axelar.dev)
- [Axelar GMP Overview](https://docs.axelar.dev/dev/general-message-passing/overview)
- [Supported Chains](https://docs.axelar.dev/dev/reference/mainnet-chain-names)
- [Gas Service](https://docs.axelar.dev/dev/gas-service/intro)

