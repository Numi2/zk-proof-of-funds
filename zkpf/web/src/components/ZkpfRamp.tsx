/**
 * ZkpfRamp - Permissionless fiat-to-crypto on-ramp widget
 * 
 * Enables users to buy zkUSD/ZEC/STRK with credit card without KYC.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import './ZkpfRamp.css';

// Types
type CryptoAsset = 'zkUSD' | 'ZEC' | 'STRK';
type PaymentMethod = 'card' | 'apple_pay' | 'google_pay' | 'bank';
type RampStatus = 'idle' | 'quoting' | 'pending' | 'processing' | 'complete' | 'error';

interface RampQuote {
  cryptoAmount: number;
  rate: number;
  feePct: number;
  agentId: string;
  agentName: string;
  agentRating: number;
  estimatedTime: number; // seconds
}

interface RampAgent {
  id: string;
  name: string;
  rating: number;
  spreadBps: number;
  volume24h: number;
  successRate: number;
}

interface ZkpfRampProps {
  /** Wallet address to receive crypto */
  destinationAddress: string;
  /** Default asset to buy */
  defaultAsset?: CryptoAsset;
  /** Callback when purchase completes */
  onSuccess?: (txHash: string, amount: string, asset: CryptoAsset) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Custom class name */
  className?: string;
}

// Asset metadata
const ASSET_META: Record<CryptoAsset, { icon: string; name: string; color: string }> = {
  zkUSD: { icon: '💵', name: 'zkUSD', color: '#22c55e' },
  ZEC: { icon: '🛡️', name: 'Zcash', color: '#f4b728' },
  STRK: { icon: '⚡', name: 'Starknet', color: '#ec796b' },
};

// Mock API calls (replace with real implementation)
async function fetchQuote(
  fiatAmount: number,
  asset: CryptoAsset
): Promise<RampQuote> {
  // Simulate API delay
  await new Promise(r => setTimeout(r, 500));
  
  // Mock quote
  const rates: Record<CryptoAsset, number> = {
    zkUSD: 1.0,
    ZEC: 35.0, // $35 per ZEC
    STRK: 1.2,  // $1.20 per STRK
  };
  
  const feePct = 1.5; // 1.5% fee
  const rate = rates[asset];
  const netAmount = fiatAmount * (1 - feePct / 100);
  const cryptoAmount = netAmount / rate;
  
  return {
    cryptoAmount,
    rate,
    feePct,
    agentId: 'agent-001',
    agentName: 'ZkRamp Agent #1',
    agentRating: 4.8,
    estimatedTime: 300, // 5 minutes
  };
}

async function createRampIntent(params: {
  fiatAmount: number;
  asset: CryptoAsset;
  address: string;
  paymentMethod: PaymentMethod;
}): Promise<{ intentId: string; paymentUrl: string }> {
  await new Promise(r => setTimeout(r, 800));
  
  // In production, this would:
  // 1. Call the RampEscrow contract to create intent
  // 2. Get payment URL from the matched agent
  return {
    intentId: `intent-${Date.now()}`,
    paymentUrl: `https://pay.zkpf.dev/checkout/${Date.now()}`,
  };
}

export function ZkpfRamp({
  destinationAddress,
  defaultAsset = 'zkUSD',
  onSuccess,
  onError,
  className,
}: ZkpfRampProps) {
  // State
  const [amount, setAmount] = useState('100');
  const [asset, setAsset] = useState<CryptoAsset>(defaultAsset);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [status, setStatus] = useState<RampStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);

  // Parse amount
  const fiatAmount = useMemo(() => {
    const parsed = parseFloat(amount.replace(/[^0-9.]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }, [amount]);

  // Fetch quote when amount/asset changes
  useEffect(() => {
    if (fiatAmount < 10) {
      setQuote(null);
      return;
    }

    const controller = new AbortController();
    setStatus('quoting');
    
    fetchQuote(fiatAmount, asset)
      .then(q => {
        if (!controller.signal.aborted) {
          setQuote(q);
          setStatus('idle');
        }
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setStatus('error');
        }
      });

    return () => controller.abort();
  }, [fiatAmount, asset]);

  // Handle buy
  const handleBuy = useCallback(async () => {
    if (!destinationAddress) {
      setError('Please connect your wallet');
      return;
    }

    if (fiatAmount < 10) {
      setError('Minimum purchase is $10');
      return;
    }

    setStatus('pending');
    setError(null);

    try {
      const { intentId, paymentUrl } = await createRampIntent({
        fiatAmount,
        asset,
        address: destinationAddress,
        paymentMethod,
      });

      setIntentId(intentId);

      // Open payment window
      const paymentWindow = window.open(
        paymentUrl,
        'zkpf-ramp-payment',
        'width=450,height=650,left=100,top=100'
      );

      // Poll for completion (in production, use webhooks)
      setStatus('processing');
      
      // Simulate completion after 3 seconds
      setTimeout(() => {
        setStatus('complete');
        onSuccess?.(`0x${Math.random().toString(16).slice(2)}`, String(quote?.cryptoAmount || 0), asset);
      }, 3000);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [destinationAddress, fiatAmount, asset, paymentMethod, quote, onSuccess, onError]);

  // Format helpers
  const formatCrypto = (value: number, decimals = 4) => 
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    return `~${Math.round(seconds / 60)} min`;
  };

  return (
    <div className={`zkpf-ramp ${className || ''}`}>
      {/* Header */}
      <div className="ramp-header">
        <div className="ramp-title">
          <h2>Buy Crypto</h2>
          <span className="ramp-badge permissionless">Permissionless</span>
        </div>
        <div className="ramp-subtitle">
          No KYC • Self-custody • Privacy-first
        </div>
      </div>

      {/* Amount Input */}
      <div className="ramp-section">
        <label className="ramp-label">You pay</label>
        <div className="ramp-input-container">
          <span className="ramp-input-prefix">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100"
            className="ramp-input"
            disabled={status === 'processing'}
          />
          <span className="ramp-input-suffix">USD</span>
        </div>
        <div className="ramp-quick-amounts">
          {[50, 100, 250, 500, 1000].map(val => (
            <button
              key={val}
              type="button"
              className={`quick-amount ${fiatAmount === val ? 'active' : ''}`}
              onClick={() => setAmount(String(val))}
              disabled={status === 'processing'}
            >
              ${val}
            </button>
          ))}
        </div>
      </div>

      {/* Asset Selection */}
      <div className="ramp-section">
        <label className="ramp-label">You receive</label>
        <div className="ramp-asset-grid">
          {(Object.keys(ASSET_META) as CryptoAsset[]).map(a => (
            <button
              key={a}
              type="button"
              className={`ramp-asset-option ${asset === a ? 'active' : ''}`}
              onClick={() => setAsset(a)}
              disabled={status === 'processing'}
              style={{ '--asset-color': ASSET_META[a].color } as React.CSSProperties}
            >
              <span className="asset-icon">{ASSET_META[a].icon}</span>
              <span className="asset-name">{ASSET_META[a].name}</span>
              {a === 'zkUSD' && <span className="asset-tag">Stablecoin</span>}
              {a === 'ZEC' && <span className="asset-tag">Private</span>}
              {a === 'STRK' && <span className="asset-tag">L2</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Quote Display */}
      {status === 'quoting' && (
        <div className="ramp-quote loading">
          <div className="quote-spinner" />
          <span>Getting best rate...</span>
        </div>
      )}

      {quote && status !== 'quoting' && (
        <div className="ramp-quote">
          <div className="quote-main">
            <span className="quote-label">You receive</span>
            <span className="quote-value">
              {formatCrypto(quote.cryptoAmount)} {asset}
            </span>
          </div>
          <div className="quote-details">
            <div className="quote-row">
              <span>Rate</span>
              <span>1 {asset} = ${quote.rate.toFixed(2)}</span>
            </div>
            <div className="quote-row">
              <span>Fee</span>
              <span className={quote.feePct === 0 ? 'quote-free' : ''}>
                {quote.feePct === 0 ? 'FREE ✨' : `${quote.feePct}%`}
              </span>
            </div>
            <div className="quote-row">
              <span>Est. time</span>
              <span>{formatTime(quote.estimatedTime)}</span>
            </div>
            <div className="quote-row quote-agent">
              <span>Via</span>
              <span>
                {quote.agentName}
                <span className="agent-rating">⭐ {quote.agentRating}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Payment Methods */}
      <div className="ramp-section">
        <label className="ramp-label">Pay with</label>
        <div className="ramp-payment-methods">
          <button
            type="button"
            className={`payment-method ${paymentMethod === 'card' ? 'active' : ''}`}
            onClick={() => setPaymentMethod('card')}
            disabled={status === 'processing'}
          >
            <span className="payment-icon">💳</span>
            <span>Card</span>
          </button>
          <button
            type="button"
            className={`payment-method ${paymentMethod === 'apple_pay' ? 'active' : ''}`}
            onClick={() => setPaymentMethod('apple_pay')}
            disabled={status === 'processing'}
          >
            <span className="payment-icon"></span>
            <span>Pay</span>
          </button>
          <button
            type="button"
            className={`payment-method ${paymentMethod === 'bank' ? 'active' : ''}`}
            onClick={() => setPaymentMethod('bank')}
            disabled={status === 'processing'}
          >
            <span className="payment-icon">🏦</span>
            <span>Bank</span>
          </button>
        </div>
      </div>

      {/* Buy Button */}
      <button
        type="button"
        className={`ramp-buy-button ${status}`}
        onClick={handleBuy}
        disabled={
          !quote ||
          status === 'processing' ||
          status === 'pending' ||
          fiatAmount < 10
        }
      >
        {status === 'idle' && `Buy ${asset}`}
        {status === 'quoting' && 'Getting quote...'}
        {status === 'pending' && 'Opening payment...'}
        {status === 'processing' && (
          <>
            <span className="button-spinner" />
            Processing...
          </>
        )}
        {status === 'complete' && '✓ Complete!'}
        {status === 'error' && 'Try again'}
      </button>

      {/* Destination Address */}
      <div className="ramp-destination">
        <span className="destination-label">Delivering to:</span>
        <span className="destination-address">
          {destinationAddress 
            ? `${destinationAddress.slice(0, 8)}...${destinationAddress.slice(-6)}`
            : 'Connect wallet'
          }
        </span>
      </div>

      {/* Status Messages */}
      {status === 'processing' && (
        <div className="ramp-status processing">
          <div className="status-icon">⏳</div>
          <div className="status-text">
            <strong>Processing payment...</strong>
            <span>Your {asset} will arrive in ~5 minutes</span>
          </div>
        </div>
      )}

      {status === 'complete' && (
        <div className="ramp-status complete">
          <div className="status-icon">✅</div>
          <div className="status-text">
            <strong>Purchase complete!</strong>
            <span>{formatCrypto(quote?.cryptoAmount || 0)} {asset} on the way</span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="ramp-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button 
            type="button" 
            className="error-dismiss"
            onClick={() => { setError(null); setStatus('idle'); }}
          >
            ×
          </button>
        </div>
      )}

      {/* Trust Indicators */}
      <div className="ramp-trust">
        <div className="trust-item">
          <span className="trust-icon">🔒</span>
          <span>Non-custodial</span>
        </div>
        <div className="trust-item">
          <span className="trust-icon">👤</span>
          <span>No KYC</span>
        </div>
        <div className="trust-item">
          <span className="trust-icon">🌐</span>
          <span>Decentralized</span>
        </div>
      </div>
    </div>
  );
}

export default ZkpfRamp;

