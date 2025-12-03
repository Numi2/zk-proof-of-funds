# Zero-Knowledge Proof of Funds (zkpf)

A system for generating and verifying zero-knowledge proofs of funds. This allows custodians, wallet providers, and crypto holders to prove they meet minimum balance requirements without revealing exact balances or sensitive wallet information.

**zkpf** enables privacy-preserving proof-of-funds attestations using zero-knowledge cryptography. Instead of sharing raw balance data, parties can:

- Generate cryptographic proofs that demonstrate sufficient funds
- Verify proofs without learning exact balances or wallet addresses
- Support multiple "rails" (custodial attestations, Zcash Orchard wallets, provider-backed proofs, and future on-chain rails)

Zcash cryptographic APIs
- Integrated `zcash_note_encryption::try_compact_note_decryption()` for cryptographically correct Orchard note detection
- Used `orchard::note_encryption::OrchardDomain` and `CompactAction` for proper domain construction
- Implemented UFVK parsing using `zcash_keys` to extract Orchard Full Viewing Keys
- Added proper nullifier derivation from decrypted notes using the Full Viewing Key


The implementation now uses the official Zcash cryptographic primitives as specified in the protocol, ensuring full compatibility and security with the Zcash network.



**Credits:**  WebZjs builds on [ChainSafe's fork of librustzcash](https://github.com/ChainSafe/librustzcash), which added WASM compatibility to the official Zcash libraries. Standing on the shoulders of giants.

---

## Rust Crates

The core proof system is implemented in Rust, built on [Axiom's Halo2 fork](https://github.com/axiom-crypto/halo2) which adds lookup optimizations and proving performance.

**Core crates:**

| Crate | Purpose |
|-------|---------|
| `zkpf-circuit` | The main Halo2 circuit. ECDSA signature verification, balance threshold checks, nullifier generation. Uses `halo2-base` for range checks and `halo2-ecc` for elliptic curve operations. |
| `zkpf-prover` | Proof generation. Supports both native (multicore) and WASM targets. Takes circuit inputs, runs the prover, outputs proof bytes. |
| `zkpf-verifier` | Proof verification. Loads the verification key, checks the proof against public inputs. |
| `zkpf-common` | Shared types: `ProofBundle`, `PublicInputs`, policy definitions, serialization. Also handles Poseidon hashing for nullifiers. |
| `zkpf-wasm` | WASM bindings via `wasm-bindgen`. Exposes `prove()` and `verify()` to JavaScript. Used by the web dashboard for client-side verification. |
| `zkpf-backend` | Axum HTTP server. Loads proving/verification keys at startup, serves the API endpoints. |
| `zkpf-test-fixtures` | Deterministic test data. Generates reproducible proofs using seeded RNG for CI and integration tests. |

**Zcash Orchard crates:**

| Crate | Purpose |
|-------|---------|
| `zkpf-zcash-orchard-circuit` | Orchard-specific circuit extensions. Verifies note commitments, Merkle paths, nullifier derivation inside Halo2. |
| `zkpf-zcash-orchard-wallet` | Wallet integration for Orchard notes. Implements proper trial decryption using `zcash_note_encryption` and `zcash_client_backend` for cryptographically correct note detection during blockchain synchronization. Extracts witness data needed for proof generation. |
| `zkpf-orchard-inner` | Inner proof types and serialization for Orchard rail. |

**Multi-chain rail crates:**

| Crate | Purpose |
|-------|---------|
| `zkpf-tachyon-wallet` | Unified multi-chain wallet coordinator. Orchestrates proofs across Zcash, Mina, Starknet, Axelar, and NEAR. |
| `zkpf-near-tee` | NEAR TEE-backed private AI agent. Wallet intelligence, proof strategy, intent parsing in confidential compute. |
| `zkpf-mina` | Mina recursive proof hub. Wraps ProofBundles into Mina-native recursive proofs for cross-chain attestations. |
| `zkpf-starknet-l2` | Starknet L2 rail. DeFi position proving, account abstraction, session keys. |
| `zkpf-rails-mina` | HTTP service for Mina rail endpoints. |
| `zkpf-rails-starknet` | HTTP service for Starknet rail endpoints. |
| `zkpf-rails-axelar` | Axelar GMP integration for cross-chain transport. |

The crate dependency graph flows: `zkpf-circuit` → `zkpf-common` → `zkpf-prover`/`zkpf-verifier` → `zkpf-backend`/`zkpf-wasm`. The Orchard crates extend this for shielded Zcash proofs. The Tachyon wallet coordinates across all rails.

---

## Project Structure

```
zkpf/
├── zkpf-circuit/          # Core Halo2 zero-knowledge circuit
├── zkpf-backend/          # HTTP API server (Axum)
├── zkpf-prover/           # Proof generation
├── zkpf-verifier/         # Proof verification
├── zkpf-common/           # Shared types and utilities
├── zkpf-wasm/             # WASM bindings for browser
├── zkpf-test-fixtures/    # Deterministic test data
├── zkpf-snap/             # MetaMask Snap for browser-based proofs
├── webwallet/             # Full Zcash wallet in WebAssembly
├── web/                   # React frontend dashboard
├── contracts/             # Solidity smart contracts
└── docs/                  # Detailed documentation
```

## Key Components

### Core Circuit (`zkpf-circuit/`)

The Halo2 zero-knowledge circuit. Verifies ECDSA signatures from allow-listed custodians, enforces balance thresholds and policy requirements, generates nullifiers for replay protection. Supports multiple proof "rails" (custodial, Orchard, provider-backed).

### Backend API (`zkpf-backend/`)

Axum-based REST server with the following endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/zkpf/verify` | POST | Verify raw proofs (low-level, requires separate public_inputs) |
| `/zkpf/verify-bundle` | POST | Verify proof bundles (recommended, accepts full `ProofBundle`) |
| `/zkpf/prove-bundle` | POST | Generate proofs (requires `ZKPF_ENABLE_PROVER=1`) |
| `/zkpf/policies` | GET | List all available verification policies |
| `/zkpf/policies/compose` | POST | Create or retrieve policies dynamically |
| `/zkpf/epoch` | GET | Current epoch timestamp and max drift tolerance |
| `/zkpf/attest` | POST | Record on-chain attestation (requires attestation feature) |
| `/zkpf/params` | GET | Circuit parameters and artifact URLs/blobs |

**Note:** On-chain attestation (`/zkpf/attest`) requires additional configuration via `ZKPF_ATTESTATION_ENABLED=1` and related environment variables. The prover endpoint (`/zkpf/prove-bundle`) is disabled by default in production deployments.

### Web Dashboard (`web/`)

React frontend for inspecting verifier parameters, uploading proof bundles, monitoring epoch drift, and managing provider sessions (Zashi integration).

### MetaMask Snap (`zkpf-snap/`)

The proof-of-funds snap described above. Manages policy selection, funding source aggregation, holder binding, and proof export. Maintains persistent state for proof history and network configuration.

### WebWallet (`webwallet/`)

The web Zcash wallet described above. Four Rust crates compiled to WASM, a React frontend (`web-wallet/`), and a companion snap for secure PCZT signing (`snap/`). The first browser-based Zcash wallet with full shielded transaction support.

### Tachyon Wallet (`zkpf-tachyon-wallet/`)

The unified multi-chain wallet coordinator described above. Orchestrates proofs across Zcash, Mina, Starknet, Axelar, and NEAR. Provides proof aggregation, cross-chain attestation transport, and TEE-backed wallet intelligence.

### NEAR TEE Agent (`zkpf-near-tee/`)

The TEE-backed private AI agent described above. Runs wallet intelligence, proof strategy recommendations, and intent parsing in Trusted Execution Environments. Provides privacy-preserving insights without exposing sensitive wallet data.

### Smart Contracts (`contracts/`)

Solidity contracts for on-chain functionality: `AttestationRegistry.sol` records verified attestations, `WalletCommitmentRegistry.sol` registers wallet commitments, `BalanceSnapshotPublisher.sol` publishes balance snapshots.

## Proof Rails

The system supports multiple "rails" for different use cases:

1. **Custodial Attestation** (`CUSTODIAL_ATTESTATION`) — Traditional custodian-signed balance attestations using secp256k1 ECDSA. Fully implemented and production-ready.

2. **Zcash Orchard** (`ZCASH_ORCHARD`) — Non-custodial proofs from Zcash shielded pools using Orchard note commitments and Merkle paths. Features proper trial decryption using official Zcash cryptographic APIs for secure note detection during synchronization. Architecture complete, circuit implementation in progress.

3. **Provider Balance** (`PROVIDER_BALANCE_V2`) — Generic provider-attested proofs. Wallet-agnostic balance attestations reusing the custodial circuit with provider keys.

4. **Mina Recursive** (`MINA_RECURSIVE`) — Cross-chain compliance layer. Wraps ProofBundles into Mina-native recursive proofs. Enables other chains to verify PoF attestations via zkBridges. Fully implemented.

5. **Starknet L2** (`STARKNET_L2`) — DeFi position proving on Starknet. Supports account abstraction, session keys, and aggregation across JediSwap, Nostra, zkLend, Ekubo, Haiko. Fully implemented.

6. **On-Chain** (design phase) — Merkle-based proofs from on-chain snapshots. See design doc for details.

## Privacy Model: Holder Tags

The holder tag system enables privacy-preserving identity:

```
holder_tag = keccak256(personal_sign(message))
```

Verifiers can confirm "same MetaMask identity signed both proofs" and link multiple proofs from the same holder. They cannot learn the actual wallet address, track the holder across different verifiers, or associate the proof with on-chain activity.

The holder tag is deterministic per message—the same user signing the same policy produces the same tag every time. Identity consistency without address exposure.

## Documentation

- **[Main README](zkpf/README.md)** — Comprehensive technical documentation
- **[Tachyon Architecture](zkpf/docs/tachyon-architecture.md)** — Multi-chain wallet architecture and design
- **[MetaMask Snap](zkpf/zkpf-snap/README.md)** — Snap installation, usage, and dapp integration
- **[WebWallet API](zkpf/webwallet/readme.md)** — Complete WebWallet class documentation
- **[Mina Rail](zkpf/docs/mina-rail.md)** — Mina recursive proof hub specification
- **[Starknet Rail](zkpf/docs/starknet-rail.md)** — Starknet L2 rail documentation
- **[On-Chain Design](zkpf/docs/onchain-proof-of-funds.md)** — On-chain rail specification
- **[Web Console](zkpf/web/README.md)** — Frontend documentation

## Development

See [`zkpf/README.md`](zkpf/README.md) for detailed setup instructions, test commands, and build steps.

## License

See individual crate `Cargo.toml` files for license information.


