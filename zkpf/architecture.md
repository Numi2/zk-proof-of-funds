# Architecture Documentation

This document describes the architectural choices, design patterns, and system organization of the zk-proof-of-funds (zkpf) project.

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Architecture Principles](#core-architecture-principles)
3. [Multi-Rail Architecture](#multi-rail-architecture)
4. [Circuit Design](#circuit-design)
5. [Proof System](#proof-system)
6. [Wallet Architecture](#wallet-architecture)
7. [Cross-Chain Architecture](#cross-chain-architecture)
8. [Frontend Architecture](#frontend-architecture)
9. [Data Flow](#data-flow)
10. [Security Architecture](#security-architecture)
11. [Dependency Management](#dependency-management)

---

## System Overview

zkpf is a zero-knowledge proof-of-funds system that enables users to prove they meet minimum balance requirements without revealing exact balances or wallet addresses. The system supports multiple "rails" (proof sources) and can aggregate proofs across different chains.

### Key Components

- **Core Circuit** (`zkpf-circuit`): Halo2-based ZK circuit for balance verification
- **Prover** (`zkpf-prover`): Proof generation service
- **Verifier** (`zkpf-verifier`): Proof verification logic
- **Backend** (`zkpf-backend`): HTTP API server (Axum)
- **Web Dashboard** (`web/`): React frontend for proof management
- **MetaMask Snap** (`zkpf-snap`): Browser-based proof generation
- **WebWallet** (`webwallet/`): Full Zcash wallet in WebAssembly
- **Multi-Rail Services**: Specialized services for different proof sources

---

## Core Architecture Principles

### 1. Privacy-First Design

- **Holder Tags**: Uses `keccak256(personal_sign(message))` for privacy-preserving identity
- **Zero-Knowledge**: Exact balances never revealed, only threshold satisfaction
- **Nullifier-Based Replay Protection**: Prevents proof reuse without revealing account details

### 2. Multi-Rail Support

The system supports multiple proof sources ("rails"):

- **Custodial Attestation** (`CUSTODIAL_ATTESTATION`): Traditional custodian-signed proofs
- **Zcash Orchard** (`ZCASH_ORCHARD`): Shielded Zcash note proofs
- **Provider Balance** (`PROVIDER_BALANCE_V2`): Generic provider-attested proofs
- **Mina Recursive** (`MINA_RECURSIVE`): Cross-chain compliance layer
- **Starknet L2** (`STARKNET_L2`): DeFi position proving
- **Axelar GMP** (`AXELAR_GMP`): Interchain proof transport

### 3. Modular Crate Structure

The workspace is organized into focused crates:

```
zkpf-circuit/          # Core Halo2 circuit
zkpf-prover/           # Proof generation
zkpf-verifier/         # Proof verification
zkpf-common/           # Shared types and utilities
zkpf-backend/          # HTTP API server
zkpf-wasm/             # WASM bindings
zkpf-rails-*/          # Rail-specific services
```

### 4. Deterministic Testing

- `zkpf-test-fixtures`: Generates reproducible test data using seeded RNG
- Enables consistent CI/CD testing without external dependencies

---

## Multi-Rail Architecture

### Rail Registry System

The backend uses a **multi-rail manifest** to configure available rails:

```json
{
  "rails": [
    {
      "rail_id": "ZCASH_ORCHARD",
      "circuit_version": 4,
      "manifest_path": "artifacts/orchard/manifest.json",
      "layout": "V2_ORCHARD"
    }
  ]
}
```

### Public Input Layouts

Different rails use different public input layouts:

- **V1**: Legacy custodial rail (8 public inputs)
- **V2_ORCHARD**: Orchard rail (V1 + snapshot fields)
- **V3_STARKNET**: Starknet rail (V1 + DeFi fields)
- **V4_MINA**: Mina rail (V1 + recursive proof fields)

### Rail Abstraction

All rails implement a common interface:

```rust
pub trait Rail {
    fn rail_id(&self) -> &str;
    fn generate_proof(&self, input: RailInput) -> Result<ProofBundle>;
    fn verify_proof(&self, bundle: &ProofBundle) -> Result<bool>;
}
```

---

## Circuit Design

### Halo2 Circuit Architecture

The core circuit uses **Axiom's Halo2 fork** which provides:
- Lookup optimizations
- Improved proving performance
- Multi-phase proving support

### Circuit Components

1. **ECDSA Signature Verification**: Verifies custodian signatures using secp256k1
2. **Balance Threshold Check**: Enforces `balance ≥ threshold` without revealing balance
3. **Nullifier Generation**: Creates replay-protection nullifiers
4. **Custodian Allowlist**: Enforces that only allow-listed keys can sign attestations

### Public Inputs (V1 Layout)

1. `threshold_raw` – Minimum balance required (u64)
2. `required_currency_code` – ISO-4217 currency code (u32)
3. `required_custodian_id` – Allow-listed custodian ID (u32)
4. `current_epoch` – Verifier-supplied epoch timestamp
5. `verifier_scope_id` – Domain separator for nullifier
6. `policy_id` – Policy identifier
7. `nullifier` – Poseidon hash for replay protection
8. `custodian_pubkey_hash` – Hash of custodian's public key

### Poseidon Hashing

The circuit uses Poseidon hashing for:
- Nullifier computation
- Custodian pubkey hashing
- State commitments

Parameters: `POSEIDON_T=3`, `POSEIDON_RATE=2`, full rounds optimized for bn256.

---

## Proof System

### Proof Generation Flow

```
1. Witness Construction
   ↓
2. Circuit Synthesis
   ↓
3. Proving Key Loading
   ↓
4. Proof Generation (Halo2 prover)
   ↓
5. Proof Serialization
   ↓
6. ProofBundle Creation
```

### ProofBundle Structure

```rust
pub struct ProofBundle {
    pub rail_id: String,
    pub circuit_version: u32,
    pub proof: Vec<u8>,
    pub public_inputs: VerifierPublicInputs,
}
```

### Verification Flow

```
1. ProofBundle Deserialization
   ↓
2. Policy Lookup
   ↓
3. Rail Selection (by rail_id)
   ↓
4. Public Input Validation
   ↓
5. Nullifier Replay Check
   ↓
6. Epoch Drift Check
   ↓
7. Halo2 Verification
   ↓
8. Result
```

### Artifact Management

- **Proving Keys**: Large binary blobs (~GB), loaded on-demand
- **Verifying Keys**: Smaller (~KB), loaded at startup
- **KZG Parameters**: Shared across circuits, loaded once
- **Manifest System**: JSON files describing artifact locations and hashes

---

## Wallet Architecture

### Tachyon Wallet Coordinator

The **Tachyon Wallet** orchestrates proofs across multiple chains:

```
┌─────────────────────────────────────┐
│    TachyonWallet Coordinator        │
├─────────────────────────────────────┤
│                                     │
│  ┌──────────┐  ┌──────────┐       │
│  │ ZcashRail│  │MinaRail  │       │
│  └────┬─────┘  └────┬──────┘       │
│       │             │              │
│       └──────┬──────┘              │
│              │                     │
│         ProofAggregator            │
│              │                     │
│       ┌──────┴──────┐              │
│       │             │              │
│  AxelarTransport  NEARAgent        │
│                                     │
└─────────────────────────────────────┘
```

### Chain Responsibilities

| Chain | Role | Why |
|-------|------|-----|
| **Zcash** | Privacy-preserving proofs | Gold-standard shielded UTXOs |
| **Mina** | Recursive aggregation | Constant-size proofs, infinite recursion |
| **Starknet** | DeFi position proving | Cheap STARK proving, rich DeFi |
| **Axelar** | Cross-chain transport | Battle-tested GMP infrastructure |
| **NEAR** | TEE-backed AI agent | Confidential compute enclaves |

### WebWallet Architecture

The WebWallet is split into four Rust crates compiled to WASM:

- `webzjs-keys`: Key derivation (ZIP-32)
- `webzjs-wallet`: Account management, balance tracking
- `webzjs-requests`: gRPC-web client for lightwalletd
- `webzjs-common`: Shared types and error handling

**Browser Compatibility**:
- Dual WASM builds: `pkg-threads` (with SharedArrayBuffer) and `pkg-single` (fallback)
- Automatic detection of browser capabilities
- WebWorker-based sync and proving

---

## Cross-Chain Architecture

### Axelar GMP Integration

Axelar General Message Passing enables interchain proof attestations:

```
zkpf Backend → AttestationRegistry → Axelar Gateway → Target Chains
```

**PoF Receipt Format**:
```rust
struct PoFReceipt {
    holder_id: [u8; 32],
    policy_id: u64,
    snapshot_id: [u8; 32],
    chain_id_origin: u64,
    attestation_hash: [u8; 32],
    validity_window: u64,
    issued_at: u64,
}
```

### Mina Recursive Proof Hub

Mina serves as a compliance layer:

1. zkpf ProofBundles are wrapped into Mina-native recursive proofs
2. Mina zkApp emits attestations
3. Other chains query via zkBridges
4. Original proofs remain hidden

**Benefits**:
- ~22KB light client footprint
- Institutional self-verification without full nodes
- Privacy preservation (only attestation bit propagated)

### Starknet Integration

Starknet rail supports:
- Account abstraction (session keys, batched signatures)
- DeFi position aggregation (JediSwap, Nostra, zkLend, etc.)
- Native STARK verification

---

## Frontend Architecture

### React Application Structure

```
web/
├── src/
│   ├── components/
│   │   ├── ProofWorkbench.tsx    # Main proof UI
│   │   ├── wallet/                # Wallet components
│   │   └── p2p/                   # P2P marketplace
│   ├── services/                  # API clients
│   ├── context/                   # React context providers
│   └── hooks/                     # Custom hooks
```

### State Management

- **React Context**: Global state (WebZjs wallet, API client)
- **React Query**: Server state caching and synchronization
- **localStorage**: Persistent state (offers, trades, payment history)

### MetaMask Snap Integration

The snap provides:
- Secure key storage in MetaMask's encrypted storage
- RPC interface: `selectPolicy`, `addFundingSource`, `createProof`
- Seed phrase never touches web pages

---

## Data Flow

### Proof Generation Flow

```
User Request
    ↓
Select Policy
    ↓
Add Funding Sources (Ethereum addresses, Zcash UFVK)
    ↓
Bind Holder Identity (sign message → holder_tag)
    ↓
Generate Proof (circuit synthesis + Halo2 proving)
    ↓
Create ProofBundle
    ↓
Export/Verify
```

### Verification Flow

```
ProofBundle Received
    ↓
Deserialize Bundle
    ↓
Lookup Policy
    ↓
Select Rail (by rail_id)
    ↓
Validate Public Inputs
    ↓
Check Nullifier (replay protection)
    ↓
Check Epoch Drift
    ↓
Halo2 Verification
    ↓
Return Result
```

### Multi-Rail Aggregation Flow

```
Multiple Rails Generate Proofs
    ↓
Mina Recursive Aggregator
    ↓
Wrap into Single Recursive Proof
    ↓
Emit Attestation
    ↓
Axelar GMP Broadcast
    ↓
Target Chains Receive Attestation
```

---

## Security Architecture

### Cryptographic Primitives

- **Halo2**: Zero-knowledge proof system (Axiom fork)
- **Poseidon**: Hash function (zk-friendly)
- **ECDSA**: secp256k1 signatures for custodians
- **KZG Commitments**: Polynomial commitments for proofs

### Security Properties

1. **Privacy**: Exact balances never revealed
2. **Replay Protection**: Nullifier-based, scoped to (scope_id, policy_id, epoch)
3. **Custodian Allowlist**: Only allow-listed keys can sign attestations
4. **Epoch Validation**: Time-based validity windows
5. **Policy Enforcement**: Server-side policy validation

### Key Management

- **Custodian Keys**: Allow-listed in circuit, never exposed
- **Holder Keys**: Managed by MetaMask Snap or WebWallet
- **TEE Keys**: NEAR TEE-backed agent for confidential operations

### Threat Model

**Protected Against**:
- Balance disclosure
- Proof replay attacks
- Unauthorized custodian signatures
- Time-based attacks (epoch drift)

**Not Protected Against**:
- Policy disclosure (public by design)
- Threshold disclosure (public by design)
- Holder tag correlation (if same message signed)

---

## Dependency Management

### Workspace Structure

The project uses a Cargo workspace with:
- **Core crates**: Circuit, prover, verifier, common
- **Rail crates**: Specialized services per rail
- **Vendor crates**: Forked dependencies (halo2-axiom, halo2-base, etc.)

### Version Conflicts

**Known Conflicts**:
1. **nonempty**: ChainSafe fork uses 0.11, orchard uses 0.7
   - **Impact**: `zkpf-zcash-orchard-wallet` disabled in workspace
2. **Solana**: Version conflict in omni-bridge
   - **Impact**: `zkpf-omni-bridge` and `zkpf-rails-omni` disabled

**Workarounds**:
- Disabled crates commented in `Cargo.toml`
- Patches via `[patch.crates-io]` for critical dependencies

### Vendor Dependencies

Forked dependencies in `vendor/`:
- `halo2-axiom`: Axiom's Halo2 fork with optimizations
- `halo2-base`: Circuit building utilities
- `halo2-ecc`: Elliptic curve operations
- `halo2curves-axiom`: Curve implementations

**Rationale**: Custom optimizations and fixes not yet upstreamed.

### Build System

- **Rust Toolchain**: Pinned via `rust-toolchain.toml`
- **WASM Target**: `wasm32-unknown-unknown` for browser builds
- **Feature Flags**: Conditional compilation for optional features

---

## Architecture Patterns

### 1. Rail Pattern

Each rail is a self-contained service:
- Own HTTP endpoints (`/rails/{rail_id}/*`)
- Own circuit implementation (if needed)
- Own state management
- Common `ProofBundle` output format

### 2. ProofBundle Abstraction

All rails produce the same `ProofBundle` structure:
- Enables uniform verification
- Supports multi-rail aggregation
- Simplifies frontend integration

### 3. Policy-Driven Verification

Policies define verification requirements:
- Threshold, currency, custodian
- Epoch windows, scope IDs
- Rail-specific metadata

### 4. Nullifier-Based Replay Protection

Nullifiers are computed as:
```
nullifier = Poseidon(account_id_hash, scope_id, policy_id, current_epoch)
```

- Scoped to verifier/policy/epoch
- Prevents proof reuse
- Privacy-preserving (no account disclosure)

### 5. Epoch-Based Time Windows

Time validation uses epochs:
- `issued_at ≤ current_epoch ≤ valid_until`
- Configurable drift tolerance (`ZKPF_VERIFIER_MAX_DRIFT_SECS`)
- Prevents stale proof acceptance

---

## Performance Considerations

### Proof Generation

- **Native**: Multi-threaded proving using Rayon
- **WASM**: Single-threaded fallback (no SharedArrayBuffer)
- **Proving Time**: 30-60 seconds for Orchard proofs

### Verification

- **Fast**: ~100ms for typical proofs
- **Batch Verification**: Supported via Halo2 batch API
- **Caching**: Verifying keys loaded at startup

### Storage

- **Nullifier DB**: Sled-backed persistent storage
- **Artifact Storage**: Large files (~GB), served via HTTP
- **State Management**: In-memory with persistence hooks

---

## Future Architecture Directions

### Planned Enhancements

1. **On-Chain Rail**: Merkle-based proofs from on-chain snapshots
2. **Cairo-Native Circuits**: Native STARK verification on Starknet
3. **Recursive Verification**: Cross-circuit proof composition
4. **Light Client Integration**: Self-verification without full nodes

### Scalability Considerations

- **Horizontal Scaling**: Stateless backend design
- **Proof Aggregation**: Mina recursion for batch verification
- **Caching**: Redis for nullifier checks (future)
- **CDN**: Artifact distribution via CDN

---

## Conclusion

The zkpf architecture is designed for:
- **Privacy**: Zero-knowledge proofs hide sensitive data
- **Modularity**: Multi-rail support enables diverse proof sources
- **Extensibility**: New rails can be added without core changes
- **Security**: Multiple layers of cryptographic protection
- **Performance**: Optimized for both proving and verification

The system successfully balances these goals while maintaining a clean, modular codebase organized around focused crates and clear interfaces.

