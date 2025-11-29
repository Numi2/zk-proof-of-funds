/**
 * WalletBuy - Real USDC on-ramp flow using Coinbase / Transak.
 *
 * Uses an EVM wallet (MetaMask or any EIP-1193 provider) as the destination.
 * No mocks: providers are called directly or via their hosted widgets.
 *
 * The quote UX is modeled after Coinbase's Sell Quote API:
 * - Clear subtotal / fees / total breakdown
 * - Fast, debounced quote fetching
 * - Provider comparison with best quote highlighted
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useOnRamp,
  DEFAULT_ONRAMP_CONFIG,
  PROVIDER_CAPABILITIES,
  type OnRampProvider,
} from '../../services/onramp';
import '../ZkpfRamp.css';

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

interface WindowWithEthereum extends Window {
  ethereum?: EthereumProvider;
}

const QUICK_AMOUNTS = [50, 100, 250, 500, 1000];

// Provider icons and branding
const PROVIDER_BRANDING: Record<string, { icon: string; color: string }> = {
  coinbase: { icon: '◉', color: '#0052FF' },
  transak: { icon: '◈', color: '#5F6CF7' },
};


export function WalletBuy() {
  const [amount, setAmount] = useState('100');
  const [evmAddress, setEvmAddress] = useState('');
  const [evmError, setEvmError] = useState<string | null>(null);
  const [country] = useState('US'); // basic default for provider selection

  const provider = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const w = window as WindowWithEthereum;
    return w.ethereum ?? null;
  }, []);

  const {
    quote,
    quotes,
    loading,
    error,
    provider: currentProvider,
    setProvider,
    getAllQuotes,
    startOnRamp,
    isProviderAvailable,
  } = useOnRamp(DEFAULT_ONRAMP_CONFIG.defaultChain);

  const quoteDebounceRef = useRef<number | null>(null);

  const fiatAmount = useMemo(() => {
    const parsed = parseFloat(amount.replace(/[^0-9.]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }, [amount]);

  useEffect(() => {
    if (!provider) {
      setEvmError('Install MetaMask or another EVM wallet to receive USDC.');
    }
  }, [provider]);

  const connectEvmWallet = useCallback(async () => {
    if (!provider) {
      setEvmError('No EVM wallet detected in this browser.');
      return;
    }
    try {
      setEvmError(null);
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts || accounts.length === 0) {
        throw new Error('Wallet returned no accounts.');
      }
      setEvmAddress(accounts[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setEvmError(message);
    }
  }, [provider]);

  // Fetch quote whenever amount changes (and is above minimum)
  useEffect(() => {
    if (fiatAmount < DEFAULT_ONRAMP_CONFIG.minAmountUsd) {
      return;
    }

    if (!Number.isFinite(fiatAmount)) {
      return;
    }

    if (quoteDebounceRef.current !== null) {
      window.clearTimeout(quoteDebounceRef.current);
    }

    quoteDebounceRef.current = window.setTimeout(() => {
      // Fetch quotes from all providers in parallel; hook manages errors
      void getAllQuotes(fiatAmount);
    }, 350);

    return () => {
      if (quoteDebounceRef.current !== null) {
        window.clearTimeout(quoteDebounceRef.current);
      }
    };
  }, [fiatAmount, getAllQuotes]);

  const handleBuy = useCallback(async () => {
    if (!evmAddress) {
      setEvmError('Connect a wallet first.');
      return;
    }
    if (fiatAmount < DEFAULT_ONRAMP_CONFIG.minAmountUsd) {
      setEvmError(`Minimum purchase is $${DEFAULT_ONRAMP_CONFIG.minAmountUsd}`);
      return;
    }
    try {
      await startOnRamp({
        address: evmAddress,
        amountUsd: fiatAmount,
        userCountry: country,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start on-ramp';
      setEvmError(message);
    }
  }, [evmAddress, fiatAmount, country, startOnRamp]);

  const availableProviders: OnRampProvider[] = useMemo(
    () => DEFAULT_ONRAMP_CONFIG.enabledProviders.filter((p) => isProviderAvailable(p)),
    [isProviderAvailable],
  );

  // Check if we're in demo mode (no providers available)
  const isDemoMode = availableProviders.length === 0;

  // Shortened address display
  const shortAddress = evmAddress
    ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`
    : null;

  return (
    <div className="wallet-buy-page">
      <div className="zkpf-ramp wallet-onramp">
        {/* Header with gradient styling */}
        <div className="ramp-header">
          <div className="ramp-title">
            <span className="ramp-title-icon">💵</span>
            <h2>Buy USDC</h2>
            <span className="ramp-badge permissionless">On-ramp</span>
          </div>
          <div className="ramp-subtitle">
            Instant fiat → stablecoin conversion via trusted providers
          </div>
        </div>

        {/* Wallet Connection Section */}
        <div className="ramp-section wallet-destination-section">
          <label className="ramp-label">
            <span className="label-icon">🔗</span>
            Destination Wallet
          </label>
          <div className={`wallet-address-display ${evmAddress ? 'connected' : ''}`}>
            {evmAddress ? (
              <>
                <div className="wallet-address-info">
                  <span className="wallet-status-indicator" />
                  <span className="wallet-address-text">{shortAddress}</span>
                  <span className="wallet-chain-badge">EVM</span>
                </div>
                <button
                  type="button"
                  className="wallet-reconnect-btn"
                  onClick={connectEvmWallet}
                >
                  Change
                </button>
              </>
            ) : (
              <button
                type="button"
                className="wallet-connect-btn"
                onClick={connectEvmWallet}
              >
                <span className="connect-icon">⬡</span>
                Connect EVM Wallet
              </button>
            )}
          </div>
          {!evmAddress && (
            <div className="wallet-hint">
              Connect MetaMask or another EVM wallet to receive USDC
            </div>
          )}
        </div>

        {/* Amount Input Section */}
        <div className="ramp-section">
          <label className="ramp-label">
            <span className="label-icon">💰</span>
            You Pay
          </label>
          <div className="ramp-input-container amount-input-large">
            <span className="ramp-input-prefix">$</span>
            <input
              type="text"
              inputMode="decimal"
              className="ramp-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
            />
            <span className="ramp-input-suffix">USD</span>
          </div>
          <div className="ramp-quick-amounts">
            {QUICK_AMOUNTS.map((val) => (
              <button
                key={val}
                type="button"
                className={`quick-amount ${fiatAmount === val ? 'active' : ''}`}
                onClick={() => setAmount(String(val))}
              >
                ${val}
              </button>
            ))}
          </div>
        </div>

        {/* Demo Mode Notice */}
        {isDemoMode && (
          <div className="ramp-section demo-mode-notice">
            <div className="demo-banner">
              <span className="demo-icon">🔧</span>
              <div className="demo-content">
                <strong>Demo Mode</strong>
                <p>
                  On-ramp providers require API keys to work. For production, set the following environment variables:
                </p>
                <ul className="demo-env-list">
                  <li><code>VITE_COINBASE_ONRAMP_APP_ID</code> - Coinbase CDP App ID (zero-fee USDC!)</li>
                  <li><code>VITE_TRANSAK_API_KEY</code> - Transak API key</li>
                </ul>
                <p className="demo-hint">
                  Get a free Coinbase CDP API key at <a href="https://www.coinbase.com/developer-platform" target="_blank" rel="noopener noreferrer">coinbase.com/developer-platform</a>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Provider Selection */}
        {!isDemoMode && (
          <div className="ramp-section">
            <label className="ramp-label">
              <span className="label-icon">🏦</span>
              Provider
            </label>
            <div className="provider-grid">
              {availableProviders.map((p) => {
                const branding = PROVIDER_BRANDING[p] || { icon: '●', color: '#38bdf8' };
                return (
                  <button
                    key={p}
                    type="button"
                    className={`provider-card ${currentProvider === p ? 'active' : ''}`}
                    onClick={() => setProvider(p)}
                    style={{ '--provider-color': branding.color } as React.CSSProperties}
                  >
                    <span className="provider-icon">{branding.icon}</span>
                    <span className="provider-name">{PROVIDER_CAPABILITIES[p].displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quote Loading State */}
        {loading && (
          <div className="ramp-quote loading">
            <div className="quote-spinner" />
            <span>Getting best quote…</span>
          </div>
        )}

        {/* Quote Display */}
        {quote && !loading && (
          <div className="ramp-quote quote-enhanced">
            <div className="quote-main">
              <span className="quote-label">You Receive</span>
              <span className="quote-value">
                {(quote.cryptoAmount / 1_000_000).toFixed(2)}
                <span className="quote-currency">USDC</span>
              </span>
            </div>
            <div className="quote-details">
              <div className="quote-row">
                <span>Provider</span>
                <span className="quote-provider-pill">
                  {PROVIDER_BRANDING[quote.provider]?.icon || '●'}
                  {PROVIDER_CAPABILITIES[quote.provider].displayName}
                </span>
              </div>
              <div className="quote-row">
                <span>Exchange Rate</span>
                <span>1 USDC ≈ ${quote.exchangeRate.toFixed(4)}</span>
              </div>
              <div className="quote-row">
                <span>Fees</span>
                <span className={quote.isZeroFee ? 'quote-free' : ''}>
                  {quote.isZeroFee ? '✨ Zero fee' : `$${(quote.fees.total / 100).toFixed(2)}`}
                </span>
              </div>
              <div className="quote-row highlight">
                <span>Total Charged</span>
                <span className="quote-total">${(quote.fiatAmountCents / 100).toFixed(2)}</span>
              </div>
              <div className="quote-row">
                <span>Estimated Time</span>
                <span>~{Math.round(quote.estimatedTimeSeconds / 60) || 1} min</span>
              </div>
            </div>

            {/* Provider Comparison */}
            {quotes.length > 1 && (
              <div className="quote-comparison">
                <div className="comparison-header">
                  <span className="comparison-title">Compare Providers</span>
                </div>
                <div className="quote-providers-grid">
                  {quotes.map((q) => (
                    <div
                      key={q.provider}
                      className={`quote-provider-card ${q.provider === quote.provider ? 'best' : ''}`}
                      onClick={() => setProvider(q.provider)}
                    >
                      {q.provider === quote.provider && (
                        <div className="best-badge">Best Value</div>
                      )}
                      <div className="quote-provider-header">
                        <span className="quote-provider-icon">
                          {PROVIDER_BRANDING[q.provider]?.icon || '●'}
                        </span>
                        <span className="quote-provider-name">
                          {PROVIDER_CAPABILITIES[q.provider].displayName}
                        </span>
                      </div>
                      <div className="quote-provider-body">
                        <div className="provider-stat">
                          <span className="stat-label">Receive</span>
                          <span className="stat-value">{(q.cryptoAmount / 1_000_000).toFixed(2)} USDC</span>
                        </div>
                        <div className="provider-stat">
                          <span className="stat-label">Fees</span>
                          <span className={`stat-value ${q.isZeroFee ? 'free' : ''}`}>
                            {q.isZeroFee ? 'FREE' : `$${(q.fees.total / 100).toFixed(2)}`}
                          </span>
                        </div>
                        <div className="provider-stat">
                          <span className="stat-label">Time</span>
                          <span className="stat-value">~{Math.round(q.estimatedTimeSeconds / 60) || 1}m</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Buy Button */}
        <button
          type="button"
          className={`ramp-buy-button ${loading ? 'processing' : ''} ${evmAddress && quote ? 'ready' : ''}`}
          onClick={handleBuy}
          disabled={isDemoMode || !evmAddress || fiatAmount < DEFAULT_ONRAMP_CONFIG.minAmountUsd || loading}
        >
          {isDemoMode ? (
            <>
              <span className="button-icon">🔧</span>
              Configure API Keys to Enable
            </>
          ) : loading ? (
            <>
              <span className="button-spinner" />
              Getting Quote…
            </>
          ) : (
            <>
              <span className="button-icon">💳</span>
              Buy USDC
            </>
          )}
        </button>

        {/* Trust Indicators */}
        <div className="ramp-trust">
          <div className="trust-item">
            <span className="trust-icon">🔒</span>
            <span>Secure</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">⚡</span>
            <span>Instant</span>
          </div>
          <div className="trust-item">
            <span className="trust-icon">✓</span>
            <span>Trusted</span>
          </div>
        </div>

        {/* Error Display */}
        {(evmError || error) && (
          <div className="ramp-error">
            <span className="error-icon">⚠️</span>
            <span>{evmError || error}</span>
            <button
              type="button"
              className="error-dismiss"
              onClick={() => {
                setEvmError(null);
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

