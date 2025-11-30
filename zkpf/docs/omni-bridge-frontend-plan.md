# Omni Bridge Frontend Plan

## Overview

This document outlines the frontend architecture for integrating the Omni Bridge SDK into the zkpf wallet. The bridge enables cross-chain asset transfers between NEAR, Ethereum, Arbitrum, Base, and Solana, along with proof-of-bridged-assets for zkpf attestations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Omni Bridge Frontend                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         BridgePage (Router)                           │  │
│  │                                                                        │  │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────────────┐ │  │
│  │  │   Bridge   │ │  History   │ │   Proofs   │ │   Settings/Config  │ │  │
│  │  │    Tab     │ │    Tab     │ │    Tab     │ │        Tab         │ │  │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                          Core Components                              │  │
│  │                                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │ ChainSelector   │  │ TokenSelector   │  │ AddressInput        │   │  │
│  │  │ - Chain icons   │  │ - Token logos   │  │ - Chain-aware       │   │  │
│  │  │ - Network info  │  │ - Balances      │  │ - Validation        │   │  │
│  │  │ - Gas estimates │  │ - Availability  │  │ - ENS/NEAR names    │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │  │
│  │                                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │ AmountInput     │  │ FeeEstimator    │  │ TransferProgress    │   │  │
│  │  │ - Max balance   │  │ - Live updates  │  │ - Step tracking     │   │  │
│  │  │ - USD value     │  │ - Fast mode     │  │ - TX links          │   │  │
│  │  │ - Validation    │  │ - Breakdown     │  │ - ETA countdown     │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Feature Components                             │  │
│  │                                                                        │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐   │  │
│  │  │ BridgedAsset    │  │ Attestation     │  │ WalletConnect       │   │  │
│  │  │ ProofGenerator  │  │ Creator         │  │ Multi-chain         │   │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Page Structure

### 1. Bridge Page (`/bridge`)

Main entry point for bridge operations.

```
/bridge
├── /bridge              # Main bridge interface (default)
├── /bridge/history      # Transfer history
├── /bridge/proofs       # Bridged asset proofs
├── /bridge/attestation  # Cross-chain attestations
└── /bridge/settings     # Bridge configuration
```

### 2. Integration Points

The bridge should integrate with:

- **Wallet Dashboard** - Quick bridge access card
- **TachyonStatePanel** - Bridge rail status
- **WalletLayout** - Navigation menu item
- **StatusCards** - Active transfer notifications

## Component Specifications

### Core Components

#### 1. ChainSelector

```typescript
interface ChainSelectorProps {
  value: ChainId;
  onChange: (chain: ChainId) => void;
  label: string;
  excludeChains?: ChainId[];
  showBalance?: boolean;
  disabled?: boolean;
}

// Features:
// - Visual chain icons with brand colors
// - Network status indicator (healthy/degraded)
// - Average gas/fee display
// - Quick network switch
```

#### 2. TokenSelector

```typescript
interface TokenSelectorProps {
  chainId: ChainId;
  value: string;
  onChange: (token: Token) => void;
  showBalance?: boolean;
  filterBridgeable?: boolean;
}

// Features:
// - Token search/filter
// - Balance display per chain
// - Price in USD
// - Stablecoin badge
// - "Add custom token" option
```

#### 3. AmountInput

```typescript
interface AmountInputProps {
  value: string;
  onChange: (amount: string) => void;
  token: Token;
  maxAmount?: string;
  showUsdValue?: boolean;
  error?: string;
}

// Features:
// - MAX button
// - USD conversion (via CoinGecko)
// - Decimal validation per token
// - Insufficient balance warning
// - Min/max amount enforcement
```

#### 4. AddressInput

```typescript
interface AddressInputProps {
  chainId: ChainId;
  value: string;
  onChange: (address: string) => void;
  label?: string;
  placeholder?: string;
}

// Features:
// - Chain-specific validation
// - ENS/NEAR name resolution
// - Address book integration
// - QR code scanner (mobile)
// - "Use connected wallet" button
```

#### 5. FeeEstimator

```typescript
interface FeeEstimatorProps {
  sourceChain: ChainId;
  destinationChain: ChainId;
  token: string;
  amount: string;
  fastMode: boolean;
  onFastModeChange: (enabled: boolean) => void;
}

// Features:
// - Real-time fee estimation
// - Source chain gas
// - Bridge fee
// - Destination chain gas
// - Fast mode toggle
// - Time estimate
```

#### 6. TransferProgress

```typescript
interface TransferProgressProps {
  transfer: Transfer;
  onCancel?: () => void;
  onRetry?: () => void;
}

// Steps:
// 1. Pending - Awaiting confirmation
// 2. Source Submitted - TX sent to source chain
// 3. Source Confirmed - TX confirmed
// 4. Waiting Finality - Chain finality period
// 5. Proof Generated - Cross-chain proof ready
// 6. Destination Submitted - TX sent to destination
// 7. Completed - Transfer complete

// Features:
// - Animated progress bar
// - Step-by-step status
// - TX hash links to explorers
// - Countdown timer
// - Error handling with retry
```

### Feature Components

#### 7. BridgedAssetProofGenerator

```typescript
interface BridgedAssetProofGeneratorProps {
  onProofGenerated: (proof: BridgedAssetProof) => void;
}

// Flow:
// 1. Select chain
// 2. Connect wallet
// 3. Select tokens to prove
// 4. Generate proof
// 5. Download/share proof
```

#### 8. AttestationCreator

```typescript
interface AttestationCreatorProps {
  holderId: string;
  onAttestationCreated: (attestation: CrossChainAttestation) => void;
}

// Flow:
// 1. Select source chain
// 2. Select destination chain
// 3. Generate bridged asset proof
// 4. Create attestation
// 5. View encoded attestation
```

#### 9. MultiChainWalletConnect

```typescript
interface MultiChainWalletConnectProps {
  chains: ChainId[];
  onConnect: (connections: ChainConnection[]) => void;
}

// Supported:
// - MetaMask (EVM chains)
// - NEAR Wallet
// - Phantom (Solana)
// - WalletConnect v2
```

## State Management

### Bridge Context

```typescript
interface BridgeState {
  // Configuration
  config: OmniBridgeConfig;
  supportedChains: Chain[];
  supportedTokens: Token[];
  
  // Connection
  connectedChains: Map<ChainId, WalletConnection>;
  balances: Map<string, TokenBalance>;
  
  // Transfer state
  activeTransfers: Transfer[];
  transferHistory: Transfer[];
  
  // UI state
  isLoading: boolean;
  error: string | null;
}

interface BridgeActions {
  // Connection
  connectChain(chainId: ChainId): Promise<void>;
  disconnectChain(chainId: ChainId): void;
  
  // Transfers
  initiateTransfer(request: TransferRequest): Promise<Transfer>;
  cancelTransfer(transferId: string): Promise<void>;
  refreshTransfer(transferId: string): Promise<void>;
  
  // Balances
  refreshBalances(): Promise<void>;
  
  // Proofs
  generateAssetProof(params: AssetProofParams): Promise<BridgedAssetProof>;
  createAttestation(params: AttestationParams): Promise<CrossChainAttestation>;
}
```

### React Context Implementation

```typescript
// contexts/BridgeContext.tsx
export const BridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // State management with useReducer or Zustand
  // API calls via custom hooks
  // WebSocket for real-time updates
};
```

## API Integration

### API Service

```typescript
// services/omni-bridge-api.ts

const API_BASE = import.meta.env.VITE_OMNI_BRIDGE_API || '/api/rails/omni';

export const omniBridgeApi = {
  // Info
  getInfo: () => fetch(`${API_BASE}/info`).then(r => r.json()),
  
  // Chains
  getChains: () => fetch(`${API_BASE}/chains`).then(r => r.json()),
  getChain: (id: string) => fetch(`${API_BASE}/chains/${id}`).then(r => r.json()),
  
  // Tokens
  getTokens: () => fetch(`${API_BASE}/tokens`).then(r => r.json()),
  getToken: (symbol: string) => fetch(`${API_BASE}/tokens/${symbol}`).then(r => r.json()),
  
  // Transfers
  initiateTransfer: (req: TransferRequest) => 
    fetch(`${API_BASE}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(r => r.json()),
  
  getTransfer: (id: string) => fetch(`${API_BASE}/transfer/${id}`).then(r => r.json()),
  getTransfers: () => fetch(`${API_BASE}/transfers`).then(r => r.json()),
  
  // Fees
  estimateFee: (req: FeeEstimateRequest) =>
    fetch(`${API_BASE}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(r => r.json()),
  
  // Proofs
  proveAssets: (req: ProveAssetsRequest) =>
    fetch(`${API_BASE}/prove-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(r => r.json()),
  
  createAttestation: (req: AttestationRequest) =>
    fetch(`${API_BASE}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(r => r.json()),
};
```

### Custom Hooks

```typescript
// hooks/useBridge.ts
export function useBridge() {
  const context = useContext(BridgeContext);
  if (!context) throw new Error('useBridge must be used within BridgeProvider');
  return context;
}

// hooks/useTransfer.ts
export function useTransfer(transferId: string) {
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Poll for transfer status updates
    const interval = setInterval(async () => {
      const data = await omniBridgeApi.getTransfer(transferId);
      setTransfer(data);
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [transferId]);
  
  return { transfer, isLoading };
}

// hooks/useFeeEstimate.ts
export function useFeeEstimate(params: FeeEstimateParams) {
  const [fee, setFee] = useState<FeeEstimate | null>(null);
  
  useEffect(() => {
    const debounce = setTimeout(async () => {
      if (params.amount && parseFloat(params.amount) > 0) {
        const data = await omniBridgeApi.estimateFee(params);
        setFee(data);
      }
    }, 500);
    
    return () => clearTimeout(debounce);
  }, [params.sourceChain, params.destinationChain, params.token, params.amount]);
  
  return fee;
}

// hooks/useTokenBalances.ts
export function useTokenBalances(chainId: ChainId, address: string) {
  // Fetch balances for all tokens on a chain
}
```

## User Flows

### Flow 1: Basic Bridge Transfer

```
┌─────────────────────────────────────────────────────────────────┐
│                     Bridge Transfer Flow                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Connect Wallet                                              │
│     ├── Select source chain                                     │
│     └── Connect wallet for that chain                           │
│                                                                 │
│  2. Configure Transfer                                          │
│     ├── Select destination chain                                │
│     ├── Select token                                            │
│     ├── Enter amount                                            │
│     └── Enter recipient address                                 │
│                                                                 │
│  3. Review & Confirm                                            │
│     ├── View fee breakdown                                      │
│     ├── View estimated time                                     │
│     ├── Toggle fast mode (optional)                             │
│     └── Sign transaction                                        │
│                                                                 │
│  4. Track Progress                                              │
│     ├── View step-by-step progress                              │
│     ├── See TX links                                            │
│     └── Wait for completion                                     │
│                                                                 │
│  5. Complete                                                    │
│     ├── Success notification                                    │
│     └── View in history                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 2: Generate Bridged Asset Proof

```
┌─────────────────────────────────────────────────────────────────┐
│                  Bridged Asset Proof Flow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Select Chain                                                │
│     └── Choose chain where assets are held                      │
│                                                                 │
│  2. Connect Wallet                                              │
│     └── Connect wallet for selected chain                       │
│                                                                 │
│  3. Select Assets                                               │
│     ├── View detected token balances                            │
│     └── Check tokens to include in proof                        │
│                                                                 │
│  4. Generate Proof                                              │
│     ├── Click "Generate Proof"                                  │
│     └── Wait for proof generation                               │
│                                                                 │
│  5. Use Proof                                                   │
│     ├── View proof details                                      │
│     ├── Copy encoded proof                                      │
│     ├── Download as JSON                                        │
│     └── Use in zkpf attestation                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 3: Create Cross-Chain Attestation

```
┌─────────────────────────────────────────────────────────────────┐
│                Cross-Chain Attestation Flow                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Provide Holder ID                                           │
│     └── Enter or connect zkpf holder identity                   │
│                                                                 │
│  2. Select Chains                                               │
│     ├── Source chain (where assets are)                         │
│     └── Destination chain (where attestation will be used)      │
│                                                                 │
│  3. Generate Asset Proof                                        │
│     └── (Uses Flow 2)                                           │
│                                                                 │
│  4. Create Attestation                                          │
│     ├── Click "Create Attestation"                              │
│     └── Wait for creation                                       │
│                                                                 │
│  5. Use Attestation                                             │
│     ├── View attestation details                                │
│     ├── Check validity period                                   │
│     ├── Copy encoded attestation                                │
│     └── Submit to destination chain                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Design Specifications

### Color Palette (Chain-specific)

```css
/* Chain brand colors */
--near-primary: #00ec97;
--near-gradient: linear-gradient(135deg, #00ec97, #00c4a5);

--ethereum-primary: #627eea;
--ethereum-gradient: linear-gradient(135deg, #627eea, #8c9eff);

--arbitrum-primary: #28a0f0;
--arbitrum-gradient: linear-gradient(135deg, #28a0f0, #12aaff);

--base-primary: #0052ff;
--base-gradient: linear-gradient(135deg, #0052ff, #1969ff);

--solana-primary: #9945ff;
--solana-gradient: linear-gradient(135deg, #9945ff, #14f195);

/* Status colors */
--status-pending: #d29922;
--status-success: #3fb950;
--status-error: #f85149;
--status-info: #58a6ff;
```

### Typography

```css
/* Use existing project fonts */
--font-heading: 'Space Grotesk', sans-serif;
--font-body: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', monospace;

/* Sizes */
--text-xs: 0.75rem;
--text-sm: 0.875rem;
--text-base: 1rem;
--text-lg: 1.125rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;
```

### Spacing & Layout

```css
/* Container */
--bridge-max-width: 480px;
--bridge-padding: 2rem;

/* Components */
--input-height: 56px;
--button-height: 48px;
--card-radius: 16px;
--input-radius: 12px;

/* Gaps */
--gap-xs: 0.25rem;
--gap-sm: 0.5rem;
--gap-md: 1rem;
--gap-lg: 1.5rem;
--gap-xl: 2rem;
```

### Responsive Breakpoints

```css
/* Mobile first */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
```

## File Structure

```
web/src/
├── components/
│   └── bridge/
│       ├── index.ts                    # Exports
│       ├── OmniBridge.tsx              # Main bridge component ✓
│       ├── OmniBridge.css              # Styles ✓
│       ├── BridgePage.tsx              # Page wrapper ✓
│       ├── BridgeHistory.tsx           # History list ✓
│       ├── ChainSelector.tsx           # Chain dropdown
│       ├── ChainSelector.css
│       ├── TokenSelector.tsx           # Token dropdown
│       ├── TokenSelector.css
│       ├── AmountInput.tsx             # Amount field
│       ├── AmountInput.css
│       ├── AddressInput.tsx            # Address field
│       ├── AddressInput.css
│       ├── FeeEstimator.tsx            # Fee display
│       ├── FeeEstimator.css
│       ├── TransferProgress.tsx        # Progress tracker
│       ├── TransferProgress.css
│       ├── TransferCard.tsx            # History item
│       ├── TransferCard.css
│       ├── BridgedAssetProof.tsx       # Proof generator
│       ├── BridgedAssetProof.css
│       ├── AttestationCreator.tsx      # Attestation UI
│       ├── AttestationCreator.css
│       ├── BridgeSettings.tsx          # Settings panel
│       └── BridgeSettings.css
│
├── contexts/
│   └── BridgeContext.tsx               # Bridge state context
│
├── hooks/
│   ├── useBridge.ts                    # Main bridge hook
│   ├── useTransfer.ts                  # Single transfer hook
│   ├── useFeeEstimate.ts               # Fee estimation hook
│   ├── useTokenBalances.ts             # Balance fetching hook
│   └── useChainConnection.ts           # Wallet connection hook
│
├── services/
│   └── omni-bridge-api.ts              # API client
│
└── types/
    └── bridge.ts                       # TypeScript types
```

## Implementation Phases

### Phase 1: Core Bridge UI (Week 1)
- [ ] ChainSelector component
- [ ] TokenSelector component
- [ ] AmountInput component
- [ ] AddressInput component
- [ ] Basic transfer flow

### Phase 2: Transfer Tracking (Week 2)
- [ ] FeeEstimator component
- [ ] TransferProgress component
- [ ] Transfer history page
- [ ] Real-time status updates

### Phase 3: Wallet Integration (Week 3)
- [ ] MetaMask connection (EVM)
- [ ] NEAR Wallet connection
- [ ] Phantom connection (Solana)
- [ ] Multi-chain balance display

### Phase 4: Proofs & Attestations (Week 4)
- [ ] BridgedAssetProof component
- [ ] AttestationCreator component
- [ ] Integration with zkpf system
- [ ] Proof sharing/export

### Phase 5: Polish & Testing (Week 5)
- [ ] Mobile responsive design
- [ ] Error handling improvements
- [ ] Loading states & animations
- [ ] E2E testing
- [ ] Documentation

## Testing Strategy

### Unit Tests
```typescript
// Test components in isolation
describe('ChainSelector', () => {
  it('renders all supported chains');
  it('calls onChange when chain selected');
  it('excludes specified chains');
});
```

### Integration Tests
```typescript
// Test full user flows
describe('Bridge Transfer Flow', () => {
  it('completes a transfer from Ethereum to NEAR');
  it('shows error for insufficient balance');
  it('tracks transfer progress');
});
```

### E2E Tests
```typescript
// Test with real API (testnet)
describe('Omni Bridge E2E', () => {
  it('bridges USDC from Ethereum Sepolia to NEAR Testnet');
});
```

## Performance Considerations

1. **Lazy Loading** - Load chain-specific wallet connectors on demand
2. **Caching** - Cache chain/token lists with SWR or React Query
3. **Debouncing** - Debounce fee estimation API calls
4. **Optimistic Updates** - Show pending transfers immediately
5. **Background Refresh** - Poll for transfer updates efficiently

## Security Considerations

1. **Address Validation** - Validate addresses client-side before submission
2. **Amount Limits** - Enforce min/max amounts
3. **Slippage Protection** - Show fee changes before confirmation
4. **Transaction Signing** - Clear signing prompts with amount verification
5. **Session Management** - Handle wallet disconnections gracefully

## Accessibility

1. **Keyboard Navigation** - All controls accessible via keyboard
2. **Screen Readers** - Proper ARIA labels
3. **Color Contrast** - Meet WCAG 2.1 AA standards
4. **Focus Management** - Clear focus indicators
5. **Error Messages** - Clear, actionable error descriptions

