import React, { useState, useEffect, useCallback } from 'react';
import { USDC_CHAINS } from '../../config/usdc-chains';
import './StarknetBridge.css';

const API_BASE = import.meta.env.VITE_STARKNET_RAIL_API || '/api/rails/starknet';

interface Attestation {
  attestationId: string;
  holderAddress: string;
  blockNumber: number;
  timestamp: number;
  tokens: { symbol: string; balance: string }[];
  isValid: boolean;
  expiresAt: number;
}

interface AttestationRequest {
  holderAddress: string;
  tokens: string[];
}

export const StarknetBridge: React.FC = () => {
  const [holderAddress, setHolderAddress] = useState<string>('');
  const [selectedTokens, setSelectedTokens] = useState<string[]>(['USDC']);
  const [attestations, setAttestations] = useState<Attestation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);

  const starknetConfig = USDC_CHAINS.starknet;

  // Fetch USDC balance
  const fetchBalance = useCallback(async () => {
    if (!holderAddress || !starknetConfig) return;

    try {
      const balanceOfSelector = '0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e';
      const normalizedUsdcAddress = starknetConfig.usdcAddress.toLowerCase();
      const normalizedWalletAddress = holderAddress.toLowerCase();

      const response = await fetch(starknetConfig.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'starknet_call',
          params: [
            {
              contract_address: normalizedUsdcAddress,
              entry_point_selector: balanceOfSelector,
              calldata: [normalizedWalletAddress],
            },
            'latest',
          ],
          id: 1,
        }),
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error.message || 'Starknet RPC error');
      }

      const resultArray = result.result || [];
      if (resultArray.length >= 1) {
        const low = BigInt(resultArray[0] || '0x0');
        const high = resultArray.length >= 2 ? BigInt(resultArray[1] || '0x0') : 0n;
        setBalance(low + (high << 128n));
      } else {
        setBalance(0n);
      }
    } catch (err) {
      console.error('Failed to fetch balance:', err);
      setBalance(null);
    }
  }, [holderAddress, starknetConfig]);

  useEffect(() => {
    if (holderAddress) {
      fetchBalance();
    }
  }, [holderAddress, fetchBalance]);

  // Load attestations
  const loadAttestations = useCallback(async () => {
    if (!holderAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/attestations/${holderAddress}`);
      if (response.ok) {
        const data = await response.json();
        setAttestations(data.attestations || []);
      } else {
        // If endpoint doesn't exist, use empty array
        setAttestations([]);
      }
    } catch (err) {
      // Silently fail if endpoint doesn't exist
      setAttestations([]);
    } finally {
      setIsLoading(false);
    }
  }, [holderAddress]);

  useEffect(() => {
    if (holderAddress) {
      loadAttestations();
    }
  }, [holderAddress, loadAttestations]);

  // Create attestation
  const handleCreateAttestation = async () => {
    if (!holderAddress) {
      setError('Please enter a holder address');
      return;
    }

    if (selectedTokens.length === 0) {
      setError('Please select at least one token');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const request: AttestationRequest = {
        holderAddress,
        tokens: selectedTokens,
      };

      const response = await fetch(`${API_BASE}/attest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create attestation');
      }

      const attestation = await response.json();
      setAttestations([...attestations, attestation]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create attestation');
    } finally {
      setIsLoading(false);
    }
  };

  // Verify attestation
  const handleVerifyAttestation = async (attestationId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/verify/${attestationId}`);
      if (!response.ok) {
        throw new Error('Failed to verify attestation');
      }

      const result = await response.json();
      if (result.isValid) {
        await loadAttestations();
      } else {
        setError('Attestation is invalid');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify attestation');
    } finally {
      setIsLoading(false);
    }
  };

  const formatBalance = (bal: bigint | null): string => {
    if (bal === null) return 'Loading...';
    return (Number(bal) / 1e6).toFixed(2) + ' USDC';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const availableTokens = ['USDC', 'USDT', 'DAI', 'ETH'];

  return (
    <div className="starknet-bridge">
      {/* Info Card */}
      <div className="starknet-info-card">
        <h3>Starknet L2 Attestations</h3>
        <p className="info-description">
          Create and manage proof-of-funds attestations on Starknet L2.
          Attestations are stored on-chain and can be verified by any party.
        </p>
        <div className="info-stats">
          <div className="stat">
            <span className="stat-label">Network:</span>
            <span className="stat-value">Starknet Mainnet</span>
          </div>
          <div className="stat">
            <span className="stat-label">RPC:</span>
            <span className="stat-value">{starknetConfig?.rpcUrl || 'N/A'}</span>
          </div>
        </div>
      </div>

      {/* Create Attestation Form */}
      <div className="create-attestation-section">
        <h3>Create Attestation</h3>
        <div className="form-group">
          <label>Holder Address (Starknet)</label>
          <input
            type="text"
            value={holderAddress}
            onChange={(e) => setHolderAddress(e.target.value)}
            placeholder="0x..."
            className="address-input"
          />
          {balance !== null && (
            <div className="balance-display">
              Balance: {formatBalance(balance)}
            </div>
          )}
        </div>
        <div className="form-group">
          <label>Tokens to Attest</label>
          <div className="token-checkboxes">
            {availableTokens.map((token) => (
              <label key={token} className="token-checkbox">
                <input
                  type="checkbox"
                  checked={selectedTokens.includes(token)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedTokens([...selectedTokens, token]);
                    } else {
                      setSelectedTokens(selectedTokens.filter(t => t !== token));
                    }
                  }}
                />
                <span>{token}</span>
              </label>
            ))}
          </div>
        </div>
        <button
          onClick={handleCreateAttestation}
          disabled={isLoading || !holderAddress || selectedTokens.length === 0}
          className="create-button"
        >
          {isLoading ? 'Creating...' : 'Create Attestation'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Attestations List */}
      {holderAddress && (
        <div className="attestations-section">
          <h3>Your Attestations</h3>
          {isLoading && attestations.length === 0 ? (
            <div className="loading">Loading attestations...</div>
          ) : attestations.length === 0 ? (
            <div className="empty-state">No attestations found for this address</div>
          ) : (
            <div className="attestations-list">
              {attestations.map((att) => (
                <div key={att.attestationId} className="attestation-card">
                  <div className="attestation-header">
                    <span className="attestation-id">{att.attestationId.slice(0, 16)}...</span>
                    <span className={`attestation-status ${att.isValid ? 'valid' : 'invalid'}`}>
                      {att.isValid ? '✓ Valid' : '✗ Invalid'}
                    </span>
                  </div>
                  <div className="attestation-details">
                    <div>
                      <span className="detail-label">Block:</span>
                      <span className="detail-value">#{att.blockNumber}</span>
                    </div>
                    <div>
                      <span className="detail-label">Created:</span>
                      <span className="detail-value">{formatDate(att.timestamp)}</span>
                    </div>
                    <div>
                      <span className="detail-label">Expires:</span>
                      <span className="detail-value">{formatDate(att.expiresAt)}</span>
                    </div>
                    <div>
                      <span className="detail-label">Tokens:</span>
                      <span className="detail-value">
                        {att.tokens.map(t => `${t.symbol}: ${t.balance}`).join(', ')}
                      </span>
                    </div>
                  </div>
                  <div className="attestation-actions">
                    <button
                      onClick={() => handleVerifyAttestation(att.attestationId)}
                      disabled={isLoading}
                      className="verify-button"
                    >
                      Verify
                    </button>
                    <a
                      href={`${starknetConfig?.explorerUrl}/tx/${att.attestationId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="explorer-link"
                    >
                      View on Explorer
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Network Info */}
      <div className="network-info-section">
        <h3>Network Information</h3>
        <div className="network-details">
          <div className="network-detail">
            <span className="detail-label">Chain ID:</span>
            <span className="detail-value">{starknetConfig?.chainId || 'SN_MAIN'}</span>
          </div>
          <div className="network-detail">
            <span className="detail-label">USDC Address:</span>
            <span className="detail-value monospace">{starknetConfig?.usdcAddress || 'N/A'}</span>
          </div>
          <div className="network-detail">
            <span className="detail-label">Explorer:</span>
            <a
              href={starknetConfig?.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="explorer-link"
            >
              Starkscan
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

