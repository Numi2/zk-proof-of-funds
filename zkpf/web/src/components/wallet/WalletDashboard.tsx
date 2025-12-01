/**
 * Wallet Dashboard
 * 
 * Main dashboard view for the Zcash wallet.
 * Handles: loading, browser compatibility, wallet creation, and connected state.
 */

import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, set } from 'idb-keyval';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';
import { PersonhoodSettings } from './PersonhoodSettings';
import type { PolicyDefinition } from '../../types/zkpf';
import { detectBrowser, type BrowserInfo } from '../../utils/browserCompat';

const UFVK_STORAGE_KEY = 'zkpf-zcash-ufvk';

/**
 * Derive UFVK from seed phrase using dynamically imported WASM functions.
 * Must be called only after WASM is initialized.
 */
async function deriveUfvkFromSeedPhrase(seedPhrase: string, network: 'main' | 'test'): Promise<string> {
  // Dynamic import to avoid loading WASM at module level before initialization
  const { UnifiedSpendingKey } = await import('@chainsafe/webzjs-keys');
  
  const encoder = new TextEncoder();
  const mnemonicBytes = encoder.encode(seedPhrase.normalize('NFKD'));
  const saltBytes = encoder.encode('mnemonic');
  const seed = pbkdf2(sha512, mnemonicBytes, saltBytes, { c: 2048, dkLen: 64 });
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

function createBalancePolicy(balanceZats: number): PolicyDefinition {
  // Use the non-custodial Zcash Orchard currency code (999001)
  // The WebWallet is a non-custodial Orchard wallet
  const ZEC_ORCHARD_CURRENCY_CODE = 999001;
  
  // Generate a deterministic policy_id based on the policy parameters.
  // This ensures the same balance always gets the same policy_id, making
  // verification work seamlessly even if the user loads a previously generated bundle.
  // Format: 9XXYYYYYY where XX = currency code mod 100, YYYYYY = threshold-based hash
  const thresholdHash = Math.abs(
    (balanceZats * 31 + ZEC_ORCHARD_CURRENCY_CODE * 17) % 10000000
  );
  const customPolicyId = 900000000 + thresholdHash;
  
  // Use a deterministic scope_id derived from the currency code
  // This ensures all Zcash Orchard proofs use the same scope
  const verifierScopeId = 999001000 + (balanceZats % 1000);
  
  const zecAmount = balanceZats / 100_000_000;
  const formattedAmount = zecAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
  
  // Use ZCASH_ORCHARD rail for non-custodial shielded Zcash proofs
  return {
    policy_id: customPolicyId,
    verifier_scope_id: verifierScopeId,
    threshold_raw: balanceZats,
    required_currency_code: ZEC_ORCHARD_CURRENCY_CODE,
    required_custodian_id: 0,
    category: 'ZCASH_ORCHARD',
    rail_id: 'ZCASH_ORCHARD',
    label: `Prove exactly ${formattedAmount} ZEC`,
  };
}

// User-friendly error messages
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('Failed to fetch')) {
    return 'Network error. Check your internet connection and try again.';
  }
  if (msg.includes('invalid') && msg.includes('seed')) {
    return 'Invalid seed phrase. Make sure all 24 words are correct.';
  }

  if (msg.includes('WebAssembly') || msg.includes('WASM')) {
    return 'Failed to load wallet engine. Try refreshing the page.';
  }
  if (msg.includes('timeout')) {
    return 'Connection timed out. The server may be busy, try again in a moment.';
  }
  // Return cleaned up message if no match
  return msg.replace(/Error:/gi, '').trim() || 'Something went wrong. Please try again.';
}

type ConnectStep = 'input' | 'backup' | 'connecting';

export function WalletDashboard() {
  const { state, dispatch } = useWebZjsContext();
  const { createAccountFromSeed } = useWebzjsActions();
  const navigate = useNavigate();
  
  // Connection flow state
  const [connectStep, setConnectStep] = useState<ConnectStep>('input');
  const [isConnecting, setIsConnecting] = useState(false);
  const [seedPhraseInput, setSeedPhraseInput] = useState('');
  const [seedBirthdayInput, setSeedBirthdayInput] = useState('');
  const [hasSavedSeed, setHasSavedSeed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  
  // Browser state
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null);
  
  // Dashboard state
  const [storedUfvk, setStoredUfvk] = useState<string | null>(null);
  const [showFullUfvk, setShowFullUfvk] = useState(false);
  const [ufvkCopied, setUfvkCopied] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  // Track if user just generated a new seed (needs backup warning)
  const isNewSeed = useRef(false);

  useEffect(() => {
    setBrowserInfo(detectBrowser());
  }, []);

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

  const isConnected = state.activeAccount != null;
  const isWebWalletAvailable = state.webWallet !== null;
  const isLoading = state.loading;

  const activeBalanceReport = useMemo(() => {
    if (!state.summary || state.activeAccount == null) return null;
    return state.summary.account_balances.find(
      ([accountId]) => accountId === state.activeAccount
    );
  }, [state.summary, state.activeAccount]);

  const balances = useMemo(() => {
    if (!activeBalanceReport) {
      return { total: 0, shielded: 0, unshielded: 0, sapling: 0, orchard: 0 };
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

  // Generate a new seed phrase
  const handleGenerateSeed = useCallback(async () => {
    setLocalError(null);
    try {
      // Dynamic import to avoid loading WASM at module level before initialization
      const { generate_seed_phrase } = await import('@chainsafe/webzjs-keys');
      const newSeed = generate_seed_phrase();
      setSeedPhraseInput(newSeed);
      isNewSeed.current = true;
      setHasSavedSeed(false);
      // For new seeds, show backup step
      setConnectStep('backup');
    } catch (err) {
      setLocalError(friendlyError(err));
    }
  }, []);

  // Copy seed to clipboard
  const handleCopySeed = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(seedPhraseInput);
      setHasSavedSeed(true);
    } catch {
      // Fallback: select the text
      setLocalError('Could not copy automatically. Please select and copy the words manually.');
    }
  }, [seedPhraseInput]);

  // Validate seed phrase input
  const validateSeedInput = useCallback((): boolean => {
    const phrase = seedPhraseInput.trim();
    if (!phrase) {
      setLocalError('Enter your 24-word seed phrase');
      return false;
    }

    const words = phrase.split(/\s+/);
    if (words.length !== 24) {
      setLocalError(`Seed phrase must have exactly 24 words. You entered ${words.length}.`);
      return false;
    }

    if (seedBirthdayInput.trim()) {
      const parsed = Number(seedBirthdayInput.trim().replace(/[, _]/g, ''));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setLocalError('Birthday height must be a positive number');
        return false;
      }
    }

    return true;
  }, [seedPhraseInput, seedBirthdayInput]);

  // Actually connect with the seed (defined first so other handlers can reference it)
  const handleConnectWithSeed = useCallback(async () => {
    const phrase = seedPhraseInput.trim();
    
    let birthday: number | null = null;
    if (seedBirthdayInput.trim()) {
      const parsed = Number(seedBirthdayInput.trim().replace(/[, _]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        birthday = Math.floor(parsed);
      }
    }

    setIsConnecting(true);
    setLocalError(null);
    
    try {
      const derivedUfvk = await deriveUfvkFromSeedPhrase(phrase, 'main');
      try {
        localStorage.setItem(UFVK_STORAGE_KEY, derivedUfvk);
      } catch {
        console.warn('Could not store UFVK in localStorage');
      }
      await createAccountFromSeed(phrase, birthday);
    } catch (err) {
      setLocalError(friendlyError(err));
      setConnectStep('input');
      console.error('Failed to create wallet:', err);
    } finally {
      setIsConnecting(false);
    }
  }, [seedPhraseInput, seedBirthdayInput, createAccountFromSeed]);

  // Proceed from backup step to connecting
  const handleProceedFromBackup = useCallback(() => {
    if (!hasSavedSeed) {
      setLocalError('Please save your seed phrase before continuing');
      return;
    }
    setConnectStep('connecting');
    handleConnectWithSeed();
  }, [hasSavedSeed, handleConnectWithSeed]);

  // Connect with seed phrase (for restore flow)
  const handleConnectFromInput = useCallback(() => {
    if (!validateSeedInput()) return;
    
    // If this is an existing seed (user pasted it), skip backup step
    if (!isNewSeed.current) {
      setConnectStep('connecting');
      handleConnectWithSeed();
    } else {
      // New seed needs backup confirmation
      setConnectStep('backup');
    }
  }, [validateSeedInput, handleConnectWithSeed]);

  // Sync wallet
  const handleSync = useCallback(async () => {
    if (!state.webWallet || state.activeAccount == null) return;
    if (isSyncing) return;

    setIsSyncing(true);
    setSyncError(null);
    
    try {
      await state.webWallet.sync();
      
      // Update summary
      const summary = await state.webWallet.get_wallet_summary();
      if (summary) {
        dispatch({ type: 'set-summary', payload: summary });
      }
      
      // Persist to IndexedDB
      try {
        const bytes = await state.webWallet.db_to_bytes();
        await set('zkpf-webwallet-db', bytes);
      } catch (persistErr) {
        console.warn('Could not persist wallet:', persistErr);
      }
    } catch (err) {
      console.error('Sync failed:', err);
      setSyncError(friendlyError(err));
    } finally {
      setIsSyncing(false);
    }
  }, [state.webWallet, state.activeAccount, isSyncing, dispatch]);

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

  const truncatedUfvk = useMemo(() => {
    if (!storedUfvk) return null;
    if (storedUfvk.length <= 40) return storedUfvk;
    return `${storedUfvk.slice(0, 20)}...${storedUfvk.slice(-10)}`;
  }, [storedUfvk]);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      try {
        localStorage.removeItem(UFVK_STORAGE_KEY);
      } catch {
        // localStorage might be unavailable
      }
      try {
        await del('zkpf-webwallet-db');
      } catch (err) {
        console.warn('Could not clear wallet database:', err);
      }
      dispatch({ type: 'set-active-account', payload: null as unknown as number });
      dispatch({ type: 'set-error', payload: null });
      setShowLogoutConfirm(false);
      setStoredUfvk(null);
      window.location.reload();
    } catch (err) {
      console.error('Logout failed:', err);
      setLocalError('Failed to disconnect. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
  }, [dispatch]);

  const displayError = localError || (state.error ? friendlyError(state.error) : null);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING STATE - Show while WASM initializes
  // ═══════════════════════════════════════════════════════════════════════════
  if (isLoading) {
    return (
      <div className="wallet-connect-prompt">
        <div className="card wallet-connect-card">
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p className="muted">Initializing wallet...</p>
            <p className="muted small" style={{ marginTop: '0.5rem' }}>
              This may take a moment on first load
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER NOT SUPPORTED
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isWebWalletAvailable && browserInfo) {
    return (
      <div className="wallet-connect-prompt">
        <div className="card wallet-connect-card wallet-connect-card-wide">
          <h3>Browser Not Supported</h3>
          
          <div className="wallet-warning" style={{ marginBottom: '1.5rem', textAlign: 'left' }}>
            <p style={{ margin: 0 }}>
              {browserInfo.recommendation || 
               'This wallet requires features not available in your browser.'}
            </p>
          </div>
          
          <div style={{ textAlign: 'left' }}>
            <p className="small muted" style={{ marginBottom: '1rem' }}>
              <strong>What you can do:</strong>
            </p>
            <ul className="small muted" style={{ marginLeft: '1.25rem', marginBottom: '1.5rem' }}>
              <li>Use <strong>Chrome</strong> or <strong>Firefox</strong> on desktop</li>
              <li>Make sure you're on the latest browser version</li>
              <li>Try disabling browser extensions that might interfere</li>
            </ul>
          </div>
          
          <button 
            onClick={() => window.location.reload()} 
            className="wallet-connect-button ghost"
          >
            Refresh Page
          </button>
          
          <p className="muted small" style={{ marginTop: '1rem', textAlign: 'center' }}>
            Already using Chrome/Firefox? <br/>
            <a href="https://github.com/nicktehrany/zk-proof-of-funds/issues" target="_blank" rel="noopener noreferrer">
              Report this issue
            </a>
          </p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NOT CONNECTED - Wallet creation/restore flow
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isConnected) {
    // Step: Connecting (loading spinner)
    if (connectStep === 'connecting') {
      return (
        <div className="wallet-connect-prompt">
          <div className="card wallet-connect-card">
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem' }} />
              <p>Setting up your wallet...</p>
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                This may take a few seconds
              </p>
            </div>
            
            {displayError && (
              <div className="error-message" style={{ marginTop: '1rem' }}>
                <span>⚠️</span> {displayError}
                <button 
                  onClick={() => { setConnectStep('input'); setLocalError(null); }}
                  className="tiny-button ghost"
                  style={{ marginLeft: '1rem' }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Step: Backup warning for new seeds
    if (connectStep === 'backup') {
      return (
        <div className="wallet-connect-prompt">
          <div className="card wallet-connect-card wallet-connect-card-wide">
            <h3>Save Your Seed Phrase</h3>
            
            <div className="wallet-warning" style={{ 
              marginBottom: '1rem', 
              textAlign: 'left',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              padding: '1rem',
              borderRadius: '0.5rem'
            }}>
              <p style={{ margin: 0, fontWeight: 500 }}>
                ⚠️ Write these words down and store them safely. 
                This is the ONLY way to recover your wallet. 
                If you lose them, your funds are lost forever.
              </p>
            </div>
            
            <div style={{ 
              background: 'rgba(15, 23, 42, 0.6)', 
              padding: '1rem', 
              borderRadius: '0.5rem',
              marginBottom: '1rem',
              fontFamily: 'monospace',
              fontSize: '0.9rem',
              lineHeight: 1.8,
              wordSpacing: '0.5rem'
            }}>
              {seedPhraseInput}
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
              <button 
                onClick={handleCopySeed}
                className="tiny-button"
              >
                {hasSavedSeed ? '✓ Copied' : 'Copy to clipboard'}
              </button>
            </div>
            
            <label style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: '0.75rem', 
              marginBottom: '1.5rem',
              cursor: 'pointer'
            }}>
              <input 
                type="checkbox" 
                checked={hasSavedSeed}
                onChange={(e) => setHasSavedSeed(e.target.checked)}
                style={{ marginTop: '0.25rem' }}
              />
              <span className="small">
                I have saved my seed phrase in a safe place and understand that 
                I am responsible for keeping it secure.
              </span>
            </label>
            
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                onClick={() => { 
                  setConnectStep('input'); 
                  setHasSavedSeed(false);
                  // Clear the generated seed so user can't skip backup by clicking Restore
                  setSeedPhraseInput('');
                  isNewSeed.current = false;
                }}
                className="wallet-connect-button ghost"
                style={{ flex: 1 }}
              >
                Back
              </button>
              <button 
                onClick={handleProceedFromBackup}
                disabled={!hasSavedSeed || isConnecting}
                className="wallet-connect-button"
                style={{ flex: 2 }}
              >
                Continue
              </button>
            </div>
            
            {displayError && (
              <div className="error-message" style={{ marginTop: '1rem' }}>
                <span>⚠️</span> {displayError}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Step: Input (main connect form)
    return (
      <div className="wallet-connect-prompt">
        <div className="card wallet-connect-card wallet-connect-card-wide">
          <h3>Connect Wallet</h3>
          
          <div className="wallet-seed-form">
            {/* Create new wallet option */}
            <div style={{ marginBottom: '1.5rem' }}>
              <button
                type="button"
                onClick={handleGenerateSeed}
                className="wallet-connect-button"
                style={{ width: '100%' }}
              >
                Create New Wallet
              </button>
              <p className="muted small" style={{ marginTop: '0.5rem', textAlign: 'center' }}>
                Generate a fresh wallet with a new seed phrase
              </p>
            </div>
            
            <div style={{ 
              margin: '1.5rem 0', 
              textAlign: 'center', 
              color: '#64748b', 
              fontSize: '0.8rem',
              position: 'relative'
            }}>
              <span style={{ 
                background: 'var(--bg-card, #0f172a)', 
                padding: '0 1rem',
                position: 'relative',
                zIndex: 1
              }}>
                or restore existing wallet
              </span>
              <div style={{ 
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: '1px',
                background: 'rgba(100, 116, 139, 0.3)'
              }} />
            </div>
            
            {/* Restore existing wallet */}
            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
                Seed phrase (24 words)
              </label>
              <textarea
                value={seedPhraseInput}
                onChange={(e) => { 
                  setSeedPhraseInput(e.target.value); 
                  isNewSeed.current = false;
                  setLocalError(null);
                }}
                placeholder="Enter your 24-word seed phrase"
                rows={3}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label className="small muted" style={{ display: 'block', marginBottom: '0.5rem' }}>
                Birthday height <span style={{ opacity: 0.6 }}>(optional, for faster sync)</span>
              </label>
              <input
                type="text"
                value={seedBirthdayInput}
                onChange={(e) => { setSeedBirthdayInput(e.target.value); setLocalError(null); }}
                placeholder="e.g. 2000000"
                style={{ width: '100%' }}
              />
            </div>

            <button 
              onClick={handleConnectFromInput} 
              disabled={isConnecting || !seedPhraseInput.trim()}
              className="wallet-connect-button"
              style={{ width: '100%' }}
            >
              Restore Wallet
            </button>

            
          </div>

          {displayError && (
            <div className="error-message" style={{ marginTop: '1rem' }}>
              <span>⚠️</span> {displayError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTED - Dashboard view
  // ═══════════════════════════════════════════════════════════════════════════
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
            <span className="wallet-balance-label">Shielded</span>
          </div>
          <div className="wallet-balance-value">
            {zatsToZec(balances.shielded)} <span className="wallet-balance-unit">ZEC</span>
          </div>
          <div className="wallet-balance-breakdown">
            <span>Orchard: {zatsToZec(balances.orchard)}</span>
            <span>Sapling: {zatsToZec(balances.sapling)}</span>
          </div>
        </div>

        <div className="wallet-balance-card wallet-balance-card-transparent">
          <div className="wallet-balance-header">
            <span className="wallet-balance-icon">📊</span>
            <span className="wallet-balance-label">Transparent</span>
          </div>
          <div className="wallet-balance-value">
            {zatsToZec(balances.unshielded)} <span className="wallet-balance-unit">ZEC</span>
          </div>
        </div>
      </div>

      {/* Sync Status */}
      <div className="card wallet-sync-card">
        <div className="wallet-sync-header">
          <h3>Sync</h3>
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
              <span className="wallet-sync-label">Scanned</span>
              <span className="wallet-sync-value mono">{chainInfo.scannedHeight?.toLocaleString() || '—'}</span>
            </div>
            {chainInfo.tipHeight && chainInfo.scannedHeight && (
              <div className="wallet-sync-progress">
                <div 
                  className="wallet-sync-progress-bar"
                  style={{ width: `${Math.min(100, (chainInfo.scannedHeight / chainInfo.tipHeight) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {syncError && (
          <div className="error-message" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            {syncError}
          </div>
        )}
      </div>

      {/* Personhood Verification */}
      <PersonhoodSettings />

      {/* UFVK */}
      <div className="card wallet-ufvk-card">
        <div className="wallet-ufvk-header">
          <h3>Viewing Key</h3>
          {storedUfvk && (
            <button className="tiny-button" onClick={() => setShowFullUfvk(!showFullUfvk)}>
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
            <button className="tiny-button" onClick={handleCopyUfvk}>
              {ufvkCopied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="muted small">Not available</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="wallet-actions-grid">
        <button 
          className="wallet-action-card"
          onClick={() => {
            const customPolicy = createBalancePolicy(balances.shielded);
            navigate('/build', { state: { customPolicy, fromWallet: true, walletBalance: balances.shielded } });
          }}
        >
          <span className="wallet-action-icon">🔐</span>
          <span className="wallet-action-title">Build Proof</span>
          <span className="wallet-action-description">
            Prove {zatsToZec(balances.shielded)} ZEC
          </span>
        </button>
        <button className="wallet-action-card" onClick={() => navigate('/wallet/receive')}>
          <span className="wallet-action-icon">📥</span>
          <span className="wallet-action-title">Receive</span>
          <span className="wallet-action-description">Get your address</span>
        </button>
        <button className="wallet-action-card" onClick={() => navigate('/wallet/send')}>
          <span className="wallet-action-icon">📤</span>
          <span className="wallet-action-title">Send</span>
          <span className="wallet-action-description">Transfer funds</span>
        </button>
      </div>

      {/* Logout */}
      <div className="card wallet-logout-card">
        {showLogoutConfirm ? (
          <div className="wallet-logout-confirm">
            <p className="small" style={{ marginBottom: '0.75rem' }}>
              This will remove the wallet from this browser. 
              Make sure you have your seed phrase saved.
            </p>
            <div className="wallet-logout-actions">
              <button className="tiny-button danger" onClick={handleLogout} disabled={isLoggingOut}>
                {isLoggingOut ? 'Clearing...' : 'Disconnect'}
              </button>
              <button className="tiny-button ghost" onClick={() => setShowLogoutConfirm(false)} disabled={isLoggingOut}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="tiny-button ghost" onClick={() => setShowLogoutConfirm(true)}>
            Disconnect Wallet
          </button>
        )}
      </div>
    </div>
  );
}
