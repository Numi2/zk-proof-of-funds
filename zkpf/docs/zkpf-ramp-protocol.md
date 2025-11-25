# zkpf Ramp Protocol

> **A permissionless, decentralized fiat-to-crypto on-ramp for the zkpf ecosystem**

## The Problem

Existing on-ramps (Coinbase, MoonPay, Transak) create friction:
- **KYC walls**: Users must verify identity before buying
- **Geographic restrictions**: Many countries blocked
- **Custody risk**: Funds pass through centralized entities
- **High fees**: 2-5% on most platforms
- **Privacy loss**: All purchases linked to identity

**Goal**: Enable anyone with a credit card to permissionlessly acquire crypto (ZEC, STRK, or a zkpf-native stablecoin) with minimal friction.

---

## Solution: zkpf Ramp Protocol

A **decentralized liquidity protocol** with three participant types:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        zkpf Ramp Protocol                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐          │
│   │   BUYERS    │ ──────▶ │   RAMP      │ ──────▶ │  LIQUIDITY  │          │
│   │  (Users)    │   Fiat  │   AGENTS    │  Crypto │  PROVIDERS  │          │
│   └─────────────┘         └─────────────┘         └─────────────┘          │
│         │                       │                       │                   │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│   ┌─────────────────────────────────────────────────────────────────┐      │
│   │                    RAMP SMART CONTRACT                          │      │
│   │  • Escrow stablecoins from LPs                                  │      │
│   │  • Lock/release based on payment proofs                         │      │
│   │  • Slash malicious agents                                       │      │
│   │  • Reward honest participants                                   │      │
│   └─────────────────────────────────────────────────────────────────┘      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Participant Roles

| Role | Description | Incentive |
|------|-------------|-----------|
| **Buyer** | End user wanting to convert fiat → crypto | Gets crypto without KYC |
| **Liquidity Provider (LP)** | Stakes stablecoins in the protocol | Earns yield from fees |
| **Ramp Agent** | Business/individual with payment processing | Earns spread on transactions |

---

## Protocol Design

### 1. zkUSD - Native Stablecoin

Instead of relying on USDC, we mint a **zkpf-native stablecoin** backed by the protocol's liquidity:

```
zkUSD Properties:
├── 1:1 backed by USDC/DAI in protocol reserves
├── Privacy-preserving transfers (Zcash-style shielded)
├── Instantly redeemable for underlying collateral
├── Seamlessly convertible to ZEC/STRK via DEX integration
└── Proof-of-reserves verifiable via zkpf circuit
```

**Why a native stablecoin?**
- Full control over minting/burning mechanics
- Can implement privacy features
- No dependency on Circle/Tether
- Protocol captures value instead of external stablecoin issuers

### 2. Ramp Agent Network

**Ramp Agents** are the bridge between fiat and crypto. Anyone can become one by:

1. Staking collateral (prevents fraud)
2. Setting up payment processing (Stripe, Square, PayPal, etc.)
3. Registering their rates and supported payment methods

```typescript
interface RampAgent {
  // Identity
  agentId: bytes32;              // Pseudonymous identifier
  stakingAddress: address;       // Where collateral is locked
  
  // Capabilities
  supportedFiatCurrencies: string[];  // ['USD', 'EUR', 'GBP']
  supportedPaymentMethods: string[];  // ['card', 'bank', 'apple_pay']
  supportedCryptoOut: string[];       // ['zkUSD', 'ZEC', 'STRK']
  
  // Economics
  spreadBps: number;             // Fee in basis points (e.g., 100 = 1%)
  minAmount: number;             // Minimum fiat amount
  maxAmount: number;             // Maximum per transaction
  dailyLimit: number;            // Volume cap
  
  // Reputation
  totalVolume: bigint;           // Lifetime volume processed
  successRate: number;           // % of successful transactions
  averageSettleTime: number;     // Seconds to complete
  slashingEvents: number;        // Times penalized
}
```

### 3. Transaction Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         RAMP TRANSACTION FLOW                            │
└──────────────────────────────────────────────────────────────────────────┘

Step 1: INTENT
┌─────────┐                      ┌──────────────┐
│  Buyer  │ ─── "Buy $100 of ──▶ │   Protocol   │
│         │      zkUSD/ZEC"      │   Frontend   │
└─────────┘                      └──────────────┘
                                        │
Step 2: MATCHING                        ▼
                                 ┌──────────────┐
                                 │  Find best   │
                                 │  Ramp Agent  │
                                 │  (by rate,   │
                                 │   reputation)│
                                 └──────────────┘
                                        │
Step 3: ESCROW                          ▼
┌──────────────┐                 ┌──────────────┐
│  Ramp Agent  │ ◀── "Lock $100 ─│   Escrow     │
│  Liquidity   │     of zkUSD"   │   Contract   │
└──────────────┘                 └──────────────┘
                                        │
Step 4: PAYMENT                         ▼
┌─────────┐                      ┌──────────────┐
│  Buyer  │ ─── Credit card ───▶ │  Ramp Agent  │
│         │     payment ($100)   │   (Stripe)   │
└─────────┘                      └──────────────┘
                                        │
Step 5: CONFIRMATION                    ▼
┌──────────────┐                 ┌──────────────┐
│  Ramp Agent  │ ─── Payment ───▶│   Escrow     │
│              │     proof       │   Contract   │
└──────────────┘                 └──────────────┘
                                        │
Step 6: RELEASE                         ▼
┌─────────┐                      ┌──────────────┐
│  Buyer  │ ◀── zkUSD/ZEC ──────│   Protocol   │
│  Wallet │     delivered        │              │
└─────────┘                      └──────────────┘
```

### 4. Payment Proof Oracle

The key innovation: **How do we verify fiat payment on-chain?**

#### Option A: Agent Attestation (Simple)
```
Agent signs: "Payment of $X received from payment_id Y"
↓
Submit to contract with agent's stake at risk
↓
Dispute period (1 hour)
↓
Funds released or agent slashed
```

#### Option B: Payment Processor Webhook Verification
```
Stripe webhook → Agent backend → Sign with TEE/MPC → Submit proof
```

#### Option C: zkTLS Payment Proofs (Advanced)
```
User's browser → TLS connection to Stripe → zkProof of payment receipt
↓
Proof verifiable on-chain without revealing payment details
```

### 5. Fraud Prevention

| Threat | Mitigation |
|--------|------------|
| Agent takes payment, doesn't release crypto | Stake slashing + buyer compensation from insurance pool |
| Buyer disputes legitimate payment | Agent provides payment processor evidence |
| Agent front-runs favorable trades | Commit-reveal scheme for intents |
| Sybil agents | Minimum stake requirement + reputation bootstrapping |
| Chargebacks | Agents set chargeback buffer period (7-30 days) |

### 6. Economics

```
Fee Structure:
├── Buyer pays: Agent spread (0.5-2%) + Protocol fee (0.1%)
├── LP earns: Share of protocol fees (proportional to liquidity)
├── Agent earns: Spread minus payment processor fees (~1.5%)
└── Protocol treasury: 0.1% of all volume

Example $100 purchase:
├── Buyer pays: $100
├── Agent receives: $100 (minus ~$2.90 Stripe fees)
├── Agent spread: 1.5% = $1.50
├── Protocol fee: 0.1% = $0.10
├── Agent profit: $1.50 - $0.10 = $1.40
├── Buyer receives: $98.40 worth of zkUSD
└── LP yield source: $0.10 goes to protocol reserves
```

---

## Smart Contract Architecture

### Core Contracts

```solidity
// RampEscrow.sol - Main escrow and settlement logic
contract RampEscrow {
    // Liquidity pools per asset
    mapping(address => LiquidityPool) public pools;
    
    // Active ramp intents
    mapping(bytes32 => RampIntent) public intents;
    
    // Agent registry
    mapping(address => RampAgent) public agents;
    
    // Create a ramp intent (buyer calls)
    function createIntent(
        address cryptoOut,
        uint256 fiatAmount,
        string calldata fiatCurrency,
        address preferredAgent
    ) external returns (bytes32 intentId);
    
    // Agent accepts and locks liquidity
    function acceptIntent(
        bytes32 intentId,
        uint256 cryptoAmount
    ) external;
    
    // Agent confirms payment received
    function confirmPayment(
        bytes32 intentId,
        bytes calldata paymentProof
    ) external;
    
    // Release crypto to buyer after confirmation
    function release(bytes32 intentId) external;
    
    // Dispute mechanism
    function dispute(bytes32 intentId, bytes calldata evidence) external;
}

// zkUSD.sol - Native stablecoin
contract zkUSD is ERC20 {
    // Backed 1:1 by reserves
    IERC20 public immutable reserveAsset; // USDC
    
    function mint(uint256 amount) external {
        reserveAsset.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }
    
    function redeem(uint256 amount) external {
        _burn(msg.sender, amount);
        reserveAsset.transfer(msg.sender, amount);
    }
    
    // Proof of reserves for zkpf circuit
    function getReserveProof() external view returns (bytes memory);
}

// AgentRegistry.sol - Agent staking and reputation
contract AgentRegistry {
    uint256 public constant MIN_STAKE = 10_000e6; // $10k USDC
    
    function registerAgent(
        string[] calldata supportedCurrencies,
        string[] calldata paymentMethods,
        uint16 spreadBps
    ) external payable;
    
    function slash(address agent, uint256 amount, bytes32 intentId) external;
    
    function updateReputation(address agent, bool success) external;
}
```

### Starknet Contracts (Cairo)

```cairo
// ramp_escrow.cairo
#[starknet::contract]
mod RampEscrow {
    use starknet::ContractAddress;
    
    #[storage]
    struct Storage {
        intents: LegacyMap<felt252, RampIntent>,
        agents: LegacyMap<ContractAddress, AgentInfo>,
        liquidity_pools: LegacyMap<ContractAddress, u256>,
    }
    
    #[derive(Drop, Serde, starknet::Store)]
    struct RampIntent {
        buyer: ContractAddress,
        agent: ContractAddress,
        crypto_out: ContractAddress,
        fiat_amount: u256,
        crypto_amount: u256,
        status: u8, // 0=pending, 1=locked, 2=confirmed, 3=released, 4=disputed
        created_at: u64,
    }
    
    #[external(v0)]
    fn create_intent(
        ref self: ContractState,
        crypto_out: ContractAddress,
        fiat_amount: u256,
    ) -> felt252 {
        // Implementation
    }
    
    #[external(v0)]
    fn confirm_and_release(
        ref self: ContractState,
        intent_id: felt252,
        payment_proof: Array<felt252>,
    ) {
        // Verify payment proof
        // Release crypto to buyer
    }
}
```

---

## Frontend Integration

### Ramp Widget Component

```typescript
// web/src/components/ZkpfRamp.tsx

import { useState, useCallback } from 'react';
import { useRampProtocol } from '../hooks/useRampProtocol';

interface ZkpfRampProps {
  defaultAsset?: 'zkUSD' | 'ZEC' | 'STRK';
  onSuccess?: (txHash: string, amount: string) => void;
}

export function ZkpfRamp({ defaultAsset = 'zkUSD', onSuccess }: ZkpfRampProps) {
  const [amount, setAmount] = useState('100');
  const [asset, setAsset] = useState(defaultAsset);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'apple_pay'>('card');
  
  const {
    createIntent,
    bestAgent,
    quote,
    status,
    paymentUrl,
    loading,
    error,
  } = useRampProtocol();

  const handleBuy = useCallback(async () => {
    const intent = await createIntent({
      fiatAmount: parseFloat(amount),
      fiatCurrency: 'USD',
      cryptoOut: asset,
      paymentMethod,
    });
    
    // Open payment in iframe/popup
    if (intent.paymentUrl) {
      window.open(intent.paymentUrl, 'payment', 'width=450,height=600');
    }
  }, [amount, asset, paymentMethod, createIntent]);

  return (
    <div className="zkpf-ramp">
      <div className="ramp-header">
        <h2>Buy Crypto</h2>
        <span className="ramp-badge">Permissionless</span>
      </div>

      {/* Amount Input */}
      <div className="ramp-input-group">
        <label>You pay</label>
        <div className="ramp-input">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="10"
            max="5000"
          />
          <span className="currency">USD</span>
        </div>
      </div>

      {/* Asset Selection */}
      <div className="ramp-asset-selector">
        <label>You receive</label>
        <div className="asset-options">
          <button 
            className={asset === 'zkUSD' ? 'active' : ''}
            onClick={() => setAsset('zkUSD')}
          >
            <span className="asset-icon">💵</span>
            <span>zkUSD</span>
          </button>
          <button 
            className={asset === 'ZEC' ? 'active' : ''}
            onClick={() => setAsset('ZEC')}
          >
            <span className="asset-icon">🛡️</span>
            <span>ZEC</span>
          </button>
          <button 
            className={asset === 'STRK' ? 'active' : ''}
            onClick={() => setAsset('STRK')}
          >
            <span className="asset-icon">⚡</span>
            <span>STRK</span>
          </button>
        </div>
      </div>

      {/* Quote Display */}
      {quote && (
        <div className="ramp-quote">
          <div className="quote-row">
            <span>You receive</span>
            <span className="quote-amount">{quote.cryptoAmount} {asset}</span>
          </div>
          <div className="quote-row">
            <span>Rate</span>
            <span>1 {asset} = ${quote.rate.toFixed(4)}</span>
          </div>
          <div className="quote-row">
            <span>Fee</span>
            <span>{quote.feePct.toFixed(2)}%</span>
          </div>
          <div className="quote-row agent">
            <span>Via</span>
            <span>
              {bestAgent?.name || 'Best available agent'}
              <span className="agent-rating">⭐ {bestAgent?.rating || 'N/A'}</span>
            </span>
          </div>
        </div>
      )}

      {/* Payment Method */}
      <div className="payment-methods">
        <button 
          className={paymentMethod === 'card' ? 'active' : ''}
          onClick={() => setPaymentMethod('card')}
        >
          💳 Card
        </button>
        <button 
          className={paymentMethod === 'apple_pay' ? 'active' : ''}
          onClick={() => setPaymentMethod('apple_pay')}
        >
           Pay
        </button>
      </div>

      {/* Buy Button */}
      <button 
        className="ramp-buy-button"
        onClick={handleBuy}
        disabled={loading || !quote}
      >
        {loading ? 'Processing...' : `Buy ${asset}`}
      </button>

      {/* Status */}
      {status && (
        <div className={`ramp-status status-${status.type}`}>
          {status.type === 'pending' && '⏳ Waiting for payment...'}
          {status.type === 'confirming' && '🔄 Confirming payment...'}
          {status.type === 'releasing' && '📤 Releasing crypto...'}
          {status.type === 'complete' && '✅ Complete!'}
          {status.type === 'error' && `❌ ${status.message}`}
        </div>
      )}

      {/* No KYC Notice */}
      <p className="ramp-notice">
        🔒 No account required • No KYC • Self-custody
      </p>

      {error && (
        <div className="ramp-error">{error}</div>
      )}
    </div>
  );
}
```

### Ramp Protocol Hook

```typescript
// web/src/hooks/useRampProtocol.ts

import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';

interface RampQuote {
  cryptoAmount: number;
  rate: number;
  feePct: number;
  agentId: string;
  validUntil: number;
}

interface RampIntent {
  intentId: string;
  paymentUrl: string;
  expiresAt: number;
}

interface RampAgent {
  id: string;
  name: string;
  rating: number;
  spreadBps: number;
  availableLiquidity: bigint;
}

interface RampStatus {
  type: 'pending' | 'confirming' | 'releasing' | 'complete' | 'error';
  message?: string;
  txHash?: string;
}

export function useRampProtocol() {
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [bestAgent, setBestAgent] = useState<RampAgent | null>(null);
  const [status, setStatus] = useState<RampStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch best agent and quote
  const getQuote = useCallback(async (params: {
    fiatAmount: number;
    fiatCurrency: string;
    cryptoOut: string;
  }) => {
    setLoading(true);
    setError(null);

    try {
      // Call protocol API to get best agent and quote
      const response = await fetch('/api/ramp/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await response.json();
      
      setQuote({
        cryptoAmount: data.cryptoAmount,
        rate: data.rate,
        feePct: data.feePct,
        agentId: data.agent.id,
        validUntil: data.validUntil,
      });

      setBestAgent(data.agent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get quote');
    } finally {
      setLoading(false);
    }
  }, []);

  // Create ramp intent
  const createIntent = useCallback(async (params: {
    fiatAmount: number;
    fiatCurrency: string;
    cryptoOut: string;
    paymentMethod: 'card' | 'apple_pay';
  }): Promise<RampIntent> => {
    setLoading(true);
    setError(null);
    setStatus({ type: 'pending' });

    try {
      // 1. Create intent on-chain (or via backend that submits tx)
      const response = await fetch('/api/ramp/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          agentId: bestAgent?.id,
        }),
      });

      const intent = await response.json();

      // 2. Start polling for status
      pollIntentStatus(intent.intentId);

      return intent;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create intent');
      setStatus({ type: 'error', message: 'Failed to create intent' });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [bestAgent]);

  // Poll intent status
  const pollIntentStatus = useCallback(async (intentId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`/api/ramp/intent/${intentId}/status`);
        const data = await response.json();

        switch (data.status) {
          case 'pending':
            setStatus({ type: 'pending' });
            break;
          case 'payment_received':
            setStatus({ type: 'confirming' });
            break;
          case 'releasing':
            setStatus({ type: 'releasing' });
            break;
          case 'complete':
            setStatus({ type: 'complete', txHash: data.txHash });
            return; // Stop polling
          case 'failed':
            setStatus({ type: 'error', message: data.error });
            return; // Stop polling
        }

        // Continue polling
        setTimeout(poll, 3000);
      } catch (err) {
        console.error('Poll error:', err);
        setTimeout(poll, 5000);
      }
    };

    poll();
  }, []);

  return {
    quote,
    bestAgent,
    status,
    loading,
    error,
    getQuote,
    createIntent,
  };
}
```

---

## DEX Integration for ZEC/STRK

Once users have zkUSD, they can swap to ZEC or STRK:

```typescript
// Automated swap flow
async function buyZecWithCard(fiatAmount: number, destinationAddress: string) {
  // 1. Buy zkUSD via Ramp Protocol
  const zkUsdAmount = await rampProtocol.buy({
    fiatAmount,
    fiatCurrency: 'USD',
    cryptoOut: 'zkUSD',
  });

  // 2. Swap zkUSD → ZEC via DEX aggregator
  const zecAmount = await dexAggregator.swap({
    fromToken: 'zkUSD',
    toToken: 'ZEC',
    amount: zkUsdAmount,
    recipient: destinationAddress,
    slippage: 0.5, // 0.5%
  });

  return zecAmount;
}
```

### DEX Options

| Chain | DEX | Pairs |
|-------|-----|-------|
| Ethereum | Uniswap V3 | zkUSD/WETH → Bridge to ZEC |
| Starknet | JediSwap, 10kSwap | zkUSD/STRK |
| Zcash | Atomic swap via HTLC | Direct zkUSD → ZEC |

---

## Becoming a Ramp Agent

### Requirements

1. **Stake $10,000+ in USDC/zkUSD** - Collateral against fraud
2. **Payment processor account** - Stripe, Square, or similar
3. **Run agent software** - Open-source node that handles payments

### Agent Setup Flow

```bash
# 1. Clone agent software
git clone https://github.com/zkpf/ramp-agent

# 2. Configure
cat > .env << EOF
AGENT_PRIVATE_KEY=0x...
PAYMENT_PROCESSOR=stripe
STRIPE_SECRET_KEY=sk_live_...
SUPPORTED_CURRENCIES=USD,EUR
SPREAD_BPS=150  # 1.5%
MIN_AMOUNT=10
MAX_AMOUNT=5000
EOF

# 3. Stake collateral
npx ramp-agent stake --amount 10000

# 4. Register on-chain
npx ramp-agent register

# 5. Start processing
npx ramp-agent start
```

### Agent Economics

| Monthly Volume | Revenue (1.5% spread) | Stripe Fees (~2.9%) | Net Profit |
|----------------|----------------------|---------------------|------------|
| $10,000 | $150 | -$290 | -$140 ❌ |
| $50,000 | $750 | -$1,450 | -$700 ❌ |
| $100,000 | $1,500 | -$2,900 | -$1,400 ❌ |
| $500,000 | $7,500 | -$14,500 | -$7,000 ❌ |

**Problem**: Credit card fees eat all margin!

### Solution: Alternative Payment Rails

| Method | Fees | Agent Profit @ 1.5% spread |
|--------|------|---------------------------|
| ACH/Bank transfer | 0.5% | ~1% ✅ |
| Apple Pay (debit) | 0.15% | ~1.35% ✅ |
| PIX (Brazil) | 0% | 1.5% ✅ |
| UPI (India) | 0% | 1.5% ✅ |
| iDEAL (Netherlands) | €0.29 flat | ~1.4% ✅ |
| SEPA Instant | €0.20 flat | ~1.4% ✅ |

**Strategy**: Focus on low-fee payment methods. Credit cards are viable only at higher spreads (3-5%).

---

## Privacy Features

### 1. Shielded zkUSD Deposits

```
Buyer receives zkUSD → Immediately shield into zkUSD Sapling pool
                     → Balance visible only to holder
                     → Swaps to ZEC remain private
```

### 2. Zero-Knowledge Intent Matching

```
Buyer intent: "I want to buy ~$100 of crypto"
↓
ZK proof that intent is valid without revealing exact amount
↓
Agents bid on a range, not exact amount
↓
Settlement reveals only necessary details
```

### 3. Anonymous Agent Selection

Use **Private Information Retrieval (PIR)** so agents don't know which buyer selected them until commitment.

---

## Implementation Roadmap

### Phase 1: MVP (4 weeks)
- [ ] zkUSD smart contract (EVM)
- [ ] Basic RampEscrow contract
- [ ] Single trusted agent (us)
- [ ] Stripe integration
- [ ] Simple frontend widget

### Phase 2: Decentralization (4 weeks)
- [ ] Agent registry and staking
- [ ] Multi-agent matching
- [ ] Reputation system
- [ ] Dispute resolution

### Phase 3: Multi-Chain (4 weeks)
- [ ] Starknet deployment (Cairo contracts)
- [ ] Cross-chain zkUSD bridging
- [ ] DEX integrations (JediSwap, Uniswap)
- [ ] Direct ZEC/STRK purchases

### Phase 4: Privacy (4 weeks)
- [ ] Shielded zkUSD pool
- [ ] zkTLS payment proofs
- [ ] Anonymous agent selection

---

## Comparison with Existing Solutions

| Feature | Coinbase | MoonPay | zkpf Ramp |
|---------|----------|---------|-----------|
| KYC Required | Yes | Yes | **No** |
| Permissionless | No | No | **Yes** |
| Self-custody | No | No | **Yes** |
| Privacy | None | None | **High** |
| Geographic coverage | Limited | Limited | **Global** |
| Fees | 0-2% | 3-5% | **1-2%** |
| Decentralized | No | No | **Yes** |
| Supports ZEC | Yes | Yes | **Yes** |
| Supports STRK | No | Yes | **Yes** |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Regulatory pressure on agents | Agents operate independently; protocol is just infrastructure |
| Chargebacks | Agents hold funds for 7-30 days; chargeback insurance pool |
| Agent collusion | Reputation system + random assignment for small amounts |
| Smart contract bugs | Audits + formal verification + gradual rollout |
| Low agent adoption | Bootstrap with our own agents; attractive economics |
| Payment processor bans | Multiple processors; local payment methods |

---

## Conclusion

The **zkpf Ramp Protocol** provides:

1. **Permissionless access** - Anyone can buy crypto with just a card
2. **No KYC** - Privacy preserved, no identity requirements
3. **Self-custody** - Funds go directly to user's wallet
4. **Decentralized** - No single point of failure or control
5. **Multi-asset** - zkUSD, ZEC, STRK all supported
6. **Competitive fees** - 1-2% via efficient payment rails

This transforms zkpf from a proof-of-funds protocol into a **full-stack privacy-preserving financial infrastructure**.

---

*Document Version: 1.0*
*Last Updated: 2025-11-25*

