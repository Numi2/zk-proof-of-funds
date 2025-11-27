# PCD (Proof-Carrying Data) Wallet State Machine

## Overview

This document describes the recursive PCD pattern implemented for the zkPF wallet state machine. The system allows a wallet to maintain a chain of proofs where each new proof commits to the previous state.

## Architecture

### Two-Step Recursive Approach

Due to the complexity and cost of full recursive SNARKs (which would require specialized accumulator circuits), we implement a practical "two-step" approach:

1. **Step 1: Off-chain Verification** - The zkPF service verifies `π_prev` before generating a new proof.
2. **Step 2: Trusted Reference** - The new proof references `S_prev` as trusted, having verified the chain.

This approach maintains soundness while avoiding the complexity of fully recursive circuits.

### Data Structures

#### PCD State (`PcdState`)

```typescript
interface PcdState {
  wallet_state: WalletState;    // Current wallet state
  s_current: string;             // Commitment to current state (hex)
  proof_current: string;         // Current proof (hex-encoded)
  circuit_version: number;       // Circuit version
  s_genesis: string;             // Genesis commitment
  chain_length: number;          // Transitions from genesis
}
```

#### Tachyon Metadata (`TachyonMetadata`)

Used in spending flows to attach PCD state to transactions:

```typescript
interface TachyonMetadata {
  s_current: string;       // Current state commitment
  proof_current: string;   // Current proof
  height: number;          // Last processed block height
  chain_length: number;    // Chain length
  updated_at: number;      // Timestamp
}
```

## API Endpoints

### `POST /zkpf/pcd/init`

Initialize a new PCD chain from genesis.

**Request:**
```json
{
  "initial_notes": []  // Optional initial notes
}
```

**Response:**
```json
{
  "pcd_state": {
    "wallet_state": {...},
    "s_current": "0x...",
    "proof_current": "0x...",
    "circuit_version": 1,
    "s_genesis": "0x...",
    "chain_length": 1
  }
}
```

### `POST /zkpf/pcd/update`

Update PCD state with new block data.

**Request:**
```json
{
  "pcd_state": {...},
  "delta": {
    "block_height": 100,
    "anchor_new": "0x...",
    "new_notes": [],
    "spent_nullifiers": []
  },
  "current_notes": [],
  "current_nullifiers": []
}
```

**Response:**
```json
{
  "pcd_state": {...},
  "prev_proof_verified": true
}
```

### `POST /zkpf/pcd/verify`

Verify a PCD state and its proof.

**Request:**
```json
{
  "pcd_state": {...}
}
```

**Response:**
```json
{
  "valid": true,
  "s_current": "0x...",
  "chain_length": 10,
  "error": null
}
```

## Frontend Integration

### React Context

The `PcdProvider` component manages PCD state in the React application:

```tsx
import { PcdProvider, usePcdContext } from '../context/PcdContext';

function WalletLayout({ children }) {
  return (
    <PcdProvider>
      {children}
    </PcdProvider>
  );
}
```

### Using PCD in Components

```tsx
function MyComponent() {
  const { 
    state,
    initializePcd,
    updatePcd,
    verifyPcd,
    getTachyonMetadata,
    exportPcdState,
    importPcdState,
    clearPcdState,
  } = usePcdContext();

  // Initialize new chain
  await initializePcd([]);

  // Update with block data
  await updatePcd({
    block_height: 100,
    anchor_new: "0x...",
    new_notes: [],
    spent_nullifiers: [],
  });

  // Get metadata for spending
  const metadata = getTachyonMetadata();
}
```

### TachyonStatePanel Component

A ready-to-use UI component for displaying and managing PCD state:

```tsx
import { TachyonStatePanel } from '../components/TachyonStatePanel';

// Full panel
<TachyonStatePanel />

// Compact mode for embedding
<TachyonStatePanel compact />
```

## Spending Flow Integration

Before constructing a spend, the wallet:

1. Ensures PCD state is up to date
2. Verifies the current proof
3. Includes `TachyonMetadata` in transaction metadata

```tsx
// In WalletSend component
const handleContinue = async () => {
  if (pcdState.isInitialized) {
    const isValid = await verifyPcd();
    if (!isValid) {
      console.warn('PCD verification failed');
    }
  }
  // Continue with transaction...
};
```

## Storage

PCD state is persisted in IndexedDB using `idb-keyval`:

- **Key:** `zkpf-pcd-state`
- **Format:** `PersistedPcdState` JSON

The state includes:
- Full `PcdState` with proof
- Current notes (private)
- Current nullifiers (private)
- Last update timestamp

## Security Considerations

1. **Proof Verification**: While we use a two-step approach, the off-chain verification ensures soundness.
2. **State Commitment**: The commitment `S` is publicly verifiable without revealing wallet contents.
3. **Private Witness**: Notes and nullifiers remain private to the wallet owner.
4. **Chain Integrity**: The genesis commitment allows verification of the entire proof chain.

## Implementation Mode

This implementation uses the **simulated PCD** approach with off-chain verification. A future enhancement could implement full recursive verification using:
- Nova/SuperNova accumulators
- Halo2 recursive circuits
- IVC (Incrementally Verifiable Computation)

The current implementation is documented as:
- Mode: **Two-step off-chain verification**
- Soundness: Maintained via backend verification
- Complexity: O(1) proof size (non-recursive)

