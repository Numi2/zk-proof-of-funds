# zkpf web console

A lightweight React + Vite front-end for the zk-proof-of-funds stack. It focuses on three workflows:

1. Inspect the verifier manifest (params/VK/PK hashes and artifacts).
2. Monitor the verifier’s epoch drift guardrail.
3. Upload, validate, and submit proof bundles to `/zkpf/verify` or `/zkpf/verify-bundle`.

## Getting started

```bash
cd web
npm install
npm run dev
```

The UI auto-detects its backend target in this order:

1. `VITE_ZKPF_API_URL` env variable (set in `.env.local`, Vercel env settings, etc.)
2. Window origin (useful when the verifier lives behind the same domain + reverse proxy)
3. Fallback `http://localhost:3000`

Override the target by defining the env variable—there’s no longer a runtime toggle in the UI:

```bash
# .env.local (not committed)
VITE_ZKPF_API_URL=https://your-verifier.company.com
VITE_ZKPF_SNAP_ORIGIN=local:http://localhost:8080
```

Available scripts:

| Command         | Purpose                              |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start Vite in dev mode with HMR      |
| `npm run build` | Type-check + produce production dist |
| `npm run lint`  | ESLint across the `src/` tree        |
| `npm run preview` | Serve the production build locally |

## Deploying to Vercel

The repository root includes a `vercel.json` that tells Vercel how to build the `web/` app from a monorepo:

- `installCommand`: `cd web && npm install`
- `buildCommand`: `cd web && npm run build`
- `outputDirectory`: `web/dist`
- `/zkpf/*` rewrites that point to lightweight mock API routes under `api/zkpf`
- SPA fallback rewrite to `index.html` so client-side routing works.

### One-time setup

1. Install the Vercel CLI (`npm i -g vercel`) or connect the GitHub repo in the Vercel dashboard.
2. When prompted for the project folder, choose the repo root (the config already points at `web/`).
3. Define the backend URL that the UI should call:
   - Dashboard: Settings → Environment Variables → add `VITE_ZKPF_API_URL`.
   - CLI: `vercel env add VITE_ZKPF_API_URL production` (repeat for preview if needed).

### Deploy

```bash
# from the repo root
vercel --prod
# or let the dashboard trigger builds on push
```

Vercel will run `npm run build` inside `web/`, publish `web/dist/`, and serve `/sample-bundle.json` plus other static assets automatically.

### Built-in mock verifier

If you don’t have the Rust backend running, the Vercel deployment still works out-of-the-box thanks to serverless routes located in `api/zkpf`. They expose `/zkpf/params`, `/zkpf/epoch`, `/zkpf/policies`, `/zkpf/verify`, and `/zkpf/verify-bundle` with deterministic mock data that mirrors the test fixtures. Point `VITE_ZKPF_API_URL` at your real verifier when you’re ready for production traffic; otherwise the UI will happily talk to the embedded mock.

## Zcash WebWallet + MetaMask Snap integration

The console can derive Zcash balances and snapshot heights directly from a lightwalletd-backed Zcash WebWallet, instead of requiring manual UFVK and balance entry:

- **Prerequisites**
  - MetaMask with Snaps support (Flask or a Snaps-enabled build).
  - The zkpf Zcash Snap running at `VITE_ZKPF_SNAP_ORIGIN` (defaults to `local:http://localhost:8080`).
  - A reachable lightwalletd-compatible endpoint (the app uses `https://zcash-mainnet.chainsafe.dev` by default).

- **Flow**
  - In the Zcash wallet attestation card, click **“Connect via MetaMask Snap”**.
  - MetaMask will prompt you to install/authorize the zkpf Snap and derive a view key.
  - The WebWallet will:
    - Import the UFVK and birthday height returned by the Snap.
    - Sync with lightwalletd in a WebWorker.
    - Expose per-account balances and heights via the WebWallet API.
  - The UI then:
    - Auto-populates shielded balance (Sapling + Orchard) and snapshot height (fully scanned height) for the active account.
    - Lets you click **“Rescan Zcash balance”** to sync again and refresh balances before building an attestation.

- **Attestation compatibility**
  - The attestation JSON and `CircuitInput` shape are unchanged.
  - `account_id_hash` is still computed as `BLAKE3("zcash:<network>:<UFVK>")`.
  - Existing policies for the Zcash Orchard rail (e.g. `rail_id: "ZCASH_ORCHARD"`) continue to apply unchanged; the WebWallet flow only changes how balances and heights are sourced.

## Creating a Zcash wallet in the browser

The Zcash connector lets users create a wallet directly from the website:

- **Recommended: MetaMask Snap-backed wallet**
  - Click **“Create via MetaMask Snap”** in the Zcash wallet card.
  - MetaMask installs/authorizes the zkpf Snap, derives a UFVK and birthday, and the WebWallet imports them as a mainnet account.
  - Balances and snapshot heights for that account are then synced from lightwalletd and used when building attestations.
  - Private keys stay inside MetaMask/Snap; the zkpf app only sees viewing keys and balance data.

- **Advanced: manual seed phrase**
  - Under the “Advanced: create wallet from seed phrase” section, you can paste a 24-word seed and optional birthday height.
  - This is intended for demos/testing only. The seed phrase is handled in-browser and the resulting wallet DB can be persisted to IndexedDB.
  - Once created and synced, this account’s shielded balance and snapshot height are treated exactly like Snap-backed wallets for proofs-of-funds.

In both flows, the proof format and policy semantics are unchanged; the wallet creation methods only affect how Zcash balances and heights are sourced before building a Zcash attestation.

## Proof workflow

1. Generate a proof bundle from your custody system or via `cargo test -p zkpf-test-fixtures`.
2. Paste the JSON into the “Verify console” text area or upload the file.
3. Choose the endpoint:
   - `/zkpf/verify-bundle` accepts the JSON structure directly.
   - `/zkpf/verify` re-encodes the public inputs and sends the proof bytes separately.
4. Review the parsed public inputs, nullifier, and custodian hash in the summary panel.
5. Click “Send to verifier” to call the backend and persist the response banner as an audit artifact.

The parser accepts byte arrays in native JSON (e.g. `[12,34,…]`), hex (`0x…`), or base64. Invalid payloads never leave the browser.

## Future ideas

- Wire up the `zkpf-wasm` bindings for entirely local verification.
- Add attestation builders for custodians to craft witnesses interactively.
- Stream log entries (WebSocket/SSE) from the backend to expose auditing data in real time.
