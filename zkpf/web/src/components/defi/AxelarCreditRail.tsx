import React, { useState, useEffect, useCallback } from 'react';
import {
  createAxelarCreditRailClient,
  ZecTier,
  TIER_INFO,
  type ZecCredential,
  type ChainInfo,
} from '../../services/axelar-credit-rail';
import './AxelarCreditRail.css';

const API_BASE = import.meta.env.VITE_AXELAR_RAIL_API || '/api/rails/axelar';

export const AxelarCreditRail: React.FC = () => {
  const [client] = useState(() => createAxelarCreditRailClient(API_BASE));
  const [accountTag, setAccountTag] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<ZecTier>(ZecTier.TIER_1);
  const [credentials, setCredentials] = useState<ZecCredential[]>([]);
  const [supportedChains, setSupportedChains] = useState<{ evmChains: ChainInfo[]; cosmosChains: ChainInfo[] }>({
    evmChains: [],
    cosmosChains: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<any>(null);

  // Load rail info and supported chains
  useEffect(() => {
    async function loadInfo() {
      try {
        const [railInfo, chains] = await Promise.all([
          client.info(),
          client.getSupportedChains(),
        ]);
        setInfo(railInfo);
        setSupportedChains(chains);
      } catch (err) {
        console.error('Failed to load rail info:', err);
      }
    }
    loadInfo();
  }, [client]);

  // Load credentials for account
  const loadCredentials = useCallback(async () => {
    if (!accountTag) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await client.getAccountCredentials(accountTag);
      setCredentials(data.credentials as ZecCredential[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load credentials');
    } finally {
      setIsLoading(false);
    }
  }, [accountTag, client]);

  useEffect(() => {
    if (accountTag) {
      loadCredentials();
    }
  }, [accountTag, loadCredentials]);

  // Issue credential
  const handleIssueCredential = async () => {
    if (!accountTag) {
      setError('Please enter an account tag');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Mock data - in production, these would come from wallet/proof generation
      const result = await client.issueCredential({
        accountTag,
        tier: selectedTier,
        stateRoot: '0x' + '0'.repeat(64), // Mock
        blockHeight: 1000000, // Mock
        proofCommitment: '0x' + '0'.repeat(64), // Mock
        attestationHash: '0x' + '0'.repeat(64), // Mock
      });

      if (result.success && result.credentialId) {
        await loadCredentials();
      } else {
        setError(result.error || 'Failed to issue credential');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue credential');
    } finally {
      setIsLoading(false);
    }
  };

  // Broadcast credential
  const handleBroadcast = async (credentialId: string, targetChains?: string[]) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.broadcastCredential({
        credentialId,
        targetChains,
      });

      if (result.success) {
        await loadCredentials();
      } else {
        setError(result.error || 'Failed to broadcast credential');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to broadcast credential');
    } finally {
      setIsLoading(false);
    }
  };

  // Revoke credential
  const handleRevoke = async (credentialId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await client.revokeCredential({
        credentialId,
        reason: 0, // USER_REQUESTED
        broadcast: true,
      });

      if (result.success) {
        await loadCredentials();
      } else {
        setError(result.error || 'Failed to revoke credential');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke credential');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  return (
    <div className="axelar-credit-rail">
      {/* Info Card */}
      {info && (
        <div className="rail-info-card">
          <h3>Rail Information</h3>
          <div className="info-grid">
            <div>
              <span className="info-label">Rail ID:</span>
              <span className="info-value">{info.railId}</span>
            </div>
            <div>
              <span className="info-label">Origin Chain:</span>
              <span className="info-value">{info.originChainName}</span>
            </div>
            <div>
              <span className="info-label">Active Subscriptions:</span>
              <span className="info-value">{info.activeSubscriptions}</span>
            </div>
            <div>
              <span className="info-label">Validity Window:</span>
              <span className="info-value">{Math.floor(info.validityWindowSecs / 86400)} days</span>
            </div>
          </div>
        </div>
      )}

      {/* Issue Credential Form */}
      <div className="issue-credential-section">
        <h3>Issue ZEC Credential</h3>
        <div className="form-group">
          <label>Account Tag</label>
          <input
            type="text"
            value={accountTag}
            onChange={(e) => setAccountTag(e.target.value)}
            placeholder="0x..."
            className="account-input"
          />
        </div>
        <div className="form-group">
          <label>Tier</label>
          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(Number(e.target.value) as ZecTier)}
            className="tier-select"
          >
            {TIER_INFO.map((tier) => (
              <option key={tier.value} value={tier.value}>
                {tier.name} ({tier.thresholdZec} ZEC)
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleIssueCredential}
          disabled={isLoading || !accountTag}
          className="issue-button"
        >
          {isLoading ? 'Issuing...' : 'Issue Credential'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Credentials List */}
      {accountTag && (
        <div className="credentials-section">
          <h3>Your Credentials</h3>
          {isLoading && credentials.length === 0 ? (
            <div className="loading">Loading credentials...</div>
          ) : credentials.length === 0 ? (
            <div className="empty-state">No credentials found for this account</div>
          ) : (
            <div className="credentials-list">
              {credentials.map((cred) => (
                <div key={cred.credentialId} className="credential-card">
                  <div className="credential-header">
                    <span className="credential-id">{cred.credentialId.slice(0, 16)}...</span>
                    <span className={`credential-status ${cred.isValid ? 'valid' : 'invalid'}`}>
                      {cred.isValid ? '✓ Valid' : '✗ Invalid'}
                    </span>
                  </div>
                  <div className="credential-details">
                    <div>
                      <span className="detail-label">Tier:</span>
                      <span className="detail-value">{cred.tierName}</span>
                    </div>
                    <div>
                      <span className="detail-label">Issued:</span>
                      <span className="detail-value">{formatDate(cred.issuedAt)}</span>
                    </div>
                    <div>
                      <span className="detail-label">Expires:</span>
                      <span className="detail-value">{formatDate(cred.expiresAt)}</span>
                    </div>
                    <div>
                      <span className="detail-label">Revoked:</span>
                      <span className="detail-value">{cred.revoked ? 'Yes' : 'No'}</span>
                    </div>
                  </div>
                  <div className="credential-actions">
                    <button
                      onClick={() => handleBroadcast(cred.credentialId)}
                      disabled={isLoading || !cred.isValid}
                      className="broadcast-button"
                    >
                      Broadcast to All Chains
                    </button>
                    {cred.isValid && (
                      <button
                        onClick={() => handleRevoke(cred.credentialId)}
                        disabled={isLoading}
                        className="revoke-button"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Supported Chains */}
      {(supportedChains.evmChains.length > 0 || supportedChains.cosmosChains.length > 0) && (
        <div className="supported-chains-section">
          <h3>Supported Chains</h3>
          {supportedChains.evmChains.length > 0 && (
            <div className="chains-group">
              <h4>EVM Chains</h4>
              <div className="chains-list">
                {supportedChains.evmChains.map((chain) => (
                  <div key={chain.name} className="chain-badge">
                    {chain.displayName}
                    {chain.productionReady && <span className="production-badge">✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {supportedChains.cosmosChains.length > 0 && (
            <div className="chains-group">
              <h4>Cosmos Chains</h4>
              <div className="chains-list">
                {supportedChains.cosmosChains.map((chain) => (
                  <div key={chain.name} className="chain-badge">
                    {chain.displayName}
                    {chain.productionReady && <span className="production-badge">✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

