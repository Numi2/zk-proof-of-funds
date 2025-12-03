/**
 * Login or Create Account Component
 * 
 * Provides explicit options for users to either login with an existing account
 * or create a new Orderly account. Uses SDK state machine for proper flow.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount } from '@orderly.network/hooks';
import { AccountStatusEnum } from '@orderly.network/types';
import { useNetwork } from '../../context/NetworkContext';
import { useNear } from '../../context/NearContext';
import './LoginOrCreateAccount.css';

interface LoginOrCreateAccountProps {
  /** Chain type to check (EVM, SOL, or NEAR) */
  chainType?: 'EVM' | 'SOL' | 'NEAR';
  /** Callback when account is ready for trading */
  onAccountReady?: () => void;
  /** Show compact version */
  compact?: boolean;
}

/**
 * Account Status Helper
 * SDK Status Values:
 * - 0: NotConnected
 * - 1: Connected (wallet connected, not signed in)
 * - 2: NotSignedIn
 * - 3: SignedIn (account exists, trading not enabled)
 * - 4: DisabledTrading
 * - 5: EnableTrading (fully ready)
 */
const getStatusInfo = (status: number) => {
  switch (status) {
    case AccountStatusEnum.NotConnected:
      return { label: 'Not Connected', needsAction: 'connect', color: 'gray' };
    case AccountStatusEnum.Connected:
      return { label: 'Connected', needsAction: 'createAccount', color: 'yellow' };
    case AccountStatusEnum.NotSignedIn:
      return { label: 'Not Signed In', needsAction: 'createAccount', color: 'yellow' };
    case AccountStatusEnum.SignedIn:
      return { label: 'Signed In', needsAction: 'enableTrading', color: 'blue' };
    case AccountStatusEnum.DisabledTrading:
      return { label: 'Trading Disabled', needsAction: 'enableTrading', color: 'orange' };
    case AccountStatusEnum.EnableTrading:
      return { label: 'Ready to Trade', needsAction: null, color: 'green' };
    default:
      return { label: 'Unknown', needsAction: null, color: 'gray' };
  }
};

export function LoginOrCreateAccount({
  chainType = 'EVM',
  onAccountReady,
  compact = false,
}: LoginOrCreateAccountProps) {
  const { account, state: accountState, createAccount, createOrderlyKey } = useAccount();
  const { isTestnet } = useNetwork();
  const nearContext = chainType === 'NEAR' ? useNear() : null;
  const [isCreating, setIsCreating] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [isAutoProgressing, setIsAutoProgressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<number>(0);
  const hasNotifiedRef = useRef(false);
  
  // For NEAR: check if wallet is connected
  const nearConnected = chainType === 'NEAR' ? nearContext?.isConnected : false;
  const nearAccountId = chainType === 'NEAR' ? nearContext?.accountId : null;

  // Ensure accountState exists before accessing status
  const status = accountState?.status ?? AccountStatusEnum.NotConnected;
  const statusInfo = getStatusInfo(status);
  
  // Ensure SDK methods are available
  const canCreateAccount = typeof createAccount === 'function';
  const canEnableTrading = typeof createOrderlyKey === 'function';
  
  // Determine state
  // For NEAR, use NEAR connection status; for EVM/SOL, use Orderly SDK status
  const walletConnected = chainType === 'NEAR' 
    ? nearConnected 
    : status >= AccountStatusEnum.Connected;
  const accountCreated = status >= AccountStatusEnum.SignedIn;
  const tradingEnabled = status >= AccountStatusEnum.EnableTrading;
  
  // For NEAR: if wallet is connected but account not created, we need to create Orderly account
  const needsNearAccountCreation = chainType === 'NEAR' && nearConnected && !accountCreated;

  // Notify when account is fully ready (only once)
  useEffect(() => {
    if (tradingEnabled && onAccountReady && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      onAccountReady();
    } else if (!tradingEnabled) {
      // Reset notification flag when trading is disabled
      hasNotifiedRef.current = false;
    }
  }, [tradingEnabled, onAccountReady]);

  // Handle account creation with auto-progression
  const handleCreateAccount = useCallback(async () => {
    if (isCreating || !canCreateAccount) return;
    
    setIsCreating(true);
    setError(null);
    setProgressStep(1);
    
    try {
      await createAccount();
      setProgressStep(2);
      
      // Auto-progress to enable trading if account was just created
      // Wait a bit for state to update
      setTimeout(async () => {
        if (!tradingEnabled && canEnableTrading) {
          setIsAutoProgressing(true);
          try {
            await createOrderlyKey(true);
            setProgressStep(3);
          } catch (err) {
            // Don't show error here, user can manually enable trading
            console.warn('Auto-enable trading failed, user can enable manually:', err);
          } finally {
            setIsAutoProgressing(false);
          }
        }
      }, 500);
      
      // SDK will update state automatically
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create account';
      setError(message);
      console.error('Account creation failed:', err);
      setProgressStep(0);
    } finally {
      setIsCreating(false);
    }
  }, [createAccount, isCreating, canCreateAccount, tradingEnabled, canEnableTrading, createOrderlyKey]);

  // Handle enabling trading (creates Orderly key)
  const handleEnableTrading = useCallback(async () => {
    if (isEnabling || !canEnableTrading) return;
    
    setIsEnabling(true);
    setError(null);
    setProgressStep(2);
    
    try {
      // Pass true to remember the key
      await createOrderlyKey(true);
      setProgressStep(3);
      // SDK will update state automatically
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable trading';
      setError(message);
      console.error('Enable trading failed:', err);
      setProgressStep(1);
    } finally {
      setIsEnabling(false);
    }
  }, [createOrderlyKey, isEnabling, canEnableTrading]);
  
  // Handle NEAR wallet connection
  const handleConnectNear = useCallback(async () => {
    if (!nearContext) return;
    
    try {
      setError(null);
      await nearContext.connect();
      // After NEAR connection, we may need to create Orderly account
      // This will be handled by the component state
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect NEAR wallet';
      setError(message);
      console.error('NEAR connection failed:', err);
    }
  }, [nearContext]);
  
  // Reset progress when status changes
  useEffect(() => {
    if (tradingEnabled) {
      setProgressStep(3);
    } else if (accountCreated) {
      setProgressStep(2);
    } else if (walletConnected) {
      setProgressStep(1);
    } else {
      setProgressStep(0);
    }
  }, [walletConnected, accountCreated, tradingEnabled]);

  // Compact version
  if (compact) {
    return (
      <div className="login-create-compact">
        {!walletConnected && (
          <div className="status-message info">
            <span className="status-icon">🔌</span>
            <span>Connect wallet to get started</span>
          </div>
        )}
        
        {walletConnected && !accountCreated && (
          <div className="status-message warning">
            <span className="status-icon">📝</span>
            <span>Account creation needed</span>
            <button 
              className="compact-action-btn"
              onClick={handleCreateAccount}
              disabled={isCreating}
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
          </div>
        )}
        
        {accountCreated && !tradingEnabled && (
          <div className="status-message warning">
            <span className="status-icon">🔑</span>
            <span>Enable trading to continue</span>
            <button 
              className="compact-action-btn"
              onClick={handleEnableTrading}
              disabled={isEnabling}
            >
              {isEnabling ? 'Enabling...' : 'Enable'}
            </button>
          </div>
        )}
        
        {tradingEnabled && (
          <div className="status-message success">
            <span className="status-icon">✅</span>
            <span>Ready to trade</span>
          </div>
        )}
        
        {error && (
          <div className="status-message error">
            <span className="status-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="login-create-account">
      <div className="auth-header">
        <h2 className="auth-title">
          <span className="title-icon">🔐</span>
          {walletConnected ? 'Account Setup' : 'Connect Wallet'}
        </h2>
        <div className="header-badges">
          {isTestnet && (
            <span className="network-badge testnet">Testnet</span>
          )}
          <span className={`status-badge ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Progress Indicator */}
      {walletConnected && (
        <div className="auth-progress">
          <div className="progress-steps">
            <div className={`progress-step ${progressStep >= 1 ? 'completed' : progressStep === 0 ? 'active' : ''}`}>
              <div className="step-number">1</div>
              <div className="step-label">Connect Wallet</div>
            </div>
            <div className={`progress-step ${progressStep >= 2 ? 'completed' : progressStep === 1 ? 'active' : ''}`}>
              <div className="step-number">2</div>
              <div className="step-label">Create Account</div>
            </div>
            <div className={`progress-step ${progressStep >= 3 ? 'completed' : progressStep === 2 ? 'active' : ''}`}>
              <div className="step-number">3</div>
              <div className="step-label">Enable Trading</div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Connect Wallet */}
      {!walletConnected && (
        <div className="auth-section">
          <div className="info-box">
            <p className="info-text">
              Connect your {chainType === 'NEAR' ? 'NEAR' : chainType === 'SOL' ? 'Solana' : 'EVM'} wallet to access Orderly Network. 
              The system will guide you through account creation and trading setup.
            </p>
          </div>
          {chainType === 'NEAR' ? (
            <div className="action-hint">
              <span className="hint-icon">💡</span>
              <span>
                Connect your NEAR wallet to get started. You can choose from HOT Wallet, Meteor, Nightly, and more.
              </span>
            </div>
          ) : (
            <div className="action-hint">
              <span className="hint-icon">💡</span>
              <span>
                Click the wallet connection button in the header to get started
              </span>
            </div>
          )}
          {chainType === 'NEAR' && nearContext && (
            <button 
              className="action-button primary"
              onClick={handleConnectNear}
              disabled={nearContext.isInitializing}
            >
              {nearContext.isInitializing ? (
                <>
                  <span className="button-spinner" />
                  Connecting...
                </>
              ) : (
                <>
                  <span className="button-icon">Ⓝ</span>
                  Connect NEAR Wallet
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Step 2: Create Account */}
      {(walletConnected && !accountCreated) || needsNearAccountCreation ? (
        <div className="auth-section">
          <div className="status-card warning">
            <div className="status-header">
              <span className="status-icon large">📝</span>
              <div className="status-content">
                <h3 className="status-title">Create Account</h3>
                <p className="status-description">
                  {chainType === 'NEAR' 
                    ? `Your NEAR wallet (${nearAccountId?.slice(0, 8)}...) is connected but not registered with Orderly Network yet. Create an account to start trading.`
                    : 'Your wallet is connected but not registered with Orderly Network yet. Create an account to start trading.'
                  }
                </p>
              </div>
            </div>
            
            <div className="registration-info">
              <p className="registration-title">What happens when you create an account:</p>
              <ul className="registration-steps">
                <li>
                  <span className="step-icon">🔑</span>
                  <span>{chainType === 'NEAR' ? 'Your NEAR account will be linked to Orderly' : 'You\'ll sign a message to prove wallet ownership'}</span>
                </li>
                <li>
                  <span className="step-icon">🆔</span>
                  <span>A unique Orderly account ID will be created</span>
                </li>
                <li>
                  <span className="step-icon">⚡</span>
                  <span>You'll be able to trade across multiple chains</span>
                </li>
                {chainType !== 'NEAR' && (
                  <li>
                    <span className="step-icon">🚀</span>
                    <span>Trading keys will be automatically generated</span>
                  </li>
                )}
              </ul>
              <div className="registration-note">
                <span className="note-icon">ℹ️</span>
                <span>
                  Account creation is free and only requires a wallet signature. 
                  {isTestnet && ' No gas fees on testnet.'}
                  {chainType === 'NEAR' && ' NEAR accounts can deposit and withdraw tokens directly.'}
                </span>
              </div>
            </div>

            <button 
              className="action-button primary"
              onClick={handleCreateAccount}
              disabled={isCreating || isAutoProgressing || !canCreateAccount}
            >
              {isCreating || isAutoProgressing ? (
                <>
                  <span className="button-spinner" />
                  {isAutoProgressing ? 'Setting up...' : 'Creating Account...'}
                </>
              ) : (
                <>
                  <span className="button-icon">✨</span>
                  Create Account {chainType === 'NEAR' ? '& Enable Trading' : ''}
                </>
              )}
            </button>
            {isAutoProgressing && (
              <div className="auto-progress-note">
                <span className="note-icon">⚡</span>
                <span>Automatically enabling trading...</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Step 3: Enable Trading */}
      {accountCreated && !tradingEnabled && (
        <div className="auth-section">
          <div className="status-card info">
            <div className="status-header">
              <span className="status-icon large">🔑</span>
              <div className="status-content">
                <h3 className="status-title">Enable Trading</h3>
                <p className="status-description">
                  Your account is created! Enable trading to access all features.
                </p>
              </div>
            </div>
            
            <div className="registration-info">
              <p className="registration-title">What happens when you enable trading:</p>
              <ul className="registration-steps">
                <li>
                  <span className="step-icon">🔐</span>
                  <span>Sign to create secure trading keys</span>
                </li>
                <li>
                  <span className="step-icon">⚡</span>
                  <span>Enable fast order execution without gas</span>
                </li>
                <li>
                  <span className="step-icon">💰</span>
                  <span>Deposit and withdraw assets seamlessly</span>
                </li>
              </ul>
            </div>

            <button 
              className="action-button primary"
              onClick={handleEnableTrading}
              disabled={isEnabling || !canEnableTrading}
            >
              {isEnabling ? (
                <>
                  <span className="button-spinner" />
                  Enabling Trading...
                </>
              ) : (
                <>
                  <span className="button-icon">🚀</span>
                  Enable Trading
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Ready to Trade */}
      {tradingEnabled && (
        <div className="auth-section">
          <div className="status-card success">
            <div className="status-header">
              <span className="status-icon large">✅</span>
              <div className="status-content">
                <h3 className="status-title">Ready to Trade</h3>
                <p className="status-description">
                  Your Orderly account is fully set up and ready to trade!
                </p>
              </div>
            </div>
            {(account?.address || nearAccountId) && (
              <div className="account-info">
                <div className="info-row">
                  <span className="info-label">Wallet:</span>
                  <span className="info-value">
                    {chainType === 'NEAR' && nearAccountId
                      ? `${nearAccountId.slice(0, 8)}...${nearAccountId.slice(-6)}`
                      : account?.address
                      ? `${account.address.slice(0, 6)}...${account.address.slice(-4)}`
                      : 'Unknown'}
                  </span>
                </div>
                {chainType === 'NEAR' && nearContext?.networkId && (
                  <div className="info-row">
                    <span className="info-label">Network:</span>
                    <span className="info-value">{nearContext.networkId}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="auth-section">
          <div className="status-card error">
            <span className="status-icon">⚠️</span>
            <p className="error-text">{error}</p>
            <button
              className="retry-button"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Account State Debug Info (only in development) */}
      {walletConnected && import.meta.env.DEV && (
        <div className="account-state-info">
          <div className="state-row">
            <span className="state-label">Status Code:</span>
            <span className="state-value">{status}</span>
          </div>
          <div className="state-row">
            <span className="state-label">Status:</span>
            <span className={`state-value ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>
          {account?.address && (
            <div className="state-row">
              <span className="state-label">Wallet:</span>
              <span className="state-value">
                {account.address.slice(0, 8)}...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
