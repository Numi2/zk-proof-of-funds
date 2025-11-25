/**
 * ZkpfRamp - Permissionless fiat-to-crypto on-ramp widget
 * 
 * Enables users to buy zkUSD/ZEC/STRK with credit card without KYC.
 * Integrates with the RampEscrow smart contract for decentralized settlement.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  expiresAt: number;
}

interface RampIntent {
  intentId: string;
  status: 'pending' | 'locked' | 'payment_sent' | 'confirmed' | 'released' | 'disputed' | 'cancelled' | 'expired';
  cryptoAmount: number;
  fiatAmountCents: number;
  agentId: string;
  txHash?: string;
  createdAt: number;
  expiresAt: number;
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
  /** API base URL for ramp protocol */
  apiBaseUrl?: string;
}

// Asset metadata
const ASSET_META: Record<CryptoAsset, { icon: string; name: string; color: string; tokenAddress?: string }> = {
  zkUSD: { icon: '💵', name: 'zkUSD', color: '#22c55e', tokenAddress: undefined },
  ZEC: { icon: '🛡️', name: 'Zcash', color: '#f4b728' },
  STRK: { icon: '⚡', name: 'Starknet', color: '#ec796b' },
};

// Default API base URL
const DEFAULT_API_BASE = import.meta.env.VITE_RAMP_API_BASE || '/api/ramp';

/**
 * Fetch quote from the ramp protocol API.
 */
async function fetchQuoteFromApi(
  apiBase: string,
  fiatAmount: number,
  asset: CryptoAsset,
  abortSignal?: AbortSignal
): Promise<RampQuote> {
  const response = await fetch(`${apiBase}/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fiatAmountCents: Math.round(fiatAmount * 100),
      fiatCurrency: 'USD',
      cryptoAsset: asset,
    }),
    signal: abortSignal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Quote request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  
  return {
    cryptoAmount: data.cryptoAmount,
    rate: data.rate,
    feePct: data.feePct,
    agentId: data.agent.id,
    agentName: data.agent.name,
    agentRating: data.agent.rating,
    estimatedTime: data.estimatedTimeSeconds || 300,
    expiresAt: data.expiresAt,
  };
}

/**
 * Create a ramp intent via the protocol API.
 */
async function createRampIntentApi(
  apiBase: string,
  params: {
    fiatAmount: number;
    asset: CryptoAsset;
    address: string;
    paymentMethod: PaymentMethod;
    agentId?: string;
  }
): Promise<{ intentId: string; paymentUrl: string; intent: RampIntent }> {
  const response = await fetch(`${apiBase}/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fiatAmountCents: Math.round(params.fiatAmount * 100),
      fiatCurrency: 'USD',
      cryptoAsset: params.asset,
      destinationAddress: params.address,
      paymentMethod: params.paymentMethod,
      preferredAgentId: params.agentId,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Intent creation failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Poll for intent status updates.
 */
async function pollIntentStatus(
  apiBase: string,
  intentId: string,
  abortSignal?: AbortSignal
): Promise<RampIntent> {
  const response = await fetch(`${apiBase}/intent/${intentId}/status`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    signal: abortSignal,
  });

  if (!response.ok) {
    throw new Error(`Status poll failed: HTTP ${response.status}`);
  }

  return response.json();
}

export function ZkpfRamp({
  destinationAddress,
  defaultAsset = 'ZEC',
  onSuccess,
  onError,
  className,
  apiBaseUrl = DEFAULT_API_BASE,
}: ZkpfRampProps) {
  // State
  const [amount, setAmount] = useState('100');
  const [asset, setAsset] = useState<CryptoAsset>(defaultAsset);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [status, setStatus] = useState<RampStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [intent, setIntent] = useState<RampIntent | null>(null);

  // Refs for cleanup
  const quoteAbortRef = useRef<AbortController | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse amount
  const fiatAmount = useMemo(() => {
    const parsed = parseFloat(amount.replace(/[^0-9.]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }, [amount]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
      pollAbortRef.current?.abort();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Fetch quote when amount/asset changes
  useEffect(() => {
    if (fiatAmount < 10) {
      setQuote(null);
      setError(null);
      setStatus('idle');
      return;
    }

    // Abort previous request
    quoteAbortRef.current?.abort();
    quoteAbortRef.current = new AbortController();

    setStatus('quoting');
    setError(null);
    
    fetchQuoteFromApi(apiBaseUrl, fiatAmount, asset, quoteAbortRef.current.signal)
      .then(q => {
        setQuote(q);
        setStatus('idle');
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Quote fetch error:', err);
        setError(err.message);
        setStatus('error');
      });

    return () => {
      quoteAbortRef.current?.abort();
    };
  }, [fiatAmount, asset, apiBaseUrl]);

  // Poll for intent status when we have an active intent
  useEffect(() => {
    if (!intentId || status !== 'processing') {
      return;
    }

    pollAbortRef.current?.abort();
    pollAbortRef.current = new AbortController();

    const pollStatus = async () => {
      try {
        const updatedIntent = await pollIntentStatus(
          apiBaseUrl,
          intentId,
          pollAbortRef.current?.signal
        );
        
        setIntent(updatedIntent);

        // Check for terminal states
        if (updatedIntent.status === 'released') {
          setStatus('complete');
          onSuccess?.(
            updatedIntent.txHash || '',
            String(updatedIntent.cryptoAmount / 1_000_000),
            asset
          );
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        } else if (['disputed', 'cancelled', 'expired'].includes(updatedIntent.status)) {
          setStatus('error');
          setError(`Transaction ${updatedIntent.status}`);
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.warn('Status poll error:', err);
      }
    };

    pollStatus();
    pollIntervalRef.current = setInterval(pollStatus, 5000);

    return () => {
      pollAbortRef.current?.abort();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [intentId, status, apiBaseUrl, asset, onSuccess]);

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

    if (!quote) {
      setError('Please wait for quote');
      return;
    }

    if (Date.now() > quote.expiresAt) {
      setError('Quote expired, please try again');
      setQuote(null);
      return;
    }

    setStatus('pending');
    setError(null);

    try {
      const result = await createRampIntentApi(apiBaseUrl, {
        fiatAmount,
        asset,
        address: destinationAddress,
        paymentMethod,
        agentId: quote.agentId,
      });

      setIntentId(result.intentId);
      setIntent(result.intent);

      const paymentWindow = window.open(
        result.paymentUrl,
        'zkpf-ramp-payment',
        'width=500,height=700,left=100,top=100'
      );

      setStatus('processing');

      if (paymentWindow) {
        const checkWindow = setInterval(() => {
          if (paymentWindow.closed) {
            clearInterval(checkWindow);
          }
        }, 1000);
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      setError(message);
      setStatus('error');
      onError?.(err instanceof Error ? err : new Error(message));
    }
  }, [destinationAddress, fiatAmount, asset, paymentMethod, quote, apiBaseUrl, onError]);

  // Format helpers
  const formatCrypto = (value: number, decimals = 4) => 
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    return `~${Math.round(seconds / 60)} min`;
  };

  const getStatusMessage = useCallback(() => {
    if (!intent) return null;
    
    switch (intent.status) {
      case 'pending':
        return 'Waiting for agent to accept...';
      case 'locked':
        return 'Crypto locked, complete payment...';
      case 'payment_sent':
        return 'Payment received, confirming...';
      case 'confirmed':
        return 'Payment confirmed, releasing crypto...';
      case 'released':
        return 'Complete!';
      case 'disputed':
        return 'Under dispute resolution';
      case 'cancelled':
        return 'Transaction cancelled';
      case 'expired':
        return 'Transaction expired';
      default:
        return 'Processing...';
    }
  }, [intent]);

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

      {quote && status !== 'quoting' && status !== 'error' && (
        <div className="ramp-quote">
          <div className="quote-main">
            <span className="quote-label">You receive</span>
            <span className="quote-value">
              {formatCrypto(quote.cryptoAmount / 1_000_000)} {asset}
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
                {quote.feePct === 0 ? 'FREE ✨' : `${quote.feePct.toFixed(1)}%`}
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
                <span className="agent-rating">⭐ {quote.agentRating.toFixed(1)}</span>
              </span>
            </div>
          </div>
          {quote.expiresAt - Date.now() < 60000 && (
            <div className="quote-expiring">
              Quote expires in {Math.round((quote.expiresAt - Date.now()) / 1000)}s
            </div>
          )}
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
          status === 'error' ||
          fiatAmount < 10
        }
      >
        {status === 'idle' && `Buy ${asset}`}
        {status === 'quoting' && 'Getting quote...'}
        {status === 'pending' && 'Creating transaction...'}
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
      {status === 'processing' && intent && (
        <div className="ramp-status processing">
          <div className="status-icon">⏳</div>
          <div className="status-text">
            <strong>{getStatusMessage()}</strong>
            <span>Your {asset} will arrive in ~{formatTime(quote?.estimatedTime || 300)}</span>
          </div>
          {intent.txHash && (
            <a 
              href={`https://basescan.org/tx/${intent.txHash}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="tx-link"
            >
              View transaction →
            </a>
          )}
        </div>
      )}

      {status === 'complete' && (
        <div className="ramp-status complete">
          <div className="status-icon">✅</div>
          <div className="status-text">
            <strong>Purchase complete!</strong>
            <span>{formatCrypto((intent?.cryptoAmount || 0) / 1_000_000)} {asset} delivered</span>
          </div>
          {intent?.txHash && (
            <a 
              href={`https://basescan.org/tx/${intent.txHash}`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="tx-link"
            >
              View transaction →
            </a>
          )}
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
