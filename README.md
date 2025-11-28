# Zero-Knowledge Proof of Funds (zkpf)

A system for generating and verifying zero-knowledge proofs of funds. This allows custodians, wallet providers, and crypto holders to prove they meet minimum balance requirements without revealing exact balances or sensitive wallet information.

**zkpf** enables privacy-preserving proof-of-funds attestations using zero-knowledge cryptography. Instead of sharing raw balance data, parties can:

- Generate cryptographic proofs that demonstrate sufficient funds
- Verify proofs without learning exact balances or wallet addresses
- Support multiple "rails" (custodial attestations, Zcash Orchard wallets, provider-backed proofs, and future on-chain rails)

## 🆕 Recent Work

### Tachyon Wallet: Unified Multi-Chain Proof Orchestration

We built **Tachyon Wallet**—a unified wallet coordinator that orchestrates zero-knowledge proofs across five chains, using each only for its comparative advantage. The core principle: **never bridge assets, only proofs and attestations**.

**Chain Responsibilities:**

| Chain | Role | Why This Chain |
|-------|------|----------------|
| **Zcash (Orchard)** | Privacy-preserving balance proofs | Gold-standard shielded UTXOs, strongest privacy guarantees |
| **Mina** | PCD/recursive SNARK aggregation | Constant-size proofs, infinite recursion depth |
| **Starknet** | Heavy proving, DeFi positions | Cheap STARK proving, native AA, rich DeFi ecosystem |
| **Axelar** | Cross-chain proof transport | Battle-tested GMP infrastructure |
| **NEAR** | TEE-backed private AI agent | Confidential compute enclaves for wallet intelligence |

**Architecture:** The wallet coordinates across rails (Zcash, Mina, Starknet) to generate unified proofs. Proofs can be aggregated via Mina recursion, then broadcast via Axelar GMP to target chains. A NEAR TEE agent provides privacy-preserving wallet intelligence without exposing sensitive data.

**Key Features:**
- Single-rail proofs (privacy-optimized via Zcash)
- Multi-rail aggregation (balance aggregation across chains via Mina)
- Cross-chain attestations (Axelar GMP transport)
- TEE-backed AI agent (NEAR for private wallet intelligence)

See [`docs/tachyon-architecture.md`](zkpf/docs/tachyon-architecture.md) for full architecture details.

### NEAR TEE Agent: Private AI Wallet Intelligence

We integrated a **NEAR TEE-backed private AI agent** that runs wallet intelligence in Trusted Execution Environments. The agent provides:

- **Private portfolio analysis** — Insights without exposing transaction data
- **Proof strategy recommendations** — Optimal rail selection based on privacy/performance tradeoffs
- **Natural language interactions** — Intent parsing and structured actions
- **Privacy filtering** — Ensures AI outputs don't leak sensitive wallet data
- **Secure key management** — TEE-protected key derivation and signing

All sensitive operations happen inside the TEE enclave. The agent proves it's running in a genuine TEE via attestation, and outputs are filtered to prevent data leakage.

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

### Browser Compatibility & WASM Loader

We built a comprehensive browser compatibility system that automatically detects SharedArrayBuffer support and provides graceful fallbacks. The system includes:

**Browser Detection** — Detects Chrome, Firefox, Edge, Safari (desktop and mobile) and their capabilities. Checks for SharedArrayBuffer, cross-origin isolation, and secure context requirements.

**Dual WASM Builds** — The wallet loader automatically selects between:
- **Threaded build** (pkg-threads): For browsers with SharedArrayBuffer + cross-origin isolation. Uses all CPU cores for faster sync and proving.
- **Single-threaded build** (pkg-single): For all other browsers. Slower but works everywhere.

**Lite Mode** — When full wallet mode isn't available, users can still:
- Use the P2P marketplace (post and respond to offers)
- Verify proof bundles from others
- View and manage attestations
- Browse the policy catalog
- Share offers via links

**Smart Fallbacks** — The system provides clear guidance: Safari users get instructions for proper server headers, mobile users get desktop recommendations, and everyone gets the option to continue in lite mode.

### Mina Recursive Proof Hub Rail

We implemented a **Mina recursive proof hub rail** that enables zkpf to serve as a cross-chain compliance layer. Key insight: *PoF verified once in a privacy-preserving way; many chains can reuse it.*

**How it works:**
1. Existing zkpf proofs from any rail (Starknet, Orchard, custodial, etc.) are wrapped into Mina-native recursive proofs
2. The Mina zkApp emits attestations that other chains can query via zkBridges
3. Original proofs and addresses remain hidden; only the attestation bit `has_PoF(holder, policy) = true` is propagated

Mina's ~22KB light client footprint makes it realistic for institutional verifiers to self-verify proofs cheaply without running full nodes.

### Starknet L2 Rail: DeFi Position Proving

We built a **Starknet L2 rail** that enables proof-of-funds over Starknet accounts, DeFi positions (vaults, LP tokens, lending), and leverages Starknet's native account abstraction.

**Key Features:**
- **Account Abstraction** — Session keys, batched signatures, wallet detection (Argent, Braavos, OpenZeppelin)
- **DeFi Position Support** — Aggregates balances across JediSwap LP, Nostra lending, zkLend deposits, Ekubo positions, Haiko vaults
- **Native STARK Verification** — Uses Starknet's STARK-friendly cryptography (Pedersen hash, ECDSA over Stark curve)

The rail can prove statements like "I control Starknet account(s) with total balance ≥ threshold" or "My aggregated DeFi positions have value ≥ threshold" without revealing individual positions or addresses.

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

2. **Zcash Orchard** (`ZCASH_ORCHARD`) — Non-custodial proofs from Zcash shielded pools using Orchard note commitments and Merkle paths. Architecture in place, circuit implementation in progress.

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


