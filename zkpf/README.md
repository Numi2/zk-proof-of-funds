## zk-proof-of-funds

This workspace hosts an end-to-end proving stack for custodial proof-of-funds attestations. The Halo2 circuit enforces a Poseidon commitment over the attestation fields, verifies a secp256k1 ECDSA signature, derives a nullifier scoped to a verifier/policy pair, and now additionally exposes the hash of the custodian’s allow-listed public key as a public input. Deterministic fixtures and test witnesses make it possible to run consistent proofs in CI or locally without depending on external custody systems.

### What's New
- **P2P Marketplace with shareable offers**: A full peer-to-peer trading interface at `/p2p` for buying/selling ZEC. Create offers with custom amounts, prices, and payment methods. Share offers via compact encoded URLs, QR codes, or social media—recipients can view and trade without the offer existing in their local storage. Offers persist in `localStorage` and can be imported via URL paste or direct navigation.
- **URI-Encapsulated Payments (ZIP 324)**: Send Zcash via secure messaging (Signal, WhatsApp) without knowing the recipient's address. New `zkpf-uri-payment` crate handles ephemeral key derivation via ZIP 32, Bech32m key encoding, and URI parsing. React components provide create/receive/history UI at `/wallet/uri-payment`. Keys are recoverable from wallet backup using a gap limit scan.
- **Deterministic witness generation**: `zkpf-circuit/tests/basic.rs` builds a fully valid attestation + signature fixture, allowing the MockProver to run with real data instead of `unimplemented!()`.
- **Expanded public inputs**: An eighth instance column now commits to `custodian_pubkey_hash`, and the nullifier mixes `(account_id_hash, scope_id, policy_id, current_epoch)`.
- **Custodian allowlist baked into the circuit**: `zkpf_circuit::custodians` tracks the exact secp256k1 keys that may sign attestations. The circuit hashes the witness public key and constrains it to the allow-listed hash, and the tests panic when attempting to use a non-listed custodian.
- **Shared fixtures crate**: `zkpf-test-fixtures` produces prover artifacts, serialized public inputs, and JSON blobs with deterministic values so that integration tests across crates consume the same data.
- **Server-owned policy enforcement**: The backend now loads allow-listed policies from `config/policies.json` (override with `ZKPF_POLICY_PATH`). Clients reference policies by `policy_id`, and the service enforces the stored expectations for threshold, currency, custodian, scope, and policy identifiers.
- **Durable nullifier replay protection**: A persistent sled-backed store (`ZKPF_NULLIFIER_DB`, default `data/nullifiers.db`) keeps `(scope_id, policy_id, nullifier)` tuples so duplicate proofs remain rejected across process restarts.
- **Provider-backed Zashi sessions & canonical attestations**: The custodial circuit now includes a dedicated Zashi custodian ID + key, `zkpf-common` exposes a reusable `Attestation` model + Poseidon message-hash helper, and the backend/front-end add `/zkpf/zashi/session/*` APIs plus a "Zashi provider session" workflow that fetches a signed bundle straight from the Zashi app.

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
| `zkpf-uri-payment` | URI-Encapsulated Payments (ZIP 324): ephemeral key derivation, Bech32m key encoding, URI parsing/generation, and payment note construction for sending ZEC via secure messaging. |
| `zkpf-zcash-orchard-wallet` | Zcash/Orchard-specific wallet backend and snapshot API. Owns a global `WalletDb` + `BlockDb` (via `zcash_client_sqlite`), loads config from env, runs a background sync loop against `lightwalletd`, and exposes `build_snapshot_for_fvk(fvk, height) -> OrchardSnapshot` backed by real Orchard notes (values, commitments, Merkle paths, and anchors) for an imported UFVK. |
| `zkpf-zcash-orchard-circuit` | Public API for the `ZCASH_ORCHARD` rail circuit, including Orchard-specific public metadata and a `prove_orchard_pof` entrypoint. It builds `VerifierPublicInputs` in the V2_ORCHARD layout and wraps a bn256 circuit that will eventually act as an **outer recursive verifier** of an inner Orchard PoF circuit. |
| `zkpf-orchard-inner` | Defines the data model and prover interface for the **inner Orchard proof-of-funds circuit** over the Pallas/Vesta fields. This circuit is expected to use Orchard’s own Halo2 gadgets (MerkleChip, Sinsemilla `MerklePath::calculate_root`, etc.) to enforce consensus-compatible Orchard semantics. |
| `zkpf-rails-zcash-orchard` | Axum-based rail service exposing `POST /rails/zcash-orchard/proof-of-funds`. On startup it initializes the global Orchard wallet from env and spawns a background sync loop; each request builds a snapshot via `build_snapshot_for_fvk`, derives Orchard + policy metadata, and calls `prove_orchard_pof` to obtain a `ProofBundle` for the Orchard rail (currently still unimplemented at the circuit level). |
| `zkpf-axelar-gmp` | Types, encoding, chain configurations, and utilities for Axelar General Message Passing integration. Defines `PoFReceipt`, `PoFRevocation`, `GmpMessage`, and chain subscription management for interchain PoF broadcasting. |
| `zkpf-rails-axelar` | Axum-based rail service exposing `/rails/axelar/*` endpoints for Axelar GMP integration. Manages chain subscriptions, broadcasts PoF receipts to connected chains, and provides gas estimation for cross-chain messages. |
| `zkpf-mina` | Core Mina recursive proof hub rail: circuit implementation, types, zkApp interaction helpers, state management, and optional GraphQL client. Wraps zkpf ProofBundles into Mina-native recursive proofs for cross-chain attestations. |
| `zkpf-rails-mina` | Axum-based rail service exposing `/rails/mina/*` endpoints for Mina recursive proof wrapping. Handles multi-rail aggregation, attestation submission to zkApps, and bridge message generation. |

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
- `POST /zkpf/provider/prove-balance` – lets a **provider** submit a signed balance attestation for an opaque account tag and obtain a `ProofBundle` for the `PROVIDER_BALANCE_V2` rail using the existing custodial circuit (threshold, currency, provider key hash, nullifier, and epoch semantics).
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

### Zashi provider sessions

Zashi integrates via server-side policy enforcement without requiring UFVK
exports or on-chain movement:

1. `POST /zkpf/zashi/session/start`
   - Body: `{ "policy_id": 900001 }` plus an optional `"deep_link_scheme"`.
   - Response: `{ session_id, policy, expires_at, deep_link }`, where the deep
     link defaults to `zashi://zkpf-proof?...`.
2. Zashi confirms the user meets the selected policy, builds the canonical
   attestation, and calls `POST /zkpf/zashi/session/submit`:

```jsonc
{
  "session_id": "f38bc92e-a54d-4fb6-827f-5afca0edb6a9",
  "attestation": {
    "balance_raw": "15000000000",
    "currency_code_int": 5915971,
    "custodian_id": 8001,
    "attestation_id": 4242,
    "issued_at": 1705000000,
    "valid_until": 1705086400,
    "account_id_hash": "0xd2029649000000000000000000000000000000000000000000000000000000",
    "custodian_pubkey": { "x": "0x…", "y": "0x…" },
    "signature": { "r": "0x…", "s": "0x…" },
    "message_hash": "0x…"
  }
}
```

3. The backend parses the attestation (`zkpf_common::Attestation`), recomputes
   the Poseidon digest, derives the nullifier/current epoch, and runs the
   custodial prover using the allow-listed Zashi key.
4. `GET /zkpf/zashi/session/{session_id}` polls until the session is `READY`,
   `INVALID`, or `EXPIRED`. READY responses embed the `ProofBundle`, already
   normalized for `/zkpf/verify-bundle`.

Policies `900001` (`Zashi ≥ 10 ZEC`) and `900002` (`Zashi ≥ 100 ZEC`) ship in
`config/policies.json` with `custodian_id = 8001`, so Zashi can offer a one-tap
“Proof of funds” action backed by the existing custodial rail.

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
- Launch a **Zashi provider session** from the Proof Builder (“Zashi provider session (custodial)” rail). The UI starts `/zkpf/zashi/session/start`, surfaces the deep link / QR, polls status, and drops the resulting bundle directly into the prover + Verify console once Zashi submits it.

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

### Fly.io memory sizing & artifacts

For production verifier-only deployments on Fly.io:

- Use at least a 2 GB VM (`[[vm]] memory = "2gb"`) so the KZG params + verifying key fit comfortably in memory without OOM kills.
- Keep `ZKPF_ENABLE_PROVER=0` so the backend never loads the proving key into memory on the verifier instances; run any heavy proving on separate infrastructure.
- When the prover is disabled, `/zkpf/params` returns manifest metadata and BLAKE3 hashes plus streaming artifact URLs under `/zkpf/artifacts/{params,vk,pk}` that operators or CI can download on demand.

If you increase circuit size or add additional rails, bump VM memory accordingly and re-run `/zkpf/params` to confirm the process stays well below the new limit.

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

### Starknet L2 rail (STARKNET_L2) – zk-friendly account abstraction

The workspace includes a **Starknet L2 rail** that enables proof-of-funds over Starknet accounts,
DeFi positions (vaults, LP tokens, lending), and leverages Starknet's native account abstraction
for session keys and batched signatures.

**Key components:**

| Crate | Purpose |
| --- | --- |
| `zkpf-starknet-l2` | Core Starknet circuit, types, state reader, and AA wallet integration. |
| `zkpf-rails-starknet` | HTTP service exposing `/rails/starknet/proof-of-funds` and related endpoints. |

**Cairo contracts:**

| Contract | Purpose |
| --- | --- |
| `AttestationRegistry.cairo` | On-chain attestation storage for Starknet dApps to trust zkpf PoF without going back to L1. |
| `ZkpfVerifier.cairo` | Optional on-chain proof verification with epoch drift and nullifier replay protection. |
| `ZkpfGatedLending.cairo` | Example DeFi integration showing how to gate lending based on PoF. |

**Public input layout (V3_STARKNET):**

The Starknet rail uses an 11-column public input layout:
- Columns 0-6: Base zkpf fields (threshold, currency, epoch, scope, policy, nullifier, pubkey_hash)
- Column 7: `block_number` – Starknet block at snapshot
- Column 8: `account_commitment` – H(account_addresses)
- Column 9: `holder_binding` – H(holder_id || account_commitment)
- Column 10: `proven_sum` – Actual proven sum (optional)

**Account abstraction features:**

- **Session keys**: Sign proof binding messages with limited-scope session keys
- **Batched signatures**: Efficiently sign for multiple accounts in one operation
- **Wallet detection**: Auto-detect Argent, Braavos, and OpenZeppelin accounts

**DeFi position support:**

The rail can aggregate balances across:
- Native ETH/STRK balances
- ERC-20 tokens (USDC, USDT, DAI, WBTC, etc.)
- DeFi positions: JediSwap LP, Nostra lending, zkLend deposits, Ekubo positions, Haiko vaults

**Example policies:**

```json
{
  "policy_id": 200001,
  "threshold_raw": 1000000000000000000,
  "required_currency_code": 1027,
  "verifier_scope_id": 400,
  "rail_id": "STARKNET_L2",
  "label": "Starknet ≥ 1 ETH",
  "category": "STARKNET"
}
```

**Configuration:**

- `ZKPF_STARKNET_RPC_URL` – Starknet JSON-RPC endpoint for state reading
- `ZKPF_STARKNET_CHAIN_ID` – Chain identifier (`SN_MAIN` or `SN_SEPOLIA`)

For detailed documentation, see [docs/starknet-rail.md](docs/starknet-rail.md).

### Axelar GMP rail (AXELAR_GMP) – interchain PoF receipts

The workspace includes an **Axelar GMP rail** that enables zkpf attestations to be broadcast across
chains via Axelar's **General Message Passing (GMP)** protocol. This transforms zkpf into interchain
middleware, allowing dApps on any Axelar-connected chain to trust PoF status without custom bridges.

**What Axelar GMP gives you:**

- **General Message Passing**: Arbitrary data/function calls across EVM and Cosmos chains
- **Unified Security**: Re-uses Axelar's existing security model and validator set
- **Broad Connectivity**: 50+ chains including Ethereum, L2s, and Cosmos ecosystem
- **Programmable Actions**: Trigger remote contract calls based on PoF receipts

**Key components:**

| Crate | Purpose |
| --- | --- |
| `zkpf-axelar-gmp` | Types, encoding, and chain configurations for Axelar GMP. |
| `zkpf-rails-axelar` | HTTP service exposing `/rails/axelar/*` endpoints for broadcasting. |

**Solidity contracts:**

| Contract | Purpose |
| --- | --- |
| `AttestationBridge.sol` | Broadcasts PoF receipts via GMP to subscribed chains. |
| `PoFReceiver.sol` | Receives and stores PoF receipts on destination EVM chains. |
| `pof_receiver.rs` | CosmWasm contract for Cosmos chains (Osmosis, Neutron, etc.). |

**PoF receipt format:**

```rust
struct PoFReceipt {
    holder_id: [u8; 32],         // Pseudonymous holder identifier
    policy_id: u64,              // Policy under which proof was verified
    snapshot_id: [u8; 32],       // Snapshot identifier
    chain_id_origin: u64,        // Chain where attestation was recorded
    attestation_hash: [u8; 32],  // Hash of the full attestation
    validity_window: u64,        // Seconds until receipt expires
    issued_at: u64,              // Timestamp when attestation was issued
}
```

**Interchain action examples:**

- **Interchain credit lines**: User proves solvency on Ethereum, obtains credit on Osmosis solely
  based on the GMP PoF receipt—no collateral required on the destination chain.
- **Undercollateralized lending**: DeFi protocols on Chain B can whitelist holders with valid
  PoF receipts from Chain A for higher LTV ratios.
- **Cross-chain gating**: DEXs, NFT marketplaces, or DAOs can gate high-value operations behind
  PoF verification from any Axelar-connected chain.

**Supported chains:**

| Type | Chains |
| --- | --- |
| EVM | Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Scroll, zkSync, Linea, Blast |
| Cosmos | Osmosis, Neutron, Sei, Injective, Celestia, dYdX |

**Example policies:**

```json
{
  "policy_id": 300001,
  "threshold_raw": 1000000000000000000,
  "required_currency_code": 1027,
  "verifier_scope_id": 500,
  "rail_id": "AXELAR_GMP",
  "label": "Interchain PoF ≥ 1 ETH (broadcasts to all)",
  "category": "AXELAR_INTERCHAIN",
  "axelar_config": {
    "broadcast_chains": ["osmosis", "neutron", "arbitrum", "optimism"],
    "validity_window_secs": 86400
  }
}
```

**Configuration:**

- `ZKPF_AXELAR_GATEWAY` – Axelar Gateway contract address
- `ZKPF_AXELAR_GAS_SERVICE` – Axelar Gas Service contract address
- `ZKPF_ORIGIN_CHAIN_ID` – Origin chain ID (e.g., 1 for Ethereum)
- `ZKPF_ORIGIN_CHAIN_NAME` – Axelar chain identifier (e.g., "ethereum")
- `ZKPF_AXELAR_VALIDITY_WINDOW` – Default receipt validity in seconds (default: 86400)

For detailed documentation, see [docs/axelar-gmp.md](docs/axelar-gmp.md).

### Mina recursive proof hub rail (MINA_RECURSIVE) – cross-chain compliance layer

The workspace includes a **Mina recursive proof hub rail** that enables zkpf to serve as a
cross-chain compliance layer by wrapping ProofBundles into Mina-native recursive proofs.

**Key insight:** *PoF verified once in a privacy-preserving way; many chains can reuse it.*

Mina's ~22KB light client footprint makes it realistic for institutional verifiers to self-verify
proofs cheaply without running full nodes.

**Key components:**

| Crate | Purpose |
| --- | --- |
| `zkpf-mina` | Core circuit, types, zkApp helpers, state management, and optional GraphQL client. |
| `zkpf-rails-mina` | HTTP service exposing `/rails/mina/*` endpoints for proof wrapping and bridge messages. |

**How it works:**

1. **ProofBundle wrapping**: Existing zkpf proofs from any rail (Starknet, Orchard, custodial, etc.)
   are wrapped into Mina-native recursive proofs.
2. **Cross-chain attestations**: The Mina zkApp emits attestations that other chains can query via
   zkBridges.
3. **Privacy preservation**: Original proofs and addresses remain hidden; only the attestation bit
   `has_PoF(holder, policy) = true` is propagated.

**Public input layout (V4_MINA):**

The Mina rail uses an 11-column public input layout:
- Columns 0-6: Base zkpf fields (threshold, currency, epoch, scope, policy, nullifier, pubkey_hash)
- Column 7: `mina_slot` – Global slot at proof creation
- Column 8: `recursive_proof_commitment` – Hash of wrapped recursive proof
- Column 9: `zkapp_commitment` – Commitment to the verifier zkApp
- Column 10: `proven_sum` – Aggregated proven sum

**Multi-rail aggregation:**

```json
{
  "source_proofs": [
    { "bundle": { "rail_id": "STARKNET_L2", ... } },
    { "bundle": { "rail_id": "ZCASH_ORCHARD", ... } },
    { "bundle": { "rail_id": "CUSTODIAL_ATTESTATION", ... } }
  ]
}
```

This creates a single Mina attestation covering all source proofs, queryable by any target chain.

**Example policies:**

```json
{
  "policy_id": 400001,
  "threshold_raw": 1000000000000000000,
  "required_currency_code": 1027,
  "verifier_scope_id": 700,
  "rail_id": "MINA_RECURSIVE",
  "label": "Cross-chain ≥ 1 ETH (via Mina)",
  "category": "MINA_HUB"
}
```

**Configuration:**

- `ZKPF_MINA_NETWORK` – Mina network (mainnet/testnet/berkeley)
- `ZKPF_MINA_GRAPHQL_URL` – Mina GraphQL endpoint
- `ZKPF_MINA_ZKAPP_ADDRESS` – zkApp verifier address

For detailed documentation, see [docs/mina-rail.md](docs/mina-rail.md) and [docs/mina-roadmap.md](docs/mina-roadmap.md).

### Provider-balance rail (PROVIDER_BALANCE_V2) – generic provider-attested proofs

In addition to the custodial and Orchard rails, the backend exposes a **provider-balance rail**
that reuses the existing custodial circuit to prove statements of the form:

- *“A trusted provider attests that this opaque account has balance ≥ X units under policy P,
  and the provider’s key and policy metadata match the verifier’s expectations.”*

This rail is intentionally wallet-agnostic:

- Any upstream wallet or custody system that can compute a balance and a stable 32-byte
  `account_tag` can integrate by:
  - Sending a **provider-signed attestation** to `/zkpf/provider/prove-balance`, and
  - Receiving a `ProofBundle` with `rail_id: "PROVIDER_BALANCE_V2"` that verifiers check
    via the usual `/zkpf/verify-bundle` endpoint.

#### Roles and flow

- **Provider** – entity that:
  - Owns a secp256k1 signing key that is allow-listed in the zkpf custodial circuit
    (via `custodians.rs` and the policy’s `required_custodian_id`).
  - Holds or derives view-only data from one or more wallets (e.g. Zcash UFVK, CSV exports,
    internal ledgers) in order to compute a conservative `balance_raw`.
  - Constructs a private balance attestation per account, signs it, and calls zkpf to obtain
    a reusable `ProofBundle`.
- **Verifier** – any counterparty (exchange, DApp, desk, person) that:
  - Configures a policy with:
    - `rail_id: "PROVIDER_BALANCE_V2"`,
    - Threshold and currency, and
    - An allow-listed provider ID whose pubkey hash is baked into the circuit artifacts.
  - Consumes `ProofBundle`s via `/zkpf/verify-bundle` and never sees the underlying attestation
    or exact balance.

High-level flow:

1. Provider computes `balance_raw` for some logical account from view-only wallet data.
2. Provider chooses an **opaque** 32-byte `account_tag` (e.g. `H("pof:acct:" || H(account_source))`)
   that is:
   - Stable per logical account, and
   - Never revealed to verifiers except via the one-way nullifier.
3. Provider builds a private attestation:
   - `balance_raw`, `currency_code_int`, `attestation_id`, `issued_at`, `valid_until`,
   - `account_tag` (hex-encoded 32-byte string),
   - Provider secp256k1 public key + ECDSA signature over a 32-byte `message_hash`.
4. Provider calls:

   ```jsonc
   POST /zkpf/provider/prove-balance
   {
     "policy_id": 900001,
     "attestation": {
       "balance_raw": 1_500_000_000,
       "currency_code_int": 123456,
       "attestation_id": 42,
       "issued_at": 1_705_000_000,
       "valid_until": 1_705_086_400,
       "account_tag": "0x…32-byte-hex…",
       "custodian_pubkey": { "x": [/* 32 bytes */], "y": [/* 32 bytes */] },
       "signature": { "r": [/* 32 bytes */], "s": [/* 32 bytes */] },
       "message_hash": [/* 32-byte array */]
     }
   }
   ```

5. The backend:
   - Looks up the policy by `policy_id` to obtain:
     - `threshold_raw`, `required_currency_code`, `required_custodian_id`,
       `verifier_scope_id`, and `policy_id`.
   - Normalizes `account_tag` into a bn256 field element:

     ```rust
     let account_tag_bytes = parse_hex_32(&att.account_tag)?;
     let account_id_hash = reduce_be_bytes_to_fr(&account_tag_bytes);
     ```

   - Computes the canonical nullifier in the field, mirroring the in-circuit gadget:

     ```rust
     let nullifier = nullifier_fr(
         account_id_hash,
         policy.verifier_scope_id,
         policy.policy_id,
         current_epoch,
     );
     ```

   - Hashes the provider’s secp256k1 pubkey into the shared `custodian_pubkey_hash` field:

     ```rust
     let pubkey_hash = custodian_pubkey_hash(&att.custodian_pubkey);
     ```

   - Constructs the circuit `PublicInputs` and `AttestationWitness`:

     ```rust
     let public = PublicInputs {
         threshold_raw: policy.threshold_raw,
         required_currency_code: policy.required_currency_code,
         required_custodian_id: policy.required_custodian_id,
         current_epoch,
         verifier_scope_id: policy.verifier_scope_id,
         policy_id: policy.policy_id,
         nullifier,
         custodian_pubkey_hash: pubkey_hash,
     };
     let witness = AttestationWitness {
         balance_raw: att.balance_raw,
         currency_code_int: att.currency_code_int,
         custodian_id: policy.required_custodian_id,
         attestation_id: att.attestation_id,
         issued_at: att.issued_at,
         valid_until: att.valid_until,
         account_id_hash,
         custodian_pubkey: att.custodian_pubkey,
         signature: att.signature,
         message_hash: att.message_hash,
     };
     ```

   - Enforces **policy**, **provider allowlist**, **epoch drift**, and **nullifier replay**
     against the derived `VerifierPublicInputs`.
   - Runs the existing custodial Halo2 circuit to produce a `ProofBundle` and tags it:

     ```rust
     bundle.rail_id = "PROVIDER_BALANCE_V2".to_string();
     ```

6. The provider receives a `ProofBundle` that they can return to the wallet or holder.

#### Verifier semantics for PROVIDER_BALANCE_V2

From the verifier’s perspective, a `ProofBundle` with `rail_id: "PROVIDER_BALANCE_V2"` has:

- Public fields:
  - `threshold_raw` – policy’s minimum balance in raw units.
  - `required_currency_code` – asset code (e.g. ZEC) as configured in the policy.
  - `required_custodian_id` – an identifier for the allow-listed provider key baked into
    the circuit artifacts and policies.
  - `current_epoch`, `verifier_scope_id`, `policy_id` – same semantics as the custodial rail.
  - `nullifier` – Poseidon hash over
    `(account_id_hash, verifier_scope_id, policy_id, current_epoch)` where `account_id_hash`
    is derived from the opaque `account_tag`.
  - `custodian_pubkey_hash` – Poseidon hash over the provider’s secp256k1 pubkey coordinates.

The verifier:

1. Checks the **rail** and **circuit version** via `/zkpf/verify-bundle`.
2. Checks that the decoded public inputs match the stored policy:
   - `threshold_raw`, `required_currency_code`, `required_custodian_id`,
     `verifier_scope_id`, `policy_id`.
3. Relies on the circuit and backend to have enforced:
   - ECDSA signature validity for the provider key over the 32-byte `message_hash`.
   - `balance_raw ≥ threshold_raw` inside the circuit (balance itself is never revealed).
   - Time window `issued_at ≤ current_epoch ≤ valid_until`.
   - Consistency between `custodian_pubkey_hash` and the allow-listed provider key.
   - Nullifier replay protection for `(scope, policy, nullifier)` via the sled-backed
     `NullifierStore`.

Critically, verifiers **never** see:

- Viewing keys or raw wallet addresses.
- The underlying attestation body (including exact `balance_raw`).
- The `account_tag` itself—only the derived nullifier.

### URI-Encapsulated Payments (ZIP 324) – send ZEC via messaging

The workspace includes a **URI-Encapsulated Payments** implementation that enables sending Zcash
payments via any unmodified secure messaging service (Signal, WhatsApp, etc.). The sender need not
know the recipient's Zcash address, and the recipient need not have a wallet pre-installed.

**How it works:**

1. **Sender creates payment**: Alice's wallet generates an ephemeral Zcash address, sends funds to it,
   and constructs a URI containing the secret spending key.
2. **URI transmission**: Alice sends the URI via secure messaging to Bob.
3. **Recipient finalizes**: Bob clicks the link, his wallet verifies the funds on-chain, and he
   "finalizes" by transferring to his own address using the key from the URI.

**URI format:**

```
https://pay.withzcash.com:65536/v1#amount=1.23&desc=Coffee&key=zkey1...
```

- **Host**: `pay.withzcash.com` (mainnet) or `testpay.testzcash.com` (testnet)
- **Port**: `65536` (intentionally invalid TCP port to prevent accidental HTTP requests)
- **Fragment parameters**: `amount`, `desc` (optional description), `key` (Bech32m-encoded 256-bit key)

**Key components:**

| Crate/Module | Purpose |
| --- | --- |
| `zkpf-uri-payment` | Core Rust crate: ephemeral key derivation (ZIP 32), Bech32m encoding, URI parsing/generation, payment note construction. |
| `webzjs-wallet/bindgen/uri_payment.rs` | WASM bindings exposing `UriPayment`, `UriPaymentStatus`, and helper functions to JavaScript. |
| `web/src/components/uri-payment/` | React components for creating, receiving, and managing URI payments. |

**React components:**

| Component | Purpose |
| --- | --- |
| `URIPaymentPage` | Main interface with tabs for Send/Receive/History |
| `URIPaymentCreate` | Create payments with amount/description, generate shareable links |
| `URIPaymentReceive` | Verify incoming payments and finalize to user's wallet |
| `URIPaymentHistory` | View sent/received payment history (persisted in localStorage) |
| `URIPaymentStatus` | Real-time status tracking (pending → ready → finalized) |
| `URIPaymentDeepLink` | Handle incoming deep links from messaging apps |

**Key derivation (ZIP 32):**

Ephemeral keys are derived deterministically from the wallet seed, enabling recovery:

```
path: m_Sapling/324'/coin_type'/payment_index'
key = BLAKE2b-256(extended_spending_key, personal='Zcash_PaymentURI')
```

The wallet tracks used `payment_index` values (0..2^31) and never reuses them.

**Recovery from backup:**

When restoring a wallet, the implementation uses a "gap limit" of N=3:
- Derive the first N payment URI keys
- Scan the chain for spent nullifiers matching these keys
- When a match is found, derive the next key in sequence
- Stop when N consecutive keys have no on-chain activity

**Security considerations:**

- URIs are like "magic spells" — anyone who sees one can claim the funds
- The intentionally invalid port (65536) prevents browser HTTP requests
- Fragment parameters (`#...`) are never sent over the network per RFC 3986
- Keys use Bech32m encoding with `zkey1` (mainnet) or `zkeytest1` (testnet) HRP for error detection
- Payments should only be sent over end-to-end encrypted channels

**Frontend integration:**

Access via the wallet navigation: **📨 Via Message** → `/wallet/uri-payment`

**What's implemented:**

- ✅ Core Rust crate with ephemeral key derivation and URI parsing
- ✅ WASM bindings for JavaScript/TypeScript
- ✅ Complete React UI (create, receive, history, status tracking)
- ✅ Proper Bech32m encoding/decoding (BIP-350 compliant)
- ✅ Local storage persistence for payment history
- ✅ Deep link handling for `pay.withzcash.com` URLs
- ✅ Recovery hook for wallet restoration

**What's left:**

- 🔲 **Wire to actual wallet transactions**: Currently UI is scaffolded but not connected to real
  Sapling note creation. Need to integrate with `webzjs-wallet` to:
  - Generate actual Sapling transactions funding the ephemeral address
  - Spend notes using the ephemeral key during finalization
- 🔲 **Lightwalletd integration**: Add efficient note lookup by ephemeral IVK (trial decryption or
  indexed tags) instead of full chain scan
- 🔲 **Cancellation flow**: Implement sender-side "claw back" when recipient hasn't finalized
- 🔲 **Mobile deep linking**: Configure iOS/Android app links for `pay.withzcash.com` domain
- 🔲 **Testnet support**: Add `testpay.testzcash.com` handling and TAZ currency display
- 🔲 **QR code generation**: Add QR code display for in-person URI sharing
- 🔲 **Expiry notifications**: Alert sender when payment hasn't been finalized within N days

For the full specification, see [docs/uri-encapsulated-payments.md](docs/uri-encapsulated-payments.md).

### P2P Marketplace – peer-to-peer ZEC trading

The `web/` directory includes a **P2P Marketplace** for direct ZEC trading between users, accessible at `/p2p`. This enables trustless peer-to-peer trades with privacy-preserving proof-of-funds verification.

**Key features:**

| Feature | Description |
| --- | --- |
| **Offer creation** | Post buy/sell offers with custom amounts, prices, payment methods, and trading terms. |
| **Shareable offers** | Share offers via compact encoded URLs, QR codes, or text—recipients can view and trade without the offer existing in their local storage. |
| **Offer persistence** | Offers persist in `localStorage` across sessions and page reloads. |
| **Import offers** | Import shared offers via URL paste or by navigating to a share link. |
| **Payment links** | Generate URI-encapsulated payment links for instant ZEC transfers within trades. |
| **Trade flow** | Step-by-step trade management with chat, payment confirmation, and escrow release. |

**Offer sharing system:**

The marketplace implements a URL-based sharing system that encodes complete offer data into compact, portable links:

1. **Encoding**: Offers are serialized to JSON, compressed, and Base64url-encoded into the URL fragment (`?share=...`).
2. **Sharing options**:
   - **Link**: Copy a shareable URL to clipboard
   - **QR Code**: Generate a scannable QR code for in-person sharing
   - **Social**: Quick-share to X/Twitter, Telegram, WhatsApp, or email
   - **Text**: Copy formatted offer details as plain text
3. **Importing**: Recipients can:
   - Navigate directly to a share link (offer auto-imports)
   - Paste a share URL into the "Import Offer" modal
   - Scan a QR code (mobile)

**React components:**

| Component | Purpose |
| --- | --- |
| `P2PMarketplace` | Main marketplace with offer grid, filters, search, and import modal |
| `P2POfferCreate` | Multi-step offer creation flow |
| `P2POfferDetail` | Offer detail page with trade initiation and sharing |
| `ShareOffer` | Sharing modal with link/QR/text tabs and social buttons |
| `P2PPaymentLink` | Payment link generation for ZEC transfers within trades |

**State management:**

The `useP2PMarketplace` hook centralizes marketplace state with `localStorage` persistence:

```typescript
// Automatic persistence
const [offers, setOffers] = useState(() => getStoredJson('p2p_offers', []));
const [myProfile, setMyProfile] = useState(() => getStoredJson('p2p_my_profile', null));
const [myTrades, setMyTrades] = useState(() => getStoredJson('p2p_my_trades', []));
```

**URL format:**

```
https://your-domain.com/p2p/offer/{offerId}?share={encodedOffer}
```

Where `encodedOffer` is a Base64url-encoded JSON object containing the full offer data (type, amounts, maker info, payment methods, terms, timestamps).

**What's implemented:**

- ✅ Offer creation, editing, and cancellation
- ✅ Local storage persistence for offers, trades, and profiles
- ✅ Shareable offer URLs with encoded data
- ✅ QR code generation for offer sharing
- ✅ Social media share buttons (X, Telegram, WhatsApp, Email)
- ✅ Import offer modal and auto-import from URL
- ✅ Trade initiation and status tracking
- ✅ Payment link integration via URI-Encapsulated Payments
- ✅ Responsive design with modern UI

**What's left:**

- 🔲 **Real-time sync**: WebSocket/WebRTC for live offer broadcasting between peers
- 🔲 **Escrow contracts**: On-chain escrow for trustless settlement
- 🔲 **Reputation system**: On-chain trade history and ratings
- 🔲 **Dispute resolution**: Arbitration flow for contested trades
- 🔲 **PoF integration**: Require proof-of-funds before accepting large trades

Access via the wallet navigation: **🏪 P2P Marketplace** → `/p2p`

### Project TODO / roadmap (high level)

Across the whole workspace, the remaining work can be grouped into a few major themes:

- **1. Orchard rail completion**
  - Implement the Orchard Halo2 circuit, generate artifacts, and wire `prove_orchard_pof` to produce real `ProofBundle`s for `RAIL_ID_ZCASH_ORCHARD`.
  - Harden error handling around wallet connectivity (lightwalletd failures, DB corruption, unknown anchors) and document operational runbooks for the Orchard rail.

- **2. Starknet L2 rail completion**
  - Generate Halo2/bn256 circuit artifacts for the Starknet rail (`V3_STARKNET` layout).
  - Deploy Cairo contracts (`AttestationRegistry.cairo`, `ZkpfVerifier.cairo`) to Starknet mainnet/sepolia.
  - Integrate real Starknet RPC calls for balance and DeFi position fetching.
  - Implement Cairo-native PoF circuit for native STARK verification (optional).
  - Add end-to-end tests covering account abstraction (session keys, batched signatures).

- **3. Multi-rail verifier and manifest**
  - Continue evolving the multi-rail manifest and registry to cover additional rails (`ZCASH_ORCHARD`, `STARKNET_L2`, future EVM/on-chain rails) with clear separation between verifier-only and prover-capable artifacts.
  - Enforce strict `rail_id` and `circuit_version` matching to avoid cross-rail verification mistakes.

- **4. Public-input evolution and circuit versioning**
  - Finalize Orchard (V2_ORCHARD), Starknet (V3_STARKNET), and future rail layouts on top of `PublicInputLayout` while keeping the existing custodial circuit on V1.
  - Add helpers in `zkpf-common` and dedicated circuit crates to build and validate per-rail `VerifierPublicInputs` structs, and keep the backend + wasm bindings in sync.

- **5. On-chain wallet PoF rail(s)**
  - Turn the `docs/onchain-proof-of-funds.md` design and `contracts/` into a working rail:
    - Implement a circuit that proves inclusion of wallet balances under on-chain Merkle snapshots.
    - Define a `rail_id` and manifest entry for the on-chain rail.
    - Add a dedicated rail HTTP service and UI configuration similar to the Orchard rail.

- **6. Axelar GMP rail completion**
  - Deploy `AttestationBridge.sol` and `PoFReceiver.sol` to mainnet EVM chains.
  - Deploy `pof_receiver.rs` CosmWasm contracts to Osmosis, Neutron, and other Cosmos chains.
  - Wire automatic GMP broadcasts when attestations are recorded in `AttestationRegistry`.
  - Implement gas estimation and payment flows via Axelar Gas Service.
  - Add pull-based query support via GMP callbacks.
  - Build example DeFi integrations: interchain credit lines, undercollateralized lending.

- **7. Mina recursive proof hub completion**
  - Deploy Mina zkApp contracts (`ZkpfVerifier`, `AttestationRegistry`, `ZkBridge`) to Berkeley testnet and mainnet.
  - Implement EVM light client bridge for Mina state verification (`MinaLightClient.sol`).
  - Build relayer infrastructure for propagating attestations from Mina to target chains.
  - Create Mina light client SDK for institutional self-verification (~22KB state).
  - Solve Kimchi→BN254 recursion for trustless EVM verification.
  - Deploy Starknet bridge for Mina attestation reception.

- **8. Cross-L2 proofs**
  - Enable aggregating proofs across multiple L2s (Starknet, zkSync, Scroll, etc.).
  - Design a unified "L2 aggregation" circuit that can verify sub-proofs from different chains.
  - Coordinate nullifier and epoch semantics across chains.
  - Leverage Axelar GMP for broadcasting aggregated proofs to all connected chains.

- **9. UX, tooling, and docs**
  - Extend the web dashboard's rail awareness (per-rail filters, status/health panels, richer bundle inspection).
  - Add operational docs for:
    - Running the backend + rails in production (env vars, ports, manifests, nullifier DB).
    - Provisioning Zcash wallets and syncing for the Orchard rail.
    - Deploying and operating Starknet contracts.
    - Rotating artifacts and policies safely.
  - Tighten CI around:
    - Multi-rail regression tests.
    - End-to-end flows (custodial, Orchard, Starknet) using `zkpf-test-fixtures`-like harnesses.

- **10. URI-Encapsulated Payments (ZIP 324) completion**
  - Wire the React UI to actual Sapling transaction creation via `webzjs-wallet`.
  - Implement finalization flow: spend ephemeral notes to user's persistent address.
  - Add efficient note lookup via lightwalletd (indexed tags or IVK-based trial decryption).
  - Implement sender-side cancellation ("claw back" before recipient finalizes).
  - Configure iOS/Android deep linking for `pay.withzcash.com` domain.
  - Add testnet support with `testpay.testzcash.com` handling.
  - Generate QR codes for in-person URI sharing.
  - Add expiry notifications when payments remain unfinalized.

- **11. P2P Marketplace completion**
  - Implement real-time offer sync via WebSocket/WebRTC for live peer-to-peer broadcasting.
  - Deploy escrow smart contracts for trustless ZEC settlement.
  - Build on-chain reputation system with trade history and ratings.
  - Implement dispute resolution and arbitration flow.
  - Integrate proof-of-funds verification for high-value trade gating.
  - Add mobile-optimized QR scanning for in-person offer sharing.
  - Implement offer expiration and automatic cleanup.

This README will be updated as the Orchard rail, Starknet rail, Axelar GMP rail, Mina recursive proof hub, URI-Encapsulated Payments, P2P Marketplace, multi-rail verifier, and future rails progress from scaffold to production-ready status.

