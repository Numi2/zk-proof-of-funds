import { useMemo, useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { del } from 'idb-keyval';
import { generate_seed_phrase, UnifiedSpendingKey } from '@chainsafe/webzjs-keys';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';
import { usePcdContext } from '../../context/PcdContext';
import { TachyonStatePanel } from '../TachyonStatePanel';
import type { PolicyDefinition } from '../../types/zkpf';
import { 
  detectBrowser, 
  getBrowserDownloadLinks, 
  checkCrossOriginHeaders,
  getSafariTroubleshootingSteps,
  type BrowserInfo,
  type HeaderCheckResult,
} from '../../utils/browserCompat';

// localStorage key for UFVK - must match ZcashWalletConnector
const UFVK_STORAGE_KEY = 'zkpf-zcash-ufvk';

/**
 * Derive a UFVK from a BIP39 mnemonic seed phrase using PBKDF2.
 * This follows the BIP39 standard for converting mnemonic to seed.
 */
function deriveUfvkFromSeedPhrase(seedPhrase: string, network: 'main' | 'test'): string {
  // BIP39: Convert mnemonic to seed using PBKDF2 with "mnemonic" + passphrase as salt
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(seedPhrase.normalize('NFKD'));
  const saltBytes = encoder.encode('mnemonic'); // Empty passphrase

  // PBKDF2-SHA512 with 2048 iterations (BIP39 standard)
  const seed = pbkdf2(sha512, mnemonicBytes, saltBytes, { c: 2048, dkLen: 64 });

  // Create a UnifiedSpendingKey from the seed (account index 0)
  const usk = new UnifiedSpendingKey(network, seed, 0);
  const ufvk = usk.to_unified_full_viewing_key();
  return ufvk.encode(network);
}

function zatsToZec(zats: number): string {
  return (zats / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

/**
 * Creates a custom policy tailored to the user's exact balance.
 * This removes friction from manually selecting a policy that fits.
 */
function createBalancePolicy(balanceZats: number): PolicyDefinition {
  // ZEC currency code (Zcash uses 5915971 which is "ZEC" in ASCII)
  const ZEC_CURRENCY_CODE = 5915971;
  
  // Generate a unique policy ID based on timestamp and balance
  // Using a large number range to avoid collision with server-defined policies
  const customPolicyId = 900000000 + Math.floor(Math.random() * 1000000);
  
  // Format the balance for the label
  const zecAmount = balanceZats / 100_000_000;
  const formattedAmount = zecAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
  
  return {
    policy_id: customPolicyId,
    verifier_scope_id: 314159265, // Standard Zcash scope
    threshold_raw: balanceZats,
    required_currency_code: ZEC_CURRENCY_CODE,
    required_custodian_id: 0, // Non-custodial (Zcash Orchard)
    category: 'ZCASH_ORCHARD',
    rail_id: 'ZCASH_ORCHARD',
    label: `Prove exactly ${formattedAmount} ZEC`,
  };
}

type WalletMethod = 'seed' | 'snap';

export function WalletDashboard() {
  const { state, dispatch } = useWebZjsContext();
  const { connectWebZjsSnap, triggerRescan, createAccountFromSeed } = useWebzjsActions();
  const navigate = useNavigate();
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletMethod, setWalletMethod] = useState<WalletMethod>('seed');
  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedBirthdayInput, setSeedBirthdayInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null);
  const [headerCheckResult, setHeaderCheckResult] = useState<HeaderCheckResult | null>(null);
  const [isCheckingHeaders, setIsCheckingHeaders] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [storedUfvk, setStoredUfvk] = useState<string | null>(null);
  const [showFullUfvk, setShowFullUfvk] = useState(false);
  const [ufvkCopied, setUfvkCopied] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Detect browser capabilities on mount
  useEffect(() => {
    setBrowserInfo(detectBrowser());
  }, []);

  // Load UFVK from localStorage when wallet is connected
  useEffect(() => {
    if (state.activeAccount != null) {
      try {
        const ufvk = localStorage.getItem(UFVK_STORAGE_KEY);
        setStoredUfvk(ufvk);
      } catch {
        // localStorage might be unavailable
      }
    }
  }, [state.activeAccount]);

  const handleCheckHeaders = useCallback(async () => {
    setIsCheckingHeaders(true);
    try {
      const result = await checkCrossOriginHeaders();
      setHeaderCheckResult(result);
    } catch (err) {
      console.error('Header check failed:', err);
    } finally {
      setIsCheckingHeaders(false);
    }
  }, []);

  const handleSuggestedAction = useCallback((action: string) => {
    switch (action) {
      case 'refresh':
        window.location.reload();
        break;
      case 'clear-cache':
        // Can't programmatically clear cache, show instructions
        setShowTroubleshooting(true);
        break;
      case 'check-headers':
        handleCheckHeaders();
        break;
      case 'use-chrome':
        window.open('https://www.google.com/chrome/', '_blank');
        break;
      case 'use-firefox':
        window.open('https://www.mozilla.org/firefox/', '_blank');
        break;
      case 'manual-mode':
        navigate('/build');
        break;
      case 'use-desktop':
        // Just show the troubleshooting info
        setShowTroubleshooting(true);
        break;
      default:
        break;
    }
  }, [handleCheckHeaders, navigate]);

  const isConnected = state.activeAccount != null;
  const isSyncing = state.syncInProgress;
  const isWebWalletAvailable = state.webWallet !== null;
  const showBrowserWarning = !state.loading && !isWebWalletAvailable && browserInfo !== null;

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
      const viewingKey = await connectWebZjsSnap();
      // Store the viewing key in localStorage so it's available for attestation building
      if (viewingKey) {
        try {
          localStorage.setItem(UFVK_STORAGE_KEY, viewingKey);
        } catch {
          // localStorage might be unavailable in some contexts
          console.warn('Could not store viewing key in localStorage');
        }
      }
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
      // Derive and store UFVK so it's available for attestation building
      const derivedUfvk = deriveUfvkFromSeedPhrase(phrase, 'main');
      try {
        localStorage.setItem(UFVK_STORAGE_KEY, derivedUfvk);
      } catch {
        // localStorage might be unavailable in some contexts
        console.warn('Could not store UFVK in localStorage');
      }

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

  const handleCopyUfvk = useCallback(async () => {
    if (!storedUfvk) return;
    try {
      await navigator.clipboard.writeText(storedUfvk);
      setUfvkCopied(true);
      setTimeout(() => setUfvkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy UFVK:', err);
    }
  }, [storedUfvk]);

  // Truncate UFVK for display (show first 20 and last 10 chars)
  const truncatedUfvk = useMemo(() => {
    if (!storedUfvk) return null;
    if (storedUfvk.length <= 40) return storedUfvk;
    return `${storedUfvk.slice(0, 20)}...${storedUfvk.slice(-10)}`;
  }, [storedUfvk]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      // Clear UFVK from localStorage
      try {
        localStorage.removeItem(UFVK_STORAGE_KEY);
      } catch {
        // localStorage might be unavailable
      }

      // Clear wallet database from IndexedDB
      try {
        await del('zkpf-webwallet-db');
      } catch (err) {
        console.warn('Could not clear wallet database:', err);
      }

      // Reset wallet state - this will show the connect screen
      dispatch({ type: 'set-active-account', payload: null as unknown as number });
      dispatch({ type: 'set-error', payload: null });

      setShowLogoutConfirm(false);
      setStoredUfvk(null);
      
      // Force a page reload to fully reset the wallet state
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
      setLocalError('Failed to logout. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  }, [dispatch]);

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

          {showBrowserWarning && browserInfo && (
            <div className="wallet-warning" style={{ 
              marginBottom: '1rem', 
              textAlign: 'left', 
              padding: '1.25rem', 
              background: browserInfo.isMobile && !browserInfo.isSupported 
                ? 'rgba(239, 68, 68, 0.1)' 
                : 'rgba(251, 191, 36, 0.1)', 
              borderRadius: '0.75rem', 
              border: `1px solid ${browserInfo.isMobile && !browserInfo.isSupported 
                ? 'rgba(239, 68, 68, 0.3)' 
                : 'rgba(251, 191, 36, 0.3)'}` 
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.5rem' }}>
                  {browserInfo.isMobile && !browserInfo.isSupported ? '📱' : '⚠️'}
                </span>
                <div style={{ flex: 1 }}>
                  <strong style={{ display: 'block', marginBottom: '0.5rem', fontSize: '1rem' }}>
                    {browserInfo.isMobile && !browserInfo.isSupported 
                      ? 'Desktop Browser Required' 
                      : 'Browser Compatibility Issue'}
                  </strong>
                  
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', opacity: 0.9 }}>
                    {browserInfo.recommendation || 
                      'The Zcash wallet requires SharedArrayBuffer, which needs special browser support.'}
                  </p>

                  {/* Browser Details */}
                  <div style={{ 
                    fontSize: '0.8rem', 
                    opacity: 0.7, 
                    marginBottom: '0.75rem',
                    padding: '0.5rem',
                    background: 'rgba(0,0,0,0.1)',
                    borderRadius: '0.5rem'
                  }}>
                    <div>Browser: {browserInfo.name} {browserInfo.version}</div>
                    <div>SharedArrayBuffer: {browserInfo.supportDetails.hasSharedArrayBuffer ? '✅' : '❌'}</div>
                    <div>Cross-Origin Isolated: {browserInfo.supportDetails.hasCrossOriginIsolation ? '✅' : '❌'}</div>
                  </div>

                  {/* Header check result */}
                  {headerCheckResult && (
                    <div style={{ 
                      marginBottom: '0.75rem', 
                      padding: '0.75rem', 
                      background: headerCheckResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                      borderRadius: '0.5rem',
                      border: `1px solid ${headerCheckResult.success ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                    }}>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                        {headerCheckResult.success ? '✅ Header Check Passed' : '❌ Header Check Result'}
                      </strong>
                      <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.9 }}>
                        {headerCheckResult.message}
                      </p>
                    </div>
                  )}

                  {/* Safari-specific troubleshooting */}
                  {browserInfo.name === 'Safari' && !browserInfo.isMobile && showTroubleshooting && (
                    <div style={{ 
                      marginBottom: '0.75rem', 
                      padding: '0.75rem', 
                      background: 'rgba(56, 189, 248, 0.1)', 
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(56, 189, 248, 0.2)'
                    }}>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                        🔧 Safari Troubleshooting Steps
                      </strong>
                      <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', opacity: 0.9 }}>
                        {getSafariTroubleshootingSteps().map((step, i) => (
                          <li key={i} style={{ marginBottom: '0.25rem' }}>{step.replace(/^\d+\.\s*/, '')}</li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {/* Suggested Actions */}
                  {browserInfo.suggestedActions.length > 0 && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                        Suggested Actions:
                      </strong>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {browserInfo.suggestedActions.map((action, idx) => (
                          <button 
                            key={idx}
                            type="button"
                            className="tiny-button"
                            onClick={() => handleSuggestedAction(action.action)}
                            disabled={action.action === 'check-headers' && isCheckingHeaders}
                            title={action.description}
                          >
                            {action.action === 'check-headers' && isCheckingHeaders ? '⏳' : 
                              action.action === 'refresh' ? '🔄' :
                              action.action === 'clear-cache' ? '🧹' :
                              action.action === 'use-chrome' ? '🌐' :
                              action.action === 'use-firefox' ? '🦊' :
                              action.action === 'manual-mode' ? '📋' :
                              action.action === 'check-headers' ? '🔍' : '💻'
                            } {action.label}
                          </button>
                        ))}
                        {browserInfo.name === 'Safari' && !showTroubleshooting && (
                          <button 
                            type="button"
                            className="tiny-button ghost"
                            onClick={() => setShowTroubleshooting(true)}
                          >
                            📖 Show Steps
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Available features despite limitation */}
                  {browserInfo.availableFeatures.length > 0 && (
                    <div style={{ 
                      marginBottom: '0.75rem', 
                      padding: '0.75rem', 
                      background: 'rgba(34, 197, 94, 0.1)', 
                      borderRadius: '0.5rem',
                      border: '1px solid rgba(34, 197, 94, 0.2)'
                    }}>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                        ✅ What You Can Still Do
                      </strong>
                      <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', opacity: 0.9 }}>
                        {browserInfo.availableFeatures.map((feature, i) => (
                          <li key={i}>{feature}</li>
                        ))}
                      </ul>
                      <button 
                        type="button"
                        className="tiny-button"
                        onClick={() => navigate('/build')}
                        style={{ marginTop: '0.5rem' }}
                      >
                        📋 Go to Proof Builder
                      </button>
                    </div>
                  )}

                  {/* Browser download links */}
                  {!browserInfo.isSupported && !browserInfo.isMobile && (
                    <div>
                      <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                        Recommended Browsers:
                      </strong>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {getBrowserDownloadLinks().map(({ name, url, icon }) => (
                          <a
                            key={name}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="tiny-button"
                            style={{ textDecoration: 'none' }}
                          >
                            {icon} {name}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
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

      {/* Tachyon State Machine (PCD) */}
      <div className="card wallet-tachyon-card">
        <TachyonStatePanel />
      </div>

      {/* UFVK Display */}
      <div className="card wallet-ufvk-card">
        <div className="wallet-ufvk-header">
          <h3>🔑 Viewing Key (UFVK)</h3>
          {storedUfvk && (
            <button 
              className="tiny-button"
              onClick={() => setShowFullUfvk(!showFullUfvk)}
            >
              {showFullUfvk ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
        {storedUfvk ? (
          <div className="wallet-ufvk-content">
            <div className="wallet-ufvk-value">
              <code className="wallet-ufvk-code">
                {showFullUfvk ? storedUfvk : truncatedUfvk}
              </code>
            </div>
            <div className="wallet-ufvk-actions">
              <button 
                className="tiny-button"
                onClick={handleCopyUfvk}
              >
                {ufvkCopied ? '✓ Copied!' : '📋 Copy UFVK'}
              </button>
            </div>
            <p className="wallet-ufvk-hint">
              Your Unified Full Viewing Key allows you to view your balance and transaction history without spending funds. 
              Keep it private—anyone with this key can see your shielded transactions.
            </p>
          </div>
        ) : (
          <div className="wallet-ufvk-missing">
            <p className="muted">
              UFVK not found in browser storage. To enable the streamlined proof flow, 
              please re-enter your seed phrase to regenerate the viewing key.
            </p>
            <button 
              className="tiny-button ghost"
              onClick={() => {
                // Clear wallet and force re-creation
                // For now, just show the seed phrase input
                setLocalError('Please re-enter your seed phrase in the wallet creation form to regenerate your UFVK.');
              }}
            >
              Regenerate UFVK
            </button>
          </div>
        )}
      </div>

      {/* Logout Section */}
      <div className="card wallet-logout-card">
        <div className="wallet-logout-header">
          <h3>🚪 Session</h3>
        </div>
        {showLogoutConfirm ? (
          <div className="wallet-logout-confirm">
            <p className="wallet-logout-warning">
              ⚠️ <strong>Are you sure you want to logout?</strong>
            </p>
            <p className="muted small">
              This will clear your wallet data from this browser. Make sure you have your seed phrase backed up 
              before logging out, as you'll need it to restore your wallet.
            </p>
            <div className="wallet-logout-actions">
              <button 
                className="tiny-button danger"
                onClick={handleLogout}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? 'Logging out...' : 'Yes, Logout'}
              </button>
              <button 
                className="tiny-button ghost"
                onClick={() => setShowLogoutConfirm(false)}
                disabled={isLoggingOut}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="wallet-logout-content">
            <p className="muted small">
              Disconnect your wallet from this browser. You can always restore it later using your seed phrase.
            </p>
            <button 
              className="tiny-button ghost"
              onClick={() => setShowLogoutConfirm(true)}
            >
              🚪 Logout
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="wallet-actions-grid">
        <button 
          className="wallet-action-card"
          onClick={() => {
            // Create a custom policy tailored to the user's exact shielded balance
            const customPolicy = createBalancePolicy(balances.shielded);
            navigate('/build', { 
              state: { 
                customPolicy,
                fromWallet: true,
                walletBalance: balances.shielded,
              } 
            });
          }}
        >
          <span className="wallet-action-icon">🔐</span>
          <span className="wallet-action-title">Build Proof</span>
          <span className="wallet-action-description">
            Prove your exact balance of {zatsToZec(balances.shielded)} ZEC
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

      {/* Verify Bond Card */}
      <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/bound-identity/verify')}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
          <span style={{ fontSize: '2rem' }}>✓</span>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem' }}>Verify Bond</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Verify identity bonds and proof attestations
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
