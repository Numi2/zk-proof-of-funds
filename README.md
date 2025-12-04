# zkpf web wallet

with zk features Built around your it

Proof-of-Funds
Generate zero-knowledge proofs from your wallet balance. Prove minimum thresholds without revealing exact amounts or addresses.

DEX Trading
DEX trading. Perpetual futures, spot trading, and portfolio management, leveraging Orderly Network.

P2P Marketplace
Buy & Sell goods and services with Zcash. Peer-to-peer chat facilitates negotiation and payment between parties. Verify what you wish before committing.

ZKPassport
Verify your identity, age, location, and more using passport data without storing PII or revealing sensitive information. Bind your verified personhood to your wallet.

Proof of real human Binding
Cryptographically bind your wallet to verified identity. Prove you control funds as a verified individual.

Cross-Chain
Bridge assets across chains while maintaining privacy. Generate proof-of-funds credentials for multiple networks.

Zero-Knowledge Proof of Funds (zkpf)

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


The implementation  uses the official Zcash cryptographic primitives as specified in the protocol, ensuring full compatibility and security with the Zcash network.


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
| `zkpf-mina` | Mina recursive proof hub. Wraps ProofBundles into Mina-native recursive proofs for cross-chain attestations. |
| `zkpf-mina-kimchi-wrapper` | Kimchi proof wrapper for BN254 circuit compatibility. |
| `zkpf-mina-rail` | Mina rail implementation for tachystamp aggregation. |
| `zkpf-mina-relayer` | Mina state relayer for cross-chain attestations. |
| `zkpf-rails-mina` | HTTP service for Mina rail endpoints. |
| `zkpf-starknet-l2` | Starknet L2 rail. DeFi position proving, account abstraction, session keys. |
| `zkpf-rails-starknet` | HTTP service for Starknet rail endpoints. |
| `zkpf-axelar-gmp` | Types, encoding, and chain configurations for Axelar GMP. |
| `zkpf-rails-axelar` | HTTP service for Axelar GMP integration and cross-chain transport. |
| `zkpf-wallet-state` | Wallet state machine with ZK proofs. |

The crate dependency graph flows: `zkpf-circuit` → `zkpf-common` → `zkpf-prover`/`zkpf-verifier` → `zkpf-backend`/`zkpf-wasm`. The Orchard crates extend this for shielded Zcash proofs. Rail-specific crates provide multi-chain support.

---

## Project Structure

```
zkpf/
├── Core Circuit & Proof System
│   ├── zkpf-circuit/          # Core Halo2 zero-knowledge circuit
│   ├── zkpf-prover/           # Proof generation
│   ├── zkpf-verifier/         # Proof verification
│   ├── zkpf-common/           # Shared types and utilities
│   ├── zkpf-wasm/             # WASM bindings for browser
│   ├── zkpf-test-fixtures/    # Deterministic test data
│   └── zkpf-tools/            # CLI utilities
│
├── Backend & API
│   ├── zkpf-backend/          # HTTP API server (Axum)
│   └── api/                   # API client libraries (chat, lightwalletd, p2p)
│
├── Zcash Orchard Rail
│   ├── zkpf-zcash-orchard-circuit/    # Orchard circuit extensions
│   ├── zkpf-zcash-orchard-wallet/     # Orchard wallet integration
│   ├── zkpf-orchard-inner/            # Inner proof types
│   ├── zkpf-orchard-pof-circuit/      # Orchard PoF circuit
│   └── zkpf-rails-zcash-orchard/      # Orchard rail HTTP service
│
├── Multi-Chain Rails
│   ├── zkpf-mina/                     # Mina recursive proof hub
│   │   ├── zkpf-mina-kimchi-wrapper/  # Kimchi wrapper for BN254
│   │   ├── zkpf-mina-rail/             # Mina rail implementation
│   │   ├── zkpf-mina-relayer/          # Mina state relayer
│   │   └── zkpf-rails-mina/            # Mina rail HTTP service
│   ├── zkpf-rails-starknet/            # Starknet rail HTTP service
│   │   └── zkpf-starknet-l2/           # Starknet L2 circuit and types
│   ├── zkpf-axelar-gmp/                # Axelar GMP types and encoding
│   │   └── zkpf-rails-axelar/          # Axelar rail HTTP service
│   └── zkpf-wallet-state/              # Wallet state machine with ZK proofs
│
├── Frontend & User Interfaces
│   ├── web/                   # React frontend dashboard
│   ├── zkpf-snap/             # MetaMask Snap for browser-based proofs
│   ├── webwallet/             # Full Zcash wallet in WebAssembly
│   ├── zkpf-chat/             # P2P chat application (frontend + backend)
│   └── zpkf-orderly/          # Orderly Network DEX integration
│
├── Smart Contracts
│   ├── contracts/
│   │   ├── AttestationRegistry.sol
│   │   ├── WalletCommitmentRegistry.sol
│   │   ├── BalanceSnapshotPublisher.sol
│   │   ├── axelar/            # Axelar GMP contracts
│   │   ├── mina/              # Mina zkApp contracts
│   │   ├── mina-bridge/       # Mina bridge contracts
│   │   ├── p2p/               # P2P marketplace contracts
│   │   ├── ramp/              # Ramp protocol contracts
│   │   └── starknet/          # Starknet Cairo contracts
│
├── Supporting Infrastructure
│   ├── config/                # Configuration files (policies, manifests)
│   ├── artifacts/             # Circuit artifacts (params, keys, manifests)
│   ├── data/                  # Persistent data (nullifiers.db, personhood.db)
│   ├── vendor/                # Forked dependencies (halo2-axiom, halo2-base, etc.)
│   ├── docs/                  # Documentation
│   ├── experiments/           # Experimental crates (not in main workspace)
│   ├── xtask/                 # Build automation
│   ├── Dockerfile             # Container configuration
│   ├── fly.toml               # Fly.io deployment config
│   └── vercel.json            # Vercel deployment config
│
└── Additional Features
    ├── zkpf-uri-payment/      # URI-Encapsulated Payments (ZIP 324)
    └── validate_attestation.py # Attestation validation script
```

## Key Components

### Core Circuit (`zkpf-circuit/`)

The Halo2 zero-knowledge circuit. Verifies ECDSA signatures from allow-listed custodians, enforces balance thresholds and policy requirements, generates nullifiers for replay protection. Supports multiple proof "rails" (custodial, Orchard, provider-backed).

### Backend API (`zkpf-backend/`)

Axum-based REST server. The `api/` directory contains client libraries for chat, lightwalletd, and P2P functionality.

Endpoints:

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

Zcash wallet implementation in WebAssembly. Four Rust crates compiled to WASM with a React frontend. Supports shielded transactions and note management.

### Chat Application (`zkpf-chat/`)

Peer-to-peer chat application for P2P marketplace negotiations. Includes browser WASM backend, CLI, and React frontend.

### Orderly Network Integration (`zpkf-orderly/`)

DEX trading integration with Orderly Network. Supports perpetual futures, spot trading, and portfolio management.

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
- **[Architecture](zkpf/architecture.md)** — System architecture and design patterns
- **[Tachyon Architecture](zkpf/docs/tachyon-architecture.md)** — Multi-chain wallet architecture
- **[MetaMask Snap](zkpf/zkpf-snap/README.md)** — Snap installation and usage
- **[WebWallet API](zkpf/webwallet/readme.md)** — WebWallet class documentation
- **[Mina Rail](zkpf/docs/mina-rail.md)** — Mina recursive proof hub specification
- **[Mina Roadmap](zkpf/docs/mina-roadmap.md)** — Mina integration roadmap
- **[Starknet Rail](zkpf/docs/starknet-rail.md)** — Starknet L2 rail documentation
- **[Axelar GMP](zkpf/docs/axelar-gmp.md)** — Axelar General Message Passing integration
- **[On-Chain Design](zkpf/docs/onchain-proof-of-funds.md)** — On-chain rail specification
- **[URI Payments](zkpf/docs/uri-encapsulated-payments.md)** — URI-Encapsulated Payments (ZIP 324)
- **[Mina Bridge](zkpf/docs/mina-bridge.md)** — Mina bridge implementation
- **[Web Console](zkpf/web/README.md)** — Frontend documentation


## Development

See [`zkpf/README.md`](zkpf/README.md) for detailed setup instructions, test commands, and build steps.

## License

See individual crate `Cargo.toml` files for license information.


