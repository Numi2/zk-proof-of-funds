import React, { useState } from 'react';
import { ChainSelector, SUPPORTED_CHAINS } from './ChainSelector';
import './BridgedAssetProof.css';

interface Token {
  symbol: string;
  name: string;
  balance: string;
  selected: boolean;
}

interface AssetProof {
  chain: string;
  holderAddress: string;
  proofHash: string;
  blockNumber: number;
  timestamp: number;
  assets: { symbol: string; balance: string }[];
  encoded: string;
}

const API_BASE = import.meta.env.VITE_OMNI_BRIDGE_API || '/api/rails/omni';

export const BridgedAssetProof: React.FC = () => {
  const [selectedChain, setSelectedChain] = useState<string>('ethereum');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [tokens, setTokens] = useState<Token[]>([
    { symbol: 'USDC', name: 'USD Coin', balance: '1,000.00', selected: true },
    { symbol: 'WETH', name: 'Wrapped Ether', balance: '0.5', selected: false },
    { symbol: 'USDT', name: 'Tether USD', balance: '500.00', selected: false },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [proof, setProof] = useState<AssetProof | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggleToken = (symbol: string) => {
    setTokens(tokens.map(t => 
      t.symbol === symbol ? { ...t, selected: !t.selected } : t
    ));
  };

  const selectedTokens = tokens.filter(t => t.selected);

  const generateProof = async () => {
    if (!walletAddress) {
      setError('Please enter your wallet address');
      return;
    }

    if (selectedTokens.length === 0) {
      setError('Please select at least one token');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/prove-assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: selectedChain,
          address: walletAddress,
          tokens: selectedTokens.map(t => t.symbol),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate proof');
      }

      const data = await response.json();
      setProof({
        chain: data.chain,
        holderAddress: data.holder_address,
        proofHash: data.proof_hash,
        blockNumber: data.block_number,
        timestamp: data.timestamp,
        assets: data.assets,
        encoded: data.proof_hash, // Simplified for demo
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate proof');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadProof = () => {
    if (!proof) return;
    
    const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bridged-asset-proof-${proof.proofHash.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bridged-asset-proof">
      <div className="proof-header">
        <h3 className="proof-title">
          <ShieldIcon />
          Bridged Asset Proof
        </h3>
        <p className="proof-subtitle">
          Generate a cryptographic proof of your bridged assets for zkpf attestations
        </p>
      </div>

      {!proof ? (
        <>
          {/* Chain Selection */}
          <div className="proof-section">
            <label className="section-label">1. Select Chain</label>
            <ChainSelector
              value={selectedChain}
              onChange={setSelectedChain}
              size="lg"
            />
          </div>

          {/* Wallet Address */}
          <div className="proof-section">
            <label className="section-label">2. Enter Wallet Address</label>
            <input
              type="text"
              className="wallet-input"
              placeholder={`Enter your ${SUPPORTED_CHAINS.find(c => c.id === selectedChain)?.symbol} address`}
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
            />
            <button className="connect-wallet-btn">
              <WalletIcon />
              Connect Wallet
            </button>
          </div>

          {/* Token Selection */}
          <div className="proof-section">
            <label className="section-label">3. Select Tokens to Prove</label>
            <div className="token-list">
              {tokens.map((token) => (
                <label
                  key={token.symbol}
                  className={`token-item ${token.selected ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={token.selected}
                    onChange={() => toggleToken(token.symbol)}
                  />
                  <span className="token-info">
                    <span className="token-symbol">{token.symbol}</span>
                    <span className="token-name">{token.name}</span>
                  </span>
                  <span className="token-balance">{token.balance}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="proof-error">
              <AlertIcon />
              {error}
            </div>
          )}

          {/* Generate Button */}
          <button
            className={`generate-btn ${isGenerating ? 'loading' : ''}`}
            onClick={generateProof}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <LoadingIcon />
                Generating Proof...
              </>
            ) : (
              <>
                <LockIcon />
                Generate Proof
              </>
            )}
          </button>
        </>
      ) : (
        /* Proof Result */
        <div className="proof-result">
          <div className="result-header">
            <SuccessIcon />
            <span>Proof Generated Successfully</span>
          </div>

          <div className="result-details">
            <div className="detail-row">
              <span className="detail-label">Chain</span>
              <span className="detail-value">{proof.chain}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Address</span>
              <span className="detail-value mono">
                {proof.holderAddress.slice(0, 10)}...{proof.holderAddress.slice(-8)}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Proof Hash</span>
              <span className="detail-value mono">
                {proof.proofHash.slice(0, 12)}...
                <button className="copy-btn" onClick={() => copyToClipboard(proof.proofHash)}>
                  <CopyIcon />
                </button>
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Block</span>
              <span className="detail-value">{proof.blockNumber.toLocaleString()}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Assets</span>
              <span className="detail-value">
                {proof.assets.map(a => `${a.balance} ${a.symbol}`).join(', ')}
              </span>
            </div>
          </div>

          <div className="result-actions">
            <button className="action-btn secondary" onClick={() => copyToClipboard(JSON.stringify(proof))}>
              <CopyIcon />
              Copy Proof
            </button>
            <button className="action-btn secondary" onClick={downloadProof}>
              <DownloadIcon />
              Download JSON
            </button>
            <button className="action-btn primary" onClick={() => setProof(null)}>
              Generate New Proof
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Icons
const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const WalletIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12V7H5a2 2 0 010-4h14v4" />
    <path d="M3 5v14a2 2 0 002 2h16v-5" />
    <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" />
  </svg>
);

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

const LoadingIcon = () => (
  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 11-6.219-8.56" />
  </svg>
);

const SuccessIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <path d="M22 4L12 14.01l-3-3" />
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </svg>
);

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export default BridgedAssetProof;

