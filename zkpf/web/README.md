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

## Proof workflow

1. Generate a proof bundle from your custody system or via `cargo test -p zkpf-test-fixtures`.
2. Paste the JSON into the “Proof console” text area or upload the file.
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
