# Zero-Knowledge Proof of Funds (zkpf)

A system for generating and verifying zero-knowledge proofs of funds. This allows custodians, wallet providers, and crypto holders to prove they meet minimum balance requirements without revealing exact balances or sensitive wallet information.

**zkpf** enables privacy-preserving proof-of-funds attestations using zero-knowledge cryptography. Instead of sharing raw balance data, parties can:

- Generate cryptographic proofs that demonstrate sufficient funds
- Verify proofs without learning exact balances or wallet addresses
- Support multiple "rails" (custodial attestations, Zcash Orchard wallets, provider-backed proofs, and future on-chain rails)

## 🆕 Recent Work

### MetaMask Snap for Proof-of-Funds

We built a MetaMask Snap that lets anyone prove they have funds without revealing how much or where. The whole flow happens inside MetaMask—no external tools, no command line, no exposing your keys to random websites.

The core insight: **you don't need to prove your exact balance, you just need to prove it's above a threshold**. And you don't need to reveal your wallet address to do it.

Here's what we solved:

**The Identity Problem** — Verifiers need to know "this is the same person who proved funds last month" without learning your actual address. We solved this with **holder tags**: `keccak256(signature)`. You sign a message, we hash it. The same person signing the same message produces the same tag every time. Verifiers can link your proofs together without ever seeing your address.

**The Multi-Asset Problem** — People hold funds across different chains. The snap lets you aggregate Ethereum addresses and Zcash viewing keys into a single proof. One bundle, multiple sources.

**The UX Problem** — Previous proof-of-funds systems required running provers locally or trusting centralized services. The snap runs entirely in MetaMask's sandboxed environment. Your keys never leave the browser extension.

The snap exposes a clean RPC interface: `selectPolicy`, `addFundingSource`, `bindHolder`, `createProof`, `exportProofBundle`, `verifyProofBundle`. Dapps call these methods, users see approval dialogs, proofs get generated. Simple.

### WebWallet: Zcash in WebAssembly



We integrated **WebZjs**—a complete Zcash wallet compiled to WebAssembly. This is the first JavaScript SDK that actually supports shielded transactions (Orchard and Sapling pools). Not just viewing balances. Actually spending shielded funds from a browser.

**Why this matters:** Zcash's privacy features have historically been locked behind native wallets. If you wanted shielded transactions, you needed to run `zcashd` or use a native mobile app. WebZjs changes that. The entire wallet—sync, spend, prove—runs in your browser tab.

**The architecture :**

The wallet is split into four Rust crates compiled to WASM:
- `webzjs-keys` — Derives viewing keys and spending keys from seed phrases using ZIP-32
- `webzjs-wallet` — The actual wallet: account management, balance tracking, transaction history
- `webzjs-requests` — Talks to lightwalletd servers over gRPC-web
- `webzjs-common` — Shared types, error handling, network configuration

Blockchain sync happens in a WebWorker so it doesn't block the main thread. Proof generation (the expensive part) also runs in workers. The wallet stays responsive even while crunching through thousands of blocks.

**PCZT: Partially Constructed Zcash Transactions**

how we handle signing. Zcash transactions require zero-knowledge proofs, which are computationally expensive. We use PCZT—a format that separates transaction construction from signing from proving:

```
pczt_create → pczt_sign → pczt_prove → pczt_send
```

The web page constructs the transaction. The MetaMask Snap signs it (your seed phrase never touches the web page). The web page generates proofs. The web page broadcasts. Clean separation of concerns.

The webwallet has its own companion snap (`webwallet/snap/`) that holds your Zcash seed phrase securely in MetaMask's encrypted storage. When you want to spend, the snap signs the PCZT and returns it. The seed never leaves MetaMask.

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

**Zcash Orchard crates (WIP):**

| Crate | Purpose |
|-------|---------|
| `zkpf-zcash-orchard-circuit` | Orchard-specific circuit extensions. Verifies note commitments, Merkle paths, nullifier derivation inside Halo2. |
| `zkpf-zcash-orchard-wallet` | Wallet integration for Orchard notes. Extracts witness data needed for proof generation. |
| `zkpf-orchard-inner` | Inner proof types and serialization for Orchard rail. |

The crate dependency graph flows: `zkpf-circuit` → `zkpf-common` → `zkpf-prover`/`zkpf-verifier` → `zkpf-backend`/`zkpf-wasm`. The Orchard crates extend this for shielded Zcash proofs.

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

The WebZjs Zcash wallet described above. Four Rust crates compiled to WASM, a React frontend (`web-wallet/`), and a companion snap for secure PCZT signing (`snap/`). The first browser-based Zcash wallet with full shielded transaction support.

### Smart Contracts (`contracts/`)

Solidity contracts for on-chain functionality: `AttestationRegistry.sol` records verified attestations, `WalletCommitmentRegistry.sol` registers wallet commitments, `BalanceSnapshotPublisher.sol` publishes balance snapshots.

## Proof Rails

The system supports multiple "rails" for different use cases:

1. **Custodial Attestation** (`CUSTODIAL_ATTESTATION`) — Traditional custodian-signed balance attestations using secp256k1 ECDSA. Fully implemented and production-ready.

2. **Zcash Orchard** (`ZCASH_ORCHARD`) — Non-custodial proofs from Zcash shielded pools using Orchard note commitments and Merkle paths. Architecture in place, circuit implementation in progress.

3. **Provider Balance** (`PROVIDER_BALANCE_V2`) — Generic provider-attested proofs. Wallet-agnostic balance attestations reusing the custodial circuit with provider keys.

4. **On-Chain** (design phase) — Merkle-based proofs from on-chain snapshots. See design doc for details.

## Privacy Model: Holder Tags

The holder tag system enables privacy-preserving identity:

```
holder_tag = keccak256(personal_sign(message))
```

Verifiers can confirm "same MetaMask identity signed both proofs" and link multiple proofs from the same holder. They cannot learn the actual wallet address, track the holder across different verifiers, or associate the proof with on-chain activity.

The holder tag is deterministic per message—the same user signing the same policy produces the same tag every time. Identity consistency without address exposure.

## Documentation

- **[Main README](zkpf/README.md)** — Comprehensive technical documentation
- **[MetaMask Snap](zkpf/zkpf-snap/README.md)** — Snap installation, usage, and dapp integration
- **[WebWallet API](zkpf/webwallet/readme.md)** — Complete WebWallet class documentation
- **[On-Chain Design](zkpf/docs/onchain-proof-of-funds.md)** — On-chain rail specification
- **[Web Console](zkpf/web/README.md)** — Frontend documentation

## Development

See [`zkpf/README.md`](zkpf/README.md) for detailed setup instructions, test commands, and build steps.

## License

See individual crate `Cargo.toml` files for license information.


