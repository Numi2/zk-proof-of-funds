# CI Artifact Pipeline

`cargo xtask ci-artifacts` bundles the full trusted-setup → proving → backend verification flow into one repeatable step for CI.

## Usage

```bash
cargo xtask ci-artifacts --release \
  --output-dir artifacts/ci \
  --k 19
```

- `--release` speeds up the heavy `gen-params`/`zkpf-prover` invocations.
- `--output-dir` (default `artifacts/ci`) controls where fixtures are written.
- `--k` defaults to `19`, but smaller values are helpful for local smoke tests.
- `--skip-backend` skips the Axum verifier if you only care about the artifacts.
- `--backend-port` (default `3000`) changes the temporary Axum listener port.

## What it produces

Inside the chosen `output_dir` you will find:

- `manifest.json` plus `manifest.provenance.json` (captures `params/vk/pk` hashes, `k`, timestamps) and the raw CLI dump `params.metadata.json`.
- Deterministic fixtures for tests: `attestation.sample.json`, `proof.bin`, `public_inputs.{json,bin}`, and `proof_bundle.json`.
- Backend verification transcripts so CI can assert end-to-end behavior: `backend.params.json`, `backend.verify_bundle.json`, and `backend.verify.json`.

When the backend step is enabled, the tool sets `ZKPF_MANIFEST_PATH` automatically, boots `zkpf-backend`, and POSTs the generated bundle plus the split `(proof, public_inputs)` payload. Both endpoints must return `"valid": true`, otherwise the task fails.

These artifacts are intentionally small enough to live under `artifacts/ci` (which is `.gitignore`d) and can be copied or zipped as needed by downstream workflows.

