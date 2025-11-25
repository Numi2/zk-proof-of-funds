# USDC On-Ramp Integration Plan

> **Goal**: Enable zkpf wallets to acquire and hold USDC through seamless fiat-to-crypto conversion, supporting multi-chain deployments and integrating with the existing proof-of-funds infrastructure.

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [On-Ramp Provider Strategy](#on-ramp-provider-strategy)
4. [Multi-Chain USDC Support](#multi-chain-usdc-support)
5. [Implementation Plan](#implementation-plan)
6. [Technical Components](#technical-components)
7. [UI/UX Design](#uiux-design)
8. [Security & Compliance](#security--compliance)
9. [Integration with zkpf Proof System](#integration-with-zkpf-proof-system)
10. [Timeline & Milestones](#timeline--milestones)

---

## Executive Summary

This plan outlines the integration of USDC on-ramp functionality into the zkpf wallet ecosystem. The implementation leverages:

- **Existing infrastructure**: Starknet rail (already supports USDC), EVM wallet connector, MetaMask Snap
- **On-ramp providers**: Primary (Coinbase Onramp), Secondary (Transak/MoonPay)
- **Multi-chain**: Ethereum, Starknet, Base, Arbitrum, Optimism
- **PoF integration**: USDC balances can be proven via existing rails

### Key Benefits

| Benefit | Description |
|---------|-------------|
| **Zero-fee USDC** | Coinbase offers 0% fee for USDC on/off-ramp |
| **Multi-chain** | Support USDC across EVM L1s, L2s, and Starknet |
| **PoF Ready** | Seamless integration with proof-of-funds verification |
| **Privacy** | zkpf proofs enable balance attestation without address disclosure |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          zkpf Web Application                           │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   Wallet     │  │  On-Ramp     │  │   Balance    │  │    PoF      │ │
│  │  Dashboard   │  │   Widget     │  │   Display    │  │   Builder   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                 │                 │                  │        │
├─────────┴─────────────────┴─────────────────┴──────────────────┴────────┤
│                        On-Ramp Service Layer                            │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  OnRampContext: provider selection, session management, events   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                        Provider Adapters                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────────┐   │
│  │  Coinbase  │  │  Transak   │  │  MoonPay   │  │  MoneyGram      │   │
│  │  Onramp    │  │  Widget    │  │  Widget    │  │  (Stellar)      │   │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────────┬────────┘   │
└────────┼───────────────┼───────────────┼─────────────────┼──────────────┘
         │               │               │                 │
         ▼               ▼               ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Blockchain Networks                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Ethereum │  │   Base   │  │ Arbitrum │  │ Starknet │  │ Optimism │  │
│  │   USDC   │  │   USDC   │  │   USDC   │  │   USDC   │  │   USDC   │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User initiates buy** → On-ramp widget opens with pre-filled wallet address
2. **Provider processes** → KYC, payment, conversion handled by provider
3. **USDC delivered** → Tokens arrive at user's connected wallet address
4. **Balance updates** → Wallet dashboard reflects new USDC balance
5. **PoF available** → User can generate proof-of-funds for USDC holdings

---

## On-Ramp Provider Strategy

### Primary: Coinbase Onramp SDK

**Why Coinbase?**
- Zero fees for USDC on/off-ramp
- Established trust and regulatory compliance
- Simple SDK integration
- Supports multiple chains (Ethereum, Base, Polygon, etc.)

```typescript
// Example Coinbase Onramp integration
interface CoinbaseOnrampConfig {
  appId: string;
  addresses: { [chain: string]: string };
  assets: ['USDC'];
  defaultNetwork?: 'base' | 'ethereum' | 'arbitrum-one' | 'optimism';
  handlingRequestedUrls?: boolean;
}

// Usage
const onrampURL = generateOnRampURL({
  appId: process.env.COINBASE_APP_ID,
  destinationWallets: [{
    address: userWalletAddress,
    blockchains: ['base', 'ethereum'],
    assets: ['USDC'],
  }],
  defaultExperience: 'buy',
});
```

### Secondary: Transak

**Why Transak?**
- Wider geographic coverage (100+ countries)
- More payment method options
- Fallback when Coinbase unavailable
- Supports Starknet directly

```typescript
interface TransakConfig {
  apiKey: string;
  environment: 'STAGING' | 'PRODUCTION';
  defaultCryptoCurrency: 'USDC';
  walletAddress: string;
  networks: string[];
  disableWalletAddressForm: boolean;
}
```

### Tertiary: MoneyGram (Stellar Bridge)

For users preferring cash-based on-ramp:
- Physical locations for cash deposits
- Stellar USDC → Bridge to target chain
- Good for unbanked users

### Provider Selection Logic

```typescript
type OnRampProvider = 'coinbase' | 'transak' | 'moneygram';

interface ProviderCapabilities {
  supportedChains: string[];
  supportedCountries: string[];
  paymentMethods: string[];
  fees: { percentage: number; fixed: number };
  kycRequired: boolean;
}

function selectProvider(
  userCountry: string,
  targetChain: string,
  preferredPayment: string
): OnRampProvider {
  // 1. Check if Coinbase available (zero-fee USDC)
  if (coinbaseAvailable(userCountry, targetChain)) {
    return 'coinbase';
  }
  
  // 2. Fall back to Transak for wider coverage
  if (transakAvailable(userCountry, targetChain)) {
    return 'transak';
  }
  
  // 3. MoneyGram for cash users (requires Stellar bridge)
  return 'moneygram';
}
```

---

## Multi-Chain USDC Support

### USDC Contract Addresses

| Chain | Address | Decimals | Native/Bridged |
|-------|---------|----------|----------------|
| Ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | Native |
| Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | Native |
| Arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | Native |
| Optimism | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | Native |
| Starknet | `0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8` | 6 | Native |
| Polygon | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | 6 | Native |

### Existing Starknet Integration

The zkpf Starknet rail already supports USDC in `zkpf-starknet-l2/src/types.rs`:

```rust
pub mod known_tokens {
    pub const USDC: &str = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
    pub const USDT: &str = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8";
    pub const DAI: &str = "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3";
}
```

### Chain Configuration

```typescript
// web/src/config/usdc-chains.ts
export interface UsdcChainConfig {
  chainId: number | string;
  name: string;
  usdcAddress: string;
  rpcUrl: string;
  explorerUrl: string;
  onrampSupported: OnRampProvider[];
  zkpfRailId?: string;
}

export const USDC_CHAINS: Record<string, UsdcChainConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    onrampSupported: ['coinbase', 'transak', 'moneygram'],
    zkpfRailId: 'ONCHAIN_WALLET',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
  },
  starknet: {
    chainId: 'SN_MAIN',
    name: 'Starknet',
    usdcAddress: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    rpcUrl: 'https://starknet-mainnet.public.blastapi.io',
    explorerUrl: 'https://starkscan.co',
    onrampSupported: ['transak'],
    zkpfRailId: 'STARKNET_L2',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
  },
};
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

#### 1.1 On-Ramp Provider Module

Create new module: `web/src/services/onramp/`

```
web/src/services/onramp/
├── index.ts              # Public API
├── types.ts              # TypeScript interfaces
├── providers/
│   ├── coinbase.ts       # Coinbase Onramp adapter
│   ├── transak.ts        # Transak adapter
│   └── moneygram.ts      # MoneyGram adapter (future)
├── context.tsx           # React context for on-ramp state
├── hooks.ts              # useOnRamp, useOnRampStatus hooks
└── utils/
    ├── chain-detection.ts
    ├── address-validation.ts
    └── fee-estimation.ts
```

#### 1.2 Types Definition

```typescript
// web/src/services/onramp/types.ts

export type OnRampProvider = 'coinbase' | 'transak' | 'moneygram';
export type OnRampStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

export interface OnRampSession {
  id: string;
  provider: OnRampProvider;
  status: OnRampStatus;
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount?: number;
  cryptoAsset: string;
  targetChain: string;
  targetAddress: string;
  txHash?: string;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export interface OnRampQuote {
  provider: OnRampProvider;
  fiatAmount: number;
  fiatCurrency: string;
  cryptoAmount: number;
  cryptoAsset: string;
  exchangeRate: number;
  fees: {
    provider: number;
    network: number;
    total: number;
  };
  estimatedTime: number; // seconds
}

export interface OnRampConfig {
  defaultProvider: OnRampProvider;
  defaultChain: string;
  defaultAsset: 'USDC';
  enabledProviders: OnRampProvider[];
  enabledChains: string[];
}
```

### Phase 2: Coinbase Integration (Week 2-3)

#### 2.1 Coinbase Onramp SDK Setup

```typescript
// web/src/services/onramp/providers/coinbase.ts

import { generateOnRampURL } from '@coinbase/cbpay-js';

export interface CoinbaseConfig {
  appId: string;
  appName: string;
}

export class CoinbaseOnrampProvider {
  private config: CoinbaseConfig;

  constructor(config: CoinbaseConfig) {
    this.config = config;
  }

  generateBuyUrl(params: {
    address: string;
    chain: string;
    amount?: number;
    asset?: string;
  }): string {
    const chainMapping: Record<string, string> = {
      ethereum: 'ethereum',
      base: 'base',
      arbitrum: 'arbitrum',
      optimism: 'optimism',
      polygon: 'polygon',
    };

    return generateOnRampURL({
      appId: this.config.appId,
      destinationWallets: [{
        address: params.address,
        blockchains: [chainMapping[params.chain] || 'base'],
        assets: [params.asset || 'USDC'],
      }],
      presetFiatAmount: params.amount,
      defaultExperience: 'buy',
    });
  }

  // Webhook handler for purchase completion
  async handleWebhook(payload: unknown): Promise<OnRampSession> {
    // Validate signature, update session status
    // ...
  }
}
```

#### 2.2 Environment Configuration

```bash
# .env.local
VITE_COINBASE_ONRAMP_APP_ID=your-coinbase-app-id
VITE_TRANSAK_API_KEY=your-transak-api-key
VITE_ONRAMP_ENABLED=true
VITE_DEFAULT_ONRAMP_CHAIN=base
```

### Phase 3: UI Components (Week 3-4)

#### 3.1 On-Ramp Widget Component

```typescript
// web/src/components/onramp/OnRampWidget.tsx

import { useState, useCallback } from 'react';
import { useWalletContext } from '../../context/WalletContext';
import { useOnRamp } from '../../services/onramp/hooks';
import { USDC_CHAINS } from '../../config/usdc-chains';

interface OnRampWidgetProps {
  defaultChain?: string;
  defaultAmount?: number;
  onSuccess?: (session: OnRampSession) => void;
  onError?: (error: Error) => void;
}

export function OnRampWidget({ 
  defaultChain = 'base',
  defaultAmount,
  onSuccess,
  onError 
}: OnRampWidgetProps) {
  const { address, chainId } = useWalletContext();
  const { startOnRamp, quote, loading, error } = useOnRamp();
  
  const [selectedChain, setSelectedChain] = useState(defaultChain);
  const [amount, setAmount] = useState(defaultAmount || 100);
  const [provider, setProvider] = useState<OnRampProvider>('coinbase');

  const handleBuy = useCallback(async () => {
    if (!address) {
      onError?.(new Error('Wallet not connected'));
      return;
    }

    try {
      const session = await startOnRamp({
        provider,
        chain: selectedChain,
        address,
        amount,
        asset: 'USDC',
      });
      onSuccess?.(session);
    } catch (err) {
      onError?.(err as Error);
    }
  }, [address, provider, selectedChain, amount, startOnRamp, onSuccess, onError]);

  return (
    <div className="onramp-widget">
      <div className="onramp-header">
        <h3>Buy USDC</h3>
        <span className="onramp-badge">Powered by {provider}</span>
      </div>

      <div className="onramp-form">
        {/* Amount Input */}
        <div className="form-group">
          <label>Amount (USD)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            min={10}
            max={10000}
          />
        </div>

        {/* Chain Selector */}
        <div className="form-group">
          <label>Receive on</label>
          <select 
            value={selectedChain}
            onChange={(e) => setSelectedChain(e.target.value)}
          >
            {Object.entries(USDC_CHAINS).map(([key, chain]) => (
              <option key={key} value={key}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>

        {/* Quote Display */}
        {quote && (
          <div className="quote-display">
            <div className="quote-row">
              <span>You receive</span>
              <span className="quote-amount">{quote.cryptoAmount.toFixed(2)} USDC</span>
            </div>
            <div className="quote-row">
              <span>Fee</span>
              <span className="quote-fee">
                {quote.fees.total === 0 ? 'FREE' : `$${quote.fees.total.toFixed(2)}`}
              </span>
            </div>
            <div className="quote-row">
              <span>Est. time</span>
              <span>{Math.round(quote.estimatedTime / 60)} min</span>
            </div>
          </div>
        )}

        {/* Provider Selector */}
        <div className="provider-selector">
          <button 
            className={provider === 'coinbase' ? 'active' : ''}
            onClick={() => setProvider('coinbase')}
          >
            <img src="/icons/coinbase.svg" alt="Coinbase" />
            <span>Coinbase</span>
            <span className="provider-fee">0% fee</span>
          </button>
          <button 
            className={provider === 'transak' ? 'active' : ''}
            onClick={() => setProvider('transak')}
          >
            <img src="/icons/transak.svg" alt="Transak" />
            <span>Transak</span>
            <span className="provider-fee">~1% fee</span>
          </button>
        </div>

        {/* Buy Button */}
        <button 
          className="onramp-buy-button"
          onClick={handleBuy}
          disabled={loading || !address}
        >
          {loading ? 'Processing...' : `Buy $${amount} USDC`}
        </button>

        {/* Destination Address */}
        <div className="destination-address">
          <span>Delivering to:</span>
          <code>{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect wallet'}</code>
        </div>
      </div>

      {error && (
        <div className="onramp-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
```

#### 3.2 Wallet Dashboard Integration

Update `WalletDashboard.tsx` to show USDC balances and on-ramp option:

```typescript
// Addition to web/src/components/wallet/WalletDashboard.tsx

// Add USDC balance card alongside existing ZEC cards
<div className="wallet-balance-card wallet-balance-card-usdc">
  <div className="wallet-balance-header">
    <span className="wallet-balance-icon">💵</span>
    <span className="wallet-balance-label">USDC Balance</span>
  </div>
  <div className="wallet-balance-value">
    {formatUsdc(usdcBalance)} <span className="wallet-balance-unit">USDC</span>
  </div>
  <div className="wallet-balance-actions">
    <button className="tiny-button" onClick={() => setShowOnRamp(true)}>
      Buy USDC
    </button>
    <button className="tiny-button" onClick={() => navigate('/wallet/send-usdc')}>
      Send
    </button>
  </div>
</div>

{/* On-ramp Modal */}
{showOnRamp && (
  <Modal onClose={() => setShowOnRamp(false)}>
    <OnRampWidget 
      onSuccess={(session) => {
        showToast(`Purchase initiated! ${session.cryptoAmount} USDC incoming.`);
        setShowOnRamp(false);
      }}
    />
  </Modal>
)}
```

### Phase 4: Balance Tracking (Week 4-5)

#### 4.1 Multi-Chain Balance Hook

```typescript
// web/src/hooks/useUsdcBalance.ts

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { USDC_CHAINS } from '../config/usdc-chains';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

interface UsdcBalance {
  chain: string;
  balance: bigint;
  formatted: string;
  usdValue: number;
}

export function useUsdcBalances(address: string | null) {
  const [balances, setBalances] = useState<UsdcBalance[]>([]);
  const [totalUsd, setTotalUsd] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!address) return;
    
    setLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        Object.entries(USDC_CHAINS).map(async ([chainKey, config]) => {
          // Skip Starknet (different RPC approach)
          if (chainKey === 'starknet') {
            return fetchStarknetUsdcBalance(address, config);
          }

          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const contract = new ethers.Contract(
            config.usdcAddress,
            ERC20_ABI,
            provider
          );

          try {
            const balance = await contract.balanceOf(address);
            const formatted = ethers.formatUnits(balance, 6);
            return {
              chain: chainKey,
              balance,
              formatted,
              usdValue: Number(formatted), // USDC ≈ $1
            };
          } catch {
            return { chain: chainKey, balance: 0n, formatted: '0', usdValue: 0 };
          }
        })
      );

      setBalances(results.filter(Boolean) as UsdcBalance[]);
      setTotalUsd(results.reduce((sum, b) => sum + (b?.usdValue || 0), 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalances();
    // Poll every 30 seconds
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return { balances, totalUsd, loading, error, refresh: fetchBalances };
}

// Starknet-specific balance fetch
async function fetchStarknetUsdcBalance(
  address: string,
  config: typeof USDC_CHAINS['starknet']
): Promise<UsdcBalance> {
  // Use Starknet.js or the existing zkpf-starknet-l2 RPC client
  // This integrates with the existing Starknet infrastructure
  try {
    const response = await fetch(`${config.rpcUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'starknet_call',
        params: [{
          contract_address: config.usdcAddress,
          entry_point_selector: '0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e', // balanceOf
          calldata: [address],
        }, 'latest'],
        id: 1,
      }),
    });
    const data = await response.json();
    // Parse u256 response (low, high)
    const balance = BigInt(data.result?.[0] || '0');
    const formatted = (Number(balance) / 1e6).toFixed(2);
    return {
      chain: 'starknet',
      balance,
      formatted,
      usdValue: Number(formatted),
    };
  } catch {
    return { chain: 'starknet', balance: 0n, formatted: '0', usdValue: 0 };
  }
}
```

### Phase 5: Backend Integration (Week 5-6)

#### 5.1 On-Ramp Session Tracking (Rust)

```rust
// zkpf-backend/src/onramp.rs

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OnRampSession {
    pub id: String,
    pub provider: String,
    pub status: OnRampStatus,
    pub fiat_amount: u64,
    pub fiat_currency: String,
    pub crypto_amount: Option<u64>,
    pub crypto_asset: String,
    pub target_chain: String,
    pub target_address: String,
    pub tx_hash: Option<String>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OnRampStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

pub struct OnRampSessionStore {
    sessions: RwLock<HashMap<String, OnRampSession>>,
}

impl OnRampSessionStore {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn create_session(&self, session: OnRampSession) -> String {
        let id = session.id.clone();
        self.sessions.write().await.insert(id.clone(), session);
        id
    }

    pub async fn get_session(&self, id: &str) -> Option<OnRampSession> {
        self.sessions.read().await.get(id).cloned()
    }

    pub async fn update_status(&self, id: &str, status: OnRampStatus, tx_hash: Option<String>) {
        if let Some(session) = self.sessions.write().await.get_mut(id) {
            session.status = status;
            session.tx_hash = tx_hash;
            if session.status == OnRampStatus::Completed {
                session.completed_at = Some(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs()
                );
            }
        }
    }
}
```

#### 5.2 API Endpoints

```rust
// Add to zkpf-backend/src/main.rs

// POST /onramp/session/start
async fn start_onramp_session(
    State(state): State<AppState>,
    Json(req): Json<StartOnRampRequest>,
) -> Result<Json<OnRampSession>, AppError> {
    let session = OnRampSession {
        id: uuid::Uuid::new_v4().to_string(),
        provider: req.provider,
        status: OnRampStatus::Pending,
        fiat_amount: req.fiat_amount,
        fiat_currency: req.fiat_currency,
        crypto_amount: None,
        crypto_asset: "USDC".to_string(),
        target_chain: req.target_chain,
        target_address: req.target_address,
        tx_hash: None,
        created_at: now_secs(),
        completed_at: None,
    };
    
    state.onramp_store.create_session(session.clone()).await;
    Ok(Json(session))
}

// GET /onramp/session/:id
async fn get_onramp_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OnRampSession>, AppError> {
    state.onramp_store
        .get_session(&id)
        .await
        .map(Json)
        .ok_or(AppError::NotFound)
}

// POST /onramp/webhook/:provider
async fn onramp_webhook(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    // Validate webhook signature based on provider
    match provider.as_str() {
        "coinbase" => validate_coinbase_webhook(&headers, &body)?,
        "transak" => validate_transak_webhook(&headers, &body)?,
        _ => return Err(AppError::BadRequest("Unknown provider".into())),
    }
    
    // Update session status
    let payload: WebhookPayload = serde_json::from_slice(&body)?;
    state.onramp_store.update_status(
        &payload.session_id,
        payload.status.into(),
        payload.tx_hash,
    ).await;
    
    Ok(StatusCode::OK)
}
```

---

## UI/UX Design

### User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     USDC On-Ramp User Flow                      │
└─────────────────────────────────────────────────────────────────┘

┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Wallet  │───▶│   Buy    │───▶│ Provider │───▶│ Confirm  │
│Dashboard │    │  USDC    │    │   KYC    │    │ Purchase │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                               │
                     ▼                               ▼
              ┌──────────┐                    ┌──────────┐
              │  Select  │                    │  USDC    │
              │  Chain   │                    │ Received │
              └──────────┘                    └──────────┘
                     │                               │
                     ▼                               ▼
              ┌──────────┐                    ┌──────────┐
              │  Select  │                    │   PoF    │
              │ Provider │                    │  Ready   │
              └──────────┘                    └──────────┘
```

### Visual Design

**On-Ramp Card Design:**

```
┌─────────────────────────────────────────────────┐
│  💵 Buy USDC                        [Coinbase] │
├─────────────────────────────────────────────────┤
│                                                 │
│  Amount                                         │
│  ┌─────────────────────────────────────────┐   │
│  │ $  100                              USD │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Receive on                                     │
│  ┌─────────────────────────────────────────┐   │
│  │ 🔵 Base                              ▼  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  You receive:         100.00 USDC       │   │
│  │  Fee:                      FREE ✨       │   │
│  │  Est. time:              ~5 minutes     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │          Buy $100 USDC →                │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Delivering to: 0x1234...5678                  │
└─────────────────────────────────────────────────┘
```

---

## Security & Compliance

### KYC/AML Delegation

The on-ramp providers (Coinbase, Transak) handle KYC/AML compliance:

| Provider | KYC Level | Requirements |
|----------|-----------|--------------|
| Coinbase | Full | ID verification, address proof |
| Transak | Tiered | Basic info for <$300, full KYC above |
| MoneyGram | Full | In-person ID verification |

### Security Measures

1. **Address Validation**: Verify destination address matches connected wallet
2. **Domain Verification**: Only allow on-ramp from verified domains
3. **Webhook Signatures**: Validate all provider webhooks
4. **Rate Limiting**: Prevent abuse of session creation endpoints
5. **Audit Logging**: Log all on-ramp sessions for compliance

```typescript
// Address validation
function validateDestinationAddress(
  address: string,
  chain: string,
  connectedAddress: string
): boolean {
  // Normalize addresses for comparison
  const normalizedDest = address.toLowerCase();
  const normalizedConnected = connectedAddress.toLowerCase();
  
  // Must match connected wallet
  if (normalizedDest !== normalizedConnected) {
    console.warn('Destination address mismatch');
    return false;
  }
  
  // Validate address format for chain
  if (chain === 'starknet') {
    return /^0x[0-9a-f]{64}$/i.test(address);
  }
  
  // EVM address validation
  return /^0x[0-9a-f]{40}$/i.test(address);
}
```

---

## Integration with zkpf Proof System

### USDC Proof-of-Funds Flow

After acquiring USDC via on-ramp, users can generate proof-of-funds:

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  USDC    │───▶│  Build   │───▶│  Verify  │───▶│  Attest  │
│ Acquired │    │   PoF    │    │  Bundle  │    │ On-chain │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Policy Configuration for USDC

Add USDC-specific policies to `config/policies.json`:

```json
{
  "policy_id": 500001,
  "threshold_raw": 1000000000,
  "required_currency_code": 2001,
  "verifier_scope_id": 800,
  "rail_id": "ONCHAIN_WALLET",
  "label": "USDC ≥ $1,000 (any chain)",
  "category": "USDC",
  "usdc_config": {
    "allowed_chains": ["ethereum", "base", "arbitrum", "optimism", "starknet"],
    "aggregate_cross_chain": true
  }
},
{
  "policy_id": 500002,
  "threshold_raw": 10000000000,
  "required_currency_code": 2001,
  "verifier_scope_id": 801,
  "rail_id": "STARKNET_L2",
  "label": "USDC ≥ $10,000 (Starknet)",
  "category": "USDC_STARKNET",
  "usdc_config": {
    "allowed_chains": ["starknet"],
    "aggregate_cross_chain": false
  }
}
```

### Currency Code Registration

```typescript
// web/src/utils/policy.ts - add USDC currency

const CURRENCY_META: Record<number, CurrencyMeta> = {
  840: { code: 'USD', label: 'United States Dollar', decimals: 2 },
  978: { code: 'EUR', label: 'Euro', decimals: 2 },
  999001: { code: 'ZEC', label: 'Zcash (Orchard)', decimals: 8 },
  5915971: { code: 'ZEC', label: 'Zashi (custodial)', decimals: 8 },
  // New USDC entry
  2001: { code: 'USDC', label: 'USD Coin', decimals: 6 },
};
```

### Starknet Rail USDC Enhancement

The existing Starknet rail already supports USDC. Enhance with dedicated helpers:

```rust
// zkpf-starknet-l2/src/lib.rs - add USDC-specific helpers

/// Build a USDC-specific proof for Starknet accounts.
pub fn prove_starknet_usdc_pof(
    snapshot: &StarknetSnapshot,
    holder_id: &HolderId,
    threshold_usdc: u64, // in 6-decimal USDC units
    meta: &PublicMetaInputs,
) -> Result<ProofBundle, StarknetRailError> {
    prove_starknet_pof(
        snapshot,
        holder_id,
        threshold_usdc,
        Some("USDC"), // Filter to USDC only
        &StarknetPublicMeta {
            chain_id: snapshot.chain_id.clone(),
            chain_id_numeric: chain_id_to_numeric(&snapshot.chain_id),
            block_number: snapshot.block_number,
            account_commitment: [0u8; 32],
            holder_binding: [0u8; 32],
        },
        meta,
    )
}
```

---

## Timeline & Milestones

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1-2 | Infrastructure | On-ramp service module, types, provider adapters skeleton |
| 2-3 | Coinbase | Full Coinbase Onramp SDK integration, testing |
| 3-4 | UI Components | OnRampWidget, WalletDashboard integration, styling |
| 4-5 | Balance Tracking | Multi-chain USDC balance hooks, Starknet integration |
| 5-6 | Backend | Session tracking, webhooks, API endpoints |
| 6-7 | PoF Integration | USDC policies, circuit testing, documentation |
| 7-8 | Testing & Polish | E2E tests, security audit, UX refinements |

### Success Metrics

| Metric | Target |
|--------|--------|
| On-ramp completion rate | >80% |
| Average purchase time | <10 min |
| USDC PoF generation success | >95% |
| Multi-chain balance accuracy | 100% |
| Provider fallback success | >90% |

---

## Next Steps

1. **Immediate**: Set up Coinbase Developer Platform account and obtain App ID
2. **Week 1**: Implement core on-ramp service module and types
3. **Week 2**: Build Coinbase adapter and test in sandbox
4. **Week 3**: Create UI components with provider selection
5. **Week 4**: Integrate with existing wallet dashboard
6. **Week 5**: Add backend session tracking and webhooks
7. **Week 6**: Wire up USDC proof-of-funds policies
8. **Week 7-8**: Testing, security review, launch

---

## Appendix: Provider API References

### Coinbase Onramp
- Documentation: https://docs.cdp.coinbase.com/onramp/docs/overview
- SDK: `@coinbase/cbpay-js`
- Sandbox: https://pay.coinbase.com/sandbox

### Transak
- Documentation: https://docs.transak.com
- SDK: `@transak/transak-sdk`
- Sandbox: https://staging-global.transak.com

### Circle USDCKit (Future)
- Documentation: https://developers.circle.com
- For direct USDC minting partnerships

---

*Document Version: 1.0*
*Last Updated: 2025-11-25*
*Author: zkpf development team*

