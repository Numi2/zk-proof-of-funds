# Crate Review and Necessity Rating

This document reviews each crate in the zkpf workspace and rates them 1-10 based on necessity to the core system.

**Rating Scale:**
- **10**: Absolutely essential, core functionality
- **8-9**: Highly important, major feature
- **6-7**: Important, but could be optional or replaced
- **4-5**: Useful but not critical, could be removed
- **1-3**: Low value, experimental, or redundant

---

## Core Circuit Framework

### `zkpf-circuit` - **Rating: 10/10** ⭐ ESSENTIAL

**Purpose**: The main Halo2 zero-knowledge circuit. Core of the entire system.

**Functionality**:
- ECDSA signature verification (secp256k1)
- Balance threshold checks
- Nullifier generation for replay protection
- Custodian allowlist enforcement
- Poseidon hashing gadgets

**Dependencies**: `halo2-axiom`, `halo2-base`, `halo2-ecc`

**Assessment**: **Absolutely essential**. This is the cryptographic core that makes the entire system work. Without it, there is no proof-of-funds system.

**Recommendation**: Keep. This is the foundation of the project.

---

### `zkpf-common` - **Rating: 10/10** ⭐ ESSENTIAL

**Purpose**: Shared types, serialization, and utilities used across all crates.

**Functionality**:
- `ProofBundle` type definition
- `PublicInputs` and `VerifierPublicInputs`
- Policy definitions
- Poseidon hashing utilities
- Artifact manifest handling

**Dependencies**: `zkpf-circuit`, `halo2-axiom`, `serde`

**Assessment**: **Absolutely essential**. Provides the common data structures and utilities that all other crates depend on. Removing this would break the entire codebase.

**Recommendation**: Keep. Critical shared infrastructure.

---

### `zkpf-prover` - **Rating: 10/10** ⭐ ESSENTIAL

**Purpose**: Proof generation service. Takes circuit inputs and produces proofs.

**Functionality**:
- Loads proving keys
- Runs Halo2 prover
- Generates proof bytes
- Supports native and WASM targets

**Dependencies**: `zkpf-circuit`, `zkpf-common`, `halo2-axiom`

**Assessment**: **Absolutely essential**. Without proof generation, the system cannot produce proofs. This is a core capability.

**Recommendation**: Keep. Essential for proof generation.

---

### `zkpf-verifier` - **Rating: 10/10** ⭐ ESSENTIAL

**Purpose**: Proof verification logic. Checks proofs against public inputs.

**Functionality**:
- Loads verification keys
- Runs Halo2 verifier
- Validates proofs

**Dependencies**: `zkpf-circuit`, `zkpf-common`, `halo2-axiom`

**Assessment**: **Absolutely essential**. Verification is the counterpart to proving. Without it, proofs cannot be validated.

**Recommendation**: Keep. Essential for proof verification.

---

### `zkpf-backend` - **Rating: 10/10** ⭐ ESSENTIAL

**Purpose**: HTTP API server (Axum) that exposes verification endpoints.

**Functionality**:
- `/zkpf/verify` - Verify raw proofs
- `/zkpf/verify-bundle` - Verify proof bundles
- `/zkpf/policies` - List policies
- `/zkpf/epoch` - Epoch management
- Nullifier replay protection
- Policy enforcement

**Dependencies**: `zkpf-verifier`, `zkpf-common`, `axum`

**Assessment**: **Absolutely essential**. This is the production API that verifiers use. It's the primary interface for the system.

**Recommendation**: Keep. Essential production service.

---

### `zkpf-wasm` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: WASM bindings for browser-based proof verification.

**Functionality**:
- Exposes `prove()` and `verify()` to JavaScript
- Used by web dashboard for client-side verification
- WASM compilation target

**Dependencies**: `zkpf-prover`, `zkpf-verifier`, `wasm-bindgen`

**Assessment**: **Highly important** for web integration. Enables browser-based verification without server round-trips. However, could be considered optional if only server-side verification is needed.

**Recommendation**: Keep. Important for web UX and client-side verification.

---

### `zkpf-test-fixtures` - **Rating: 7/10** ⚠️ IMPORTANT BUT OPTIONAL

**Purpose**: Deterministic test data generation for CI/CD.

**Functionality**:
- Generates reproducible proofs using seeded RNG
- Creates test fixtures for integration tests
- Enables consistent CI testing

**Dependencies**: `zkpf-circuit`, `zkpf-prover`, `zkpf-common`

**Assessment**: **Important for development and CI**, but not required for production. Could be replaced with manual test data, but significantly improves development workflow.

**Recommendation**: Keep. Valuable for testing and CI/CD.

---

## Circuit Synthesis Framework

### `ragu` - **Rating: 3/10** ⚠️ LOW VALUE / EXPERIMENTAL

**Purpose**: Non-uniform circuit synthesis framework for PCD with zero-cost witness abstractions.

**Functionality**:
- `Maybe<T>` type for zero-cost optional witnesses
- Driver architecture for different synthesis contexts
- Designed for HyperNova and non-uniform PCD schemes

**Dependencies**: `ff`, `group`, `subtle`, `rand_core`

**Assessment**: **Experimental/research code**. Not currently used by the main zkpf system. Appears to be a research project for advanced PCD schemes. The main system uses standard Halo2, not ragu.

**Usage**: Not referenced in core crates (`zkpf-circuit`, `zkpf-prover`, etc.)

**Recommendation**: **Consider removing** or moving to a separate research workspace. Low value for production system.

---

## Development Tools

### `zkpf-tools` - **Rating: 6/10** ⚠️ USEFUL BUT OPTIONAL

**Purpose**: CLI utilities for artifact management.

**Functionality**:
- `gen-params` - Generate trusted setup artifacts
- `dump-params` - Inspect parameter metadata
- `dump-vk` - Inspect verification key metadata
- Supports both default and Starknet rails

**Dependencies**: `zkpf-common`, `zkpf-prover`, `zkpf-starknet-l2`, `clap`

**Assessment**: **Useful for operations**, but not required for runtime. Artifacts can be generated manually or via other tools. However, it provides a convenient interface for artifact management.

**Recommendation**: Keep. Useful for operations and development, but could be replaced with scripts.

---

### `xtask` - **Rating: 5/10** ⚠️ OPTIONAL

**Purpose**: CI/CD automation for artifact generation and backend verification.

**Functionality**:
- `ci-artifacts` command - End-to-end artifact generation flow
- Generates params, proofs, and verifies via backend
- Used for CI/CD pipelines

**Dependencies**: `zkpf-circuit`, `zkpf-common`, `zkpf-prover`, `zkpf-backend`, `clap`, `reqwest`

**Assessment**: **Convenience tool for CI/CD**. The functionality could be implemented as shell scripts or GitHub Actions. Not required for the core system.

**Recommendation**: Keep for now, but could be replaced with simpler CI scripts.

---

## Zcash Orchard Rails

### `zkpf-zcash-orchard-circuit` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: Orchard-specific circuit extensions for Zcash shielded proofs.

**Functionality**:
- Verifies Orchard note commitments
- Merkle path verification
- Nullifier derivation
- bn256 wrapper for EVM compatibility

**Dependencies**: `zkpf-common`, `zkpf-circuit`, `halo2-axiom`

**Assessment**: **Highly important** for Zcash Orchard rail. Enables privacy-preserving proofs from shielded Zcash notes. However, the rail is still in development (circuit not fully implemented).

**Recommendation**: Keep. Critical for Zcash Orchard rail functionality.

---

### `zkpf-orchard-inner` - **Rating: 7/10** ⚠️ IMPORTANT BUT INCOMPLETE

**Purpose**: Inner proof types and serialization for Orchard rail.

**Functionality**:
- `OrchardInnerPublicInputs` definition
- `OrchardPofNoteWitness` types
- `OrchardPofProver` trait
- Data model for inner Orchard circuit

**Dependencies**: Minimal (mostly types)

**Assessment**: **Important for Orchard rail architecture**, but currently incomplete. Defines the interface but the actual circuit implementation is pending.

**Recommendation**: Keep. Needed for Orchard rail completion.

---

### `zkpf-orchard-pof-circuit` - **Rating: 7/10** ⚠️ IMPORTANT BUT INCOMPLETE

**Purpose**: Orchard PoF circuit implementation (Pasta fields).

**Functionality**:
- Orchard-typed snapshots
- `snapshot_to_inner_input` conversion
- Circuit artifacts and prover wrapper
- Fixed base tables for Orchard

**Dependencies**: `zkpf-orchard-inner`, `halo2-axiom`

**Assessment**: **Important for Orchard rail**, but circuit implementation is incomplete. Currently a scaffold.

**Recommendation**: Keep. Needed for Orchard rail completion.

---

### `zkpf-rails-zcash-orchard` - **Rating: 7/10** ⚠️ IMPORTANT BUT INCOMPLETE

**Purpose**: HTTP service for Zcash Orchard rail endpoints.

**Functionality**:
- `POST /rails/zcash-orchard/proof-of-funds`
- Wallet snapshot building
- Proof generation coordination

**Dependencies**: `zkpf-zcash-orchard-circuit`, `zkpf-orchard-pof-circuit`

**Assessment**: **Important for Orchard rail**, but depends on incomplete circuit implementation. Currently scaffolded.

**Recommendation**: Keep. Needed for Orchard rail completion.

---

### `zkpf-zcash-orchard-wallet` - **Rating: 6/10** ⚠️ DISABLED DUE TO CONFLICTS

**Purpose**: Wallet integration for Orchard notes with proper trial decryption.

**Functionality**:
- Blockchain synchronization via lightwalletd
- Trial decryption using official Zcash APIs
- Note detection and Merkle path extraction
- Snapshot building for proofs

**Dependencies**: `zcash_client_backend`, `zcash_note_encryption` (conflicts with nonempty)

**Assessment**: **Important for Orchard rail**, but **currently disabled** due to `nonempty` version conflict (ChainSafe fork uses 0.11, orchard uses 0.7).

**Recommendation**: **Fix dependency conflict** or find alternative. Critical for Orchard rail functionality.

---

### `zkpf-orchard-wasm-prover` - **Rating: 4/10** ⚠️ LOW PRIORITY

**Purpose**: WASM bindings for Orchard proof generation in browser.

**Functionality**:
- WASM compilation target
- Browser-based Orchard proving

**Dependencies**: `zkpf-zcash-orchard-circuit`, `zkpf-zcash-orchard-wallet` (disabled)

**Assessment**: **Low priority**. Orchard proving is computationally expensive (30-60 seconds), making browser-based proving less practical. Also depends on disabled wallet crate.

**Recommendation**: **Consider removing** or deferring until Orchard rail is complete and wallet conflict is resolved.

---

## Multi-Chain Rails

### `zkpf-starknet-l2` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: Starknet L2 rail for DeFi position proving.

**Functionality**:
- Account abstraction support
- DeFi position aggregation (JediSwap, Nostra, zkLend, etc.)
- Session keys and batched signatures
- STARK-friendly cryptography

**Dependencies**: `zkpf-common`, `zkpf-circuit`, `halo2-axiom`

**Assessment**: **Highly important** for multi-chain support. Enables proof-of-funds over Starknet accounts and DeFi positions. Fully implemented.

**Recommendation**: Keep. Important multi-chain capability.

---

### `zkpf-rails-starknet` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: HTTP service for Starknet rail endpoints.

**Functionality**:
- `POST /rails/starknet/proof-of-funds`
- State reading from Starknet RPC
- Proof generation coordination

**Dependencies**: `zkpf-starknet-l2`

**Assessment**: **Highly important** for Starknet rail. Provides the HTTP interface for Starknet proofs.

**Recommendation**: Keep. Essential for Starknet rail.

---

### `zkpf-mina` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: Mina recursive proof hub for cross-chain attestations.

**Functionality**:
- Wraps ProofBundles into Mina-native recursive proofs
- Cross-chain compliance layer
- zkApp integration
- Proof aggregation

**Dependencies**: `zkpf-common`, `zkpf-circuit`, `zkpf-mina-kimchi-wrapper`

**Assessment**: **Highly important** for cross-chain functionality. Enables other chains to verify PoF attestations via Mina's light client.

**Recommendation**: Keep. Critical for cross-chain architecture.

---

### `zkpf-rails-mina` - **Rating: 8/10** ⭐ HIGHLY IMPORTANT

**Purpose**: HTTP service for Mina rail endpoints.

**Functionality**:
- `POST /rails/mina/*` endpoints
- Proof wrapping and aggregation
- Bridge message generation

**Dependencies**: `zkpf-mina`

**Assessment**: **Highly important** for Mina rail. Provides HTTP interface for Mina proof operations.

**Recommendation**: Keep. Essential for Mina rail.

---

### `zkpf-mina-kimchi-wrapper` - **Rating: 7/10** ⚠️ IMPORTANT BUT COMPLEX

**Purpose**: BN254 circuit wrapper for Mina Proof of State verification.

**Functionality**:
- Verifies Mina's recursive state proof (Pickles/Kimchi)
- Foreign-field arithmetic for Pasta→BN254 conversion
- Mina state verification in Halo2

**Dependencies**: `zkpf-common`, `halo2-axiom`, complex foreign-field arithmetic

**Assessment**: **Important for Mina integration**, but complex and potentially fragile. Enables Mina state verification in EVM-compatible circuits.

**Recommendation**: Keep, but monitor for complexity issues.

---

### `zkpf-mina-relayer` - **Rating: 6/10** ⚠️ USEFUL BUT OPTIONAL

**Purpose**: Relayer service for propagating Mina attestations to other chains.

**Functionality**:
- Listens to Mina zkApp events
- Submits attestations to Starknet/EVM chains
- Bridge message generation

**Dependencies**: `zkpf-mina`, `zkpf-starknet-l2`

**Assessment**: **Useful for cross-chain propagation**, but could be implemented as a separate service. Not required for core functionality.

**Recommendation**: Keep for now, but could be extracted to separate repo.

---

### `zkpf-mina-rail` - **Rating: 6/10** ⚠️ USEFUL BUT OVERLAPS

**Purpose**: Mina Recursive Rail for tachystamp aggregation (offloads slot 2 PCD).

**Functionality**:
- Tachystamp aggregation
- Epoch-based batching
- IVC (Incremental Verifiable Computation)

**Dependencies**: `zkpf-common`, `zkpf-mina`, `halo2-axiom`

**Assessment**: **Overlaps with `zkpf-mina`**. Appears to be a specialized Mina integration for tachystamps. May be redundant with main Mina rail.

**Recommendation**: **Review for consolidation** with `zkpf-mina`. May be redundant.

---

### `zkpf-axelar-gmp` - **Rating: 7/10** ⚠️ IMPORTANT BUT OPTIONAL

**Purpose**: Types and encoding for Axelar General Message Passing.

**Functionality**:
- PoF receipt format
- GMP message encoding
- Chain configuration
- Cross-chain transport types

**Dependencies**: `zkpf-common`, `serde`

**Assessment**: **Important for interchain functionality**, but Axelar GMP is optional. The system can work without cross-chain transport.

**Recommendation**: Keep. Useful for interchain use cases.

---

### `zkpf-rails-axelar` - **Rating: 7/10** ⚠️ IMPORTANT BUT OPTIONAL

**Purpose**: HTTP service for Axelar GMP integration.

**Functionality**:
- `/rails/axelar/*` endpoints
- PoF receipt broadcasting
- Chain subscription management

**Dependencies**: `zkpf-axelar-gmp`

**Assessment**: **Important for interchain functionality**, but optional. Provides cross-chain transport capability.

**Recommendation**: Keep. Useful for interchain use cases.

---

### `zkpf-omni-bridge` - **Rating: 4/10** ⚠️ DISABLED DUE TO CONFLICTS

**Purpose**: Omni Bridge rail for NEAR, ETH, ARB, Base, Solana bridging.

**Functionality**:
- Multi-chain bridging
- Proof transport across chains

**Dependencies**: Solana (version conflict)

**Assessment**: **Currently disabled** due to Solana dependency version conflict. Low priority compared to other rails.

**Recommendation**: **Fix conflicts or remove**. Not critical for core functionality.

---

### `zkpf-rails-omni` - **Rating: 4/10** ⚠️ DISABLED DUE TO CONFLICTS

**Purpose**: HTTP service for Omni Bridge rail.

**Dependencies**: `zkpf-omni-bridge` (disabled)

**Assessment**: **Disabled** due to parent crate conflict.

**Recommendation**: **Remove or fix conflicts**.

---

## Wallet and State Management

### `zkpf-wallet-state` - **Rating: 6/10** ⚠️ USEFUL BUT SPECIALIZED

**Purpose**: Wallet state machine with ZK proofs for state transitions.

**Functionality**:
- Wallet state commitments
- State transition proofs
- Block-based state updates
- Merkle tree management

**Dependencies**: `zkpf-circuit`, `zkpf-common`, `halo2-axiom`

**Assessment**: **Specialized functionality** for wallet state management. Not required for basic proof-of-funds. Appears to be for advanced wallet features.

**Recommendation**: Keep if wallet state features are needed, otherwise consider removing.

---

### `zkpf-tachyon-wallet` - **Rating: 5/10** ⚠️ DISABLED DUE TO CONFLICTS

**Purpose**: Unified multi-chain wallet coordinator.

**Functionality**:
- Orchestrates proofs across Zcash, Mina, Starknet, Axelar, NEAR
- Proof aggregation strategies
- Cross-chain attestation transport

**Dependencies**: `zkpf-zcash-orchard-wallet` (disabled due to nonempty conflict)

**Assessment**: **Currently disabled** due to dependency on disabled orchard wallet. Conceptually useful but not functional.

**Recommendation**: **Fix dependency conflicts** or remove. Not critical without Orchard wallet.

---

### `zkpf-near-tee` - **Rating: 5/10** ⚠️ EXPERIMENTAL / OPTIONAL

**Purpose**: NEAR TEE-backed private AI agent for wallet intelligence.

**Functionality**:
- TEE-backed inference
- Privacy-filtered AI
- Wallet intelligence
- Intent parsing

**Dependencies**: `zkpf-common`, `zkpf-wallet-state`, `near-sdk` (optional)

**Assessment**: **Experimental/research feature**. TEE-backed AI agent is interesting but not required for core proof-of-funds functionality. Adds significant complexity.

**Recommendation**: **Consider removing** or moving to separate research workspace. Low value for production system.

---

## Payment Protocols

### `zkpf-uri-payment` - **Rating: 6/10** ⚠️ USEFUL BUT OPTIONAL

**Purpose**: URI-Encapsulated Payments (ZIP 324) for sending ZEC via messaging.

**Functionality**:
- Ephemeral key derivation (ZIP 32)
- Bech32m key encoding
- URI parsing/generation
- Payment note construction

**Dependencies**: `zcash_primitives`, `bech32`, `serde`

**Assessment**: **Useful feature** for Zcash payments via messaging, but not required for proof-of-funds. Separate use case.

**Recommendation**: Keep if payment features are needed, otherwise optional.

---

### `zkpf-x402` - **Rating: 5/10** ⚠️ OPTIONAL / SEPARATE USE CASE

**Purpose**: x402 Payment Required protocol for ZEC payments in HTTP APIs.

**Functionality**:
- HTTP 402 Payment Required responses
- Payment requirement builder
- Payment verification
- Axum middleware (optional)

**Dependencies**: `zcash_primitives`, `axum` (optional), `tower` (optional)

**Assessment**: **Separate use case** from proof-of-funds. Enables pay-per-request APIs. Not required for core PoF functionality.

**Recommendation**: Keep if x402 protocol is a goal, otherwise optional.

---

### `zkpf-pczt-transparent` - **Rating: 4/10** ⚠️ DISABLED DUE TO CONFLICTS

**Purpose**: Partially Constructed Zcash Transactions for transparent-to-shielded flows.

**Functionality**:
- PCZT proposal creation
- Signing and proving separation
- Transparent input handling

**Dependencies**: ChainSafe fork (nonempty conflict)

**Assessment**: **Currently disabled** due to nonempty version conflict. Useful for Zcash wallet flows but not critical for PoF.

**Recommendation**: **Fix conflicts or remove**. Not critical for core PoF.

---

## Other

### `zkpf-custodian-registry` - **Rating: 2/10** ⚠️ EMPTY / PLACEHOLDER

**Purpose**: Unknown (crate is essentially empty).

**Functionality**: Only contains a placeholder `add()` function.

**Dependencies**: None

**Assessment**: **Empty placeholder crate**. No functionality implemented. Appears to be a stub.

**Recommendation**: **Remove** or implement functionality. Currently useless.

---

### `zkpf-chat` - **Rating: 3/10** ⚠️ SEPARATE FEATURE

**Purpose**: Chat functionality (appears to be separate from PoF).

**Functionality**:
- Browser WASM chat client
- CLI chat client
- Shared chat types

**Dependencies**: `iroh` (separate protocol)

**Assessment**: **Separate feature** unrelated to proof-of-funds. Appears to be a chat application using Iroh protocol.

**Recommendation**: **Move to separate workspace** or remove. Not related to PoF core functionality.

---

## Summary by Rating

### Essential (10/10) - **MUST KEEP**
- `zkpf-circuit` - Core circuit
- `zkpf-common` - Shared types
- `zkpf-prover` - Proof generation
- `zkpf-verifier` - Proof verification
- `zkpf-backend` - HTTP API server

### Highly Important (8-9/10) - **SHOULD KEEP**
- `zkpf-wasm` - Browser bindings
- `zkpf-starknet-l2` - Starknet rail
- `zkpf-rails-starknet` - Starknet service
- `zkpf-mina` - Mina recursive hub
- `zkpf-rails-mina` - Mina service
- `zkpf-zcash-orchard-circuit` - Orchard circuit

### Important (6-7/10) - **CONSIDER KEEPING**
- `zkpf-test-fixtures` - Test utilities
- `zkpf-tools` - CLI tools
- `zkpf-orchard-inner` - Orchard types
- `zkpf-orchard-pof-circuit` - Orchard circuit impl
- `zkpf-rails-zcash-orchard` - Orchard service
- `zkpf-mina-kimchi-wrapper` - Mina wrapper
- `zkpf-axelar-gmp` - Axelar types
- `zkpf-rails-axelar` - Axelar service
- `zkpf-wallet-state` - Wallet state machine
- `zkpf-uri-payment` - URI payments

### Low Priority (4-5/10) - **CONSIDER REMOVING**
- `xtask` - CI automation (could be scripts)
- `zkpf-orchard-wasm-prover` - Browser Orchard proving
- `zkpf-mina-relayer` - Relayer service
- `zkpf-mina-rail` - Overlaps with zkpf-mina
- `zkpf-x402` - Separate use case
- `zkpf-near-tee` - Experimental AI agent
- `zkpf-tachyon-wallet` - Disabled
- `zkpf-pczt-transparent` - Disabled

### Should Remove (1-3/10) - **RECOMMEND REMOVAL**
- `ragu` - Experimental, not used
- `zkpf-custodian-registry` - Empty placeholder
- `zkpf-chat` - Separate feature
- `zkpf-omni-bridge` - Disabled
- `zkpf-rails-omni` - Disabled
- `zkpf-zcash-orchard-wallet` - Disabled (but needed)

---

## Recommendations

### Immediate Actions

1. **Fix Dependency Conflicts**:
   - Resolve `nonempty` conflict for `zkpf-zcash-orchard-wallet`
   - Resolve Solana conflict for `zkpf-omni-bridge`
   - These are blocking important functionality

2. **Remove Empty/Unused Crates**:
   - `zkpf-custodian-registry` (empty)
   - `ragu` (not used by core system)
   - `zkpf-chat` (separate feature)

3. **Consolidate Overlapping Crates**:
   - Review `zkpf-mina-rail` vs `zkpf-mina` for consolidation

### Medium-Term Actions

4. **Extract Optional Features**:
   - Move `zkpf-near-tee` to separate research workspace
   - Consider extracting `zkpf-x402` if not core to PoF
   - Extract `zkpf-chat` to separate project

5. **Complete or Remove Incomplete Rails**:
   - Complete Orchard rail implementation or document as experimental
   - Remove disabled crates if conflicts can't be resolved

### Long-Term Considerations

6. **Simplify Architecture**:
   - Reduce number of rail-specific crates if possible
   - Consider unified rail abstraction
   - Document which rails are production-ready vs experimental

---

## Dependency Graph Issues

**Blocked Crates** (due to conflicts):
- `zkpf-zcash-orchard-wallet` → Blocks Orchard rail
- `zkpf-tachyon-wallet` → Depends on disabled orchard wallet
- `zkpf-pczt-transparent` → ChainSafe fork conflict
- `zkpf-omni-bridge` → Solana conflict
- `zkpf-rails-omni` → Depends on disabled omni-bridge

**Critical Path**: Resolving `nonempty` conflict would unblock:
- `zkpf-zcash-orchard-wallet`
- `zkpf-tachyon-wallet`
- `zkpf-pczt-transparent`

This would enable the full Zcash Orchard rail functionality.

