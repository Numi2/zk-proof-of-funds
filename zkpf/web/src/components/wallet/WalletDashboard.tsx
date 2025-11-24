import { useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';

function zatsToZec(zats: number): string {
  return (zats / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

export function WalletDashboard() {
  const { state } = useWebZjsContext();
  const { connectWebZjsSnap, triggerRescan } = useWebzjsActions();
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);

  const isConnected = state.webWallet !== null;
  const isSyncing = state.syncInProgress;

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

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      await connectWebZjsSnap();
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [connectWebZjsSnap]);

  const handleSync = useCallback(async () => {
    try {
      await triggerRescan();
    } catch (err) {
      console.error('Failed to sync wallet:', err);
    }
  }, [triggerRescan]);

  if (!isConnected) {
    return (
      <div className="wallet-connect-prompt">
        <div className="card wallet-connect-card">
          <div className="wallet-connect-icon">🔐</div>
          <h3>Connect Your Zcash Wallet</h3>
          <p className="muted">
            Connect via MetaMask Snap to manage your Zcash funds securely. 
            Your keys remain protected inside MetaMask.
          </p>
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
          <button 
            onClick={handleConnect} 
            disabled={isConnecting || state.loading}
            className="wallet-connect-button"
          >
            {isConnecting ? 'Connecting...' : 'Connect MetaMask Snap'}
          </button>
          {state.error && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              <span>{typeof state.error === 'string' ? state.error : state.error.message}</span>
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

