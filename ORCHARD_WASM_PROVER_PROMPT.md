# Task: Implement WASM Prover Support for Zcash Orchard Proofs

## Problem Statement

The current WASM prover (`zkpf-wasm`) only supports **custodial proofs** using the V1 circuit layout. This means that when users with Zcash Orchard wallets try to generate proofs, they are forced to use the custodial rail even though their wallets are non-custodial. The frontend correctly identifies Zcash Orchard policies, but the proof generation falls back to custodial because the WASM prover cannot generate Orchard proofs.

## Current State

### Existing Custodial Prover (V1 Layout)
- **Location**: `zkpf/zkpf-wasm/src/lib.rs`
- **Function**: `generate_proof_bundle_cached` (exposed as `generateProofBundleCached` in WASM)
- **Input**: JSON string with `CircuitInput` containing attestation + public inputs
- **Output**: `ProofBundle` with V1 layout (8 public inputs, no Orchard fields)
- **Circuit Version**: Uses `CIRCUIT_VERSION` from `zkpf-common`

### Existing Orchard Prover (Not WASM-Enabled)
- **Location**: `zkpf/zkpf-zcash-orchard-circuit/src/lib.rs`
- **Function**: `prove_orchard_pof_wasm` (already exists but not integrated into WASM build)
- **Input**: 
  - `OrchardSnapshot` (height, anchor, notes with merkle paths)
  - `OrchardFvk` (full viewing key)
  - `HolderId` (string identifier)
  - `threshold_zats` (u64)
  - `OrchardPublicMeta` (chain_id, pool_id, block_height, anchor_orchard, holder_binding)
  - `PublicMetaInputs` (policy_id, verifier_scope_id, current_epoch, required_currency_code)
  - `OrchardWasmArtifacts` (params_bytes, vk_bytes, pk_bytes)
- **Output**: `ProofBundle` with V2_ORCHARD layout (10 public inputs including Orchard fields)
- **Circuit Version**: Uses `CIRCUIT_VERSION` from `zkpf-common`

## Requirements

### 1. WASM Interface

Add a new WASM-exported function to `zkpf-wasm` that can generate Orchard proofs:

```rust
#[wasm_bindgen]
pub fn generate_orchard_proof_bundle(
    snapshot_json: &str,      // JSON serialized OrchardSnapshot
    fvk_encoded: &str,         // Orchard full viewing key as string
    holder_id: &str,           // Holder identifier
    threshold_zats: u64,       // Minimum balance threshold
    orchard_meta_json: &str,   // JSON serialized OrchardPublicMeta
    public_meta_json: &str,    // JSON serialized PublicMetaInputs
    artifacts: &OrchardWasmArtifacts, // In-memory artifacts
) -> Result<JsValue, JsValue>
```

### 2. Artifact Management

The Orchard prover requires separate artifacts (params, vk, pk) from the custodial prover. You need to:

1. Add artifact initialization functions similar to `initProverArtifacts` but for Orchard:
   ```rust
   #[wasm_bindgen]
   pub fn init_orchard_prover_artifacts(
       params_bytes: &[u8],
       vk_bytes: &[u8], 
       pk_bytes: &[u8]
   ) -> Result<(), JsValue>
   ```

2. Cache artifacts in memory (similar to how custodial artifacts are cached)

3. Add a function to check if Orchard artifacts are loaded:
   ```rust
   #[wasm_bindgen]
   pub fn has_orchard_artifacts() -> bool
   ```

### 3. Frontend Integration

Update `zkpf/web/src/wasm/prover.ts` to:

1. Add `prepareOrchardProverArtifacts()` function that:
   - Fetches Orchard artifacts from backend (similar to `/zkpf/params` but for Orchard)
   - Calls `init_orchard_prover_artifacts` with the artifact bytes
   - Caches the artifact key

2. Add `generateOrchardBundle()` function that:
   - Takes an `OrchardProofInput` TypeScript interface
   - Serializes inputs to JSON
   - Calls the WASM `generate_orchard_proof_bundle` function
   - Parses and returns a `ProofBundle`

3. Update `ProofBuilder.tsx` to:
   - Detect when policy has `rail_id: 'ZCASH_ORCHARD'`
   - Check if wallet has Orchard snapshot data available
   - If yes, use `generateOrchardBundle()` instead of `generateBundle()`
   - If no, show appropriate error/warning

### 4. TypeScript Types

Add to `zkpf/web/src/types/zkpf.ts`:

```typescript
export interface OrchardProofInput {
  snapshot: {
    height: number;
    anchor: ByteArray; // [u8; 32]
    notes: Array<{
      value_zats: number;
      commitment: ByteArray; // [u8; 32]
      merkle_path: {
        siblings: ByteArray[]; // Array of [u8; 32]
        position: number;
      };
    }>;
  };
  fvk_encoded: string; // Orchard full viewing key
  holder_id: string;
  threshold_zats: number;
  orchard_meta: {
    chain_id: string;
    pool_id: string;
    block_height: number;
    anchor_orchard: ByteArray; // [u8; 32]
    holder_binding: ByteArray; // [u8; 32] - computed from holder_id + fvk
  };
  public_meta: {
    policy_id: number;
    verifier_scope_id: number;
    current_epoch: number;
    required_currency_code: number;
  };
}
```

### 5. Backend API Endpoint

The backend should expose Orchard artifacts similar to custodial artifacts:

- **Endpoint**: `/zkpf/orchard-params` (or similar)
- **Response**: Similar to `/zkpf/params` but returns Orchard-specific artifacts
- **Artifacts**: Should be loaded from Orchard circuit build artifacts

## Implementation Steps

### Step 1: WASM Bindings
1. In `zkpf/zkpf-wasm/src/lib.rs`:
   - Import `prove_orchard_pof_wasm` from `zkpf-zcash-orchard-circuit`
   - Add `OrchardWasmArtifacts` struct with `#[wasm_bindgen]`
   - Implement artifact caching (similar to custodial artifacts)
   - Export `generate_orchard_proof_bundle` function
   - Handle serialization/deserialization of JSON inputs

### Step 2: Error Handling
- Map Rust `OrchardRailError` to JavaScript-friendly error messages
- Validate inputs before calling the prover
- Provide helpful error messages for common issues (missing artifacts, invalid snapshot, etc.)

### Step 3: Frontend Integration
1. Update `zkpf/web/src/wasm/prover.ts`:
   - Add `prepareOrchardProverArtifacts(artifacts: OrchardProverArtifacts)`
   - Add `generateOrchardBundle(input: OrchardProofInput): Promise<ProofBundle>`
   - Handle artifact caching and initialization

2. Update `zkpf/web/src/components/ProofBuilder.tsx`:
   - Detect ZCASH_ORCHARD policy
   - Check for Orchard snapshot availability (from wallet state)
   - Route to appropriate prover (Orchard vs custodial)
   - Handle errors gracefully

### Step 4: Testing
1. Unit tests for WASM bindings
2. Integration tests with sample Orchard snapshots
3. Frontend tests for proof generation flow
4. Verify generated proofs can be verified by backend

## Key Considerations

1. **Artifact Size**: Orchard artifacts may be large. Consider:
   - Lazy loading
   - Compression
   - CDN hosting
   - Progress indicators during download

2. **Performance**: Orchard proof generation may be slower than custodial:
   - Consider Web Worker for proof generation
   - Show progress indicators
   - Allow cancellation

3. **Compatibility**: 
   - Ensure generated proofs work with existing backend verifier
   - Maintain backward compatibility with custodial proofs
   - Handle circuit version differences correctly

4. **Security**:
   - Never log or expose FVK (full viewing key)
   - Validate all inputs before processing
   - Sanitize error messages to avoid leaking sensitive data

## Success Criteria

✅ WASM prover can generate Orchard proofs with V2_ORCHARD layout  
✅ Frontend can detect ZCASH_ORCHARD policies and route to Orchard prover  
✅ Generated proofs include `snapshot_block_height` and `snapshot_anchor_orchard`  
✅ Proofs verify successfully on backend with `rail_id: "ZCASH_ORCHARD"`  
✅ Error handling is user-friendly and informative  
✅ Artifact loading is efficient and cached properly  

## References

- **Orchard Prover**: `zkpf/zkpf-zcash-orchard-circuit/src/lib.rs::prove_orchard_pof_wasm`
- **Custodial Prover**: `zkpf/zkpf-wasm/src/lib.rs::generate_proof_bundle_cached`
- **Frontend Prover**: `zkpf/web/src/wasm/prover.ts`
- **Proof Builder**: `zkpf/web/src/components/ProofBuilder.tsx`
- **Types**: `zkpf/web/src/types/zkpf.ts`

## Notes

- The Orchard prover already exists in Rust (`prove_orchard_pof_wasm`), so this is primarily about:
  1. Exposing it via WASM bindings
  2. Integrating it into the frontend proof generation flow
  3. Handling artifact management
  4. Updating the UI to use it when appropriate

- The wallet already provides Orchard snapshot data via `useWebZjsContext`, so the snapshot building logic may already be available in the frontend.

