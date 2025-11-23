# Zero-Knowledge Proof of Funds (zkpf)

A complete system for generating and verifying zero-knowledge proofs of funds. This allows custodians, wallet providers, and crypto holders to prove they meet minimum balance requirements without revealing exact balances or sensitive wallet information.

**zkpf** enables privacy-preserving proof-of-funds attestations using zero-knowledge cryptography. Instead of sharing raw balance data, parties can:

- Generate cryptographic proofs that demonstrate sufficient funds
- Verify proofs without learning exact balances or wallet addresses
- Support multiple "rails" (custodial attestations, Zcash Orchard wallets, provider-backed proofs, and future on-chain rails)

## Quick Start

### Backend (Rust)

```bash
cd zkpf
cargo test -p zkpf-circuit          # Run circuit tests
cargo test -p zkpf-test-fixtures   # Generate test fixtures
cargo run -p zkpf-backend          # Start verification server (port 3000)
```

### Web Frontend

```bash
cd zkpf/web
npm install
npm run dev                         # Start dev server
```

See [`zkpf/README.md`](zkpf/README.md) for detailed setup instructions.

## Project Structure

The main codebase lives in the `zkpf/` directory:

```
zkpf/
├── zkpf-circuit/          # Core Halo2 zero-knowledge circuit
├── zkpf-backend/          # HTTP API server (Axum)
├── zkpf-prover/           # Proof generation CLI
├── zkpf-verifier/         # Proof verification logic
├── zkpf-common/           # Shared types and utilities
├── web/                   # React frontend dashboard
├── contracts/             # Solidity smart contracts
└── docs/                  # Detailed documentation
```

## Key Components

### Core Circuit (`zkpf-circuit/`)
The Halo2 zero-knowledge circuit that:
- Verifies ECDSA signatures from allow-listed custodians
- Enforces balance thresholds and policy requirements
- Generates nullifiers for replay protection
- Supports multiple proof "rails" (custodial, Orchard, provider-backed)

**Learn more:** [`zkpf/README.md`](zkpf/README.md#repository-layout)

### Backend API (`zkpf-backend/`)
REST API server providing:
- `/zkpf/verify` - Verify proof bundles
- `/zkpf/prove-bundle` - Generate proofs (when enabled)
- `/zkpf/policies` - Policy management
- `/zkpf/epoch` - Epoch/time window management
- `/zkpf/attest` - On-chain attestation recording

**Learn more:** [`zkpf/README.md`](zkpf/README.md#backend-verification-api)

### Web Dashboard (`web/`)
React-based UI for:
- Inspecting verifier parameters and policies
- Uploading and verifying proof bundles
- Monitoring epoch drift and system status
- Provider session workflows (e.g., Zashi integration)

**Learn more:** [`zkpf/web/README.md`](zkpf/web/README.md)

### Smart Contracts (`contracts/`)
Solidity contracts for on-chain functionality:
- `AttestationRegistry.sol` - Record verified attestations
- `WalletCommitmentRegistry.sol` - Register wallet commitments
- `BalanceSnapshotPublisher.sol` - Publish balance snapshots

**Learn more:** [`zkpf/docs/onchain-proof-of-funds.md`](zkpf/docs/onchain-proof-of-funds.md)

## Proof Rails

The system supports multiple "rails" for different use cases:

1. **Custodial Attestation** (`CUSTODIAL_ATTESTATION`)
   - Traditional custodian-signed balance attestations
   - Uses secp256k1 ECDSA signatures
   - Fully implemented and production-ready

2. **Zcash Orchard** (`ZCASH_ORCHARD`)
   - Non-custodial proofs from Zcash shielded pools
   - Uses Orchard note commitments and Merkle paths
   - Architecture in place, circuit implementation in progress

3. **Provider Balance** (`PROVIDER_BALANCE_V2`)
   - Generic provider-attested proofs
   - Wallet-agnostic balance attestations
   - Reuses custodial circuit with provider keys

4. **On-Chain** (design phase)
   - Merkle-based proofs from on-chain snapshots
   - See design doc for details

**Learn more:** [`zkpf/README.md`](zkpf/README.md#zcash-orchard-rail-zcash_orchard--architecture-snapshot)

## Documentation

- **[Main README](zkpf/README.md)** - Comprehensive technical documentation
- **[On-Chain Design](zkpf/docs/onchain-proof-of-funds.md)** - On-chain rail specification
- **[Web Console](zkpf/web/README.md)** - Frontend documentation
- **[CI Artifacts](zkpf/docs/ci-artifacts.md)** - Artifact management guide

## Architecture Deep Dives

### Circuit Implementation
- **Circuit logic:** [`zkpf-circuit/src/lib.rs`](zkpf/zkpf-circuit/src/lib.rs)
- **Custodian allowlist:** [`zkpf-circuit/src/custodians.rs`](zkpf/zkpf-circuit/src/custodians.rs)
- **Gadgets:** [`zkpf-circuit/src/gadgets/`](zkpf/zkpf-circuit/src/gadgets/)

### Backend Services
- **Main server:** [`zkpf-backend/src/lib.rs`](zkpf/zkpf-backend/src/lib.rs)
- **API routes:** See `zkpf-backend/src/lib.rs` for endpoint implementations
- **Policy management:** [`zkpf/config/policies.json`](zkpf/config/policies.json)

### Zcash Integration
- **Orchard wallet:** [`zkpf-zcash-orchard-wallet/`](zkpf/zkpf-zcash-orchard-wallet/)
- **Orchard circuit:** [`zkpf-zcash-orchard-circuit/`](zkpf/zkpf-zcash-orchard-circuit/)
- **Rail service:** [`zkpf-rails-zcash-orchard/`](zkpf/zkpf-rails-zcash-orchard/)

### Web Components
- **Main app:** [`web/src/App.tsx`](zkpf/web/src/App.tsx)
- **Proof workbench:** [`web/src/components/ProofWorkbench.tsx`](zkpf/web/src/components/ProofWorkbench.tsx)
- **API client:** [`web/src/api/zkpf.ts`](zkpf/web/src/api/zkpf.ts)

## Development

### Running Tests

```bash
# Circuit tests
cargo test -p zkpf-circuit

# Integration tests
cargo test -p zkpf-backend

# Generate deterministic fixtures
cargo test -p zkpf-test-fixtures
```

### Building

```bash
# Build all crates
cargo build --workspace

# Build specific crate
cargo build -p zkpf-backend

# Build web frontend
cd zkpf/web && npm run build
```

## License

See individual crate `Cargo.toml` files for license information.

## Contributing

This is a complex cryptographic system. Before making changes:

1. Read the [main README](zkpf/README.md) for architecture details
2. Understand the circuit constraints in [`zkpf-circuit/`](zkpf/zkpf-circuit/)
3. Review existing tests for expected behavior
4. Check the [design docs](zkpf/docs/) for rail specifications

For questions or issues, refer to the detailed documentation in `zkpf/README.md` and `zkpf/docs/`.

