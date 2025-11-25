# zkpf Proof of Funds Snap

A MetaMask Snap for generating zero-knowledge proof-of-funds attestations. Prove you meet a financial threshold without revealing your exact balance.

## Overview

This snap enables users to:

1. **Choose a Policy** - Select what threshold you want to prove (e.g., ≥10,000 USD)
2. **Select Funding Sources** - Connect your Ethereum wallet and/or paste your Zcash UFVK
3. **Bind Your Identity** - Sign a message to create a verifiable holder tag

The result is a proof bundle that verifiers can check to confirm you meet the threshold, without learning your actual balance or account details.

## Core Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   zkpf Proof of Funds Snap                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CHOOSE POLICY                                               │
│     ┌──────────────────────────────────────────────────────────┐│
│     │ What do you want to prove?                               ││
│     │ ○ Fiat ≥ 10,000 USD                                      ││
│     │ ○ On-chain ≥ 100,000 USD                                 ││
│     │ ● Orchard ≥ 10 ZEC shielded                              ││
│     └──────────────────────────────────────────────────────────┘│
│                                                                  │
│  2. SELECT FUNDING SOURCES                                      │
│     ┌──────────────────────────────────────────────────────────┐│
│     │ Ethereum: 0xabc...def (auto-populated)                   ││
│     │ Zcash:    uview1... (paste UFVK)                         ││
│     └──────────────────────────────────────────────────────────┘│
│                                                                  │
│  3. BIND HOLDER IDENTITY                                        │
│     ┌──────────────────────────────────────────────────────────┐│
│     │ Sign message → holder_tag                                ││
│     │ (keccak256 of signature)                                 ││
│     │                                                          ││
│     │ Verifiers see same identity,                             ││
│     │ never your actual address                                ││
│     └──────────────────────────────────────────────────────────┘│
│                                                                  │
│                    [Create Proof of Funds]                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Installation

### For Development

1. Install [MetaMask Flask](https://docs.metamask.io/snaps/get-started/install-flask/) (development version of MetaMask with Snaps support)

2. Clone and install dependencies:
   ```bash
   cd zkpf-snap
   yarn install
   ```

3. Build for local development:
   ```bash
   ./build_local.sh
   ```

4. Serve the snap:
   ```bash
   yarn serve
   ```

5. The snap will be available at `http://localhost:8081`

### For Production

```bash
yarn build
```

## Usage from a Dapp

### Step 0: Install the Snap (Required First)

Before calling any snap methods, dapps **must** request permission using `wallet_requestSnaps`:

```typescript
// Install and connect to the snap
const result = await window.ethereum.request({
  method: 'wallet_requestSnaps',
  params: {
    'npm:@zkpf/proof-of-funds-snap': {},
  },
});

console.log('Snap installed:', result);
// Returns: { 'npm:@zkpf/proof-of-funds-snap': { id, version, enabled, blocked } }
```

With a specific version:

```typescript
await window.ethereum.request({
  method: 'wallet_requestSnaps',
  params: {
    'npm:@zkpf/proof-of-funds-snap': {
      version: '^0.1.0',
    },
  },
});
```

### Check Installed Snaps

```typescript
// Get all permitted snaps
const snaps = await window.ethereum.request({
  method: 'wallet_getSnaps',
});

console.log('Installed snaps:', snaps);
```

### Step 1: Choose Policy

```typescript
// Select a policy to prove against
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'selectPolicy',
      params: {
        policy: {
          policy_id: 100200,
          threshold_raw: 1000000000,
          required_currency_code: 999001,
          verifier_scope_id: 300,
          label: 'Orchard ≥ 10 ZEC shielded',
        },
      },
    },
  },
});
```

### Step 2: Select Funding Sources

```typescript
// Auto-populate with connected Ethereum address
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'addEthereumSource',
    },
  },
});

// Collect Zcash UFVK via dialogs
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'addZcashSource',
    },
  },
});

// Or add a custom funding source directly
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'addFundingSource',
      params: {
        source: {
          type: 'zcash',
          ufvk: 'uview1...',
          network: 'main',
          snapshotHeight: 2700000,
          balanceZats: 1500000000,
        },
      },
    },
  },
});
```

### Step 3: Bind Holder Identity

```typescript
// Sign message and generate holder_tag (using personal_sign)
const binding = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'bindHolder',
      params: {
        policy: selectedPolicy,
      },
    },
  },
});

console.log('Holder tag:', binding.holderTag); // "0x..."
console.log('Signature:', binding.signature);
console.log('Signer:', binding.signerAddress);

// Alternative: Use EIP-712 typed data signing
const bindingTyped = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'bindHolderTypedData',
      params: {
        policy: selectedPolicy,
      },
    },
  },
});
```

### Complete Flow

```typescript
// Create complete proof (combines all steps)
const proofRequest = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'createProof',
      params: {
        policy: selectedPolicy,
      },
    },
  },
});

// proofRequest contains:
// - policy: the selected policy
// - fundingSources: array of funding sources
// - holderBinding: { signature, holderTag, signerAddress, message }
// - timestamp: when the proof was created
```

### Export & Share Proofs

```typescript
// Export proof as shareable bundle
const bundle = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'exportProofBundle',
      params: {
        proofRequest: proofRequest, // from createProof
      },
    },
  },
});

console.log('Bundle ID:', bundle.bundleId);
console.log('Bundle JSON:', JSON.stringify(bundle));
```

### Verify Proof Bundles

```typescript
// Verify a proof bundle
const result = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'verifyProofBundle',
      params: {
        bundleJson: '{"version":"1.0.0",...}',
      },
    },
  },
});

console.log('Valid:', result.valid);
console.log('Checks:', result.checks);
console.log('Details:', result.details);

// Interactive verification (prompts user for bundle)
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'verifyBundleInteractive',
    },
  },
});
```

### Proof History

```typescript
// List all proof history
const history = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'listProofHistory',
    },
  },
});

// Get specific proof from history
const proof = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getProofFromHistory',
      params: {
        bundleId: 'zkpf-abc123...',
      },
    },
  },
});

// Show history dialog to user
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'showProofHistory',
    },
  },
});

// Clear proof history
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'clearProofHistory',
    },
  },
});
```

### Holder Fingerprint

```typescript
// Get or create a persistent holder fingerprint
const fingerprint = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getHolderFingerprint',
    },
  },
});

// Show fingerprint in a dialog
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'showHolderFingerprint',
    },
  },
});
```

### Network Configuration

```typescript
// Get current network
const network = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getCurrentNetwork',
    },
  },
});

// Switch network (mainnet/testnet)
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'switchNetwork',
      params: {
        network: 'testnet', // or 'mainnet'
      },
    },
  },
});

// Check if on mainnet
const isMain = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'isMainnet',
    },
  },
});
```

### State Management

```typescript
// Get current proof state
const state = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getProofState',
    },
  },
});

// Get raw snap state
const rawState = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getSnapState',
    },
  },
});

// Get funding sources
const sources = await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'getFundingSources',
    },
  },
});

// Clear funding sources
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'clearFundingSources',
    },
  },
});

// Reset all state
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'resetProofState',
    },
  },
});

// Clear everything including history
await window.ethereum.request({
  method: 'wallet_invokeSnap',
  params: {
    snapId: 'npm:@zkpf/proof-of-funds-snap',
    request: {
      method: 'clearSnapState',
    },
  },
});
```

## RPC Methods Reference

### Policy & Sources

| Method | Description | Parameters |
|--------|-------------|------------|
| `selectPolicy` | Select a policy to prove against | `{ policy: PolicyDefinition }` |
| `addEthereumSource` | Auto-add connected ETH address | None |
| `addZcashSource` | Collect Zcash UFVK via dialogs | None |
| `addFundingSource` | Add a custom funding source | `{ source: FundingSource }` |
| `getFundingSources` | Get current funding sources | None |
| `clearFundingSources` | Clear all funding sources | None |

### Holder Identity

| Method | Description | Parameters |
|--------|-------------|------------|
| `bindHolder` | Sign with personal_sign | `{ policy, fundingSources? }` |
| `bindHolderTypedData` | Sign with EIP-712 | `{ policy, fundingSources? }` |
| `getHolderFingerprint` | Get/create persistent fingerprint | None |
| `showHolderFingerprint` | Display fingerprint in dialog | None |
| `getExistingHolderFingerprint` | Get fingerprint without creating | None |

### Proof Generation & Export

| Method | Description | Parameters |
|--------|-------------|------------|
| `createProof` | Complete proof generation | `{ policy }` |
| `exportProofBundle` | Export as shareable bundle | `{ proofRequest }` |

### Verification

| Method | Description | Parameters |
|--------|-------------|------------|
| `verifyProofBundle` | Verify a proof bundle | `{ bundleJson: string }` |
| `verifyBundleInteractive` | Prompt user and verify | None |
| `parseProofBundle` | Parse bundle without verification | `{ bundleJson: string }` |

### Proof History

| Method | Description | Parameters |
|--------|-------------|------------|
| `listProofHistory` | Get all proof history | None |
| `getProofFromHistory` | Get specific proof by ID | `{ bundleId: string }` |
| `showProofHistory` | Display history dialog | None |
| `clearProofHistory` | Clear history (with confirmation) | None |
| `markProofVerified` | Mark proof as verified | `{ bundleId, verified? }` |

### Network Configuration

| Method | Description | Parameters |
|--------|-------------|------------|
| `getCurrentNetwork` | Get current network config | None |
| `switchNetwork` | Switch to mainnet/testnet | `{ network: 'mainnet' \| 'testnet' }` |
| `getZcashNetwork` | Get current Zcash network | None |
| `getEthereumChainId` | Get current chain ID | None |
| `isMainnet` | Check if on mainnet | None |

### State Management

| Method | Description | Parameters |
|--------|-------------|------------|
| `getProofState` | Get current proof state | None |
| `resetProofState` | Clear proof state | None |
| `getSnapState` | Get raw snap state | None |
| `setSnapState` | Update snap state | Partial state object |
| `clearSnapState` | Clear all state | None |

## Holder Tag

The `holder_tag = keccak256(signature)` enables verifiers to:

- ✅ Confirm "this bundle was bound to the same MetaMask identity"
- ✅ Link multiple proofs from the same holder
- ❌ Learn the actual wallet address
- ❌ Track the holder across different policies/verifiers

This provides a privacy-preserving way to establish identity consistency.

## Permissions

This snap requests the following MetaMask permissions:

| Permission | Purpose |
|------------|---------|
| `snap_dialog` | Show confirmation/input dialogs |
| `snap_manageState` | Persist proof state across sessions |
| `endowment:ethereum-provider` | Access Ethereum accounts and signing |
| `endowment:lifecycle-hooks` | Handle installation events |
| `endowment:rpc` | Allow dapps to communicate with the snap |

## Security

- **No spending authority**: The snap only requests view/sign permissions
- **Local processing**: All cryptographic operations happen locally
- **User consent**: Every action requires explicit user approval via dialogs
- **No data exfiltration**: The snap cannot send data without user action
- **Origin restrictions**: Only allowed origins can communicate with the snap

## Development

```bash
# Install dependencies
yarn install

# Build for local development (adds localhost to allowed origins)
./build_local.sh

# Standard production build
yarn build

# Start development server (watch mode)
yarn start

# Serve built snap
yarn serve

# Run tests
yarn test

# Lint code
yarn lint
```

For local development, the `build_local.sh` script automatically adds `http://localhost:3000` and `http://localhost:5173` to the allowed origins in `snap.manifest.json`.

## License

MIT-0 OR Apache-2.0
