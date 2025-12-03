/**
 * Passkey Prompt Component
 * 
 * Authentication gate for /wallet routes:
 * - Only shows if a wallet already exists AND user has created a passkey
 * - If passkey exists: requires verification before accessing wallet
 * - If no passkey exists: user can access wallet without passkey (not required)
 * 
 * If no wallet exists, users can proceed directly to wallet creation without passkey.
 * Passkey is optional - users only need to authenticate if they've chosen to set one up.
 * Re-authentication is required every time the user leaves and re-enters /wallet routes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { PASSKEY_CREDENTIALS_KEY } from '../../types/auth';
import { LockIcon } from '../icons/LockIcon';
import { migratePlainToEncrypted } from '../../utils/secureUfvkStorage';
import './PasskeyPrompt.css';

interface StoredPasskey {
  credentialId: string;
  username: string;
  publicKey: string;
  createdAt: number;
}

function getStoredPasskeys(): StoredPasskey[] {
  try {
    const stored = localStorage.getItem(PASSKEY_CREDENTIALS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function PasskeyPrompt() {
  const { connectPasskey, registerPasskey, status, account } = useAuth();
  const { state: walletState } = useWebZjsContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [username, setUsername] = useState('');
  const [showUsernameInput, setShowUsernameInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track if user has verified during this wallet session
  const [walletSessionVerified, setWalletSessionVerified] = useState(false);
  const wasOnWalletRoute = useRef(false);

  // Check if we're on any /wallet route
  const isWalletRoute = location.pathname.startsWith('/wallet');

  // Check if a wallet exists (only check activeAccount - UFVK in storage alone doesn't mean wallet is created)
  const [walletExists, setWalletExists] = useState(false);
  
  useEffect(() => {
    const checkWallet = async () => {
      // Only show passkey prompt if there's an active account (wallet is actually created)
      // Don't check hasUfvk() alone because UFVK might exist in storage without a wallet being created
      const exists = walletState.activeAccount != null;
      setWalletExists(exists);
    };
    checkWallet();
  }, [walletState.activeAccount]);

  // Reset verification when user leaves /wallet routes and comes back
  useEffect(() => {
    if (isWalletRoute && !wasOnWalletRoute.current) {
      // User just entered /wallet routes - require re-verification
      setWalletSessionVerified(false);
      setError(null);
    }
    wasOnWalletRoute.current = isWalletRoute;
  }, [isWalletRoute, location.pathname]);

  // Check for passkeys on mount and when route changes
  useEffect(() => {
    if (!isWalletRoute) return;
    
    const passkeys = getStoredPasskeys();
    setHasPasskeys(passkeys.length > 0);
  }, [isWalletRoute, location.pathname]);

  // User is considered authenticated for this wallet session if they've verified
  const isAuthenticated = walletSessionVerified && account?.type === 'passkey' && status === 'connected';

  // Handle going back to home
  const handleGoBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const handleCreatePasskey = useCallback(async () => {
    if (!window.PublicKeyCredential) {
      setError('WebAuthn is not supported in this browser. Please use a modern browser.');
      return;
    }

    if (!username.trim()) {
      setShowUsernameInput(true);
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
      await registerPasskey(username.trim());
      // Successfully registered - migrate plain text UFVK to encrypted if needed
      await migratePlainToEncrypted();
      // Mark this wallet session as verified
      setWalletSessionVerified(true);
    } catch (err) {
      console.error('Failed to create passkey:', err);
      setError(err instanceof Error ? err.message : 'Failed to create passkey. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [username, registerPasskey]);

  const handleVerifyPasskey = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      await connectPasskey();
      // Successfully verified - migrate plain text UFVK to encrypted if needed
      await migratePlainToEncrypted();
      // Mark this wallet session as verified
      setWalletSessionVerified(true);
    } catch (err) {
      console.error('Failed to verify with passkey:', err);
      setError(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [connectPasskey]);

  // Don't render if:
  // - Not on wallet route
  // - Already authenticated
  // - No wallet exists (user can proceed to wallet creation without passkey)
  // - No passkeys exist (user hasn't chosen to add one, so don't require it)
  if (!isWalletRoute || isAuthenticated || !walletExists || !hasPasskeys) {
    return null;
  }

  return (
    <div className="passkey-prompt-backdrop passkey-prompt-mandatory">
      <div className="passkey-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="passkey-prompt-content">
          <div className="passkey-prompt-icon">
            <LockIcon size={48} />
          </div>
          
          <div className="passkey-prompt-security-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Required for Security
          </div>
          
          {hasPasskeys ? (
            <>
              <h3 className="passkey-prompt-title">Sign in to zkpf.dev</h3>
              <p className="passkey-prompt-description">
                Verify your identity with your passkey to access your wallet
              </p>
              
              {error && (
                <div className="passkey-prompt-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {error}
                </div>
              )}
              
              <button
                className={`wallet-option passkey-option ${isProcessing ? 'connecting' : ''}`}
                onClick={handleVerifyPasskey}
                disabled={isProcessing || status === 'connecting'}
              >
                <span className="wallet-option-icon">
                  <LockIcon size={24} />
                </span>
                <div className="wallet-option-info">
                  <span className="wallet-option-name">Sign in with Passkey</span>
                  <span className="wallet-option-status">Face ID, Touch ID, or security key</span>
                </div>
                {isProcessing && <span className="wallet-option-spinner" />}
              </button>
            </>
          ) : (
            <>
              <h3 className="passkey-prompt-title">Create a Passkey</h3>
              <p className="passkey-prompt-description">
                A passkey is required to access your wallet. Set up biometric authentication for secure access.
              </p>
              
              {error && (
                <div className="passkey-prompt-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {error}
                </div>
              )}
              
              {showUsernameInput ? (
                <div className="passkey-prompt-form">
                  <label className="passkey-prompt-label">
                    Choose a name for your passkey
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g., My Wallet"
                    className="passkey-prompt-input"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && username.trim()) {
                        handleCreatePasskey();
                      }
                    }}
                  />
                  <div className="passkey-prompt-actions">
                    <button
                      className="passkey-prompt-button passkey-prompt-button-primary"
                      onClick={handleCreatePasskey}
                      disabled={isProcessing || !username.trim() || status === 'connecting'}
                    >
                      {isProcessing ? 'Creating...' : 'Create Passkey'}
                    </button>
                    <button
                      className="passkey-prompt-button passkey-prompt-button-ghost"
                      onClick={() => {
                        setShowUsernameInput(false);
                        setUsername('');
                      }}
                      disabled={isProcessing}
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={`wallet-option passkey-option no-passkeys ${isProcessing ? 'connecting' : ''}`}
                  onClick={() => setShowUsernameInput(true)}
                  disabled={isProcessing || status === 'connecting'}
                >
                  <span className="wallet-option-icon">
                    <LockIcon size={24} />
                  </span>
                  <div className="wallet-option-info">
                    <span className="wallet-option-name">Create a Passkey</span>
                    <span className="wallet-option-status">Set up biometric authentication</span>
                  </div>
                </button>
              )}
            </>
          )}

          <button
            className="passkey-prompt-back"
            onClick={handleGoBack}
            disabled={isProcessing}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

