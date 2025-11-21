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
| `zkpf-zcash-orchard-wallet` | Zcash/Orchard-specific wallet backend and snapshot API. Owns a global `WalletDb` + `BlockDb` (via `zcash_client_sqlite`), loads config from env, runs a background sync loop against `lightwalletd`, and exposes `build_snapshot_for_fvk(fvk, height) -> OrchardSnapshot` backed by real Orchard notes (values, commitments, Merkle paths, and anchors) for an imported UFVK. |
| `zkpf-zcash-orchard-circuit` | Public API for the `ZCASH_ORCHARD` rail circuit, including Orchard-specific public metadata and a `prove_orchard_pof` entrypoint. Input validation and `VerifierPublicInputs` construction (including Orchard snapshot fields) are implemented; the Halo2 Orchard circuit and proof generation are still TODO. |
| `zkpf-rails-zcash-orchard` | Axum-based rail service exposing `POST /rails/zcash-orchard/proof-of-funds`. On startup it initializes the global Orchard wallet from env and spawns a background sync loop; each request builds a snapshot via `build_snapshot_for_fvk`, derives Orchard + policy metadata, and calls `prove_orchard_pof` to obtain a `ProofBundle` for the Orchard rail (currently still unimplemented at the circuit level). |

### Public Input Vector (custodial rail, v1)

The custodial attestation circuit (version 3) exposes eight instance columns (in order):
1. `threshold_raw` – minimum balance required (u64).
2. `required_currency_code` – ISO-4217 integer code enforced by policy (u32).
3. `required_custodian_id` – allow-listed custodian identifier (u32).
4. `current_epoch` – verifier-supplied epoch that must satisfy `issued_at ≤ current_epoch ≤ valid_until`.
5. `verifier_scope_id` – domain separator for nullifier computation.
6. `policy_id` – policy identifier hashed into the nullifier.
7. `nullifier` – Poseidon hash over `(account_id_hash, verifier_scope_id, policy_id, current_epoch)`.
8. `custodian_pubkey_hash` – Poseidon hash over the x/y coordinates of the allow-listed secp256k1 public key.

Backends should refuse proofs when the supplied public inputs are not consistent with their allowlist (see `zkpf_common::allowlisted_custodian_hash_bytes`).

Orchard and future wallet rails extend this logical struct with optional fields:

- `snapshot_block_height: Option<u64>` – the block height used as the snapshot boundary.
- `snapshot_anchor_orchard: Option<[u8; 32]>` – the Orchard Merkle root at that height.
- `holder_binding: Option<[u8; 32]>` – an optional binding (e.g. `H(holder_id || fvk_bytes)`).

These are represented on the Rust side via `zkpf_common::VerifierPublicInputs` plus a
`PublicInputLayout` enum:

- `PublicInputLayout::V1` – legacy custodial rail (8 public inputs).
- `PublicInputLayout::V2Orchard` – Orchard rail layout: the V1 prefix plus the three snapshot
  fields as trailing public inputs.

### Backend Verification API

The backend exposes:

- `GET /zkpf/policies` – returns the configured policy catalog so operators can pick a `policy_id`.
- `POST /zkpf/verify` – verifies raw proof bytes + serialized public inputs for a specific policy using the **default custodial rail**.
- `POST /zkpf/verify-bundle` – verifies a pre-serialized `ProofBundle` for a specific policy across **multiple rails**.

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
    // Omitted or "" => legacy custodial rail; explicit IDs like "ZCASH_ORCHARD"
    // select other rails when configured.
    "rail_id": "",
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

Requests are rejected if the stored policy disagrees with the decoded public inputs, if the custodian hash does not match the allow-list (for custodial rails), if the epoch drifts beyond the configured window, or if the nullifier has already been consumed for that scope/policy pair. Structural issues (missing policy, circuit version mismatch, unknown `rail_id`, malformed public inputs) return HTTP 4xx errors with `{ "error", "error_code" }` payloads, while verification outcomes return HTTP 200 with `{ valid, error, error_code }`.

Multi-rail behavior is controlled by a **rail registry** loaded at backend startup:

- The legacy custodial rail is always available:
  - Default manifest: `artifacts/manifest.json` (overridable via `ZKPF_MANIFEST_PATH`).
  - Logical rail identifiers:
    - `""` (empty string) for backward-compatible bundles.
    - `"CUSTODIAL_ATTESTATION"` as an explicit `rail_id`.
- Additional rails (for example, `ZCASH_ORCHARD`) are configured via a **multi-rail manifest**
  pointed at by `ZKPF_MULTI_RAIL_MANIFEST_PATH`. The manifest has the shape:

  ```jsonc
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

For each entry, the backend loads the per-rail verifier artifacts (`params` + `vk`) and remembers
the declared `PublicInputLayout`. `/zkpf/verify-bundle` then:

- Picks the rail by `bundle.rail_id` (defaulting to the custodial rail when empty or omitted).
- Enforces `bundle.circuit_version == rail.circuit_version`.
- Converts `bundle.public_inputs` to field elements using the rail’s layout.
- Runs Halo2 verification for rails using the V1 custodial layout; for Orchard/V2 rails, the
  current implementation focuses on wiring and policy/nullifier enforcement while the dedicated
  Halo2 Orchard circuit is still under development.

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

The workspace now includes a **Zcash Orchard rail** that is wired end-to-end into the existing
`ProofBundle` + backend + UI flow at the API level, with a **real wallet backend** and
Orchard-specific public-input layout. The dedicated Halo2 Orchard circuit is still pending.

- **What’s implemented**
  - `zkpf-zcash-orchard-wallet`:
    - Defines `OrchardFvk`, `OrchardNoteWitness`, `OrchardMerklePath`, and `OrchardSnapshot`.
    - Owns a global `WalletDb` + `BlockDb` (via `zcash_client_sqlite`) behind a `OnceCell<RwLock<WalletHandle>>`.
    - Loads configuration from env via `OrchardWalletConfig::from_env`:
      - `ZKPF_ORCHARD_NETWORK` – `mainnet` or `testnet`.
      - `ZKPF_ORCHARD_DATA_DB_PATH` – path to the wallet data DB.
      - `ZKPF_ORCHARD_CACHE_DB_PATH` – path to the cache DB.
      - `ZKPF_ORCHARD_LIGHTWALLETD_ENDPOINT` – gRPC endpoint for `lightwalletd`.
    - On initialization (`init_global_wallet`) opens the sqlite data/cache DBs, runs `init_wallet_db`,
      and caches the current chain tip.
    - Exposes an async `sync_once()` that:
      - Connects to `lightwalletd` using the configured endpoint.
      - Uses `zcash_client_backend::sync::run` with an in-memory `BlockCache` to:
        - Refresh Sapling + Orchard subtree roots and chain tip metadata.
        - Download and cache compact blocks for suggested scan ranges.
        - Call `scan_cached_blocks` to advance `WalletDb`, maintain note commitment trees,
          and keep Orchard witnesses up to date.
      - Updates the cached `wallet_tip_height` after each successful sync step.
    - Implements `build_snapshot_for_fvk(fvk, height) -> OrchardSnapshot` that:
      - Decodes `fvk.encoded` as a UFVK (`UnifiedFullViewingKey`), requiring an Orchard component.
      - Looks up a pre-imported account for that UFVK via `WalletRead::get_account_for_ufvk`.
      - Enforces that the wallet tip height is ≥ `height` (otherwise returns `WalletError::UnknownAnchor(height)`).
      - Fetches all Orchard notes via `WalletTest::get_notes(ShieldedProtocol::Orchard)`, filters to the account + `mined_height ≤ height`.
      - Uses `WalletCommitmentTrees::with_orchard_tree_mut` and the underlying `ShardTree` APIs
        (`root_at_checkpoint_id`, `witness_at_checkpoint_id_caching`) to:
        - Compute the Orchard anchor (Merkle root) at the requested height.
        - Compute a Merkle witness for each included note, populating `OrchardMerklePath.siblings`
          and `position`.
      - Returns `OrchardSnapshot { height, anchor, notes }` where `anchor` is the Orchard root at
        `height` and `notes` contains fully-populated witnesses.
  - `zkpf-zcash-orchard-circuit`:
    - Introduces `RAIL_ID_ZCASH_ORCHARD`, `OrchardPublicMeta` (chain/pool IDs, anchor, holder binding),
      and `PublicMetaInputs` (policy/scope/epoch/currency).
    - Extends the global `VerifierPublicInputs` struct with Orchard snapshot fields and relies on
      `zkpf_common::PublicInputLayout::V2Orchard` for its instance layout.
    - Provides `build_verifier_public_inputs` to construct a `VerifierPublicInputs` compatible with
      the Orchard rail, and a `prove_orchard_pof(snapshot, fvk, holder_id, threshold_zats, orchard_meta, public_meta)`
      entrypoint that validates inputs but still returns `OrchardRailError::NotImplemented` as a
      placeholder for the future Halo2 Orchard circuit.
  - `zkpf-rails-zcash-orchard`:
    - Exposes `POST /rails/zcash-orchard/proof-of-funds`, accepting:
      - `holder_id`, `fvk` (UFVK string), `threshold_zats`, `snapshot_height`,
      - `policy_id`, `scope_id`, `epoch`, `currency_code_zec`.
    - At startup, loads `OrchardWalletConfig` from env, calls `init_global_wallet`, and spawns a
      background Tokio task that repeatedly calls `sync_once()` to keep the wallet in sync.
    - For each request:
      - Wraps the FVK string in `OrchardFvk`.
      - Calls `build_snapshot_for_fvk` to obtain an `OrchardSnapshot` or a precise wallet error
        (e.g. invalid FVK, unknown anchor).
      - Builds `OrchardPublicMeta` + `PublicMetaInputs`, and delegates to `prove_orchard_pof` to
        eventually obtain a `ProofBundle` tagged for the Orchard rail once the circuit is available.

- **What’s left to reach a fully working ZCASH_ORCHARD rail**
  - **Orchard Halo2 circuit + artifacts**
    - Design and implement a new Halo2 circuit for Orchard PoF that:
      - Recomputes each note commitment and verifies inclusion under the provided Orchard anchor.
      - Enforces ownership via the Orchard component of the FVK.
      - Sums note values and enforces `Σ v_i ≥ threshold_zats`.
      - Computes/validates a holder binding (e.g. `H(holder_id || fvk_bytes)`) and a PoF nullifier
        compatible with the existing anti-replay semantics.
      - Uses the V2 Orchard public-input layout (custodial prefix + Orchard snapshot fields) in a
        new `circuit_version`.
    - Generate proving/verifying keys and integrate them into the artifact/manifest tooling in
      `zkpf-common` / `zkpf-test-fixtures`.
    - Replace `OrchardRailError::NotImplemented` in `prove_orchard_pof` with real proof generation
      and `ProofBundle` construction for the Orchard rail.

Until the Orchard circuit is implemented, the Orchard rail code is a **spec-backed scaffold with a
real wallet backend**: the types, crate boundaries, HTTP surface, wallet sync, and Merkle
witness/anchor plumbing are in place so that Zcash-specific work can focus on circuit design and
artifact production without further surgery to the surrounding zkpf stack.

### Project TODO / roadmap (high level)

Across the whole workspace, the remaining work can be grouped into a few major themes:

- **1. Orchard rail completion**
  - Implement the Orchard Halo2 circuit, generate artifacts, and wire `prove_orchard_pof` to produce real `ProofBundle`s for `RAIL_ID_ZCASH_ORCHARD`.
  - Harden error handling around wallet connectivity (lightwalletd failures, DB corruption, unknown anchors) and document operational runbooks for the Orchard rail.

- **2. Multi-rail verifier and manifest**
  - Continue evolving the multi-rail manifest and registry to cover additional rails (`ZCASH_ORCHARD`, future EVM/on-chain rails) with clear separation between verifier-only and prover-capable artifacts.
  - Enforce strict `rail_id` and `circuit_version` matching to avoid cross-rail verification mistakes.

- **3. Public-input evolution and circuit versioning**
  - Finalize Orchard and future rail layouts on top of `PublicInputLayout` while keeping the existing custodial circuit on v1.
  - Add helpers in `zkpf-common` and dedicated circuit crates to build and validate per-rail `VerifierPublicInputs` structs, and keep the backend + wasm bindings in sync.

- **4. On-chain wallet PoF rail(s)**
  - Turn the `docs/onchain-proof-of-funds.md` design and `contracts/` into a working rail:
    - Implement a circuit that proves inclusion of wallet balances under on-chain Merkle snapshots.
    - Define a `rail_id` and manifest entry for the on-chain rail.
    - Add a dedicated rail HTTP service and UI configuration similar to the Orchard rail.

- **5. UX, tooling, and docs**
  - Extend the web dashboard’s rail awareness (per-rail filters, status/health panels, richer bundle inspection).
  - Add operational docs for:
    - Running the backend + rails in production (env vars, ports, manifests, nullifier DB).
    - Provisioning Zcash wallets and syncing for the Orchard rail.
    - Rotating artifacts and policies safely.
  - Tighten CI around:
    - Multi-rail regression tests.
    - End-to-end flows (custodial and Orchard) using `zkpf-test-fixtures`-like harnesses.

This README will be updated as the Orchard rail, multi-rail verifier, and future rails progress from scaffold to production-ready status.

