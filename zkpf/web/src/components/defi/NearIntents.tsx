import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getQuotes as fetchRealTimeQuotes,
  fetchPrices,
  formatTime,
  formatUsd,
  type ChainToken,
  type Solver,
  type IntentQuote,
} from '../../services/near-intents-quotes';
import { useCredentialsStore } from '../credentials/useCredentialsStore';
import type { Credential } from '../credentials/CredentialCard';
import './NearIntents.css';

// Intent types
type IntentStatus = 'pending' | 'matching' | 'executing' | 'completed' | 'failed' | 'expired';
type IntentType = 'swap' | 'bridge' | 'zkpof' | 'defi';

interface Intent {
  id: string;
  type: IntentType;
  status: IntentStatus;
  sourceToken: ChainToken;
  targetToken: ChainToken;
  sourceAmount: string;
  minTargetAmount: string;
  receivedAmount?: string;
  solver?: Solver;
  createdAt: number;
  expiresAt: number;
  settledAt?: number;
  txHash?: string;
  zkProofRequired: boolean;
  proofCommitment?: string;
  credentialId?: string;
  policyId?: number;
  inputUsd?: string;
  outputUsd?: string;
}

// Supported chains and tokens with CoinGecko mappings
const SUPPORTED_CHAINS: ChainToken[] = [
  { chainId: 'near', chainName: 'NEAR', token: 'NEAR', icon: '◈', decimals: 24, coingeckoId: 'near' },
  { chainId: 'near', chainName: 'NEAR', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'near', chainName: 'NEAR', token: 'USDT', icon: '₮', decimals: 6, coingeckoId: 'tether' },
  { chainId: 'ethereum', chainName: 'Ethereum', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'ethereum', chainName: 'Ethereum', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'arbitrum', chainName: 'Arbitrum', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'arbitrum', chainName: 'Arbitrum', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'base', chainName: 'Base', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'base', chainName: 'Base', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'zcash', chainName: 'Zcash', token: 'ZEC', icon: 'ⓩ', decimals: 8, coingeckoId: 'zcash' },
  { chainId: 'solana', chainName: 'Solana', token: 'SOL', icon: '◎', decimals: 9, coingeckoId: 'solana' },
  { chainId: 'solana', chainName: 'Solana', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'bitcoin', chainName: 'Bitcoin', token: 'BTC', icon: '₿', decimals: 8, coingeckoId: 'bitcoin' },
];

export const NearIntents: React.FC = () => {
  // Form state
  const [sourceToken, setSourceToken] = useState<ChainToken>(SUPPORTED_CHAINS[0]);
  const [targetToken, setTargetToken] = useState<ChainToken>(SUPPORTED_CHAINS[4]);
  const [sourceAmount, setSourceAmount] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);
  const [requireZkProof, setRequireZkProof] = useState(false);
  
  // UI state
  const [quotes, setQuotes] = useState<IntentQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<IntentQuote | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [intentType, setIntentType] = useState<IntentType>('swap');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);

  // Token prices state
  const [prices, setPrices] = useState<Record<string, { usd: number; usd_24h_change?: number }>>({});
  const [lastPriceUpdate, setLastPriceUpdate] = useState<number>(0);

  // ZKPF credentials (already verified via zkpf-backend)
  const { getActiveCredentials } = useCredentialsStore();
  const activeCredentials = useMemo<Credential[]>(() => getActiveCredentials(), [getActiveCredentials]);
  const selectedCredential = useMemo<Credential | null>(
    () =>
      activeCredentials.length === 0
        ? null
        : activeCredentials.find(c => c.id === selectedCredentialId) ?? activeCredentials[0],
    [activeCredentials, selectedCredentialId],
  );

  // Fetch prices on mount and periodically
  useEffect(() => {
    const loadPrices = async () => {
      try {
        const tokenList = ['NEAR', 'ETH', 'BTC', 'SOL', 'ZEC', 'USDC', 'USDT'];
        const newPrices = await fetchPrices(tokenList);
        setPrices(newPrices);
        setLastPriceUpdate(Date.now());
      } catch (err) {
        console.warn('Failed to fetch prices:', err);
      }
    };

    loadPrices();
    const interval = setInterval(loadPrices, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh intents
  useEffect(() => {
    const interval = setInterval(() => {
      setIntents(prev => prev.map(intent => {
        if (intent.status === 'matching' && Math.random() > 0.7) {
          // Use the actual solver from the selected quote if available
          const solver = quotes[0]?.solver || intent.solver;
          return { ...intent, status: 'executing' as IntentStatus, solver };
        }
        if (intent.status === 'executing' && Math.random() > 0.5) {
          return {
            ...intent,
            status: 'completed' as IntentStatus,
            receivedAmount: intent.minTargetAmount,
            settledAt: Date.now(),
            txHash: '0x' + Math.random().toString(16).slice(2, 66),
          };
        }
        return intent;
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, [quotes]);

  // Fetch quotes when amount changes - using real-time data
  const fetchQuotes = useCallback(async () => {
    if (!sourceAmount || parseFloat(sourceAmount) <= 0) {
      setQuotes([]);
      setSelectedQuote(null);
      return;
    }

    setIsQuoting(true);
    setError(null);

    try {
      // Use the real-time quote service
      const newQuotes = await fetchRealTimeQuotes({
        sourceToken,
        targetToken,
        sourceAmount,
        slippageTolerance,
      });

      setQuotes(newQuotes);
      setSelectedQuote(newQuotes[0] || null);
    } catch (err) {
      console.error('Failed to fetch quotes:', err);
      setError('Failed to fetch quotes. Please try again.');
    } finally {
      setIsQuoting(false);
    }
  }, [sourceAmount, sourceToken, targetToken, slippageTolerance]);

  useEffect(() => {
    const debounce = setTimeout(fetchQuotes, 500);
    return () => clearTimeout(debounce);
  }, [fetchQuotes]);

  // Auto-refresh quotes every 15 seconds when amount is entered
  useEffect(() => {
    if (!sourceAmount || parseFloat(sourceAmount) <= 0) return;

    const interval = setInterval(fetchQuotes, 15000);
    return () => clearInterval(interval);
  }, [sourceAmount, fetchQuotes]);

  // Submit intent
  const handleSubmitIntent = async () => {
    if (!selectedQuote || !sourceAmount) {
      setError('Please enter an amount and select a quote');
      return;
    }

    if (requireZkProof && !selectedCredential) {
      setError('ZK proof-of-funds is required but no active credential was found. Generate one in the Credentials Hub.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Simulate intent creation
      await new Promise(resolve => setTimeout(resolve, 1500));

      const minAmount = parseFloat(selectedQuote.expectedAmount) * (1 - slippageTolerance / 100);
      
      const newIntent: Intent = {
        id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: intentType,
        status: 'matching',
        sourceToken,
        targetToken,
        sourceAmount,
        minTargetAmount: minAmount.toFixed(6),
        createdAt: Date.now(),
        expiresAt: Date.now() + 300000, // 5 minutes
        zkProofRequired: requireZkProof,
        proofCommitment: requireZkProof && selectedCredential ? selectedCredential.proofHash : undefined,
        credentialId: selectedCredential?.id,
        policyId: selectedCredential?.policyId,
        inputUsd: selectedQuote.inputUsd,
        outputUsd: selectedQuote.outputUsd,
        solver: selectedQuote.solver,
      };

      setIntents(prev => [newIntent, ...prev]);
      setSourceAmount('');
      setQuotes([]);
      setSelectedQuote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit intent');
    } finally {
      setIsLoading(false);
    }
  };

  // Cancel intent
  const handleCancelIntent = (intentId: string) => {
    setIntents(prev => prev.map(i => 
      i.id === intentId && ['pending', 'matching'].includes(i.status) 
        ? { ...i, status: 'expired' as IntentStatus } 
        : i
    ));
  };

  // Get current price for display
  const getTokenPriceDisplay = (token: string): string => {
    const price = prices[token]?.usd;
    if (!price) return '';
    return formatUsd(price);
  };

  // Format time for display (uses imported formatTime for quotes)
  const formatTimeDisplay = (seconds: number) => {
    return formatTime(seconds);
  };

  const getStatusIcon = (status: IntentStatus) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'matching': return '🔍';
      case 'executing': return '⚡';
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'expired': return '⏰';
    }
  };

  const getStatusClass = (status: IntentStatus) => {
    switch (status) {
      case 'pending':
      case 'matching': return 'status-pending';
      case 'executing': return 'status-executing';
      case 'completed': return 'status-completed';
      case 'failed':
      case 'expired': return 'status-failed';
    }
  };

  return (
    <div className="near-intents">
      {/* Intent Builder */}
      <div className="intent-builder">
        <div className="builder-header">
          <div className="intent-type-tabs">
            <button 
              className={`type-tab ${intentType === 'swap' ? 'active' : ''}`}
              onClick={() => setIntentType('swap')}
            >
              <span className="tab-icon">⇄</span>
              Swap
            </button>
            <button 
              className={`type-tab ${intentType === 'bridge' ? 'active' : ''}`}
              onClick={() => setIntentType('bridge')}
            >
              <span className="tab-icon">🌉</span>
              Bridge
            </button>
            <button 
              className={`type-tab ${intentType === 'zkpof' ? 'active' : ''}`}
              onClick={() => setIntentType('zkpof')}
            >
              <span className="tab-icon">🔐</span>
              ZK Transfer
            </button>
          </div>
        </div>

        {/* Source Input */}
        <div className="token-input-container source">
          <div className="input-label">
            <span>You send</span>
            <span className="balance">
              {selectedQuote ? `≈ ${formatUsd(parseFloat(selectedQuote.inputUsd || '0'))}` : getTokenPriceDisplay(sourceToken.token) && `1 ${sourceToken.token} = ${getTokenPriceDisplay(sourceToken.token)}`}
            </span>
          </div>
          <div className="token-input">
            <input
              type="text"
              value={sourceAmount}
              onChange={(e) => setSourceAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="amount-input"
            />
            <button className="token-selector">
              <span className="token-icon">{sourceToken.icon}</span>
              <span className="token-name">{sourceToken.token}</span>
              <span className="chain-tag">{sourceToken.chainName}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div className="token-dropdown">
              {SUPPORTED_CHAINS.map((chain, idx) => (
                <button
                  key={idx}
                  className={`dropdown-item ${chain.chainId === sourceToken.chainId && chain.token === sourceToken.token ? 'selected' : ''}`}
                  onClick={() => setSourceToken(chain)}
                >
                  <span className="token-icon">{chain.icon}</span>
                  <span className="token-name">{chain.token}</span>
                  <span className="chain-tag">{chain.chainName}</span>
                  {prices[chain.token]?.usd && (
                    <span className="token-price">{formatUsd(prices[chain.token].usd)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Swap Direction */}
        <div className="swap-direction">
          <button 
            className="swap-button"
            onClick={() => {
              const temp = sourceToken;
              setSourceToken(targetToken);
              setTargetToken(temp);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/>
            </svg>
          </button>
        </div>

        {/* Target Input */}
        <div className="token-input-container target">
          <div className="input-label">
            <span>You receive</span>
            {selectedQuote && (
              <span className="estimated">
                ≈ {formatUsd(parseFloat(selectedQuote.outputUsd || '0'))}
              </span>
            )}
          </div>
          <div className="token-input">
            <input
              type="text"
              value={selectedQuote?.expectedAmount || ''}
              placeholder="0.00"
              className="amount-input"
              readOnly
            />
            <button className="token-selector">
              <span className="token-icon">{targetToken.icon}</span>
              <span className="token-name">{targetToken.token}</span>
              <span className="chain-tag">{targetToken.chainName}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div className="token-dropdown">
              {SUPPORTED_CHAINS.filter(c => !(c.chainId === sourceToken.chainId && c.token === sourceToken.token)).map((chain, idx) => (
                <button
                  key={idx}
                  className={`dropdown-item ${chain.chainId === targetToken.chainId && chain.token === targetToken.token ? 'selected' : ''}`}
                  onClick={() => setTargetToken(chain)}
                >
                  <span className="token-icon">{chain.icon}</span>
                  <span className="token-name">{chain.token}</span>
                  <span className="chain-tag">{chain.chainName}</span>
                  {prices[chain.token]?.usd && (
                    <span className="token-price">{formatUsd(prices[chain.token].usd)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Route Preview */}
        {selectedQuote && (
          <div className="route-preview">
            <div className="route-header">
              <span className="route-label">Route via {selectedQuote.solver.name}</span>
              <span className="route-time">~{formatTimeDisplay(selectedQuote.estimatedTime)}</span>
            </div>
            <div className="route-path">
              {selectedQuote.route.map((step, idx) => (
                <React.Fragment key={idx}>
                  <span className="route-step">{step}</span>
                  {idx < selectedQuote.route.length - 1 && (
                    <span className="route-arrow">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="route-details">
              <span className="route-detail">
                <span className="detail-label">Fee:</span>
                <span className="detail-value">{formatUsd(parseFloat(selectedQuote.feeUsd || '0'))}</span>
              </span>
              {selectedQuote.priceImpact > 0 && (
                <span className="route-detail">
                  <span className="detail-label">Impact:</span>
                  <span className="detail-value impact">{selectedQuote.priceImpact.toFixed(2)}%</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Advanced Options */}
        <button 
          className="advanced-toggle"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <span>Advanced Options</span>
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="currentColor"
            style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        </button>

        {showAdvanced && (
          <div className="advanced-options">
            <div className="option-row">
              <label>Slippage Tolerance</label>
              <div className="slippage-buttons">
                {[0.1, 0.5, 1.0, 3.0].map(val => (
                  <button
                    key={val}
                    className={`slippage-btn ${slippageTolerance === val ? 'active' : ''}`}
                    onClick={() => setSlippageTolerance(val)}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>
            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={requireZkProof}
                  onChange={(e) => setRequireZkProof(e.target.checked)}
                />
                <span className="checkbox-custom" />
                <span>Require ZK Proof-of-Funds</span>
              </label>
              {requireZkProof && (
                <span className="zk-badge">🔐 Privacy-preserving</span>
              )}
            </div>
            {requireZkProof && (
              <div className="option-row zkpf-credential-row">
                {activeCredentials.length === 0 ? (
                  <p className="zkpf-credential-warning">
                    No active credentials detected.{' '}
                    <a href="/credentials" target="_blank" rel="noopener noreferrer">
                      Open Credentials Hub
                    </a>{' '}
                    to generate a proof-of-funds credential.
                  </p>
                ) : (
                  <>
                    <label>Backed by credential</label>
                    <select
                      className="zkpf-credential-select"
                      value={selectedCredential?.id ?? activeCredentials[0].id}
                      onChange={(e) => setSelectedCredentialId(e.target.value)}
                    >
                      {activeCredentials.map(cred => (
                        <option key={cred.id} value={cred.id}>
                          ≥ {cred.provenValue.toLocaleString()} {cred.currency} ({cred.chain})
                        </option>
                      ))}
                    </select>
                    {selectedCredential && (
                      <p className="zkpf-credential-hint">
                        Using policy #{selectedCredential.policyId} with threshold ≥{' '}
                        {selectedCredential.threshold.toLocaleString()} {selectedCredential.currency}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="intent-error">
            <span className="error-icon">⚠</span>
            {error}
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmitIntent}
          disabled={isLoading || !sourceAmount || !selectedQuote}
          className="submit-intent-btn"
        >
          {isLoading ? (
            <span className="loading-spinner" />
          ) : (
            <>
              <span>Submit Intent</span>
              {selectedQuote && (
                <span className="btn-sub">
                  via {selectedQuote.solver.name}
                </span>
              )}
            </>
          )}
        </button>
      </div>

      {/* Solver Quotes */}
      {quotes.length > 0 && (
        <div className="solver-quotes">
          <h3 className="quotes-title">
            <span className="quotes-icon">⚡</span>
            Competing Solvers
            {isQuoting && <span className="refreshing">Live quotes</span>}
            {lastPriceUpdate > 0 && (
              <span className="price-update">
                Prices: {new Date(lastPriceUpdate).toLocaleTimeString()}
              </span>
            )}
          </h3>
          <div className="quotes-list">
            {quotes.map((quote, idx) => (
              <button
                key={quote.solver.id}
                className={`quote-card ${selectedQuote?.solver.id === quote.solver.id ? 'selected' : ''}`}
                onClick={() => setSelectedQuote(quote)}
              >
                {idx === 0 && <span className="best-badge">Best Rate</span>}
                <div className="quote-header">
                  <span className="solver-name">{quote.solver.name}</span>
                  <span className="solver-reputation">
                    ⭐ {quote.solver.reputation}
                  </span>
                </div>
                <div className="quote-amount">
                  {parseFloat(quote.expectedAmount).toFixed(6)} <span className="token">{targetToken.token}</span>
                </div>
                <div className="quote-usd">
                  ≈ {formatUsd(parseFloat(quote.outputUsd || '0'))}
                </div>
                <div className="quote-details">
                  <span className="detail">
                    <span className="detail-label">Fee:</span>
                    <span className="detail-value">{formatUsd(parseFloat(quote.feeUsd || '0'))}</span>
                  </span>
                  <span className="detail">
                    <span className="detail-label">Time:</span>
                    <span className="detail-value">~{formatTimeDisplay(quote.estimatedTime)}</span>
                  </span>
                </div>
                <div className="solver-stats">
                  <span>{quote.solver.successRate}% success</span>
                  <span>•</span>
                  <span>{quote.solver.totalVolume} volume</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Intents */}
      {intents.length > 0 && (
        <div className="active-intents">
          <h3 className="intents-title">
            <span className="intents-icon">📋</span>
            Your Intents
          </h3>
          <div className="intents-list">
            {intents.map(intent => (
              <div key={intent.id} className={`intent-card ${intent.status}`}>
                <div className="intent-header">
                  <span className="intent-id">{intent.id.slice(0, 20)}...</span>
                  <span className={`intent-status ${getStatusClass(intent.status)}`}>
                    {getStatusIcon(intent.status)} {intent.status}
                  </span>
                </div>
                <div className="intent-swap">
                  <div className="swap-from">
                    <span className="amount">{intent.sourceAmount}</span>
                    <span className="token">
                      {intent.sourceToken.icon} {intent.sourceToken.token}
                    </span>
                    <span className="chain">{intent.sourceToken.chainName}</span>
                  </div>
                  <span className="swap-arrow">→</span>
                  <div className="swap-to">
                    <span className="amount">
                      {intent.receivedAmount || intent.minTargetAmount}
                    </span>
                    <span className="token">
                      {intent.targetToken.icon} {intent.targetToken.token}
                    </span>
                    <span className="chain">{intent.targetToken.chainName}</span>
                  </div>
                </div>
                {intent.solver && (
                  <div className="intent-solver">
                    <span className="solver-label">Solver:</span>
                    <span className="solver-name">{intent.solver.name}</span>
                  </div>
                )}
                {intent.zkProofRequired && (
                  <div className="zk-indicator">
                    <span className="zk-icon">🔐</span>
                    ZK Proof Required
                    {intent.proofCommitment && (
                      <span className="commitment">{intent.proofCommitment.slice(0, 10)}...</span>
                    )}
                  </div>
                )}
                <div className="intent-footer">
                  <span className="intent-time">
                    Created {new Date(intent.createdAt).toLocaleTimeString()}
                  </span>
                  {['pending', 'matching'].includes(intent.status) && (
                    <button 
                      className="cancel-btn"
                      onClick={() => handleCancelIntent(intent.id)}
                    >
                      Cancel
                    </button>
                  )}
                  {intent.txHash && (
                    <a 
                      href={`https://nearblocks.io/txns/${intent.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View Tx →
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div className="intents-hero">
        <div className="hero-glow" />
        <div className="hero-content">
          <h2 className="hero-title">
            Express Your <span className="gradient-text">Intent</span>
          </h2>
          <p className="hero-subtitle">
            Say what you want, not how to do it. Solvers compete to find the optimal cross-chain route.
          </p>
        </div>
      </div>

      {/* Info Section */}
      <div className="intents-info">
        <div className="info-card">
          <div className="info-icon">🧠</div>
          <h4>Intent-Based Architecture</h4>
          <p>
            Instead of constructing complex cross-chain transactions, simply express what you want. 
            NEAR's solver network competes to fulfill your intent at the best rate.
          </p>
        </div>
        <div className="info-card">
          <div className="info-icon">🔐</div>
          <h4>ZK-Enhanced Privacy</h4>
          <p>
            Optionally require ZK proof-of-funds to verify your assets without revealing exact balances. 
            Perfect for privacy-conscious cross-chain operations.
          </p>
        </div>
        <div className="info-card">
          <div className="info-icon">⚡</div>
          <h4>Solver Competition</h4>
          <p>
            Multiple solvers compete in real-time to offer you the best rates and fastest settlement. 
            No single point of failure, no MEV extraction.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NearIntents;

