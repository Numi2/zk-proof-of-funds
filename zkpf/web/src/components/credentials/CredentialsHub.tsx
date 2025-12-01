/**
 * Cross-chain Proof-of-Funds Credentials Hub
 * 
 * A central dashboard for managing, generating, and verifying
 * proof-of-funds credentials across multiple chains.
 * 
 * Focus: Proving funds exist, NOT moving assets.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CredentialCard, type Credential } from './CredentialCard';
import { ChainCredentialGenerator } from './ChainCredentialGenerator';
import { CredentialVerifier } from './CredentialVerifier';
import { CredentialShareModal } from './CredentialShareModal';
import { useCredentialsStore } from './useCredentialsStore';
import { useWebZjsContext } from '../../context/WebzjsContext';
import './CredentialsHub.css';

type TabId = 'dashboard' | 'generate' | 'verify' | 'history';

const SUPPORTED_CHAINS = [
  { id: 'zcash', name: 'Zcash', icon: '🛡️', color: '#f4b728', status: 'live' as const },
  { id: 'mina', name: 'Mina', icon: '∞', color: '#e6007a', status: 'beta' as const },
  { id: 'starknet', name: 'Starknet', icon: '⬡', color: '#29296e', status: 'beta' as const },
  { id: 'near', name: 'NEAR', icon: '◈', color: '#00c08b', status: 'beta' as const },
  { id: 'ethereum', name: 'Ethereum', icon: '◊', color: '#627eea', status: 'soon' as const },
] as const;

export const CredentialsHub: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedCredential, setSelectedCredential] = useState<Credential | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const { state: walletState } = useWebZjsContext();
  
  const { 
    credentials, 
    addCredential, 
    revokeCredential,
    getActiveCredentials,
  } = useCredentialsStore();

  // Decode and store the verify param for pre-filling the verifier
  const [prefillVerifyJson, setPrefillVerifyJson] = useState<string | null>(null);

  // Check if we should auto-open verifier with a credential from shared link
  useEffect(() => {
    const verifyParam = searchParams.get('verify');
    if (verifyParam) {
      setActiveTab('verify');
      try {
        // Decode the base64-encoded credential data
        const decodedJson = atob(verifyParam);
        setPrefillVerifyJson(decodedJson);
      } catch (err) {
        console.error('Failed to decode verify param:', err);
        // Still open verify tab, just without prefill
        setPrefillVerifyJson(null);
      }
    }
  }, [searchParams]);

  const activeCredentials = useMemo(() => getActiveCredentials(), [credentials, getActiveCredentials]);

  // Check wallet connection status
  const hasZcashWallet = walletState.activeAccount != null;
  const zcashBalance = useMemo(() => {
    if (!walletState.summary || walletState.activeAccount == null) return null;
    const report = walletState.summary.account_balances.find(
      ([accountId]) => accountId === walletState.activeAccount
    );
    if (!report) return null;
    return report[1].orchard_balance + report[1].sapling_balance;
  }, [walletState.summary, walletState.activeAccount]);

  const handleCredentialGenerated = useCallback((credential: Credential) => {
    addCredential(credential);
    setActiveTab('dashboard');
  }, [addCredential]);

  const handleShareCredential = useCallback((credential: Credential) => {
    setSelectedCredential(credential);
    setShowShareModal(true);
  }, []);

  const handleRevokeCredential = useCallback((credentialId: string) => {
    if (confirm('Are you sure you want to revoke this credential? This action cannot be undone.')) {
      revokeCredential(credentialId);
    }
  }, [revokeCredential]);

  return (
    <div className="app-shell credentials-hub">
      {/* Header */}
      <header className="credentials-header">
        <div className="credentials-header-content">
          <div className="credentials-title-section">
            <h1 className="credentials-title">
              <span className="credentials-icon">🔐</span>
              Cross-chain Credentials Hub
            </h1>
            <p className="credentials-subtitle">
              Prove your funds across any chain. No bridging. No asset movement. Pure cryptographic proof.
            </p>
          </div>
        </div>
      </header>

      {/* Wallet Status Banner */}
      {hasZcashWallet && zcashBalance !== null && (
        <div className="wallet-status-banner">
          <div className="wallet-status-content">
            <span className="wallet-status-icon">🛡️</span>
            <div className="wallet-status-info">
              <span className="wallet-status-label">Zcash Wallet Connected</span>
              <span className="wallet-status-balance">
                {(zcashBalance / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ZEC
              </span>
            </div>
            <button 
              className="wallet-status-action"
              onClick={() => setActiveTab('generate')}
            >
              Generate Proof →
            </button>
          </div>
        </div>
      )}

      {/* Chain Overview removed per request */}

      {/* Tabs */}
      <nav className="credentials-tabs">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`credentials-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          My Credentials
        </button>
        <button
          onClick={() => setActiveTab('generate')}
          className={`credentials-tab ${activeTab === 'generate' ? 'active' : ''}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          Generate Credential
        </button>
        <button
          onClick={() => setActiveTab('verify')}
          className={`credentials-tab ${activeTab === 'verify' ? 'active' : ''}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Verify Credential
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`credentials-tab ${activeTab === 'history' ? 'active' : ''}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          History
        </button>
      </nav>

      {/* Tab Content */}
      <div className="credentials-content">
        {activeTab === 'dashboard' && (
          <DashboardTab 
            credentials={activeCredentials}
            onShare={handleShareCredential}
            onRevoke={handleRevokeCredential}
            onGenerateNew={() => setActiveTab('generate')}
            hasWallet={hasZcashWallet}
          />
        )}
        {activeTab === 'generate' && (
          <ChainCredentialGenerator 
            chains={SUPPORTED_CHAINS.filter(c => c.status !== 'soon')}
            onCredentialGenerated={handleCredentialGenerated}
          />
        )}
        {activeTab === 'verify' && (
          <CredentialVerifier prefillJson={prefillVerifyJson} />
        )}
        {activeTab === 'history' && (
          <HistoryTab 
            credentials={credentials}
            onShare={handleShareCredential}
          />
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && selectedCredential && (
        <CredentialShareModal
          credential={selectedCredential}
          onClose={() => {
            setShowShareModal(false);
            setSelectedCredential(null);
          }}
        />
      )}
    </div>
  );
};

interface DashboardTabProps {
  credentials: Credential[];
  onShare: (credential: Credential) => void;
  onRevoke: (id: string) => void;
  onGenerateNew: () => void;
  hasWallet: boolean;
}

const DashboardTab: React.FC<DashboardTabProps> = ({ 
  credentials, 
  onShare, 
  onRevoke,
  onGenerateNew,
  hasWallet,
}) => {
  if (credentials.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔐</div>
        <h3>No Active Credentials</h3>
        <p>
          {hasWallet 
            ? 'Generate your first proof-of-funds credential from your connected wallet.'
            : 'Connect a wallet and generate your first proof-of-funds credential.'}
        </p>
        <button onClick={onGenerateNew} className="primary-button">
          <span>+</span> Generate Credential
        </button>
        {!hasWallet && (
          <p className="empty-state-hint">
            <a href="/wallet">Set up your Zcash wallet first →</a>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="credentials-grid">
      {credentials.map(credential => (
        <CredentialCard
          key={credential.id}
          credential={credential}
          onShare={() => onShare(credential)}
          onRevoke={() => onRevoke(credential.id)}
        />
      ))}
    </div>
  );
};

interface HistoryTabProps {
  credentials: Credential[];
  onShare: (credential: Credential) => void;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ credentials, onShare }) => {
  const sortedCredentials = useMemo(() => {
    return [...credentials].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [credentials]);

  if (sortedCredentials.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📜</div>
        <h3>No History Yet</h3>
        <p>Your credential generation history will appear here after you create your first proof.</p>
      </div>
    );
  }

  return (
    <div className="history-list">
      <div className="history-header">
        <span>Credential</span>
        <span>Chain</span>
        <span>Value Proven</span>
        <span>Status</span>
        <span>Date</span>
        <span>Actions</span>
      </div>
      {sortedCredentials.map(credential => (
        <div key={credential.id} className={`history-row history-row-${credential.status}`}>
          <span className="history-cell history-cell-id">
            <code>{credential.id.slice(0, 8)}...{credential.id.slice(-4)}</code>
          </span>
          <span className="history-cell history-cell-chain">
            <span className="chain-badge" style={{ '--chain-color': getChainColor(credential.chain) } as React.CSSProperties}>
              {credential.chainIcon} {credential.chain}
            </span>
          </span>
          <span className="history-cell history-cell-value">
            ≥ {credential.provenValue.toLocaleString()} {credential.currency}
          </span>
          <span className="history-cell history-cell-status">
            <span className={`status-badge status-badge-${credential.status}`}>
              {credential.status}
            </span>
          </span>
          <span className="history-cell history-cell-date">
            {new Date(credential.createdAt).toLocaleDateString()}
          </span>
          <span className="history-cell history-cell-actions">
            {credential.status === 'verified' && (
              <button 
                className="icon-button" 
                onClick={() => onShare(credential)}
                title="Share credential"
              >
                ↗
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
};

function getChainColor(chainId: string): string {
  const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
  return chain?.color ?? '#666';
}

export default CredentialsHub;
