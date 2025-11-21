## On-chain zk proof-of-funds design

This document specifies how to extend the zkpf stack so a crypto holder can:

- Prove (in zero-knowledge) that their wallets hold at least a threshold at a given on-chain snapshot.
- Present that proof as a bundle to a bank / exchange / lender.
- Have the receiver verify it through the existing zkpf verifier service + web console.

The design deliberately keeps the existing circuit (v3) and artifacts stable. A future circuit version can implement the Merkle logic described here while reusing the same high-level APIs.

---

### Roles

- **Holder**: controls one or more on-chain wallets.
- **WalletCommitmentRegistry** (EVM): stores commitments that bind a pseudonymous `holderId` to a set of wallets, without ever revealing the raw addresses.
- **BalanceSnapshotPublisher** (EVM): posts Merkle roots of `(address, balance)` snapshots for given chains/assets.
- **ZK prover service** (off-chain, Rust): fetches Merkle paths from the two contracts, assembles the witness, and runs the zk circuit to produce a `ProofBundle`.
- **ZK verifier service + web UI** (existing crates): verifies `ProofBundle` and exposes a rich UX.
- **AttestationRegistry** (EVM): optional on-chain registry where verifiers/banks record compact attestations after successful verification.

---

### On-chain contracts

The `zkpf/contracts/` directory contains three composable pieces:

- `WalletCommitmentRegistry.sol`
  - Interface + implementation for registering wallet commitments against a `holderId`.
  - Off-chain, the holder chooses a secret `s` and for each wallet computes `C = H(s, walletAddress, holderId, ...)`.
  - On-chain, only `C` and `holderId` are stored; the raw address never appears.
  - Events + getters allow off-chain indexers to build a Merkle tree of commitments per `holderId`.

- `BalanceSnapshotPublisher.sol`
  - Interface + implementation for publishing snapshot roots.
  - An off-chain indexer computes a Merkle tree over `(address, balance)` at block `B` and calls `publishSnapshot(chainId, assetId, snapshotId, root, blockNumber)`.
  - The registry stores and exposes `root`, `blockNumber`, and `timestamp`.

- `AttestationRegistry.sol`
  - Interface + implementation for recording that a verifier/bank has accepted a proof bundle.
  - After off-chain verification, the verifier calls:
    - `attest(holderId, policyId, snapshotId, nullifier)`.
  - Other parties can later query `hasAttestation(holderId, policyId, snapshotId)` or fetch the full `Attestation`.

All three contracts are intentionally minimal and leave access control (e.g. `onlyRole`) to deployment-time configuration.

---

### Circuit/public input sketch for an on-chain variant

The current circuit (v3) verifies a custodial attestation. An on-chain wallet-aggregation circuit would add, at minimum:

- **Additional public inputs** (conceptual – not yet wired into v3):
  - `holder_id: [u8; 32]` (or `u64` if bank assigns numeric IDs).
  - `snapshot_id: [u8; 32]` – matches `BalanceSnapshotPublisher`’s snapshotId.
  - `chain_id: u64`, `asset_id: [u8; 32]`.
  - `balances_root: Fr` – Poseidon or KZG-encoded root derived from the snapshot Merkle tree.
  - `commitments_root: Fr` – root of the holder’s commitments tree.

- **Private witness (high level)**:
  - For a subset of the holder’s wallets:
    - `address_i`, `balance_i`.
    - Merkle path into `balances_root` for `(address_i, balance_i)`.
    - Merkle path into `commitments_root` for the commitment `C_i = H(s, address_i, holder_id, ...)`.
  - Secret `s` used to derive commitments.

- **Constraints (conceptual)**:
  - Verify each `(address_i, balance_i)` is in the balances tree.
  - Verify each `C_i` is in the commitments tree and correctly recomputed from `(s, address_i, holder_id)`.
  - Sum balances across selected wallets and enforce `sum >= threshold_raw`.
  - Optionally convert balances into a target currency using price feed data provided via public inputs.
  - Reuse the existing nullifier / epoch / policy logic for anti-replay and scoping.

Once implemented as a new circuit version, the `zkpf-common` layer would expose a sibling to `VerifierPublicInputs` describing the on-chain metadata, and the web API would expose that alongside the existing fields. Until then, this document serves as the spec for that next iteration.

---

### End-to-end user flow (holder → bank) using these pieces

1. **Enrollment (one-time)**
   - Holder (or custodian on their behalf) derives a secret `s` off-chain.
   - For each wallet they want included in future proofs, they compute commitments and call `WalletCommitmentRegistry.registerCommitment(holderId, commitment)`.
   - Indexers observe events and maintain a Merkle tree of commitments per `holderId`.

2. **Snapshot**
   - An indexer computes `(address, balance)` at a chosen block `B` for the asset/chain in question.
   - It constructs a Merkle tree, then calls `BalanceSnapshotPublisher.publishSnapshot(...)` with the root and metadata.
   - Everyone now agrees on a canonical `snapshotId` and `root`.

3. **Proof generation**
   - Holder requests a zk proof-of-funds for a particular:
     - `holderId`, `policyId`, `snapshotId`, `threshold_raw`, and asset rail (on-chain).
   - A prover service:
     - Fetches balances + Merkle paths from indexers.
     - Fetches commitments + Merkle paths from the wallet registry.
     - Constructs the full witness and runs the on-chain variant of the circuit.
   - The service returns a standard `ProofBundle` JSON (aligned with the existing frontend API shape), plus auxiliary metadata where necessary.

4. **Verification via the existing service/UI**
   - The bank or receiver uploads the bundle into the zkpf web console (already implemented).
   - They pick the appropriate **policy** and ensure **Asset rail = On-chain proof**.
   - The backend verifier runs the circuit and returns `VerifyResponse { valid, error, error_code, circuit_version }`.
   - The UI displays a success/failure banner and surfaces the on-chain rail context in the bundle summary.

5. **Optional: on-chain attestation**
   - If the bank wants a reusable on-chain record:
     - After `valid == true`, the verifier service calls:
       - `AttestationRegistry.attest(holderId, policyId, snapshotId, nullifier)`.
   - Future counterparties can:
     - Query `hasAttestation(...)` as a quick indication that a proof was checked under a given policy and snapshot.
     - Or demand a fresh proof using a newer snapshot if they require up-to-date balances.

---

### Implementation notes and TODOs

- The Solidity contracts in `zkpf/contracts/` are intended as a **starting point**:
  - Add role-based access control (e.g. OpenZeppelin `AccessControl`) before production.
  - Decide on concrete encodings for `holderId`, `assetId`, and `snapshotId` (e.g. hashes of structured data).
- Circuit work:
  - The on-chain variant requires a new circuit (and `CIRCUIT_VERSION`) to actually enforce Merkle proofs and balance aggregation.
  - That circuit can live alongside the existing custodial attestation circuit, sharing much of the nullifier and policy logic.
- Backend integration:
  - A Rust helper crate (or module in `zkpf-tools`) can encapsulate:
    - Reading contract state/events via an Ethereum client.
    - Building Merkle trees for commitments and snapshots.
    - Generating the circuit input JSON that the prover CLI already consumes.

This document is the canonical spec for the “on-chain rail” and how it plugs into the zkpf stack. Future iterations can evolve the circuit and backend while keeping the contracts and overall flow stable.


