/**
 * SwapToShielded Component
 * 
 * "Swap from other chains" → Shielded ZEC flow.
 * 
 * This component standardizes the NEAR Intents + SwapKit "Swap to Shielded ZEC"
 * flow for all Zcash wallets (Zashi, YWallet, Zingo, etc.).
 * 
 * Flow:
 * 1. User selects source asset + chain (ETH on Arbitrum, SOL, BTC, etc.)
 * 2. SwapKit/NEAR Intents discovers routes and provides quotes
 * 3. User confirms swap → gets deposit address on source chain
 * 4. User sends from source chain wallet
 * 5. ZEC arrives at fresh t-addr → auto-shields to new Orchard address
 * 
 * Privacy features:
 * - Fresh t-addr for each deposit (never reused)
 * - Auto-shield to fresh Orchard address
 * - Swap metadata kept local (not on-chain)
 * - Network separation between swap RPCs and Zcash node
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSwap, useAutoRefreshQuotes } from '../../hooks/useSwap';
import { useSwapWalletActions } from '../../hooks/useSwapWalletActions';
import type { ChainAsset, SwapRoute, SwapSession } from '../../services/swap';
import './Swap.css';

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN & ASSET DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

interface ChainDefinition {
  id: string;
  name: string;
  icon: string;
  color: string;
  assets: AssetDefinition[];
}

interface AssetDefinition {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
  contractAddress?: string;
}

const SUPPORTED_CHAINS: ChainDefinition[] = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    icon: '◆',
    color: '#627EEA',
    assets: [
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6, contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
      { id: 'USDT', name: 'Tether', symbol: 'USDT', icon: '◎', decimals: 6, contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
    ],
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    icon: '⬡',
    color: '#28A0F0',
    assets: [
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
      { id: 'ARB', name: 'Arbitrum', symbol: 'ARB', icon: '⬡', decimals: 18 },
    ],
  },
  {
    id: 'optimism',
    name: 'Optimism',
    icon: '◯',
    color: '#FF0420',
    assets: [
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
      { id: 'OP', name: 'Optimism', symbol: 'OP', icon: '◯', decimals: 18 },
    ],
  },
  {
    id: 'base',
    name: 'Base',
    icon: '◎',
    color: '#0052FF',
    assets: [
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
    ],
  },
  {
    id: 'solana',
    name: 'Solana',
    icon: '◈',
    color: '#14F195',
    assets: [
      { id: 'SOL', name: 'Solana', symbol: 'SOL', icon: '◈', decimals: 9 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
    ],
  },
  {
    id: 'bitcoin',
    name: 'Bitcoin',
    icon: '₿',
    color: '#F7931A',
    assets: [
      { id: 'BTC', name: 'Bitcoin', symbol: 'BTC', icon: '₿', decimals: 8 },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface SwapToShieldedProps {
  /** User's Zcash unified address for receiving */
  zcashAddress: string;
  /** Callback when swap is initiated */
  onSwapInitiated?: (session: SwapSession) => void;
  /** Callback when swap completes */
  onSwapCompleted?: (session: SwapSession) => void;
}

export function SwapToShielded({
  zcashAddress,
  onSwapInitiated,
  onSwapCompleted,
}: SwapToShieldedProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const [selectedChain, setSelectedChain] = useState<ChainDefinition>(SUPPORTED_CHAINS[0]);
  const [selectedAsset, setSelectedAsset] = useState<AssetDefinition>(SUPPORTED_CHAINS[0].assets[0]);
  const [amount, setAmount] = useState('');
  const [sourceAddress, setSourceAddress] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<SwapRoute | null>(null);
  const [step, setStep] = useState<'input' | 'quote' | 'confirm' | 'deposit' | 'tracking'>('input');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);

  const {
    quotes,
    loadingQuotes,
    activeSession,
    error,
    getQuotesToZec,
    executeSwapToZec,
    clearError,
    refreshQuotes,
  } = useSwap();

  const { saveSwapSession } = useSwapWalletActions();

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  const amountInSmallestUnit = useMemo(() => {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return BigInt(0);
    return BigInt(Math.floor(parsed * Math.pow(10, selectedAsset.decimals)));
  }, [amount, selectedAsset.decimals]);

  const isValidAmount = amountInSmallestUnit > BigInt(0);

  const chainAsset: ChainAsset = useMemo(() => ({
    chain: selectedChain.id as ChainAsset['chain'],
    asset: selectedAsset.id as ChainAsset['asset'],
    contractAddress: selectedAsset.contractAddress,
  }), [selectedChain.id, selectedAsset.id, selectedAsset.contractAddress]);

  // Format ZEC output for display
  const formatZec = (zatoshis: bigint): string => {
    const zec = Number(zatoshis) / 1e8;
    return zec.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════

  // Track swap completion
  useEffect(() => {
    if (activeSession?.status === 'completed' && onSwapCompleted) {
      onSwapCompleted(activeSession);
    }
  }, [activeSession?.status, activeSession, onSwapCompleted]);

  // Auto-refresh quotes when in quote step
  useAutoRefreshQuotes(refreshQuotes, 15000, step === 'quote');

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleChainSelect = useCallback((chain: ChainDefinition) => {
    setSelectedChain(chain);
    setSelectedAsset(chain.assets[0]);
    setSelectedRoute(null);
    setStep('input');
  }, []);

  const handleAssetSelect = useCallback((asset: AssetDefinition) => {
    setSelectedAsset(asset);
    setSelectedRoute(null);
    setStep('input');
  }, []);

  const handleGetQuotes = useCallback(async () => {
    if (!isValidAmount || !sourceAddress) return;

    clearError();
    try {
      await getQuotesToZec(chainAsset, amountInSmallestUnit, sourceAddress, zcashAddress);
      setStep('quote');
    } catch (err) {
      console.error('Quote error:', err);
    }
  }, [isValidAmount, sourceAddress, chainAsset, amountInSmallestUnit, zcashAddress, getQuotesToZec, clearError]);

  const handleSelectRoute = useCallback((route: SwapRoute) => {
    setSelectedRoute(route);
    setStep('confirm');
  }, []);

  const handleConfirmSwap = useCallback(async () => {
    if (!selectedRoute) return;

    clearError();
    try {
      const session = await executeSwapToZec(selectedRoute, sourceAddress);
      
      // Save session to local storage
      await saveSwapSession(session);
      
      if (onSwapInitiated) {
        onSwapInitiated(session);
      }
      setStep('deposit');
    } catch (err) {
      console.error('Swap execution error:', err);
    }
  }, [selectedRoute, sourceAddress, executeSwapToZec, onSwapInitiated, clearError, saveSwapSession]);

  const handleCopyAddress = useCallback(() => {
    if (activeSession?.tracking.inboundAddress) {
      navigator.clipboard.writeText(activeSession.tracking.inboundAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  }, [activeSession?.tracking.inboundAddress]);

  const handleCopyMemo = useCallback(() => {
    if (activeSession?.tracking.providerSwapId) {
      navigator.clipboard.writeText(activeSession.tracking.providerSwapId);
      setCopiedMemo(true);
      setTimeout(() => setCopiedMemo(false), 2000);
    }
  }, [activeSession?.tracking.providerSwapId]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'quote':
        setStep('input');
        break;
      case 'confirm':
        setStep('quote');
        break;
      case 'deposit':
        // Can't go back from deposit
        break;
      case 'tracking':
        // Can't go back from tracking
        break;
    }
  }, [step]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="swap-to-shielded">
      {/* Header */}
      <div className="swap-header">
        <div className="swap-title">
          <span className="swap-title-icon">🔒</span>
          <h2>Swap to Shielded ZEC</h2>
        </div>
        <p className="swap-subtitle">
          Convert any asset to private Zcash via NEAR Intents + SwapKit
        </p>
      </div>

      {/* Privacy Notice */}
      <div className="swap-privacy-notice">
        <span className="privacy-icon">🛡️</span>
        <span>
          Auto-shields to fresh Orchard address • Swap data never on-chain
        </span>
      </div>

      {/* Step: Input */}
      {step === 'input' && (
        <div className="swap-step swap-input-step">
          {/* Chain Selection */}
          <div className="swap-section">
            <label className="swap-label">Source Chain</label>
            <div className="chain-grid">
              {SUPPORTED_CHAINS.map((chain) => (
                <button
                  key={chain.id}
                  type="button"
                  className={`chain-card ${selectedChain.id === chain.id ? 'selected' : ''}`}
                  onClick={() => handleChainSelect(chain)}
                  style={{ '--chain-color': chain.color } as React.CSSProperties}
                >
                  <span className="chain-icon">{chain.icon}</span>
                  <span className="chain-name">{chain.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Asset Selection */}
          <div className="swap-section">
            <label className="swap-label">Source Asset</label>
            <div className="asset-grid">
              {selectedChain.assets.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className={`asset-card ${selectedAsset.id === asset.id ? 'selected' : ''}`}
                  onClick={() => handleAssetSelect(asset)}
                >
                  <span className="asset-icon">{asset.icon}</span>
                  <span className="asset-symbol">{asset.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Amount Input */}
          <div className="swap-section">
            <label className="swap-label">Amount</label>
            <div className="swap-amount-input">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="amount-input"
              />
              <span className="amount-suffix">{selectedAsset.symbol}</span>
            </div>
          </div>

          {/* Source Address */}
          <div className="swap-section">
            <label className="swap-label">Your {selectedChain.name} Address</label>
            <input
              type="text"
              value={sourceAddress}
              onChange={(e) => setSourceAddress(e.target.value)}
              placeholder={`Enter your ${selectedChain.name} wallet address`}
              className="address-input"
            />
          </div>

          {/* Destination (read-only) */}
          <div className="swap-section">
            <label className="swap-label">Destination (Shielded ZEC)</label>
            <div className="swap-destination">
              <span className="destination-icon">🔒</span>
              <span className="destination-address">
                {zcashAddress ? `${zcashAddress.slice(0, 12)}...${zcashAddress.slice(-8)}` : 'Connect wallet'}
              </span>
            </div>
          </div>

          {/* Get Quote Button */}
          <button
            type="button"
            className="swap-button primary"
            onClick={handleGetQuotes}
            disabled={!isValidAmount || !sourceAddress || !zcashAddress || loadingQuotes}
          >
            {loadingQuotes ? (
              <>
                <span className="spinner" />
                Getting Quotes...
              </>
            ) : (
              'Get Quotes'
            )}
          </button>
        </div>
      )}

      {/* Step: Quote Selection */}
      {step === 'quote' && quotes && (
        <div className="swap-step swap-quote-step">
          <button type="button" className="swap-back-button" onClick={handleBack}>
            ← Back
          </button>

          <div className="swap-summary">
            <div className="summary-row">
              <span>Swapping</span>
              <span className="summary-value">
                {amount} {selectedAsset.symbol}
              </span>
            </div>
            <div className="summary-row">
              <span>From</span>
              <span className="summary-value">{selectedChain.name}</span>
            </div>
            <div className="summary-row">
              <span>To</span>
              <span className="summary-value">Shielded ZEC (Orchard)</span>
            </div>
          </div>

          <div className="swap-section">
            <label className="swap-label">Available Routes ({quotes.routes.length})</label>
            
            {quotes.routes.length === 0 ? (
              <div className="no-routes">
                <span className="no-routes-icon">⚠️</span>
                <span>No routes available for this swap</span>
              </div>
            ) : (
              <div className="routes-list">
                {quotes.routes.map((route, index) => (
                  <button
                    key={route.routeId}
                    type="button"
                    className={`route-card ${index === 0 ? 'best' : ''} ${selectedRoute?.routeId === route.routeId ? 'selected' : ''}`}
                    onClick={() => handleSelectRoute(route)}
                  >
                    {index === 0 && <div className="route-badge">Best Rate</div>}
                    <div className="route-provider">
                      <span className="provider-name">{route.provider}</span>
                      <span className="provider-time">~{Math.round(route.estimatedTimeSeconds / 60)}min</span>
                    </div>
                    <div className="route-output">
                      <span className="output-value">{formatZec(route.expectedAmountOut)}</span>
                      <span className="output-unit">ZEC</span>
                    </div>
                    <div className="route-fees">
                      Fee: {route.fees.feePercentage.toFixed(2)}%
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {loadingQuotes && (
            <div className="quotes-refreshing">
              <span className="spinner tiny" />
              Refreshing quotes...
            </div>
          )}
        </div>
      )}

      {/* Step: Confirmation */}
      {step === 'confirm' && selectedRoute && (
        <div className="swap-step swap-confirm-step">
          <button type="button" className="swap-back-button" onClick={handleBack}>
            ← Back
          </button>

          <div className="confirm-details">
            <h3>Confirm Swap</h3>
            
            <div className="confirm-box">
              <div className="confirm-row">
                <span className="confirm-label">You Send</span>
                <span className="confirm-value">
                  {amount} {selectedAsset.symbol} on {selectedChain.name}
                </span>
              </div>
              <div className="confirm-arrow">↓</div>
              <div className="confirm-row">
                <span className="confirm-label">You Receive</span>
                <span className="confirm-value highlight">
                  {formatZec(selectedRoute.expectedAmountOut)} ZEC (shielded)
                </span>
              </div>
            </div>

            <div className="confirm-meta">
              <div className="meta-row">
                <span>Provider</span>
                <span>{selectedRoute.provider}</span>
              </div>
              <div className="meta-row">
                <span>Min. Received</span>
                <span>{formatZec(selectedRoute.minimumAmountOut)} ZEC</span>
              </div>
              <div className="meta-row">
                <span>Total Fees</span>
                <span>{selectedRoute.fees.feePercentage.toFixed(2)}%</span>
              </div>
              <div className="meta-row">
                <span>Est. Time</span>
                <span>~{Math.round(selectedRoute.estimatedTimeSeconds / 60)} minutes</span>
              </div>
            </div>

            <div className="confirm-warning">
              <span className="warning-icon">ℹ️</span>
              <span>
                After deposit, ZEC will arrive at a fresh address and auto-shield to your Orchard pool.
              </span>
            </div>
          </div>

          <button
            type="button"
            className="swap-button primary"
            onClick={handleConfirmSwap}
          >
            Confirm & Get Deposit Address
          </button>
        </div>
      )}

      {/* Step: Deposit Instructions */}
      {step === 'deposit' && activeSession && (
        <div className="swap-step swap-deposit-step">
          <div className="deposit-header">
            <span className="deposit-icon">📥</span>
            <h3>Send Your {selectedAsset.symbol}</h3>
          </div>

          <div className="deposit-instructions">
            <div className="deposit-step">
              <span className="step-number">1</span>
              <span className="step-text">
                Send exactly <strong>{amount} {selectedAsset.symbol}</strong> from your {selectedChain.name} wallet
              </span>
            </div>

            <div className="deposit-address-box">
              <label>Deposit Address</label>
              <code className="deposit-address">
                {activeSession.tracking.inboundAddress || 'Loading...'}
              </code>
              <button
                type="button"
                className="copy-button"
                onClick={handleCopyAddress}
              >
                {copiedAddress ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>

            {activeSession.tracking.providerSwapId && (
              <div className="deposit-memo-box">
                <label>Memo (Required)</label>
                <code className="deposit-memo">
                  {activeSession.tracking.providerSwapId}
                </code>
                <button
                  type="button"
                  className="copy-button"
                  onClick={handleCopyMemo}
                >
                  {copiedMemo ? '✓ Copied!' : '📋 Copy'}
                </button>
              </div>
            )}

            <div className="deposit-step">
              <span className="step-number">2</span>
              <span className="step-text">
                Wait for confirmation (usually {Math.round(selectedRoute!.estimatedTimeSeconds / 60)} minutes)
              </span>
            </div>

            <div className="deposit-step">
              <span className="step-number">3</span>
              <span className="step-text">
                ZEC auto-shields to your Orchard address 🔒
              </span>
            </div>
          </div>

          <button
            type="button"
            className="swap-button secondary"
            onClick={() => setStep('tracking')}
          >
            I've Sent - Track Progress
          </button>
        </div>
      )}

      {/* Step: Tracking */}
      {step === 'tracking' && activeSession && (
        <div className="swap-step swap-tracking-step">
          <div className="tracking-header">
            <h3>Swap Progress</h3>
            <span className={`status-badge ${activeSession.status}`}>
              {activeSession.status.replace(/_/g, ' ')}
            </span>
          </div>

          <div className="tracking-timeline">
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'deposit')}
              label="Deposit Received"
              time={activeSession.timestamps.depositConfirmed}
            />
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'swap')}
              label="Swap Executing"
              time={activeSession.timestamps.swapStarted}
            />
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'output')}
              label="ZEC Received"
              time={activeSession.timestamps.outputConfirmed}
            />
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'shield')}
              label="Auto-Shielded"
              time={activeSession.timestamps.completed}
            />
          </div>

          {activeSession.tracking.trackingUrl && (
            <a
              href={activeSession.tracking.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tracking-link"
            >
              View on Explorer →
            </a>
          )}

          {activeSession.status === 'completed' && (
            <div className="swap-complete">
              <span className="complete-icon">✅</span>
              <span className="complete-text">
                {formatZec(activeSession.actualAmountOut || activeSession.expectedAmountOut)} ZEC shielded!
              </span>
            </div>
          )}

          {activeSession.error && (
            <div className="swap-error-inline">
              <span className="error-icon">⚠️</span>
              <span>{activeSession.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="swap-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button type="button" className="error-dismiss" onClick={clearError}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

interface TimelineStepProps {
  status: 'pending' | 'active' | 'complete';
  label: string;
  time?: number;
}

function TimelineStep({ status, label, time }: TimelineStepProps) {
  return (
    <div className={`timeline-step ${status}`}>
      <div className="timeline-dot">
        {status === 'complete' && '✓'}
        {status === 'active' && <span className="dot-spinner" />}
      </div>
      <div className="timeline-content">
        <span className="timeline-label">{label}</span>
        {time && (
          <span className="timeline-time">
            {new Date(time).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}

function getStepStatus(
  swapStatus: string,
  step: 'deposit' | 'swap' | 'output' | 'shield'
): 'pending' | 'active' | 'complete' {
  const statusOrder = [
    'awaiting_deposit',
    'deposit_detected',
    'deposit_confirmed',
    'swap_in_progress',
    'output_pending',
    'output_confirmed',
    'auto_shielding',
    'completed',
  ];

  const stepMapping: Record<string, number> = {
    deposit: 2, // deposit_confirmed
    swap: 3,    // swap_in_progress
    output: 5,  // output_confirmed
    shield: 7,  // completed
  };

  const currentIndex = statusOrder.indexOf(swapStatus);
  const stepIndex = stepMapping[step];

  if (currentIndex >= stepIndex) return 'complete';
  if (currentIndex === stepIndex - 1) return 'active';
  return 'pending';
}

export default SwapToShielded;

