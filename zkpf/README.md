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
| `zkpf-zcash-orchard-circuit` | Public API for the `ZCASH_ORCHARD` rail circuit, including Orchard-specific public metadata and a `prove_orchard_pof` entrypoint. It builds `VerifierPublicInputs` in the V2_ORCHARD layout and wraps a bn256 circuit that will eventually act as an **outer recursive verifier** of an inner Orchard PoF circuit. |
| `zkpf-orchard-inner` | Defines the data model and prover interface for the **inner Orchard proof-of-funds circuit** over the Pallas/Vesta fields. This circuit is expected to use Orchard’s own Halo2 gadgets (MerkleChip, Sinsemilla `MerklePath::calculate_root`, etc.) to enforce consensus-compatible Orchard semantics. |
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
- `POST /zkpf/prove-bundle` – runs the custodial prover over a `ZkpfCircuitInput` (attestation + public inputs) and returns a normalized `ProofBundle` JSON.
- `POST /zkpf/verify` – verifies raw proof bytes + serialized public inputs for a specific policy using the **default custodial rail**.
- `POST /zkpf/verify-bundle` – verifies a pre-serialized `ProofBundle` for a specific policy across **multiple rails**.
- `POST /zkpf/attest` – re-verifies a `ProofBundle` and, when EVM attestation is configured, records an attestation in the on-chain `AttestationRegistry`.

Example bodies:

```jsonc
POST /zkpf/prove-bundle
{
  "attestation": {
    "balance_raw": 5_000_000_000,
    "currency_code_int": 840,
    "custodian_id": 77,
    "attestation_id": 4242,
    "issued_at": 1_705_000_000,
    "valid_until": 1_705_086_400,
    "account_id_hash": "d202964900000000000000000000000000000000000000000000000000000000",
    "custodian_pubkey": { "x": [/* 32 bytes */], "y": [/* 32 bytes */] },
    "signature": { "r": [/* 32 bytes */], "s": [/* 32 bytes */] },
    "message_hash": [/* 32 bytes */]
  },
  "public": {
    "threshold_raw": 1_000_000_000,
    "required_currency_code": 840,
    "required_custodian_id": 77,
    "current_epoch": 1_705_000_000,
    "verifier_scope_id": 314159,
    "policy_id": 2718,
    "nullifier": "510b…0e",
    "custodian_pubkey_hash": "12d0…b2"
  }
}
```

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

```jsonc
POST /zkpf/attest
{
  "holder_id": "treasury-desk-1234",
  "snapshot_id": "custodial-epoch-1705000000",
  "policy_id": 2718,
  "bundle": { /* same shape as /zkpf/verify-bundle */ }
}
```

Requests are rejected if the stored policy disagrees with the decoded public inputs, if the custodian hash does not match the allow-list (for custodial rails), if the epoch drifts beyond the configured window, or if the nullifier has already been consumed for that scope/policy pair. Structural issues (missing policy, circuit version mismatch, unknown `rail_id`, malformed public inputs) return HTTP 4xx errors with `{ "error", "error_code" }` payloads, while verification outcomes return HTTP 200 with `{ valid, error, error_code }`. On-chain attestation outcomes from `/zkpf/attest` always return HTTP 200 with an `AttestResponse { valid, tx_hash, attestation_id, holder_id, policy_id, snapshot_id, error, error_code }` payload.

#### On-chain attestation relayer configuration

The `/zkpf/attest` endpoint is backed by an optional EVM relayer that talks to the `AttestationRegistry` contract. It is enabled and configured via environment variables:

- `ZKPF_ATTESTATION_ENABLED` – set to `1`/`true` to enable on-chain attestation; when unset or `0` the `/zkpf/attest` endpoint returns `valid: false` with `ATTESTATION_DISABLED`.
- `ZKPF_ATTESTATION_RPC_URL` – HTTPS RPC URL for the target chain (e.g. a Sepolia endpoint).
- `ZKPF_ATTESTATION_CHAIN_ID` – numeric chain ID used when signing transactions.
- `ZKPF_ATTESTATION_REGISTRY_ADDRESS` – deployed `AttestationRegistry` contract address (hex with `0x` prefix).
- `ZKPF_ATTESTOR_PRIVATE_KEY` – hex-encoded private key for the relayer wallet that calls `AttestationRegistry.attest`.

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

When deploying the Rust backend to Fly.io (for example at `https://zkpf-backend.fly.dev`), and the web console to Vercel:

- Set the frontend environment variable to point at the Fly app:

  ```bash
  # Vercel / .env.local
  VITE_ZKPF_API_URL=https://zkpf-backend.fly.dev
  ```

- After redeploying the frontend, the browser will call:
  - `GET https://zkpf-backend.fly.dev/zkpf/policies`
  - `GET https://zkpf-backend.fly.dev/zkpf/epoch`
  - `POST https://zkpf-backend.fly.dev/zkpf/verify-bundle` / `/zkpf/verify` / `/zkpf/attest`

This is the only wiring needed: the backend remains a plain Axum service on Fly.io, and the web UI (locally or on Vercel) discovers it via `VITE_ZKPF_API_URL`.

### On-chain wallet proof-of-funds (design)

The `docs/onchain-proof-of-funds.md` document and `contracts/` directory introduce an **on-chain rail** for zk proof-of-funds:

- `contracts/WalletCommitmentRegistry.sol` lets a holder (or custodian) register **commitments** that bind a pseudonymous `holderId` to a set of wallets without revealing raw addresses.
- `contracts/BalanceSnapshotPublisher.sol` publishes Merkle roots of `(address, balance)` snapshots at specific block heights, so zk circuits can prove membership against a canonical on-chain snapshot.
- `contracts/AttestationRegistry.sol` provides an optional registry of **attestations** that verifiers/banks can write after successful proof verification, enabling reusable, on-chain “proof-of-funds receipts”.

The current Halo2 circuit and Rust crates remain focused on custodial attestations (circuit version 3). A future circuit version can implement the Merkle-based wallet aggregation logic described in the design doc while keeping the HTTP API and frontend shape stable. This lets a crypto holder:

1. Commit wallets on-chain.
2. Use an off-chain prover to aggregate balances at a snapshot into a zk proof bundle.
3. Present that bundle to a bank or exchange, which verifies it through the existing `/zkpf/verify` or `/zkpf/verify-bundle` endpoints and, if desired, records an on-chain attestation.

### Zcash Orchard rail (ZCASH_ORCHARD) – architecture snapshot

The workspace now includes a **Zcash Orchard rail** that is wired into the existing
`ProofBundle` + backend + UI flow, with a clear split between:

- a **canonical inner Orchard PoF circuit** over Pasta (Pallas/Vesta) that reuses the official
  Orchard Halo2 gadgets, and
- an optional **bn256 wrapper circuit** for environments (like EVM) that require bn254-style curves.

At a high level, the Orchard rail proves:

1. There exists a set of Orchard notes `{n_i}` whose commitments `cmx_i` are leaves of the **canonical
   Orchard note commitment tree** at some anchor `rt` (depth 32, `MerkleCRH^Orchard`).
2. The values `v_i` used in the proof are exactly the values committed in those notes.
3. The sum satisfies `Σ v_i ≥ threshold_zats`.
4. All notes are consistent with a single Orchard viewing key (UFVK/FVK).
5. The circuit outputs the real Orchard nullifiers of these notes so verifiers can check unspentness.
6. Optionally, the notes are bound to a holder identifier + UFVK via an in-circuit binding hash.

**Inner data model and circuit interface**

- `zkpf-orchard-inner` defines the **inner circuit’s public inputs and witnesses**:
  - `OrchardInnerPublicInputs`:
    - `anchor_orchard: [u8; 32]` – Orchard anchor (Merkle root) at `height`.
    - `height: u32` – snapshot chain height.
    - `ufvk_commitment: [u8; 32]` – commitment to the holder’s UFVK / Orchard FVK.
    - `threshold_zats: u64` – PoF threshold in zatoshi.
    - `sum_zats: u64` – sum of all included note values (driven by the circuit).
    - `nullifiers: Vec<[u8; 32]>` – Orchard nullifiers for each included note.
    - `binding: Option<[u8; 32]>` – optional holder/UFVK/policy binding, e.g.
      `Poseidon(holder_id_bytes || ufvk_bytes || domain_bytes)`.
  - `OrchardPofNoteWitness`:
    - `value_zats: u64` – Orchard note value.
    - `cmx: [u8; 32]` – extracted note commitment.
    - `merkle_siblings: Vec<[u8; 32]>` – Merkle siblings (encoded `MerkleHashOrchard` values).
    - `position: u64` – leaf position in the global note commitment tree.
  - `OrchardPofInput`:
    - `public: OrchardInnerPublicInputs`.
    - `notes: Vec<OrchardPofNoteWitness>`.
    - `ufvk_bytes: Vec<u8>` – UFVK / Orchard viewing key material for ownership checks.
  - `ORCHARD_POF_MAX_NOTES: usize = 32` – a hard upper bound on the number of notes per proof; inner
    circuits are expected to pad up to this bound or reject larger witnesses.
  - `OrchardPofProver` trait:
    - `fn prove_orchard_pof_statement(&self, input: &OrchardPofInput) -> Result<(Vec<u8>, OrchardInnerPublicInputs), OrchardPofError>;`
    - Implementations are expected to:
      - Convert `merkle_siblings` into `halo2_gadgets::sinsemilla::merkle::MerklePath`.
      - Use Orchard’s `MerkleChip` + Sinsemilla gadgets to recompute the Orchard root with
        `MerklePath::calculate_root` under the canonical `MerkleCRH^Orchard` domain.
      - Recompute note commitments from note fields and enforce membership under `anchor_orchard`.
      - Enforce UFVK ownership and `Σ v_i ≥ threshold_zats` inside a Pasta-field Halo2 circuit.
      - Compute Orchard nullifiers in-circuit and expose them in `nullifiers`.

**Inner circuit crate and wallet snapshots**

- `zkpf-orchard-pof-circuit`:
  - Defines Orchard-typed snapshots that mirror wallet semantics:
    - `OrchardPofNoteSnapshot`:
      - `note: Option<orchard::Note>` – full Orchard note (optional for early integrations).
      - `value_zats: orchard::value::NoteValue` – note value as a Zcash `NoteValue`.
      - `cmx: orchard::note::ExtractedNoteCommitment`.
      - `position: u64`.
      - `merkle_path: orchard::tree::MerklePath`.
    - `OrchardPofSnapshot`:
      - `height: u32`.
      - `anchor: orchard::tree::Anchor`.
      - `notes: Vec<OrchardPofNoteSnapshot>`.
  - Exposes `OrchardPofParams` (threshold, UFVK bytes, optional holder ID) and a helper:
    - `snapshot_to_inner_input(snapshot, params) -> OrchardPofInput` which:
      - Enforces `notes.len() ≤ ORCHARD_POF_MAX_NOTES`.
      - Converts `anchor` and `MerklePath` into the inner witness format.
      - Leaves `sum_zats`, `nullifiers`, and `binding` to be populated by the circuit.
  - Introduces `OrchardPofCircuitArtifacts { params_bytes, vk_bytes, pk_bytes }` and
    `OrchardPofCircuitProver { artifacts }`, a thin wrapper that implements
    `OrchardPofProver` and is ready to be backed by a concrete Halo2 Pasta circuit.

- `zkpf-zcash-orchard-wallet`:
  - Provides a rail-facing snapshot format:
    - `OrchardFvk { encoded: String }` – UFVK wrapper.
    - `OrchardMerklePath { siblings: Vec<[u8; 32]>, position: u64 }`.
    - `OrchardNoteWitness { value_zats: u64, commitment: [u8; 32], merkle_path: OrchardMerklePath }`.
    - `OrchardSnapshot { height: u32, anchor: [u8; 32], notes: Vec<OrchardNoteWitness> }`.
  - Adds `snapshot_to_pof_snapshot(snapshot: &OrchardSnapshot)` which:
    - Parses `anchor` via `orchard::tree::Anchor::from_bytes`.
    - Converts `OrchardMerklePath.siblings` into `[MerkleHashOrchard; 32]`, enforcing exactly 32 siblings.
    - Builds a canonical `orchard::tree::MerklePath` using `MerklePath::from_parts(position, auth_path)`.
    - Constructs `OrchardPofNoteSnapshot` values using `NoteValue::from_raw(value_zats)` and
      `ExtractedNoteCommitment::from_bytes(commitment)`.
    - Returns a fully-typed `OrchardPofSnapshot` suitable for `snapshot_to_inner_input`.

**bn256 / EVM wrapper and backend integration**

- `zkpf-zcash-orchard-circuit` is documented as a **bn256 wrapper circuit**:
  - It owns `RAIL_ID_ZCASH_ORCHARD`, `OrchardPublicMeta` (chain/pool IDs, anchor, holder binding),
    and `PublicMetaInputs` (policy/scope/epoch/currency).
  - It relies on `zkpf_common::PublicInputLayout::V2Orchard` to map Orchard snapshot metadata into
    `VerifierPublicInputs`, and provides helpers:
    - `build_verifier_public_inputs(threshold_zats, orchard_meta, meta, nullifier, custodian_pubkey_hash)`.
    - `map_inner_to_verifier_public_inputs(inner: &OrchardInnerPublicInputs, meta, nullifier, custodian_pubkey_hash, holder_binding)`.
  - Its long-term role is to:
    - Take an **inner Orchard PoF proof + `OrchardInnerPublicInputs`** as witnesses.
    - Use a bn256 recursion gadget to verify the inner (Pasta) proof.
    - Map the inner public inputs into a single `VerifierPublicInputs` struct for the zkpf backend.

- `zkpf-rails-zcash-orchard`:
  - Exposes `POST /rails/zcash-orchard/proof-of-funds` to:
    - Build `OrchardSnapshot` via `build_snapshot_for_fvk` (once the wallet backend is fully wired).
    - Convert the snapshot into `OrchardPofSnapshot` / `OrchardPofInput`.
    - Call into an `OrchardPofProver` implementation to obtain:
      - A Pasta-field Orchard PoF proof + `OrchardInnerPublicInputs`.
      - Eventually a bn256 wrapper proof for `RAIL_ID_ZCASH_ORCHARD`, produced by
        `zkpf-zcash-orchard-circuit`.

With these pieces in place, the Orchard rail is now modeled as:

- **Canonical semantics**: an inner Orchard PoF circuit over Pasta using Orchard’s own gadgets and
  real Orchard trees/notes/nullifiers (`zkpf-orchard-inner`, `zkpf-orchard-pof-circuit`,
  `zkpf-zcash-orchard-wallet`).
- **Optional bn256/EVM wrapper**: a recursive bn256 circuit that only attests “the inner Orchard PoF
  verified” and maps its public inputs into the shared `VerifierPublicInputs` layout
  (`zkpf-zcash-orchard-circuit`).

- **What’s left to reach a fully working ZCASH_ORCHARD rail**
  - **Inner Orchard Halo2 circuit + artifacts (Pallas/Vesta)**
    - Implement the inner Orchard PoF circuit (in the Orchard repo or an adjacent crate) that:
      - Recomputes each note commitment and verifies inclusion under the provided Orchard anchor
        using `halo2_gadgets::sinsemilla::merkle::MerklePath::calculate_root` and `MerkleCRH`.
      - Enforces ownership via the Orchard component of the UFVK.
      - Sums note values and enforces `Σ v_i ≥ threshold_zats`, populating `sum_zats`.
      - Computes/validates a holder binding compatible with the existing anti-replay semantics.
      - Exposes its public inputs via `OrchardInnerPublicInputs`.
    - Generate inner proving/verifying keys and document their artifact locations.
  - **Outer bn256 recursive circuit + artifacts**
    - Update `zkpf-zcash-orchard-circuit` to act purely as an outer recursive verifier that:
      - Takes an inner Orchard PoF proof + `OrchardInnerPublicInputs` as witnesses.
      - Uses a Halo2 recursion gadget over bn256 to verify the inner proof.
      - Maps the inner public inputs into `VerifierPublicInputs` via
        `map_inner_to_verifier_public_inputs`, enforcing consistency with the Orchard anchor,
        height, threshold, and holder binding.
    - Generate outer proving/verifying keys and integrate them into the artifact/manifest tooling in
      `zkpf-common` / `zkpf-test-fixtures`, and wire the Orchard rail’s manifest entry to those
      artifacts via `ZKPF_MULTI_RAIL_MANIFEST_PATH` / `ZKPF_ORCHARD_MANIFEST_PATH`.

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

