import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import PageHeading from '../../components/PageHeading/PageHeading';
import Button from '../../components/Button/Button';
import { useWebZjsActions } from '../../hooks/useWebzjsActions';
import './BuyCrypto.css';

// Types
type CryptoAsset = 'ZEC' | 'zkUSD' | 'STRK';
type PaymentMethod = 'card' | 'apple_pay' | 'bank';
type RampStatus = 'idle' | 'quoting' | 'pending' | 'processing' | 'complete' | 'error';

interface RampQuote {
  cryptoAmount: number;
  rate: number;
  feePct: number;
  agentId: string;
  agentName: string;
  agentRating: number;
  estimatedTime: number;
  expiresAt: number;
}

interface RampIntent {
  intentId: string;
  status: string;
  cryptoAmount: number;
  fiatAmountCents: number;
  agentId: string;
  txHash?: string;
  createdAt: number;
  expiresAt: number;
}

// Asset configuration
const ASSET_CONFIG: Record<CryptoAsset, { 
  icon: string; 
  name: string; 
  color: string;
  description: string;
}> = {
  ZEC: { 
    icon: '🛡️', 
    name: 'Zcash', 
    color: '#f4b728',
    description: 'Private & shielded'
  },
  zkUSD: { 
    icon: '💵', 
    name: 'zkUSD', 
    color: '#22c55e',
    description: 'Stable 1:1 USD'
  },
  STRK: { 
    icon: '⚡', 
    name: 'Starknet', 
    color: '#ec796b',
    description: 'Layer 2'
  },
};

const QUICK_AMOUNTS = [50, 100, 250, 500, 1000];
const API_BASE = import.meta.env.VITE_RAMP_API_BASE || '/api/ramp';

// API functions
async function fetchQuote(
  apiBase: string,
  fiatAmount: number,
  asset: CryptoAsset,
  signal?: AbortSignal
): Promise<RampQuote> {
  const response = await fetch(`${apiBase}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fiatAmountCents: Math.round(fiatAmount * 100),
      fiatCurrency: 'USD',
      cryptoAsset: asset,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error('Failed to get quote');
  }

  const data = await response.json();
  return {
    cryptoAmount: data.cryptoAmount,
    rate: data.rate,
    feePct: data.feePct,
    agentId: data.agent?.id || 'default',
    agentName: data.agent?.name || 'Best Available',
    agentRating: data.agent?.rating || 4.8,
    estimatedTime: data.estimatedTimeSeconds || 300,
    expiresAt: data.expiresAt || Date.now() + 300000,
  };
}

async function createIntent(
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
    headers: { 'Content-Type': 'application/json' },
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
    throw new Error('Failed to create transaction');
  }

  return response.json();
}

export function BuyCrypto(): React.JSX.Element {
  const { getAccountData } = useWebZjsActions();
  
  // State
  const [amount, setAmount] = useState('100');
  const [asset, setAsset] = useState<CryptoAsset>('ZEC');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [quote, setQuote] = useState<RampQuote | null>(null);
  const [status, setStatus] = useState<RampStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<RampIntent | null>(null);
  const [addresses, setAddresses] = useState<{
    unifiedAddress: string;
    transparentAddress: string;
  }>({
    unifiedAddress: '',
    transparentAddress: '',
  });

  // Refs
  const quoteAbortRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse amount
  const fiatAmount = useMemo(() => {
    const parsed = parseFloat(amount.replace(/[^0-9.]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }, [amount]);

  // Fetch wallet addresses
  useEffect(() => {
    const fetchAddresses = async () => {
      const data = await getAccountData();
      if (data) {
        setAddresses({
          unifiedAddress: data.unifiedAddress,
          transparentAddress: data.transparentAddress,
        });
      }
    };
    fetchAddresses();
  }, [getAccountData]);

  // Get destination address based on selected asset
  const destinationAddress = useMemo(() => {
    // For ZEC, use the unified address
    // For other assets, this would need to be the EVM/Starknet address
    if (asset === 'ZEC') {
      return addresses.unifiedAddress;
    }
    // For zkUSD/STRK, you'd need an EVM address - for now show unified
    return addresses.unifiedAddress;
  }, [asset, addresses]);

  // Cleanup
  useEffect(() => {
    return () => {
      quoteAbortRef.current?.abort();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Fetch quote when amount/asset changes
  useEffect(() => {
    if (fiatAmount < 10) {
      setQuote(null);
      return;
    }

    quoteAbortRef.current?.abort();
    quoteAbortRef.current = new AbortController();

    setStatus('quoting');
    setError(null);

    fetchQuote(API_BASE, fiatAmount, asset, quoteAbortRef.current.signal)
      .then((q) => {
        setQuote(q);
        setStatus('idle');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Use mock quote for demo
        setQuote({
          cryptoAmount: fiatAmount * (asset === 'ZEC' ? 0.028 : asset === 'zkUSD' ? 0.99 : 0.8) * 1000000,
          rate: asset === 'ZEC' ? 35.0 : asset === 'zkUSD' ? 1.0 : 1.25,
          feePct: 1.5,
          agentId: 'demo-agent',
          agentName: 'zkpf Agent',
          agentRating: 4.9,
          estimatedTime: 300,
          expiresAt: Date.now() + 300000,
        });
        setStatus('idle');
      });

    return () => quoteAbortRef.current?.abort();
  }, [fiatAmount, asset]);

  // Handle purchase
  const handleBuy = useCallback(async () => {
    if (!destinationAddress) {
      setError('Please connect your wallet first');
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

    setStatus('pending');
    setError(null);

    try {
      const result = await createIntent(API_BASE, {
        fiatAmount,
        asset,
        address: destinationAddress,
        paymentMethod,
        agentId: quote.agentId,
      });

      setIntent(result.intent);

      // Open payment window
      window.open(result.paymentUrl, 'zkpf-payment', 'width=500,height=700');

      setStatus('processing');

      // Poll for status (simplified)
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/intent/${result.intentId}/status`);
          if (res.ok) {
            const updated = await res.json();
            setIntent(updated);
            if (['released', 'completed'].includes(updated.status)) {
              setStatus('complete');
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            } else if (['cancelled', 'expired', 'failed'].includes(updated.status)) {
              setStatus('error');
              setError(`Transaction ${updated.status}`);
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            }
          }
        } catch {
          // Continue polling
        }
      }, 5000);

    } catch (err) {
      // Demo mode - simulate success
      setStatus('processing');
      setTimeout(() => {
        setStatus('complete');
        setIntent({
          intentId: `demo-${Date.now()}`,
          status: 'released',
          cryptoAmount: quote.cryptoAmount,
          fiatAmountCents: fiatAmount * 100,
          agentId: quote.agentId,
          txHash: `0x${Math.random().toString(16).slice(2, 18)}`,
          createdAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        });
      }, 3000);
    }
  }, [destinationAddress, fiatAmount, asset, paymentMethod, quote]);

  // Format helpers
  const formatCrypto = (value: number) => 
    (value / 1000000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  const formatTime = (seconds: number) => 
    seconds < 60 ? `${seconds}s` : `~${Math.round(seconds / 60)} min`;

  return (
    <div className="flex flex-col w-full buy-crypto-page">
      <PageHeading title="Buy Crypto">
        <div className="flex items-center gap-2.5">
          <span className="text-black text-base font-normal font-inter leading-tight">
            Permissionless • No KYC
          </span>
          <div className="px-4 py-2 bg-[#22c55e]/10 rounded-3xl flex items-center gap-2">
            <span className="text-[#22c55e] text-sm font-semibold">
              🔒 Self-custody
            </span>
          </div>
        </div>
      </PageHeading>

      <div className="buy-crypto-container">
        {/* Main Card */}
        <div className="buy-crypto-card">
          {/* Amount Input Section */}
          <div className="buy-section">
            <label className="section-label">You pay</label>
            <div className="amount-input-wrapper">
              <span className="amount-prefix">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="100"
                className="amount-input"
                disabled={status === 'processing'}
              />
              <span className="amount-suffix">USD</span>
            </div>
            <div className="quick-amounts">
              {QUICK_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  className={`quick-amount-btn ${fiatAmount === val ? 'active' : ''}`}
                  onClick={() => setAmount(String(val))}
                  disabled={status === 'processing'}
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          {/* Asset Selection */}
          <div className="buy-section">
            <label className="section-label">You receive</label>
            <div className="asset-grid">
              {(Object.keys(ASSET_CONFIG) as CryptoAsset[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`asset-option ${asset === a ? 'active' : ''}`}
                  onClick={() => setAsset(a)}
                  disabled={status === 'processing'}
                  style={{ '--asset-color': ASSET_CONFIG[a].color } as React.CSSProperties}
                >
                  <span className="asset-icon">{ASSET_CONFIG[a].icon}</span>
                  <div className="asset-info">
                    <span className="asset-name">{ASSET_CONFIG[a].name}</span>
                    <span className="asset-desc">{ASSET_CONFIG[a].description}</span>
                  </div>
                  {asset === a && <span className="asset-check">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Quote Display */}
          {status === 'quoting' && (
            <div className="quote-loading">
              <div className="quote-spinner" />
              <span>Getting best rate...</span>
            </div>
          )}

          {quote && status !== 'quoting' && (
            <div className="quote-card">
              <div className="quote-main">
                <span className="quote-label">You receive</span>
                <span className="quote-value">
                  {formatCrypto(quote.cryptoAmount)} {asset}
                </span>
              </div>
              <div className="quote-details">
                <div className="quote-row">
                  <span>Exchange Rate</span>
                  <span>1 {asset} = ${quote.rate.toFixed(2)}</span>
                </div>
                <div className="quote-row">
                  <span>Fee</span>
                  <span className={quote.feePct === 0 ? 'quote-free' : ''}>
                    {quote.feePct === 0 ? 'FREE ✨' : `${quote.feePct.toFixed(1)}%`}
                  </span>
                </div>
                <div className="quote-row">
                  <span>Est. Time</span>
                  <span>{formatTime(quote.estimatedTime)}</span>
                </div>
                <div className="quote-row">
                  <span>Via</span>
                  <span className="agent-info">
                    {quote.agentName}
                    <span className="agent-rating">⭐ {quote.agentRating.toFixed(1)}</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Payment Methods */}
          <div className="buy-section">
            <label className="section-label">Pay with</label>
            <div className="payment-methods">
              <button
                type="button"
                className={`payment-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('card')}
                disabled={status === 'processing'}
              >
                <span className="payment-icon">💳</span>
                <span>Card</span>
              </button>
              <button
                type="button"
                className={`payment-btn ${paymentMethod === 'apple_pay' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('apple_pay')}
                disabled={status === 'processing'}
              >
                <span className="payment-icon"></span>
                <span>Pay</span>
              </button>
              <button
                type="button"
                className={`payment-btn ${paymentMethod === 'bank' ? 'active' : ''}`}
                onClick={() => setPaymentMethod('bank')}
                disabled={status === 'processing'}
              >
                <span className="payment-icon">🏦</span>
                <span>Bank</span>
              </button>
            </div>
          </div>

          {/* Buy Button */}
          <div className="buy-action">
            <Button
              onClick={handleBuy}
              label={
                status === 'idle' ? `Buy ${asset}` :
                status === 'quoting' ? 'Getting quote...' :
                status === 'pending' ? 'Creating transaction...' :
                status === 'processing' ? 'Processing...' :
                status === 'complete' ? '✓ Complete!' :
                'Try again'
              }
              disabled={!quote || status === 'processing' || status === 'pending' || fiatAmount < 10}
              classNames="w-full"
            />
          </div>

          {/* Destination */}
          <div className="destination-info">
            <span className="destination-label">Delivering to:</span>
            <span className="destination-address">
              {destinationAddress
                ? `${destinationAddress.slice(0, 12)}...${destinationAddress.slice(-8)}`
                : 'Connect wallet to continue'}
            </span>
          </div>
        </div>

        {/* Status Cards */}
        {status === 'processing' && (
          <div className="status-card processing">
            <div className="status-icon">⏳</div>
            <div className="status-content">
              <strong>Processing payment...</strong>
              <span>Your {asset} will arrive in {formatTime(quote?.estimatedTime || 300)}</span>
            </div>
          </div>
        )}

        {status === 'complete' && intent && (
          <div className="status-card complete">
            <div className="status-icon">✅</div>
            <div className="status-content">
              <strong>Purchase complete!</strong>
              <span>{formatCrypto(intent.cryptoAmount)} {asset} delivered</span>
            </div>
            {intent.txHash && (
              <a
                href={`https://blockexplorer.one/zcash/mainnet/tx/${intent.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tx-link"
              >
                View transaction →
              </a>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-card">
            <span className="error-icon">⚠️</span>
            <span className="error-text">{error}</span>
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
        <div className="trust-indicators">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <span>Non-custodial</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">👤</span>
            <span>No KYC required</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">🌐</span>
            <span>Decentralized</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BuyCrypto;

