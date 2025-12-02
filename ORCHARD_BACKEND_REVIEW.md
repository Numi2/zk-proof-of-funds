# Step 1: Backend Implementation Review

## Current Structure

### Artifact Management

1. **Custodial Artifacts (Default)**
   - Loaded via `load_artifacts()` → `ProverArtifacts`
   - Stored in `static ARTIFACTS: Lazy<Arc<ProverArtifacts>>`
   - Served via `/zkpf/artifacts/:kind` endpoint (params, vk, pk)
   - Managed in `AppState` via `state.artifacts()`

2. **Orchard Artifacts**
   - Loaded via `load_orchard_verifier_artifacts()` → `VerifierArtifacts`
   - Stored in `RailRegistry` per-rail (when `ZKPF_MULTI_RAIL_MANIFEST_PATH` is set)
   - **NOT currently served via API endpoints**
   - Only used for verification, not for client-side proving

### Current Endpoints

- `GET /zkpf/artifacts/:kind` - Serves custodial artifacts only (params, vk, pk)
- `GET /zkpf/params` - Returns custodial artifact metadata and URLs

### Rail Registry Structure

```rust
struct RailRegistry {
    rails: Arc<HashMap<String, RailVerifier>>,
}

struct RailVerifier {
    circuit_version: u32,
    layout: PublicInputLayout,
    artifacts: RailArtifacts,  // Prover or Verifier artifacts
}

enum RailArtifacts {
    Prover(Arc<ProverArtifacts>),
    Verifier(Arc<VerifierArtifacts>),
}
```

The `RailRegistry`:
- Loads Orchard artifacts when `ZKPF_MULTI_RAIL_MANIFEST_PATH` is configured
- Stores them as `RailArtifacts::Verifier(Arc<VerifierArtifacts>)`
- Uses them for verification in `process_verification()`

### Key Findings

1. **Missing Orchard Artifact Endpoints**
   - No `/zkpf/orchard-params` or `/zkpf/artifacts/orchard-*` endpoints
   - Frontend `prepareOrchardProverArtifacts()` needs these to download artifacts

2. **Artifact Storage**
   - Orchard artifacts are loaded into `RailRegistry` but not accessible via API
   - `VerifierArtifacts` contains `params_bytes`, `vk_bytes` but no `pk_bytes` (verifier-only)
   - For WASM proving, we need `pk_bytes` (proving key)

3. **Artifact Loading**
   - `load_orchard_verifier_artifacts()` loads verifier artifacts (no PK)
   - `load_orchard_prover_artifacts()` exists in `zkpf-zcash-orchard-circuit` but is not used by backend
   - Need to load prover artifacts for WASM client-side proving

## Required Changes

### 1. Add Orchard Artifact Endpoints

Need to add endpoints similar to custodial artifacts:
- `GET /zkpf/artifacts/orchard-params` - Orchard circuit parameters
- `GET /zkpf/artifacts/orchard-vk` - Orchard verifying key
- `GET /zkpf/artifacts/orchard-pk` - Orchard proving key (for WASM)

### 2. Load Orchard Prover Artifacts

Currently backend only loads verifier artifacts. For WASM proving, need:
- Load `ProverArtifacts` (includes PK) for Orchard rail
- Store in `RailRegistry` or separate storage
- Make accessible via API endpoints

### 3. Update Artifact Serving Logic

The `get_artifact()` function needs to:
- Detect `orchard-*` artifact kinds
- Route to Orchard artifact storage instead of default custodial artifacts
- Return appropriate artifact bytes

### 4. Update `/zkpf/params` Response

May need to add Orchard artifact URLs to `ParamsResponse`:
```rust
struct ParamsResponse {
    // ... existing fields ...
    #[serde(skip_serializing_if = "Option::is_none")]
    orchard_artifact_urls: Option<ArtifactUrls>,
}
```

## Implementation Plan

1. **Add Orchard Prover Artifacts to Backend State**
   - Load Orchard prover artifacts (with PK) in addition to verifier artifacts
   - Store in `AppState` or extend `RailRegistry`

2. **Add Orchard Artifact Endpoints**
   - Extend `get_artifact()` to handle `orchard-params`, `orchard-vk`, `orchard-pk`
   - Or create separate handler `get_orchard_artifact()`

3. **Update Frontend Integration**
   - Frontend already has `prepareOrchardProverArtifacts()` that expects these endpoints
   - Just need to ensure endpoints match expected paths

## Code Locations

- **Backend artifact loading**: `zkpf/zkpf-backend/src/lib.rs`
- **Artifact serving**: `get_artifact()` function (line ~551)
- **Rail registry**: `RailRegistry::from_env()` (line ~152)
- **Orchard artifact loading**: `zkpf/zkpf-zcash-orchard-circuit/src/lib.rs::load_orchard_verifier_artifacts()`

## Next Steps

1. Add Orchard prover artifacts loading to backend
2. Extend `get_artifact()` to serve Orchard artifacts
3. Test artifact endpoints with frontend
4. Verify WASM prover can download and use artifacts

