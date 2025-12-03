# "Try it now" Flow Map

This document maps the complete user flow from clicking the "Try it now" button through proof generation and verification.

## Entry Points

The "Try it now" button appears in two locations:

1. **Hero Section** (`ZKPFApp.tsx:332-334`)
   ```tsx
   <Link to="/build" className="hero-cta-button">
     Try it now →
   </Link>
   ```

2. **Quick Start Banner** (`ProofBuilder.tsx:992-998`)
   ```tsx
   <button onClick={handleQuickStart}>
     Try it now →
   </button>
   ```

## Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER CLICKS "Try it now"                                     │
│    Location: Hero section or Quick Start banner                 │
│    Action: Navigate to /build                                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. /build ROUTE LOADS                                           │
│    Component: ProofBuilder (lazy loaded)                       │
│    Route: ZKPFApp.tsx:469-487                                   │
│    Suspense fallback: "Loading prover..."                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PROOF BUILDER INITIALIZES                                    │
│    File: ProofBuilder.tsx                                       │
│    - Fetches verifier params (client.getParams())               │
│    - Fetches available policies (client.getPolicies())          │
│    - Checks connection state                                    │
│    - Initializes WASM prover artifacts (if needed)             │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌──────────────────┐          ┌──────────────────────┐
│ QUICK START PATH  │          │ STANDARD BUILD PATH  │
│ (handleQuickStart)│          │                      │
└────────┬─────────┘          └──────────┬───────────┘
         │                               │
         │                               │
         ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ QUICK START: Loads sample bundle                                │
│ - Fetches /sample-bundle-orchard.json                           │
│ - Creates synthetic policy matching sample                      │
│ - Calls onBundleReady(sampleBundle, syntheticPolicy)           │
│ - Navigates directly to /workbench                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ STANDARD BUILD: Step-by-step proof generation                   │
│                                                                 │
│ STEP 1: Select Verification Policy                             │
│   - User selects from dropdown                                  │
│   - Policy defines threshold, currency, scope                  │
│   - Custom policies can be auto-created from wallet              │
│                                                                 │
│ STEP 2: Connect Wallet / Data Source                           │
│   Options:                                                      │
│   a) Zcash Wallet Connector                                     │
│      - Connect via seed phrase or UFVK                         │
│      - Generates attestation from wallet balance                │
│      - Optional: Connect auth wallet for signing                │
│                                                                 │
│   b) Manual JSON Input                                          │
│      - Paste attestation JSON directly                          │
│      - Load sample attestation                                  │
│                                                                 │
│ STEP 3: Generate Proof Bundle                                  │
│   - User clicks "Generate proof bundle"                         │
│   - handleGenerate() → generateFromNormalizedJson()            │
│   - Determines rail type (Orchard vs Custodial)                │
│   - Loads appropriate artifacts:                                │
│     * Orchard: k=19, V2_ORCHARD layout (~750MB pk.bin)         │
│     * Custodial: k=14, V1 layout                               │
│   - Calls WASM prover:                                         │
│     * generateOrchardBundle() OR generateBundle()              │
│   - Progress states:                                            │
│     * preparing → generating → finalizing                       │
│   - Bundle created with:                                        │
│     * proof (zero-knowledge proof bytes)                        │
│     * public_inputs (policy, threshold, epoch, etc.)            │
│     * rail_id (ZCASH_ORCHARD, CUSTODIAL_ATTESTATION, etc.)     │
│     * circuit_version                                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ (Bundle ready)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. BUNDLE READY HANDLER                                         │
│    Function: handleBundleReady() in ZKPFApp.tsx:178-194        │
│    Actions:                                                     │
│    - Sets hasBuiltBundle = true                                 │
│    - Stores bundle JSON in prefillBundle state                  │
│    - Stores customPolicy (if any)                               │
│    - Checks for bound-identity return flag                      │
│    - Navigates to /workbench (or /bound-identity)              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. /workbench ROUTE LOADS                                       │
│    Component: ProofWorkbench (lazy loaded)                     │
│    Route: ZKPFApp.tsx:489-537                                   │
│    Props passed:                                                │
│    - prefillBundle: JSON string of bundle                       │
│    - prefillCustomPolicy: Policy definition                     │
│    - onVerificationOutcome: Callback for results               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. PROOF WORKBENCH INITIALIZES                                 │
│    File: ProofWorkbench.tsx                                     │
│    - Parses prefillBundle (if provided)                        │
│    - Auto-selects policy matching bundle                        │
│    - Creates synthetic policy if bundle policy not found       │
│    - Displays bundle summary                                    │
│    - Shows verification UI                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. USER VERIFIES PROOF                                          │
│    Action: User clicks "Verify proof bundle"                    │
│    Function: handleVerify() in ProofWorkbench.tsx:477-577       │
│    Process:                                                     │
│    - Validates bundle structure                                 │
│    - Extracts policy_id from bundle or selected policy         │
│    - Calls client.verifyBundle() or client.verifyProof()       │
│    - Backend endpoint: /zkpf/verify-bundle or /zkpf/verify     │
│    - Backend verifies:                                          │
│      * Proof validity (cryptographic verification)              │
│      * Policy compliance (threshold, currency, scope)          │
│      * Epoch validity                                           │
│      * Nullifier uniqueness                                     │
│    - Response: VerifyResponse { valid: boolean, ... }          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. VERIFICATION RESULT DISPLAYED                                │
│    Component: VerificationBanner                                 │
│    States:                                                      │
│    - ✓ Proof accepted (green banner)                            │
│    - ✗ Proof rejected (red banner with error)                   │
│    - Error state (network/parsing errors)                       │
│    - Updates ProgressChecklist "Verify proof" step              │
│    - Calls onVerificationOutcome('accepted'|'rejected'|'error')│
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. OPTIONAL: ON-CHAIN ATTESTATION                               │
│    If verification succeeds, user can:                          │
│    - Record proof on-chain via /zkpf/attest                     │
│    - Download bundle JSON                                       │
│    - Copy bundle to clipboard                                   │
│    - Share proof with counterparty                              │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components & Files

### Frontend Components

1. **ZKPFApp.tsx** (`zkpf/web/src/components/ZKPFApp.tsx`)
   - Main app router
   - Handles navigation between `/build` and `/workbench`
   - Manages bundle state and verification outcomes
   - Progress checklist tracking

2. **ProofBuilder.tsx** (`zkpf/web/src/components/ProofBuilder.tsx`)
   - Proof generation UI
   - Policy selection
   - Wallet connector integration
   - WASM prover initialization
   - Bundle generation logic

3. **ProofWorkbench.tsx** (`zkpf/web/src/components/ProofWorkbench.tsx`)
   - Verification UI
   - Bundle parsing and validation
   - Verification API calls
   - Result display

### Backend Endpoints

1. **GET /zkpf/params** - Fetch verifier parameters
2. **GET /zkpf/policies** - List available policies
3. **GET /zkpf/rails/:rail_id/params** - Fetch rail-specific params (e.g., Orchard)
4. **GET /zkpf/rails/:rail_id/artifacts/:kind** - Download artifacts (params, pk, vk, break_points)
5. **POST /zkpf/verify-bundle** - Verify proof bundle
6. **POST /zkpf/verify** - Verify raw proof
7. **POST /zkpf/attest** - Record proof on-chain

### WASM Prover Functions

1. **prepareProverArtifacts()** - Initialize custodial prover (k=14)
2. **prepareOrchardProverArtifacts()** - Initialize Orchard prover (k=19)
3. **generateBundle()** - Generate custodial proof
4. **generateOrchardBundle()** - Generate Orchard proof

## State Flow

### Bundle Generation State
```
idle → loading artifacts → ready → generating → finalizing → bundle ready
```

### Verification State
```
idle → verifying → accepted/rejected/error
```

### Connection State
```
idle → connecting → connected/error
```

## Navigation States

### From Wallet Dashboard
- Navigates to `/build` with `customPolicy` and `walletBalance` in state
- Streamlined flow: auto-selects policy, pre-fills balance

### From Bound Identity Builder
- Sets `bound-identity-return-pending` flag in sessionStorage
- After bundle ready, returns to `/bound-identity` instead of `/workbench`

### From Credentials Hub
- Navigates to `/build` with chain-specific policy
- Auto-selects appropriate rail (Orchard, Starknet, Mina, etc.)

## Error Handling

### Common Error Points

1. **Artifact Loading Failures**
   - Network errors fetching params/pk
   - Hash mismatches
   - Missing break_points (Orchard)

2. **Proof Generation Failures**
   - Invalid attestation JSON
   - Policy mismatch
   - WASM runtime errors
   - Cancellation during generation

3. **Verification Failures**
   - Invalid proof format
   - Policy non-compliance
   - Epoch expired
   - Nullifier already used

## User Experience Highlights

### Quick Start Flow
- **Fastest path**: Click "Try it now" → Load sample → Verify
- **No wallet required**: Uses pre-generated sample bundle
- **Instant verification**: See full flow in seconds

### Standard Flow
- **Step-by-step guidance**: Clear 3-step process
- **Progress tracking**: Visual checklist at top
- **Multiple data sources**: Wallet connector or manual JSON
- **Real-time feedback**: Connection status, WASM loading, proof progress

### Streamlined Flow (from Wallet)
- **Auto-configured**: Policy matches wallet balance
- **Reduced friction**: Skip policy selection
- **One-click generation**: Build attestation → Generate proof

## Related Flows

- **Wallet Flow**: `/wallet` → Generate proof → `/build`
- **Credentials Flow**: `/credentials` → Select chain → `/build`
- **Bound Identity Flow**: `/bound-identity` → Generate proof → `/build` → Return
- **P2P Marketplace**: Uses proof bundles for escrow verification

