/**
 * SwapFromShielded Component
 * 
 * "Spend shielded ZEC cross-chain" flow.
 * 
 * This component enables non-custodial off-ramp and cross-chain payment from
 * Orchard balance without using centralized exchanges.
 * 
 * Flow:
 * 1. User selects destination asset + chain (USDC on Base, SOL, BTC, etc.)
 * 2. SwapKit/NEAR Intents discovers routes and provides quotes
 * 3. User confirms swap → wallet unshields from Orchard to fresh t-addr
 * 4. Transparent ZEC sent to swap deposit address
 * 5. Destination asset delivered to user's wallet
 * 
 * Privacy features:
 * - Unshield to fresh t-addr (never reused)
 * - Swap metadata kept local
 * - Network separation between swap RPCs and Zcash node
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSwap, useAutoRefreshQuotes } from '../../hooks/useSwap';
import { useSwapWalletActions } from '../../hooks/useSwapWalletActions';
import type { ChainAsset, SwapRoute, SwapSession } from '../../services/swap';
import './Swap.css';

// ═══════════════════════════════════════════════════════════════════════════════
// DESTINATION CHAIN DEFINITIONS
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

const DESTINATION_CHAINS: ChainDefinition[] = [
  {
    id: 'base',
    name: 'Base',
    icon: '◎',
    color: '#0052FF',
    assets: [
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
    ],
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    icon: '◆',
    color: '#627EEA',
    assets: [
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
      { id: 'USDT', name: 'Tether', symbol: 'USDT', icon: '◎', decimals: 6 },
    ],
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    icon: '⬡',
    color: '#28A0F0',
    assets: [
      { id: 'USDC', name: 'USD Coin', symbol: 'USDC', icon: '◉', decimals: 6 },
      { id: 'ETH', name: 'Ethereum', symbol: 'ETH', icon: '◆', decimals: 18 },
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

interface SwapFromShieldedProps {
  /** User's Orchard balance in zatoshis */
  orchardBalanceZats: bigint;
  /** Callback when swap is initiated (triggers unshield) */
  onSwapInitiated?: (session: SwapSession, unshieldAmount: bigint, freshTaddr: string) => void;
  /** Callback when swap completes */
  onSwapCompleted?: (session: SwapSession) => void;
  /** Callback to trigger unshield transaction */
  onUnshieldRequired?: (amount: bigint, toAddress: string) => Promise<string>; // Returns tx hash
}

export function SwapFromShielded({
  orchardBalanceZats,
  onSwapInitiated,
  onSwapCompleted,
  onUnshieldRequired,
}: SwapFromShieldedProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const [selectedChain, setSelectedChain] = useState<ChainDefinition>(DESTINATION_CHAINS[0]);
  const [selectedAsset, setSelectedAsset] = useState<AssetDefinition>(DESTINATION_CHAINS[0].assets[0]);
  const [amountZec, setAmountZec] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<SwapRoute | null>(null);
  const [step, setStep] = useState<'input' | 'quote' | 'confirm' | 'unshield' | 'tracking'>('input');
  const [unshieldStatus, setUnshieldStatus] = useState<'pending' | 'confirming' | 'complete'>('pending');

  const {
    quotes,
    loadingQuotes,
    activeSession,
    error,
    getQuotesFromZec,
    executeSwapFromZec,
    continueOutbound,
    clearError,
    refreshQuotes,
  } = useSwap();

  const { saveSwapSession, getFreshTransparentAddress } = useSwapWalletActions();
  const [copiedAddress, setCopiedAddress] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED
  // ═══════════════════════════════════════════════════════════════════════════

  const amountZats = useMemo(() => {
    const parsed = parseFloat(amountZec);
    if (!Number.isFinite(parsed) || parsed <= 0) return BigInt(0);
    return BigInt(Math.floor(parsed * 1e8));
  }, [amountZec]);

  const isValidAmount = amountZats > BigInt(0) && amountZats <= orchardBalanceZats;

  const orchardBalanceZec = useMemo(() => {
    return Number(orchardBalanceZats) / 1e8;
  }, [orchardBalanceZats]);

  const chainAsset: ChainAsset = useMemo(() => ({
    chain: selectedChain.id as ChainAsset['chain'],
    asset: selectedAsset.id as ChainAsset['asset'],
    contractAddress: selectedAsset.contractAddress,
  }), [selectedChain.id, selectedAsset.id, selectedAsset.contractAddress]);

  // Format amounts for display
  const formatZec = (zatoshis: bigint): string => {
    const zec = Number(zatoshis) / 1e8;
    return zec.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  const formatOutput = (smallestUnit: bigint, decimals: number): string => {
    const amount = Number(smallestUnit) / Math.pow(10, decimals);
    return amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (activeSession?.status === 'completed' && onSwapCompleted) {
      onSwapCompleted(activeSession);
    }
  }, [activeSession?.status, activeSession, onSwapCompleted]);

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

  const handleSetMax = useCallback(() => {
    setAmountZec(orchardBalanceZec.toString());
  }, [orchardBalanceZec]);

  const handleGetQuotes = useCallback(async () => {
    if (!isValidAmount || !destinationAddress) return;

    clearError();
    try {
      await getQuotesFromZec(chainAsset, amountZats, destinationAddress);
      setStep('quote');
    } catch (err) {
      console.error('Quote error:', err);
    }
  }, [isValidAmount, destinationAddress, chainAsset, amountZats, getQuotesFromZec, clearError]);

  const handleSelectRoute = useCallback((route: SwapRoute) => {
    setSelectedRoute(route);
    setStep('confirm');
  }, []);

  const handleConfirmSwap = useCallback(async () => {
    if (!selectedRoute) return;

    clearError();
    try {
      // Generate fresh transparent address from wallet
      const freshTaddr = await getFreshTransparentAddress('swap_outbound');
      console.log('[SwapFromShielded] Fresh t-addr:', freshTaddr.address.slice(0, 10) + '...');

      const session = await executeSwapFromZec(selectedRoute, destinationAddress, orchardBalanceZats);
      
      // Save session to local storage
      await saveSwapSession(session);
      
      if (onSwapInitiated && session.freshTransparentAddress) {
        onSwapInitiated(session, amountZats, session.freshTransparentAddress);
      }
      
      setStep('unshield');
      setUnshieldStatus('pending');
    } catch (err) {
      console.error('Swap execution error:', err);
    }
  }, [selectedRoute, destinationAddress, orchardBalanceZats, executeSwapFromZec, onSwapInitiated, amountZats, clearError, saveSwapSession, getFreshTransparentAddress]);

  const handleCopyAddress = useCallback(() => {
    if (activeSession?.freshTransparentAddress) {
      navigator.clipboard.writeText(activeSession.freshTransparentAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  }, [activeSession?.freshTransparentAddress]);

  const handleUnshieldComplete = useCallback(async (txHash: string) => {
    if (!activeSession) return;

    setUnshieldStatus('confirming');
    
    try {
      await continueOutbound(activeSession.sessionId, txHash);
      setUnshieldStatus('complete');
      setStep('tracking');
    } catch (err) {
      console.error('Continue swap error:', err);
    }
  }, [activeSession, continueOutbound]);

  const handleTriggerUnshield = useCallback(async () => {
    if (!onUnshieldRequired || !activeSession?.freshTransparentAddress) return;

    setUnshieldStatus('confirming');
    
    try {
      const txHash = await onUnshieldRequired(amountZats, activeSession.freshTransparentAddress);
      await handleUnshieldComplete(txHash);
    } catch (err) {
      console.error('Unshield error:', err);
      setUnshieldStatus('pending');
    }
  }, [onUnshieldRequired, activeSession, amountZats, handleUnshieldComplete]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'quote':
        setStep('input');
        break;
      case 'confirm':
        setStep('quote');
        break;
    }
  }, [step]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="swap-from-shielded">
      {/* Header */}
      <div className="swap-header">
        <div className="swap-title">
          <span className="swap-title-icon">🔓</span>
          <h2>Spend Shielded ZEC</h2>
        </div>
        <p className="swap-subtitle">
          Swap to any chain via NEAR Intents + SwapKit (non-custodial)
        </p>
      </div>

      {/* Balance Display */}
      <div className="swap-balance">
        <div>
          <span className="balance-label">Orchard Balance</span>
        </div>
        <div>
          <span className="balance-value">{formatZec(orchardBalanceZats)}</span>
          <span className="balance-unit">ZEC</span>
        </div>
      </div>

      {/* Privacy Notice */}
      <div className="swap-privacy-notice">
        <span className="privacy-icon">🛡️</span>
        <span>
          Unshields to fresh t-addr • Swap data never on-chain
        </span>
      </div>

      {/* Step: Input */}
      {step === 'input' && (
        <div className="swap-step swap-input-step">
          {/* ZEC Amount */}
          <div className="swap-section">
            <label className="swap-label">Amount to Swap (ZEC)</label>
            <div className="swap-amount-input">
              <input
                type="text"
                inputMode="decimal"
                value={amountZec}
                onChange={(e) => setAmountZec(e.target.value)}
                placeholder="0.0"
                className="amount-input"
              />
              <span className="amount-suffix">ZEC</span>
              <button type="button" className="max-button" onClick={handleSetMax}>
                MAX
              </button>
            </div>
            {amountZats > orchardBalanceZats && (
              <div className="swap-error-inline">
                <span className="error-icon">⚠️</span>
                Insufficient balance
              </div>
            )}
          </div>

          {/* Destination Chain */}
          <div className="swap-section">
            <label className="swap-label">Destination Chain</label>
            <div className="chain-grid">
              {DESTINATION_CHAINS.map((chain) => (
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

          {/* Destination Asset */}
          <div className="swap-section">
            <label className="swap-label">Receive Asset</label>
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

          {/* Destination Address */}
          <div className="swap-section">
            <label className="swap-label">Your {selectedChain.name} Address</label>
            <input
              type="text"
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder={`Enter your ${selectedChain.name} wallet address`}
              className="address-input"
            />
          </div>

          {/* Get Quote Button */}
          <button
            type="button"
            className="swap-button primary"
            onClick={handleGetQuotes}
            disabled={!isValidAmount || !destinationAddress || loadingQuotes}
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
              <span>Spending</span>
              <span className="summary-value">
                {formatZec(amountZats)} ZEC (shielded)
              </span>
            </div>
            <div className="summary-row">
              <span>Receiving on</span>
              <span className="summary-value">{selectedChain.name}</span>
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
                      <span className="output-value">
                        {formatOutput(route.expectedAmountOut, selectedAsset.decimals)}
                      </span>
                      <span className="output-unit">{selectedAsset.symbol}</span>
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
                <span className="confirm-label">You Spend</span>
                <span className="confirm-value">
                  {formatZec(amountZats)} ZEC (from Orchard)
                </span>
              </div>
              <div className="confirm-arrow">↓</div>
              <div className="confirm-row">
                <span className="confirm-label">You Receive</span>
                <span className="confirm-value highlight">
                  {formatOutput(selectedRoute.expectedAmountOut, selectedAsset.decimals)} {selectedAsset.symbol}
                </span>
              </div>
              <div className="confirm-row">
                <span className="confirm-label">On</span>
                <span className="confirm-value">{selectedChain.name}</span>
              </div>
            </div>

            <div className="confirm-meta">
              <div className="meta-row">
                <span>Provider</span>
                <span>{selectedRoute.provider}</span>
              </div>
              <div className="meta-row">
                <span>Min. Received</span>
                <span>
                  {formatOutput(selectedRoute.minimumAmountOut, selectedAsset.decimals)} {selectedAsset.symbol}
                </span>
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
                Your ZEC will be unshielded to a fresh transparent address, then swapped.
              </span>
            </div>
          </div>

          <button
            type="button"
            className="swap-button primary"
            onClick={handleConfirmSwap}
          >
            Confirm & Start Unshield
          </button>
        </div>
      )}

      {/* Step: Unshield */}
      {step === 'unshield' && activeSession && (
        <div className="swap-step swap-unshield-step">
          <div className="deposit-header">
            <span className="deposit-icon">🔓</span>
            <h3>Unshield Your ZEC</h3>
          </div>

          <div className="deposit-instructions">
            <div className="deposit-step">
              <span className="step-number">1</span>
              <span className="step-text">
                Unshield <strong>{formatZec(amountZats)} ZEC</strong> from Orchard to the fresh transparent address below
              </span>
            </div>

            <div className="deposit-address-box">
              <label>Fresh Transparent Address</label>
              <code className="deposit-address">
                {activeSession.freshTransparentAddress || 'Generating...'}
              </code>
              <button
                type="button"
                className="copy-button"
                onClick={handleCopyAddress}
              >
                {copiedAddress ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>

            <div className="deposit-step">
              <span className="step-number">2</span>
              <span className="step-text">
                Wait for confirmation, then the swap will proceed automatically
              </span>
            </div>
          </div>

          <div className="unshield-status">
            {unshieldStatus === 'pending' && (
              <div className="status-pending">
                <span className="status-icon">⏳</span>
                <span>Waiting for unshield transaction...</span>
              </div>
            )}
            {unshieldStatus === 'confirming' && (
              <div className="status-confirming">
                <span className="spinner tiny" />
                <span>Confirming unshield transaction...</span>
              </div>
            )}
          </div>

          {onUnshieldRequired && (
            <button
              type="button"
              className="swap-button primary"
              onClick={handleTriggerUnshield}
              disabled={unshieldStatus !== 'pending'}
            >
              {unshieldStatus === 'pending' ? 'Unshield Now' : 'Processing...'}
            </button>
          )}

          <p className="swap-hint">
            Or send the unshield transaction from your wallet app, then it will be detected automatically.
          </p>
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
              status={getStepStatus(activeSession.status, 'unshield')}
              label="ZEC Unshielded"
              time={activeSession.timestamps.depositConfirmed}
            />
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'swap')}
              label="Swap Executing"
              time={activeSession.timestamps.swapStarted}
            />
            <TimelineStep 
              status={getStepStatus(activeSession.status, 'output')}
              label={`${selectedAsset.symbol} Delivered`}
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
                {formatOutput(activeSession.actualAmountOut || activeSession.expectedAmountOut, selectedAsset.decimals)} {selectedAsset.symbol} delivered!
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
  step: 'unshield' | 'swap' | 'output'
): 'pending' | 'active' | 'complete' {
  const statusOrder = [
    'awaiting_deposit',
    'deposit_detected',
    'deposit_confirmed',
    'swap_in_progress',
    'output_pending',
    'output_confirmed',
    'completed',
  ];

  const stepMapping: Record<string, number> = {
    unshield: 2, // deposit_confirmed
    swap: 3,     // swap_in_progress
    output: 6,   // completed
  };

  const currentIndex = statusOrder.indexOf(swapStatus);
  const stepIndex = stepMapping[step];

  if (currentIndex >= stepIndex) return 'complete';
  if (currentIndex === stepIndex - 1) return 'active';
  return 'pending';
}

export default SwapFromShielded;

