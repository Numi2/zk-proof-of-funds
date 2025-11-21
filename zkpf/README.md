## zk-proof-of-funds

This workspace hosts an end-to-end proving stack for custodial proof-of-funds attestations. The Halo2 circuit enforces a Poseidon commitment over the attestation fields, verifies a secp256k1 ECDSA signature, derives a nullifier scoped to a verifier/policy pair, and now additionally exposes the hash of the custodian’s allow-listed public key as a public input. Deterministic fixtures and test witnesses make it possible to run consistent proofs in CI or locally without depending on external custody systems.

### What’s New
- **Deterministic witness generation**: `zkpf-circuit/tests/basic.rs` builds a fully valid attestation + signature fixture, allowing the MockProver to run with real data instead of `unimplemented!()`.
- **Expanded public inputs**: An eighth instance column now commits to `custodian_pubkey_hash`, and the nullifier mixes `(account_id_hash, scope_id, policy_id, current_epoch)`.
- **Custodian allowlist baked into the circuit**: `zkpf_circuit::custodians` tracks the exact secp256k1 keys that may sign attestations. The circuit hashes the witness public key and constrains it to the allow-listed hash, and the tests panic when attempting to use a non-listed custodian.
- **Shared fixtures crate**: `zkpf-test-fixtures` produces prover artifacts, serialized public inputs, and JSON blobs with deterministic values so that integration tests across crates consume the same data.
- **Server-owned policy enforcement**: The backend now loads allow-listed policies from `config/policies.json` (override with `ZKPF_POLICY_PATH`). Clients reference policies by `policy_id`, and the service enforces the stored expectations for threshold, currency, custodian, scope, and policy identifiers.
- **Durable nullifier replay protection**: A persistent sled-backed store (`ZKPF_NULLIFIER_DB`, default `data/nullifiers.db`) keeps `(scope_id, policy_id, nullifier)` tuples so duplicate proofs remain rejected across process restarts.

### Repository Layout
| Crate | Purpose |
| --- | --- |
| `zkpf-circuit` | Halo2 circuit, Poseidon gadgets, secp256k1 verify gadget, custodian allowlist, and circuit-specific tests. |
| `zkpf-prover` | CLI that loads artifacts and produces proofs for attestation witnesses. |
| `zkpf-verifier` | Minimal verifier logic shared by the backend service and CLI utilities. |
| `zkpf-backend` | Axum server that exposes `/zkpf/params`, `/zkpf/epoch`, `/zkpf/verify`, and `/zkpf/verify-bundle` APIs. Performs epoch-drift checks plus allowlist validation before invoking the verifier. |
| `zkpf-common` | Shared serialization helpers, public-input conversions, custodian hash helpers, and artifact manifest tooling. |
| `zkpf-test-fixtures` | Builds deterministic proving artifacts, serialized public inputs, and JSON fixtures for integration tests. |
| `zkpf-tools` | Misc CLI helpers (e.g. manifest inspection). |
| `zkpf-wasm` | WASM bindings for browser or mobile environments. |
| `xtask` | Placeholder for future automation; exists to keep `cargo fmt` and `cargo test` workspace operations happy. |
| `zkpf-zcash-orchard-wallet` | Zcash/Orchard-specific wallet + snapshot API: given an Orchard FVK and height, returns an `OrchardSnapshot` (notes, values, Merkle paths). Currently defines the interface; the actual sync implementation is left to a downstream integration using official Zcash crates. |
| `zkpf-zcash-orchard-circuit` | Public API for the `ZCASH_ORCHARD` rail circuit, including Orchard-specific public metadata and a `prove_orchard_pof` entrypoint that will be wired to a dedicated Halo2 circuit in a future iteration. |
| `zkpf-rails-zcash-orchard` | Axum-based rail service exposing `POST /rails/zcash-orchard/proof-of-funds`, which validates input, calls the Orchard wallet snapshot builder and circuit wrapper, and returns a standard `ProofBundle`. Currently returns a “not implemented” error until the circuit and wallet backend are completed. |

### Public Input Vector

The circuit exposes eight instance columns (in order):
1. `threshold_raw` – minimum balance required (u64).
2. `required_currency_code` – ISO-4217 integer code enforced by policy (u32).
3. `required_custodian_id` – allow-listed custodian identifier (u32).
4. `current_epoch` – verifier-supplied epoch that must satisfy `issued_at ≤ current_epoch ≤ valid_until`.
5. `verifier_scope_id` – domain separator for nullifier computation.
6. `policy_id` – policy identifier hashed into the nullifier.
7. `nullifier` – Poseidon hash over `(account_id_hash, verifier_scope_id, policy_id, current_epoch)`.
8. `custodian_pubkey_hash` – Poseidon hash over the x/y coordinates of the allow-listed secp256k1 public key.

Backends should refuse proofs when the supplied public inputs are not consistent with their allowlist (see `zkpf_common::allowlisted_custodian_hash_bytes`).

### Backend Verification API

The backend exposes:

- `GET /zkpf/policies` – returns the configured policy catalog so operators can pick a `policy_id`.
- `POST /zkpf/verify` – verifies raw proof bytes + serialized public inputs for a specific policy.
- `POST /zkpf/verify-bundle` – verifies a pre-serialized `ProofBundle` for a specific policy.

Example bodies:

```jsonc
POST /zkpf/verify
{
  "circuit_version": 3,
  "proof": "<binary proof bytes>",
  "public_inputs": "<canonical verifier_public_inputs bytes>",
  "policy_id": 271828
}
```

```jsonc
POST /zkpf/verify-bundle
{
  "policy_id": 271828,
  "bundle": {
    "circuit_version": 3,
    "proof": "<binary proof bytes>",
    "public_inputs": {
      "threshold_raw": 1_000_000_000,
      "required_currency_code": 840,
      "required_custodian_id": 42,
      "current_epoch": 1_705_000_000,
      "verifier_scope_id": 314159,
      "policy_id": 2718,
      "nullifier": [/* 32-byte array */],
      "custodian_pubkey_hash": [/* 32-byte array */]
    }
  }
}
```

Requests are rejected if the stored policy disagrees with the decoded public inputs, if the custodian hash does not match the allow-list, if the epoch drifts beyond the configured window, or if the nullifier has already been consumed for that scope/policy pair. Structural issues (missing policy, circuit version mismatch, malformed public inputs) now return HTTP 4xx errors with `{ "error", "error_code" }` payloads, while verification outcomes return HTTP 200 with `{ valid, error, error_code }`.

### Deterministic Fixtures & Tests
- `zkpf-test-fixtures` wires together the prover setup, serializes the proving/verifying keys, and emits JSON for the attestation witness and public inputs. `cargo test -p zkpf-test-fixtures` regenerates and asserts these fixtures.
- `zkpf-circuit/tests/basic.rs` uses a deterministic secp256k1 signing key and the same Poseidon parameters as the circuit to recreate an attestation off-circuit. Negative tests flip each constraint (signature, balance, currency, custodian, epoch ordering, nullifier, pubkey hash) and ensure the MockProver fails accordingly.
- Additional `#[should_panic]` coverage demonstrates that circuit construction aborts if an attestation references a custodian that is not hard-coded in `custodians.rs`.

### Building & Testing
```bash
# Format the circuit crate without touching other workspace members.
rustfmt zkpf-circuit/src/**/*.rs zkpf-circuit/tests/**/*.rs

# Run circuit tests (MockProver + allowlist checks).
cargo test -p zkpf-circuit

# Generate deterministic fixtures + proof bundle.
cargo test -p zkpf-test-fixtures

# Launch the verification backend (serves params + verify endpoints on :3000).
cargo run -p zkpf-backend
```

### Custodian Allowlist Workflow
1. Add or update entries in `zkpf-circuit/src/custodians.rs` (x/y coordinates only).
2. Re-run `cargo test -p zkpf-circuit` to ensure the registry points lie on-curve and match the expected signing keys (see `registry_entries_match_expected_pubkeys`).
3. Regenerate proving/verifying keys (`zkpf-test-fixtures` or the production setup flow) so the allowlist change is baked into the artifacts.
4. Update any off-chain allowlist consumers (e.g. backend’s environment configuration) if necessary.

### Troubleshooting
- **`base64ct` edition errors** – The workspace pins `base64ct` to a compatible git commit via `[patch.crates-io]` in the top-level `Cargo.toml`. Make sure you’re using the workspace manifest (`cargo … -p <crate>`), not invoking `cargo` inside a leaf crate directly.
- **`MockProver::run` panics** – Check that your custom witness uses an allow-listed custodian and that the poseidon hash inputs exactly match the circuit ordering.
- **Backend verification failures** – Inspect `/zkpf/verify` responses for `circuit_version mismatch`, `custodian_pubkey_hash does not match allow-listed key`, or epoch validation errors. The backend enforces a configurable max drift (`ZKPF_VERIFIER_MAX_DRIFT_SECS`, default 300s).

For additional implementation details, see `zkpf-common/src/lib.rs` for serialization helpers and `docs/ci-artifacts.md` for artifact publication guidelines.

### Frontend Console

The `web/` directory hosts a Vite/React dashboard that talks to the backend verifier. It lets operators:

- Inspect the active proving parameters (hashes + binary blobs).
- Monitor the verifier epoch window and drift allowance.
- Upload proof bundles, validate them locally, and invoke `/zkpf/verify` or `/zkpf/verify-bundle`.

Run it alongside the backend:

```bash
cd web
npm install
npm run dev
```

Override the API base via `VITE_ZKPF_API_URL` (otherwise it falls back to the window origin or `http://localhost:3000`).

### On-chain wallet proof-of-funds (design)

The `docs/onchain-proof-of-funds.md` document and `contracts/` directory introduce an **on-chain rail** for zk proof-of-funds:

- `contracts/WalletCommitmentRegistry.sol` lets a holder (or custodian) register **commitments** that bind a pseudonymous `holderId` to a set of wallets without revealing raw addresses.
- `contracts/BalanceSnapshotPublisher.sol` publishes Merkle roots of `(address, balance)` snapshots at specific block heights, so zk circuits can prove membership against a canonical on-chain snapshot.
- `contracts/AttestationRegistry.sol` provides an optional registry of **attestations** that verifiers/banks can write after successful proof verification, enabling reusable, on-chain “proof-of-funds receipts”.

The current Halo2 circuit and Rust crates remain focused on custodial attestations (circuit version 3). A future circuit version can implement the Merkle-based wallet aggregation logic described in the design doc while keeping the HTTP API and frontend shape stable. This lets a crypto holder:

1. Commit wallets on-chain.
2. Use an off-chain prover to aggregate balances at a snapshot into a zk proof bundle.
3. Present that bundle to a bank or exchange, which verifies it through the existing `/zkpf/verify` or `/zkpf/verify-bundle` endpoints and, if desired, records an on-chain attestation.

### Zcash Orchard rail (ZCASH_ORCHARD) – current status

The workspace now includes a **Zcash Orchard rail** skeleton that fits into the existing `ProofBundle` flow:

- **What’s implemented**
  - `zkpf-zcash-orchard-wallet`:
    - Defines `OrchardFvk`, `OrchardNoteWitness`, `OrchardMerklePath`, and `OrchardSnapshot`.
    - Exposes `build_snapshot_for_fvk(fvk, height) -> OrchidSnapshot`, which describes the exact data the circuit needs (notes, values, Merkle paths to an Orchard anchor).
    - Currently returns `WalletError::NotImplemented`; it is intentionally a pure API crate so you can wire in `zcash_client_backend` / `orchard` and your preferred storage engine.
  - `zkpf-zcash-orchard-circuit`:
    - Introduces `RAIL_ID_ZCASH_ORCHARD`, `OrchardPublicMeta` (chain/pool IDs, anchor, holder binding), and `PublicMetaInputs` (policy/scope/epoch/currency).
    - Provides `build_verifier_public_inputs` to construct a `VerifierPublicInputs` compatible with the existing backend.
    - Provides `prove_orchard_pof(snapshot, fvk, holder_id, threshold_zats, orchard_meta, public_meta) -> Result<ProofBundle, OrchardRailError>`, which validates inputs and currently returns `OrchardRailError::NotImplemented` as a placeholder for the future Halo2 Orchard circuit.
  - `zkpf-rails-zcash-orchard`:
    - Exposes `POST /rails/zcash-orchard/proof-of-funds`, accepting `{ holder_id, fvk, threshold_zats, snapshot_height, policy_id, scope_id, epoch, currency_code_zec }`.
    - Builds an `OrchardFvk`, calls `build_snapshot_for_fvk`, derives Orchard + policy metadata, and delegates to `prove_orchard_pof`.
    - Compiles and runs as a standalone service on `:3100`, but currently surfaces a 500-style error because the circuit and wallet backend are intentionally unimplemented.

- **What’s left to reach a fully working ZCASH_ORCHARD rail**
  - **Wallet sync implementation**:
    - Implement `build_snapshot_for_fvk` using the official Zcash Rust crates (`zcash_client_backend`, `orchard`, etc.).
    - Ingest compact blocks, maintain the Orchard note commitment tree + anchors, and produce Merkle paths and values for all notes owned by a given Orchard FVK at a target height.
    - Back this with a persistent store (e.g. RocksDB/SQLite) and add a README section describing how to run the sync process.
  - **Orchard Halo2 circuit + artifacts**:
    - Implement a new Halo2 circuit that:
      - Recomputes each note commitment and verifies inclusion under `anchor_orchard`.
      - Enforces ownership via FVK-derived keys.
      - Sums note values and enforces `Σ v_i ≥ threshold_zats`.
      - Computes/validates a holder binding and nullifier compatible with the existing `VerifierPublicInputs` pattern.
    - Generate proving/verifying keys and integrate them into the artifact/manifest tooling in `zkpf-common`.
    - Replace the `OrchardRailError::NotImplemented` placeholder in `prove_orchard_pof` with real proof generation.
  - **Verifier + UI multi-rail integration**:
    - Extend the backend to support multiple rails by:
      - Adding a `rail_id` discriminator (e.g. `"ZCASH_ORCHARD"`) alongside `circuit_version` in `ProofBundle`.
      - Loading the appropriate `{params, vk}` pair based on `rail_id` instead of a single global manifest.
    - Surface Orchard-specific metadata (block height, chain/pool IDs, holder binding) in the web UI’s bundle summary once the circuit exposes them as public inputs.

Until those pieces are implemented, the Orchard rail code serves as a **spec-backed scaffold**: the types, crate boundaries, and HTTP surface are in place so that Zcash-specific engineering work can focus purely on chain sync and circuit construction without further changes to the surrounding zkpf stack.

