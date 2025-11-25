# Mina Integration Roadmap

## Vision
**"PoF verified once in a privacy-preserving way; many chains can reuse it."**

With Mina's ~22KB light client footprint, institutional verifiers can self-verify proofs cheaply without running full nodes.

---

## Current Status ✅

| Component | Status | Location |
|-----------|--------|----------|
| Core Rust crate (`zkpf-mina`) | ✅ Complete | `zkpf-mina/` |
| HTTP API service (`zkpf-rails-mina`) | ✅ Complete | `zkpf-rails-mina/` |
| Mina zkApp contracts (o1js) | ✅ Complete | `contracts/mina/` |
| Documentation | ✅ Complete | `docs/mina-rail.md` |
| Test fixtures | ✅ Complete | `zkpf-test-fixtures/src/mina.rs` |

---

## Remaining Work

### Phase 1: Cross-Chain Bridge Contracts 🌉

#### 1.1 EVM Light Client Bridge
**Priority: HIGH** | **Complexity: HIGH**

Create contracts that allow EVM chains to verify Mina attestations trustlessly.

```
contracts/mina-bridge/
├── MinaLightClient.sol       # Verifies Mina state proofs
├── AttestationBridge.sol     # Receives & caches attestations
├── IZkpfMinaBridge.sol       # Interface for DeFi integrations
└── test/
    └── MinaBridge.t.sol
```

**Key tasks:**
- [ ] Implement Kimchi/Pickles proof verification in Solidity
- [ ] State root tracking and update mechanism
- [ ] Attestation caching with expiry
- [ ] Gas-optimized `hasValidPoF()` view function
- [ ] Deploy to Ethereum Sepolia, then mainnet

**Interface:**
```solidity
interface IZkpfMinaBridge {
    struct AttestationQuery {
        bytes32 holderBinding;
        uint64 policyId;
        uint64 epoch;
    }
    
    /// @notice Check if holder has valid PoF attestation
    /// @param query The attestation query parameters
    /// @param minaProof Merkle proof from Mina state
    /// @return True if valid attestation exists
    function hasValidPoF(
        AttestationQuery calldata query,
        bytes calldata minaProof
    ) external view returns (bool);
    
    /// @notice Update Mina state root (called by relayer)
    function updateStateRoot(
        bytes32 newRoot,
        uint64 minaSlot,
        bytes calldata stateProof
    ) external;
}
```

#### 1.2 Starknet Bridge Contract
**Priority: HIGH** | **Complexity: MEDIUM**

Extend existing Starknet contracts to receive Mina attestations.

```
contracts/starknet/src/
├── MinaBridge.cairo          # NEW: Mina attestation receiver
└── ... existing contracts
```

**Key tasks:**
- [ ] Implement Mina state root verification in Cairo
- [ ] Attestation storage and query
- [ ] Integration with existing `ZkpfVerifier.cairo`

#### 1.3 Other L2 Bridges
**Priority: MEDIUM** | **Complexity: MEDIUM**

```
contracts/mina-bridge/
├── optimism/
├── arbitrum/
├── base/
├── polygon/
└── zksync/
```

---

### Phase 2: Relayer Infrastructure 🔄

**Priority: HIGH** | **Complexity: MEDIUM**

Build the infrastructure to propagate attestations from Mina to target chains.

#### 2.1 Relayer Service

```
zkpf-mina-relayer/
├── src/
│   ├── main.rs
│   ├── mina_listener.rs      # Subscribe to zkApp events
│   ├── message_queue.rs      # Attestation queue
│   ├── evm_submitter.rs      # Submit to EVM chains
│   ├── starknet_submitter.rs # Submit to Starknet
│   └── config.rs
├── Cargo.toml
└── Dockerfile
```

**Key tasks:**
- [ ] Event listener for Mina zkApp attestation events
- [ ] Message queue for reliable delivery
- [ ] Multi-chain submission with gas optimization
- [ ] Retry logic and failure handling
- [ ] Metrics and monitoring

**Architecture:**
```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│  Mina Network   │      │    Relayer      │      │  Target Chains  │
│                 │      │                 │      │                 │
│  ZkpfVerifier   │─────►│  Event Listener │─────►│  EVM Bridge     │
│  zkApp events   │      │  Message Queue  │      │  Starknet       │
│                 │      │  Submitters     │      │  Polygon...     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

#### 2.2 Decentralized Relayer Network (Future)

- [ ] Incentive mechanism for relayers
- [ ] Slashing for malicious behavior
- [ ] Permissionless participation

---

### Phase 3: Mina Light Client SDK 🔬

**Priority: HIGH** | **Complexity: HIGH**

Enable institutional verifiers to self-verify Mina state cheaply.

#### 3.1 Light Client Library

```
zkpf-mina-light-client/
├── src/
│   ├── lib.rs
│   ├── state_proof.rs       # Verify Mina state proofs
│   ├── kimchi_verifier.rs   # Kimchi proof verification
│   ├── chain_sync.rs        # Lightweight chain sync
│   └── attestation.rs       # Query attestations
├── wasm/                    # WASM bindings for browser
└── ffi/                     # C/FFI for mobile/other langs
```

**Key tasks:**
- [ ] Implement Kimchi proof verification in Rust
- [ ] Minimal chain sync (headers only, ~22KB)
- [ ] Attestation query with Merkle proofs
- [ ] WASM compilation for browser use
- [ ] C FFI for mobile SDKs

**Usage:**
```rust
use zkpf_mina_light_client::{MinaLightClient, AttestationQuery};

// Initialize with ~22KB state
let client = MinaLightClient::new(MINA_TESTNET)?;

// Query attestation (trustless verification)
let query = AttestationQuery {
    holder_binding: [0u8; 32],
    policy_id: 100,
    epoch: 1700000000,
};

let result = client.verify_attestation(&query).await?;
println!("Has valid PoF: {}", result.is_valid);
```

#### 3.2 Institutional Verifier SDK

```
zkpf-institutional-sdk/
├── rust/
├── typescript/
├── python/
└── examples/
    ├── bank_compliance.rs
    ├── defi_integration.ts
    └── regulatory_audit.py
```

**Key tasks:**
- [ ] High-level API for common compliance checks
- [ ] Policy management and caching
- [ ] Audit logging and reporting
- [ ] Rate limiting and access control

---

### Phase 4: Production Deployment 🚀

#### 4.1 zkApp Deployment

**Priority: HIGH** | **Complexity: LOW**

```
contracts/mina/scripts/
├── compile.ts
├── deploy-testnet.ts
├── deploy-mainnet.ts
└── verify.ts
```

**Key tasks:**
- [ ] Compile zkApp circuits (o1js)
- [ ] Deploy to Berkeley testnet
- [ ] Integration testing
- [ ] Deploy to Mina mainnet
- [ ] Verify on Mina explorer

#### 4.2 Bridge Deployment

- [ ] Deploy EVM bridge to Sepolia
- [ ] Deploy Starknet bridge to Sepolia
- [ ] E2E testing across chains
- [ ] Mainnet deployment

---

### Phase 5: Developer Experience 🛠️

#### 5.1 Integration Examples

```
examples/
├── evm-defi-integration/     # Aave/Compound gating example
├── starknet-lending/         # zkLend integration
├── institutional-portal/     # Bank verification dashboard
└── multi-chain-kyc/          # KYC across chains
```

#### 5.2 Documentation

- [ ] Integration guides for each target chain
- [ ] API reference
- [ ] Security considerations
- [ ] Compliance playbooks

---

## Priority Matrix

| Phase | Component | Priority | Effort | Impact |
|-------|-----------|----------|--------|--------|
| 1.1 | EVM Light Client Bridge | 🔴 HIGH | HIGH | Critical |
| 1.2 | Starknet Bridge | 🔴 HIGH | MEDIUM | High |
| 2.1 | Relayer Service | 🔴 HIGH | MEDIUM | Critical |
| 3.1 | Light Client Library | 🔴 HIGH | HIGH | Critical |
| 4.1 | zkApp Deployment | 🔴 HIGH | LOW | Critical |
| 3.2 | Institutional SDK | 🟡 MEDIUM | MEDIUM | High |
| 1.3 | Other L2 Bridges | 🟡 MEDIUM | LOW | Medium |
| 5.1 | Integration Examples | 🟡 MEDIUM | LOW | High |

---

## Technical Challenges

### 1. Kimchi Verification on EVM
**Challenge:** Mina uses Kimchi (Plonk-ish) proofs over Pasta curves, which are not natively supported on EVM.

**Solutions:**
- **Approach A:** Use a recursive proof that wraps Kimchi into a BN254-friendly proof
- **Approach B:** Implement Pasta curve operations in Solidity (expensive)
- **Approach C:** Use Succinct's SP1 or similar zkVM to verify off-chain, post commitment on-chain

### 2. State Root Freshness
**Challenge:** Target chains need reasonably fresh Mina state roots.

**Solutions:**
- Frequent relayer updates (every N blocks)
- Optimistic updates with challenge period
- Epoch-based batching (daily updates)

### 3. Gas Costs
**Challenge:** Verifying Mina proofs on EVM is expensive.

**Solutions:**
- Batch multiple attestations per state update
- Cache frequently queried attestations
- Use L2s for cheaper verification

---

## Estimated Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1.1 (EVM Bridge) | 4-6 weeks | None |
| Phase 2.1 (Relayer) | 2-3 weeks | Phase 1.1 |
| Phase 3.1 (Light Client) | 4-6 weeks | None (parallel) |
| Phase 4.1 (Deployment) | 1-2 weeks | Phases 1, 2, 3 |
| Phase 5 (DX) | 2-3 weeks | Phase 4 |

**Total: ~12-16 weeks to production**

---

## Next Immediate Actions

1. **Start EVM Bridge Contract** - Most critical path item
2. **Design Kimchi→BN254 recursion** - Technical research needed
3. **Set up relayer skeleton** - Can run with mock data initially
4. **Deploy zkApp to testnet** - Unblocks integration testing

---

## Success Metrics

1. **Latency:** Attestation propagation < 5 minutes end-to-end
2. **Cost:** < $5 per attestation on Ethereum mainnet
3. **Adoption:** 3+ DeFi protocols integrating Mina bridge
4. **Verification:** Institutional users running light clients independently

