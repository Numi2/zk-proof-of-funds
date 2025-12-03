/**
 * SwapPage Component
 * 
 * Unified swap interface for both directions:
 * - Swap TO shielded ZEC (inbound)
 * - Swap FROM shielded ZEC (outbound)
 * 
 * This standardizes the NEAR Intents + SwapKit flow across all Zcash wallets.
 * Follows the same patterns as other wallet components (WalletSend, WalletReceive).
 */

import { useState, useEffect, useCallback } from 'react';
import { useSwapWalletActions, zatsToZec } from '../../hooks/useSwapWalletActions';
import { useSwap } from '../../hooks/useSwap';
import { SwapToShielded } from './SwapToShielded';
import { SwapFromShielded } from './SwapFromShielded';
import { TeeAgentChat } from '../tee-agent';
import type { SwapSession, FreshAddress } from '../../services/swap';
import { hasSwapKitApiKey } from '../../services/swap';
import './Swap.css';

type SwapDirection = 'to_zec' | 'from_zec' | 'ai_agent';

export function SwapPage() {
  const {
    walletState,
    getSwapWalletState,
    createUnshieldTransaction,
    saveSwapSession,
    loadSwapSessions,
    getFreshTransparentAddress,
    getFreshOrchardAddress,
  } = useSwapWalletActions();

  const { setAddressGenerator } = useSwap();

  const [direction, setDirection] = useState<SwapDirection>('to_zec');
  const [zcashAddress, setZcashAddress] = useState<string>('');
  const [recentSessions, setRecentSessions] = useState<SwapSession[]>([]);
  const [isLoadingAddress, setIsLoadingAddress] = useState(true);
  
  // Check if we're in demo mode (no SwapKit API key configured)
  const isDemoMode = !hasSwapKitApiKey();

  // Wire up the wallet's address generator with the swap service
  useEffect(() => {
    if (walletState.isConnected) {
      setAddressGenerator(async (type: 'transparent' | 'orchard', purpose: string): Promise<FreshAddress> => {
        if (type === 'transparent') {
          return getFreshTransparentAddress(purpose);
        } else {
          return getFreshOrchardAddress(purpose);
        }
      });
    }
  }, [walletState.isConnected, setAddressGenerator, getFreshTransparentAddress, getFreshOrchardAddress]);

  // Load wallet addresses on mount
  useEffect(() => {
    const loadWalletData = async () => {
      setIsLoadingAddress(true);
      try {
        const state = await getSwapWalletState();
        if (state.unifiedAddress) {
          setZcashAddress(state.unifiedAddress);
        }
        
        // Load recent swap sessions
        const sessions = await loadSwapSessions();
        setRecentSessions(sessions.slice(-5).reverse()); // Last 5, most recent first
      } catch (err) {
        console.error('Failed to load wallet data:', err);
      } finally {
        setIsLoadingAddress(false);
      }
    };

    if (walletState.isConnected) {
      loadWalletData();
    } else {
      setIsLoadingAddress(false);
    }
  }, [walletState.isConnected, getSwapWalletState, loadSwapSessions]);

  // Handlers
  const handleSwapToZecInitiated = useCallback(async (session: SwapSession) => {
    console.log('Swap to ZEC initiated:', session.sessionId);
    await saveSwapSession(session);
    setRecentSessions(prev => [session, ...prev.slice(0, 4)]);
  }, [saveSwapSession]);

  const handleSwapFromZecInitiated = useCallback(async (
    session: SwapSession,
    unshieldAmount: bigint,
    freshTaddr: string
  ) => {
    console.log('Swap from ZEC initiated:', session.sessionId);
    console.log('Unshield', zatsToZec(unshieldAmount), 'ZEC to', freshTaddr.slice(0, 10) + '...');
    await saveSwapSession(session);
    setRecentSessions(prev => [session, ...prev.slice(0, 4)]);
  }, [saveSwapSession]);

  const handleSwapCompleted = useCallback(async (session: SwapSession) => {
    console.log('Swap completed:', session.sessionId);
    await saveSwapSession(session);
    // Refresh sessions list
    const sessions = await loadSwapSessions();
    setRecentSessions(sessions.slice(-5).reverse());
  }, [saveSwapSession, loadSwapSessions]);

  /**
   * Handler for unshielding - creates the actual transaction.
   * Called when user confirms outbound swap.
   */
  const handleUnshieldRequired = useCallback(async (
    amount: bigint,
    toAddress: string
  ): Promise<string> => {
    console.log('[SwapPage] Unshield required:', zatsToZec(amount), 'ZEC to', toAddress.slice(0, 10) + '...');
    
    const result = await createUnshieldTransaction(amount, toAddress);
    
    if (result.status === 'pending') {
      // Transaction created but needs broadcast
      // In production, this would be automatically broadcast
      console.log('[SwapPage] Unshield tx created:', result.txid);
    }
    
    return result.txid;
  }, [createUnshieldTransaction]);

  // Loading state
  if (walletState.isLoading || isLoadingAddress) {
    return (
      <div className="swap-page">
        <div className="card swap-loading">
          <span className="spinner"></span>
          <p className="muted">Loading wallet...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="swap-page">
      {/* Demo Mode Notice */}
      {isDemoMode && (
        <div className="swap-demo-notice">
          <div className="demo-badge">🔬 Demo Mode</div>
          <p>
            Swap quotes use simulated data. For production quotes, set <code>VITE_SWAPKIT_API_KEY</code>.
            Get a key at <a href="https://www.swapkit.dev/" target="_blank" rel="noopener noreferrer">swapkit.dev</a>
          </p>
        </div>
      )}

      {/* Direction Toggle */}
      <div className="swap-direction-toggle">
        <button
          type="button"
          className={`direction-button ${direction === 'to_zec' ? 'active' : ''}`}
          onClick={() => setDirection('to_zec')}
        >
          <span className="direction-icon">📥</span>
          <span>Swap to ZEC</span>
        </button>
        <button
          type="button"
          className={`direction-button ${direction === 'from_zec' ? 'active' : ''}`}
          onClick={() => setDirection('from_zec')}
        >
          <span className="direction-icon">📤</span>
          <span>Spend ZEC</span>
        </button>
        <button
          type="button"
          className={`direction-button ai-button ${direction === 'ai_agent' ? 'active' : ''}`}
          onClick={() => setDirection('ai_agent')}
        >
          <span className="direction-icon">AI</span>
          <span>AI Agent</span>
        </button>
      </div>

      {/* Conditional Render based on direction */}
      {direction === 'to_zec' && (
        <SwapToShielded
          zcashAddress={zcashAddress}
          onSwapInitiated={handleSwapToZecInitiated}
          onSwapCompleted={handleSwapCompleted}
        />
      )}
      
      {direction === 'from_zec' && (
        walletState.isConnected ? (
          <SwapFromShielded
            orchardBalanceZats={walletState.orchardBalanceZats}
            onSwapInitiated={handleSwapFromZecInitiated}
            onSwapCompleted={handleSwapCompleted}
            onUnshieldRequired={handleUnshieldRequired}
          />
        ) : (
          <div className="swap-connect-prompt">
            <div className="connect-icon">🔒</div>
            <h3>Connect Wallet</h3>
            <p>Connect your Zcash wallet to spend shielded ZEC</p>
          </div>
        )
      )}

      {direction === 'ai_agent' && (
        <div className="swap-ai-agent-section">
          <TeeAgentChat className="swap-ai-chat" />
        </div>
      )}

      {/* Recent Swaps */}
      {recentSessions.length > 0 && (
        <div className="swap-recent-section">
          <h4>Recent Swaps</h4>
          <div className="swap-recent-list">
            {recentSessions.map((session) => (
              <div key={session.sessionId} className="swap-recent-item">
                <div className="swap-recent-icon">
                  {session.direction === 'inbound' ? '📥' : '📤'}
                </div>
                <div className="swap-recent-details">
                  <span className="swap-recent-amount">
                    {session.direction === 'inbound'
                      ? `${formatSmallUnits(session.amountIn, 8)} → ${zatsToZec(session.expectedAmountOut)} ZEC`
                      : `${zatsToZec(session.amountIn)} ZEC → ${formatSmallUnits(session.expectedAmountOut, 8)}`
                    }
                  </span>
                  <span className="swap-recent-time">
                    {formatRelativeTime(session.timestamps.created)}
                  </span>
                </div>
                <div className={`swap-recent-status ${session.status}`}>
                  {formatStatus(session.status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="swap-info-section">
        <h4>How it works</h4>
        {direction === 'to_zec' ? (
          <div className="info-steps">
            <div className="info-step">
              <span className="info-number">1</span>
              <span>Select your source chain and asset</span>
            </div>
            <div className="info-step">
              <span className="info-number">2</span>
              <span>Get quotes from NEAR Intents & SwapKit</span>
            </div>
            <div className="info-step">
              <span className="info-number">3</span>
              <span>Send from your source wallet</span>
            </div>
            <div className="info-step">
              <span className="info-number">4</span>
              <span>ZEC auto-shields to your Orchard pool 🔒</span>
            </div>
          </div>
        ) : (
          <div className="info-steps">
            <div className="info-step">
              <span className="info-number">1</span>
              <span>Select destination chain and asset</span>
            </div>
            <div className="info-step">
              <span className="info-number">2</span>
              <span>Get quotes from NEAR Intents & SwapKit</span>
            </div>
            <div className="info-step">
              <span className="info-number">3</span>
              <span>ZEC unshields to fresh t-address</span>
            </div>
            <div className="info-step">
              <span className="info-number">4</span>
              <span>Receive assets on destination chain</span>
            </div>
          </div>
        )}

        <div className="privacy-features">
          <h5>Privacy Features</h5>
          <ul>
            <li>Fresh addresses for every swap (never reused)</li>
            <li>Swap metadata kept local (not on-chain)</li>
            <li>🔒 Network separation for swap queries</li>
            <li>⏱️ Timing randomization to prevent correlation</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function formatSmallUnits(amount: bigint, decimals: number): string {
  const num = Number(amount) / Math.pow(10, decimals);
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    idle: 'Pending',
    awaiting_deposit: 'Waiting',
    deposit_detected: 'Detected',
    deposit_confirmed: 'Confirmed',
    swap_in_progress: 'Swapping',
    output_pending: 'Pending',
    output_confirmed: 'Received',
    auto_shielding: 'Shielding',
    completed: 'Complete',
    failed: 'Failed',
    refunded: 'Refunded',
  };
  return statusMap[status] || status;
}

export default SwapPage;
