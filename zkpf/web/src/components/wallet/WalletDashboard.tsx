import { useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generate_seed_phrase } from '@chainsafe/webzjs-keys';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';

function zatsToZec(zats: number): string {
  return (zats / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

type WalletMethod = 'seed' | 'snap';

export function WalletDashboard() {
  const { state } = useWebZjsContext();
  const { connectWebZjsSnap, triggerRescan, createAccountFromSeed } = useWebzjsActions();
  const navigate = useNavigate();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletMethod, setWalletMethod] = useState<WalletMethod>('seed');
  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedBirthdayInput, setSeedBirthdayInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const isConnected = state.activeAccount != null;
  const isSyncing = state.syncInProgress;
  const isWebWalletAvailable = state.webWallet !== null;

  const activeBalanceReport = useMemo(() => {
    if (!state.summary || state.activeAccount == null) return null;
    return state.summary.account_balances.find(
      ([accountId]) => accountId === state.activeAccount
    );
  }, [state.summary, state.activeAccount]);

  const balances = useMemo(() => {
    if (!activeBalanceReport) {
      return {
        total: 0,
        shielded: 0,
        unshielded: 0,
        sapling: 0,
        orchard: 0,
      };
    }
    const balance = activeBalanceReport[1];
    const shielded = balance.sapling_balance + balance.orchard_balance;
    const unshielded = balance.unshielded_balance || 0;
    return {
      total: shielded + unshielded,
      shielded,
      unshielded,
      sapling: balance.sapling_balance,
      orchard: balance.orchard_balance,
    };
  }, [activeBalanceReport]);

  const chainInfo = useMemo(() => {
    if (!state.summary) return null;
    return {
      tipHeight: state.summary.chain_tip_height,
      scannedHeight: state.summary.fully_scanned_height,
    };
  }, [state.summary]);

  const handleConnectSnap = useCallback(async () => {
    setIsConnecting(true);
    setLocalError(null);
    try {
      await connectWebZjsSnap();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setLocalError(message);
      console.error('Failed to connect wallet:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [connectWebZjsSnap]);

  const handleGenerateSeed = useCallback(() => {
    try {
      // Use the real BIP-39 seed generator from webzjs-keys
      const newSeed = generate_seed_phrase();
      setSeedPhraseInput(newSeed);
      setLocalError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate seed phrase';
      setLocalError(message);
    }
  }, []);

  const handleCreateFromSeed = useCallback(async () => {
    const phrase = seedPhraseInput.trim();
    if (!phrase) {
      setLocalError('Enter a 24-word seed phrase');
      return;
    }

    const wordCount = phrase.split(/\s+/).length;
    if (wordCount !== 24) {
      setLocalError(`Seed phrase must be exactly 24 words (you entered ${wordCount})`);
      return;
    }

    let birthday: number | null = null;
    if (seedBirthdayInput.trim()) {
      const parsed = Number(seedBirthdayInput.trim().replace(/[, _]/g, ''));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setLocalError('Birthday height must be a positive integer');
        return;
      }
      birthday = Math.floor(parsed);
    }

    setIsConnecting(true);
    setLocalError(null);
    try {
      await createAccountFromSeed(phrase, birthday);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create wallet from seed';
      setLocalError(message);
      console.error('Failed to create wallet:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [seedPhraseInput, seedBirthdayInput, createAccountFromSeed]);

  const handleSync = useCallback(async () => {
    try {
      await triggerRescan();
    } catch (err) {
      console.error('Failed to sync wallet:', err);
    }
  }, [triggerRescan]);

  const displayError = localError || (state.error ? (typeof state.error === 'string' ? state.error : state.error.message) : null);

  if (!isConnected) {
    return (
      <div className="wallet-connect-prompt">
        <div className="card wallet-connect-card wallet-connect-card-wide">
          <div className="wallet-connect-icon">🔐</div>
          <h3>Create Your Zcash Wallet</h3>
          <p className="muted">
            Choose how you want to create or connect your Zcash wallet.
            Your keys stay secure in your browser.
          </p>

          {!isWebWalletAvailable && (
            <div className="wallet-warning" style={{ marginBottom: '1rem', textAlign: 'left' }}>
              <span className="warning-icon">⚠️</span>
              <span>
                WebWallet requires SharedArrayBuffer support. Some features may not work in this browser.
              </span>
            </div>
          )}

          {/* Wallet Method Tabs */}
          <div className="wallet-method-tabs" style={{ marginBottom: '1.5rem' }}>
            <button
              type="button"
              className={`wallet-method-tab ${walletMethod === 'seed' ? 'active' : ''}`}
              onClick={() => setWalletMethod('seed')}
            >
              <span className="wallet-method-icon">🌱</span>
              <span className="wallet-method-label">Seed Phrase</span>
              <span className="wallet-method-badge recommended">Recommended</span>
            </button>
            <button
              type="button"
              className={`wallet-method-tab ${walletMethod === 'snap' ? 'active' : ''}`}
              onClick={() => setWalletMethod('snap')}
            >
              <span className="wallet-method-icon">🦊</span>
              <span className="wallet-method-label">MetaMask Snap</span>
            </button>
          </div>

          {walletMethod === 'seed' && (
            <div className="wallet-seed-form">
              <div className="wallet-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                <strong style={{ alignSelf: 'flex-start' }}>Seed phrase (24 words)</strong>
                <textarea
                  value={seedPhraseInput}
                  onChange={(e) => setSeedPhraseInput(e.target.value)}
                  placeholder="Enter your 24-word seed phrase, or generate a new one..."
                  rows={3}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <button
                  type="button"
                  className="ghost tiny-button"
                  onClick={handleGenerateSeed}
                  style={{ alignSelf: 'flex-end' }}
                >
                  🎲 Generate New Seed
                </button>
              </div>

              <div className="wallet-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem', marginTop: '0.75rem' }}>
                <strong style={{ alignSelf: 'flex-start' }}>Birthday height (optional)</strong>
                <input
                  type="text"
                  value={seedBirthdayInput}
                  onChange={(e) => setSeedBirthdayInput(e.target.value)}
                  placeholder="Block height when wallet first received funds"
                  style={{ width: '100%' }}
                />
              </div>

              <p className="muted small" style={{ marginTop: '0.75rem', textAlign: 'left' }}>
                Leave birthday empty for new wallets. For existing wallets, enter the approximate block height 
                when your wallet first received funds to speed up initial sync.
              </p>

              <button 
                onClick={handleCreateFromSeed} 
                disabled={isConnecting || state.loading || !isWebWalletAvailable || !seedPhraseInput.trim()}
                className="wallet-connect-button"
                style={{ marginTop: '1rem' }}
              >
                {isConnecting ? 'Creating Wallet...' : 'Create Wallet from Seed'}
              </button>
            </div>
          )}

          {walletMethod === 'snap' && (
            <div className="wallet-snap-form">
              <div className="wallet-connect-features">
                <div className="wallet-feature">
                  <span className="wallet-feature-icon">🛡️</span>
                  <span>Private & Shielded</span>
                </div>
                <div className="wallet-feature">
                  <span className="wallet-feature-icon">📱</span>
                  <span>Browser-Based</span>
                </div>
                <div className="wallet-feature">
                  <span className="wallet-feature-icon">🔒</span>
                  <span>Self-Custody</span>
                </div>
              </div>

              <p className="muted small" style={{ marginTop: '1rem', textAlign: 'left' }}>
                Connect via MetaMask Snap to manage your Zcash funds. Keys stay securely inside MetaMask.
                Requires MetaMask Flask or MetaMask with Snaps support.
              </p>

              <button 
                onClick={handleConnectSnap} 
                disabled={isConnecting || state.loading || !isWebWalletAvailable}
                className="wallet-connect-button"
                style={{ marginTop: '1rem' }}
              >
                {isConnecting ? 'Connecting...' : 'Connect MetaMask Snap'}
              </button>
            </div>
          )}

          {displayError && (
            <div className="error-message" style={{ marginTop: '1rem' }}>
              <span className="error-icon">⚠️</span>
              <span>{displayError}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-dashboard">
      {/* Balance Cards */}
      <div className="wallet-balance-grid">
        <div className="wallet-balance-card wallet-balance-card-total">
          <div className="wallet-balance-header">
            <span className="wallet-balance-icon">💰</span>
            <span className="wallet-balance-label">Total Balance</span>
          </div>
          <div className="wallet-balance-value">
            {zatsToZec(balances.total)} <span className="wallet-balance-unit">ZEC</span>
          </div>
          <div className="wallet-balance-actions">
            <button className="tiny-button" onClick={() => navigate('/wallet/receive')}>
              Receive
            </button>
            <button className="tiny-button" onClick={() => navigate('/wallet/send')}>
              Send
            </button>
          </div>
        </div>

        <div className="wallet-balance-card wallet-balance-card-shielded">
          <div className="wallet-balance-header">
            <span className="wallet-balance-icon">🛡️</span>
            <span className="wallet-balance-label">Shielded Balance</span>
          </div>
          <div className="wallet-balance-value">
            {zatsToZec(balances.shielded)} <span className="wallet-balance-unit">ZEC</span>
          </div>
          <div className="wallet-balance-breakdown">
            <span>Orchard: {zatsToZec(balances.orchard)} ZEC</span>
            <span>Sapling: {zatsToZec(balances.sapling)} ZEC</span>
          </div>
        </div>

        <div className="wallet-balance-card wallet-balance-card-transparent">
          <div className="wallet-balance-header">
            <span className="wallet-balance-icon">📊</span>
            <span className="wallet-balance-label">Transparent Balance</span>
          </div>
          <div className="wallet-balance-value">
            {zatsToZec(balances.unshielded)} <span className="wallet-balance-unit">ZEC</span>
          </div>
          {balances.unshielded > 0 && (
            <p className="wallet-balance-hint">
              Shield your transparent funds for privacy
            </p>
          )}
        </div>
      </div>

      {/* Sync Status */}
      <div className="card wallet-sync-card">
        <div className="wallet-sync-header">
          <h3>Blockchain Sync</h3>
          <button 
            className="tiny-button" 
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? 'Syncing...' : 'Refresh'}
          </button>
        </div>
        {chainInfo && (
          <div className="wallet-sync-info">
            <div className="wallet-sync-row">
              <span className="wallet-sync-label">Chain Tip</span>
              <span className="wallet-sync-value mono">{chainInfo.tipHeight?.toLocaleString() || '—'}</span>
            </div>
            <div className="wallet-sync-row">
              <span className="wallet-sync-label">Scanned Height</span>
              <span className="wallet-sync-value mono">{chainInfo.scannedHeight?.toLocaleString() || '—'}</span>
            </div>
            {chainInfo.tipHeight && chainInfo.scannedHeight && (
              <div className="wallet-sync-progress">
                <div 
                  className="wallet-sync-progress-bar"
                  style={{ 
                    width: `${Math.min(100, (chainInfo.scannedHeight / chainInfo.tipHeight) * 100)}%` 
                  }}
                />
              </div>
            )}
          </div>
        )}
        {isSyncing && (
          <p className="wallet-sync-status">
            <span className="spinner tiny"></span>
            Scanning blockchain for transactions...
          </p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="wallet-actions-grid">
        <button 
          className="wallet-action-card"
          onClick={() => navigate('/build')}
        >
          <span className="wallet-action-icon">🔐</span>
          <span className="wallet-action-title">Build Proof</span>
          <span className="wallet-action-description">
            Generate a zero-knowledge proof of your balance
          </span>
        </button>
        <button 
          className="wallet-action-card"
          onClick={() => navigate('/wallet/receive')}
        >
          <span className="wallet-action-icon">📥</span>
          <span className="wallet-action-title">Receive ZEC</span>
          <span className="wallet-action-description">
            Show your address and QR code
          </span>
        </button>
        <button 
          className="wallet-action-card"
          onClick={() => navigate('/wallet/send')}
        >
          <span className="wallet-action-icon">📤</span>
          <span className="wallet-action-title">Send ZEC</span>
          <span className="wallet-action-description">
            Transfer funds to another address
          </span>
        </button>
      </div>
    </div>
  );
}
