/**
 * Login Modal Component
 * 
 * Beautiful, unified login interface supporting:
 * - Solana Wallet (Phantom, Solflare, Backpack)
 * - NEAR Wallet via near-connect (HOT, Meteor, MyNearWallet, Nightly, etc.)
 * - Passkey (WebAuthn/FIDO2)
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import './LoginModal.css';

type Tab = 'connect' | 'passkey-register';

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  type: 'solana' | 'near' | 'near-connect' | 'passkey';
  description: string;
  available: boolean;
}

export function LoginModal() {
  const {
    isLoginModalOpen,
    closeLoginModal,
    status,
    error,
    connectSolana,
    connectNear,
    connectPasskey,
    registerPasskey,
    nearWallets: nearConnectWallets,
    nearConnectReady,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('connect');
  const [passkeyUsername, setPasskeyUsername] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);

  // Detect available wallets
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);

  useEffect(() => {
    const detectWallets = () => {
      const options: WalletOption[] = [];
      
      // Solana wallets
      const win = window as Window & {
        solana?: { isPhantom?: boolean };
        phantom?: { solana?: { isPhantom?: boolean } };
        solflare?: { isSolflare?: boolean };
        backpack?: unknown;
      };

      const hasPhantom = win.phantom?.solana?.isPhantom || win.solana?.isPhantom;
      const hasSolflare = win.solflare?.isSolflare;
      const hasBackpack = !!win.backpack;

      options.push({
        id: 'phantom',
        name: 'Phantom',
        icon: '👻',
        type: 'solana',
        description: 'Solana wallet',
        available: !!hasPhantom,
      });

      options.push({
        id: 'solflare',
        name: 'Solflare',
        icon: '🔆',
        type: 'solana',
        description: 'Solana wallet',
        available: !!hasSolflare,
      });

      options.push({
        id: 'backpack',
        name: 'Backpack',
        icon: '🎒',
        type: 'solana',
        description: 'Solana wallet',
        available: !!hasBackpack,
      });

      // Passkey
      options.push({
        id: 'passkey',
        name: 'Passkey',
        icon: '🔐',
        type: 'passkey',
        description: 'Face ID, Touch ID, or security key',
        available: !!window.PublicKeyCredential,
      });

      setWalletOptions(options);
    };

    detectWallets();
    // Re-detect on window focus (wallet might have been installed)
    window.addEventListener('focus', detectWallets);
    return () => window.removeEventListener('focus', detectWallets);
  }, []);

  // Build NEAR wallet options from near-connect
  const nearWalletOptions: WalletOption[] = nearConnectWallets.map(w => ({
    id: w.id,
    name: w.name,
    icon: w.icon,
    type: 'near-connect' as const,
    description: w.description || 'NEAR wallet',
    available: true,
  }));

  const handleConnect = useCallback(async (option: WalletOption) => {
    if (!option.available && option.type !== 'passkey') {
      // Open install page for unavailable wallets
      const installUrls: Record<string, string> = {
        phantom: 'https://phantom.app/download',
        solflare: 'https://solflare.com/download',
        backpack: 'https://backpack.app/download',
      };
      if (installUrls[option.id]) {
        window.open(installUrls[option.id], '_blank');
      }
      return;
    }

    setConnecting(option.id);

    try {
      if (option.type === 'solana') {
        await connectSolana();
      } else if (option.type === 'near-connect') {
        // Use near-connect with specific wallet ID
        await connectNear(option.id);
      } else if (option.type === 'passkey') {
        await connectPasskey();
      }
    } finally {
      setConnecting(null);
    }
  }, [connectSolana, connectNear, connectPasskey]);

  const handleRegisterPasskey = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passkeyUsername.trim()) return;

    setConnecting('passkey-register');
    try {
      await registerPasskey(passkeyUsername.trim());
      setPasskeyUsername('');
      setActiveTab('connect');
    } finally {
      setConnecting(null);
    }
  }, [passkeyUsername, registerPasskey]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeLoginModal();
    }
  }, [closeLoginModal]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isLoginModalOpen) {
        closeLoginModal();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isLoginModalOpen, closeLoginModal]);

  if (!isLoginModalOpen) return null;

  const solanaWallets = walletOptions.filter(w => w.type === 'solana');
  const passkey = walletOptions.find(w => w.type === 'passkey');
  const hasStoredPasskeys = (() => {
    try {
      const stored = localStorage.getItem('zkpf_passkey_credentials');
      const parsed = stored ? JSON.parse(stored) : [];
      return parsed.length > 0;
    } catch {
      return false;
    }
  })();

  return (
    <div className="login-modal-backdrop" onClick={handleBackdropClick}>
      <div className="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
        <button className="login-modal-close" onClick={closeLoginModal} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="login-modal-header">
          <div className="login-modal-icon">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="23" stroke="url(#gradient)" strokeWidth="2" />
              <path d="M24 14v10M24 28v6M18 20h12M18 28h12" stroke="url(#gradient)" strokeWidth="2" strokeLinecap="round" />
              <defs>
                <linearGradient id="gradient" x1="0" y1="0" x2="48" y2="48">
                  <stop stopColor="#38bdf8" />
                  <stop offset="1" stopColor="#818cf8" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 id="login-modal-title">Connect Wallet</h2>
          <p className="login-modal-subtitle">
            Choose your preferred authentication method
          </p>
        </div>

        <div className="login-modal-tabs">
          <button 
            className={`login-modal-tab ${activeTab === 'connect' ? 'active' : ''}`}
            onClick={() => setActiveTab('connect')}
          >
            Connect
          </button>
          <button 
            className={`login-modal-tab ${activeTab === 'passkey-register' ? 'active' : ''}`}
            onClick={() => setActiveTab('passkey-register')}
          >
            New Passkey
          </button>
        </div>

        <div className="login-modal-content">
          {activeTab === 'connect' && (
            <>
              {/* Solana Wallets */}
              <div className="wallet-section">
                <div className="wallet-section-header">
                  <span className="wallet-section-icon">◎</span>
                  <span>Solana</span>
                </div>
                <div className="wallet-options">
                  {solanaWallets.map(wallet => (
                    <button
                      key={wallet.id}
                      className={`wallet-option ${!wallet.available ? 'unavailable' : ''} ${connecting === wallet.id ? 'connecting' : ''}`}
                      onClick={() => handleConnect(wallet)}
                      disabled={status === 'connecting'}
                    >
                      <span className="wallet-option-icon">{wallet.icon}</span>
                      <div className="wallet-option-info">
                        <span className="wallet-option-name">{wallet.name}</span>
                        <span className="wallet-option-status">
                          {!wallet.available ? 'Install' : wallet.description}
                        </span>
                      </div>
                      {connecting === wallet.id && (
                        <span className="wallet-option-spinner" />
                      )}
                      {!wallet.available && (
                        <span className="wallet-option-install">↗</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* NEAR Wallets via near-connect */}
              <div className="wallet-section near-connect-section">
                <div className="wallet-section-header">
                  <span className="wallet-section-icon">Ⓝ</span>
                  <span>NEAR</span>
                  {!nearConnectReady && (
                    <span className="wallet-section-loading">
                      <span className="wallet-option-spinner" />
                    </span>
                  )}
                </div>
                <div className="wallet-options near-wallet-grid">
                  {nearWalletOptions.map(wallet => (
                    <button
                      key={wallet.id}
                      className={`wallet-option near-connect-wallet ${connecting === wallet.id ? 'connecting' : ''}`}
                      onClick={() => handleConnect(wallet)}
                      disabled={status === 'connecting' || !nearConnectReady}
                    >
                      <span className="wallet-option-icon">{wallet.icon}</span>
                      <div className="wallet-option-info">
                        <span className="wallet-option-name">{wallet.name}</span>
                        <span className="wallet-option-status">{wallet.description}</span>
                      </div>
                      {connecting === wallet.id && (
                        <span className="wallet-option-spinner" />
                      )}
                    </button>
                  ))}
                </div>
                <p className="near-connect-powered">
                  Powered by <a href="https://github.com/azbang/near-connect" target="_blank" rel="noopener noreferrer">near-connect</a>
                </p>
              </div>

              {/* Passkey */}
              {passkey && (
                <div className="wallet-section passkey-section">
                  <div className="wallet-section-header">
                    <span className="wallet-section-icon">🔐</span>
                    <span>Passkey</span>
                  </div>
                  <div className="wallet-options">
                    <button
                      className={`wallet-option passkey-option ${!passkey.available ? 'unavailable' : ''} ${connecting === 'passkey' ? 'connecting' : ''} ${!hasStoredPasskeys ? 'no-passkeys' : ''}`}
                      onClick={() => hasStoredPasskeys ? handleConnect(passkey) : setActiveTab('passkey-register')}
                      disabled={status === 'connecting' || !passkey.available}
                    >
                      <span className="wallet-option-icon">{passkey.icon}</span>
                      <div className="wallet-option-info">
                        <span className="wallet-option-name">
                          {hasStoredPasskeys ? 'Sign in with Passkey' : 'Create a Passkey'}
                        </span>
                        <span className="wallet-option-status">
                          {!passkey.available 
                            ? 'Not supported in this browser' 
                            : hasStoredPasskeys 
                              ? 'Face ID, Touch ID, or security key'
                              : 'Set up biometric authentication'}
                        </span>
                      </div>
                      {connecting === 'passkey' && (
                        <span className="wallet-option-spinner" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'passkey-register' && (
            <div className="passkey-register">
              <div className="passkey-register-icon">
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <circle cx="40" cy="40" r="38" stroke="url(#passkey-gradient)" strokeWidth="2" opacity="0.3" />
                  <circle cx="40" cy="40" r="28" stroke="url(#passkey-gradient)" strokeWidth="2" opacity="0.6" />
                  <circle cx="40" cy="40" r="18" fill="url(#passkey-gradient)" opacity="0.1" />
                  <path d="M40 28v24M28 40h24" stroke="url(#passkey-gradient)" strokeWidth="3" strokeLinecap="round" />
                  <defs>
                    <linearGradient id="passkey-gradient" x1="0" y1="0" x2="80" y2="80">
                      <stop stopColor="#10b981" />
                      <stop offset="1" stopColor="#06b6d4" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h3>Create a Passkey</h3>
              <p className="passkey-register-description">
                Passkeys use your device's biometric authentication (Face ID, Touch ID, fingerprint, or security key) for secure, passwordless login.
              </p>
              <form onSubmit={handleRegisterPasskey} className="passkey-register-form">
                <div className="input-group">
                  <label htmlFor="passkey-username">Display Name</label>
                  <input
                    id="passkey-username"
                    type="text"
                    value={passkeyUsername}
                    onChange={(e) => setPasskeyUsername(e.target.value)}
                    placeholder="e.g., My MacBook, Work Laptop"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    required
                    disabled={connecting === 'passkey-register'}
                  />
                </div>
                <button 
                  type="submit" 
                  className="passkey-register-button"
                  disabled={!passkeyUsername.trim() || connecting === 'passkey-register'}
                >
                  {connecting === 'passkey-register' ? (
                    <>
                      <span className="wallet-option-spinner" />
                      Waiting for biometric...
                    </>
                  ) : (
                    <>
                      <span>🔐</span>
                      Create Passkey
                    </>
                  )}
                </button>
              </form>
              <p className="passkey-register-note">
                Your passkey is stored securely on your device and never leaves it.
              </p>
            </div>
          )}

          {error && (
            <div className="login-modal-error">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="login-modal-footer">
          <p>
            By connecting, you agree to our{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
            {' '}and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          </p>
        </div>
      </div>
    </div>
  );
}

