import React, { useState, useEffect, useCallback } from 'react';
import './OmniBridge.css';

// Types
interface Chain {
  id: string;
  name: string;
  symbol: string;
  nativeCurrency: string;
  icon: string;
}

interface Token {
  symbol: string;
  name: string;
  decimals: number;
  isStablecoin: boolean;
  logoUrl?: string;
}

interface TransferStatus {
  transferId: string;
  status: 'pending' | 'sourceSubmitted' | 'sourceConfirmed' | 'completed' | 'failed';
  sourceChain: string;
  destinationChain: string;
  amount: string;
  token: string;
  estimatedCompletion?: number;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
}

interface FeeEstimate {
  amount: string;
  currency: string;
}

// Supported chains
const SUPPORTED_CHAINS: Chain[] = [
  { id: 'near', name: 'NEAR Protocol', symbol: 'NEAR', nativeCurrency: 'NEAR', icon: 'N' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', nativeCurrency: 'ETH', icon: 'Ξ' },
  { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', nativeCurrency: 'ETH', icon: 'A' },
  { id: 'base', name: 'Base', symbol: 'BASE', nativeCurrency: 'ETH', icon: 'B' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', nativeCurrency: 'SOL', icon: 'S' },
];

// Common tokens
const COMMON_TOKENS: Token[] = [
  { symbol: 'USDC', name: 'USD Coin', decimals: 6, isStablecoin: true },
  { symbol: 'USDT', name: 'Tether USD', decimals: 6, isStablecoin: true },
  { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, isStablecoin: false },
  { symbol: 'NEAR', name: 'NEAR Protocol', decimals: 24, isStablecoin: false },
  { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, isStablecoin: true },
];

// API base URL
const API_BASE = import.meta.env.VITE_OMNI_BRIDGE_API || '/api/rails/omni';

export const OmniBridge: React.FC = () => {
  // Form state
  const [sourceChain, setSourceChain] = useState<string>('ethereum');
  const [destinationChain, setDestinationChain] = useState<string>('near');
  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [amount, setAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [fastMode, setFastMode] = useState<boolean>(false);

  // UI state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [activeTransfer, setActiveTransfer] = useState<TransferStatus | null>(null);

  // Mock balance (would come from wallet connection)
  const [balance] = useState<string>('1,000.00');

  // Swap source and destination chains
  const handleSwapChains = () => {
    const temp = sourceChain;
    setSourceChain(destinationChain);
    setDestinationChain(temp);
  };

  // Estimate fee when parameters change
  const estimateFee = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) {
      setFeeEstimate(null);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_chain: sourceChain,
          destination_chain: destinationChain,
          token: selectedToken,
          amount: parseFloat(amount).toString(),
          fast_mode: fastMode,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setFeeEstimate({
          amount: data.amount,
          currency: data.currency,
        });
      }
    } catch (err) {
      console.error('Failed to estimate fee:', err);
    }
  }, [sourceChain, destinationChain, selectedToken, amount, fastMode]);

  useEffect(() => {
    const debounce = setTimeout(estimateFee, 500);
    return () => clearTimeout(debounce);
  }, [estimateFee]);

  // Initiate bridge transfer
  const handleBridge = async () => {
    if (!amount || !recipientAddress) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_chain: sourceChain,
          destination_chain: destinationChain,
          sender: 'connected-wallet-address', // Would come from wallet
          recipient: recipientAddress,
          token: selectedToken,
          amount: parseFloat(amount).toString(),
          fast_mode: fastMode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Transfer failed');
      }

      const data = await response.json();
      setActiveTransfer({
        transferId: data.transfer_id,
        status: 'pending',
        sourceChain,
        destinationChain,
        amount,
        token: selectedToken,
        estimatedCompletion: data.estimated_completion,
      });

      // Clear form
      setAmount('');
      setRecipientAddress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Get chain display info
  const getChainInfo = (chainId: string): Chain => {
    return SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
  };

  // Format fee for display
  const formatFee = (fee: FeeEstimate): string => {
    const amount = parseFloat(fee.amount);
    if (amount < 0.000001) return `< 0.000001 ${fee.currency}`;
    return `${amount.toFixed(6)} ${fee.currency}`;
  };

  // Get progress steps for transfer
  const getProgressSteps = (status: TransferStatus['status']) => {
    const steps = ['pending', 'sourceSubmitted', 'sourceConfirmed', 'completed'];
    const currentIndex = steps.indexOf(status);
    return steps.map((step, index) => ({
      name: step,
      completed: index < currentIndex,
      active: index === currentIndex,
    }));
  };

  return (
    <div className="omni-bridge">
      <div className="omni-bridge-header">
        <div>
          <h2 className="omni-bridge-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3L4 7l4 4" />
              <path d="M4 7h16" />
              <path d="M16 21l4-4-4-4" />
              <path d="M20 17H4" />
            </svg>
            Omni Bridge
          </h2>
          <p className="omni-bridge-subtitle">
            Transfer assets across NEAR, Ethereum, Arbitrum, Base, and Solana
          </p>
        </div>
      </div>

      {/* Source Chain */}
      <div className="chain-selector">
        <span className="chain-selector-label">From</span>
        <div className="chain-dropdown">
          <select
            className="chain-select"
            value={sourceChain}
            onChange={(e) => setSourceChain(e.target.value)}
          >
            {SUPPORTED_CHAINS.map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Swap Button */}
      <button className="swap-direction-button" onClick={handleSwapChains}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 16V4m0 0L3 8m4-4l4 4" />
          <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </button>

      {/* Destination Chain */}
      <div className="chain-selector">
        <span className="chain-selector-label">To</span>
        <div className="chain-dropdown">
          <select
            className="chain-select"
            value={destinationChain}
            onChange={(e) => setDestinationChain(e.target.value)}
          >
            {SUPPORTED_CHAINS.filter(c => c.id !== sourceChain).map((chain) => (
              <option key={chain.id} value={chain.id}>
                {chain.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Token & Amount */}
      <div className="token-amount-section">
        <div className="token-row">
          <select
            className="token-select"
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
          >
            {COMMON_TOKENS.map((token) => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol}
              </option>
            ))}
          </select>
          <input
            type="number"
            className="amount-input"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min="0"
            step="any"
          />
        </div>
        <div className="balance-row">
          <span>Balance: {balance} {selectedToken}</span>
          <button className="max-button" onClick={() => setAmount(balance.replace(/,/g, ''))}>
            MAX
          </button>
        </div>
      </div>

      {/* Recipient Address */}
      <div className="recipient-section">
        <span className="recipient-label">Recipient Address on {getChainInfo(destinationChain).name}</span>
        <input
          type="text"
          className="recipient-input"
          placeholder={`Enter ${getChainInfo(destinationChain).symbol} address`}
          value={recipientAddress}
          onChange={(e) => setRecipientAddress(e.target.value)}
        />
      </div>

      {/* Fee Summary */}
      {feeEstimate && (
        <div className="fee-summary">
          <div className="fee-row">
            <span className="fee-label">Estimated Fee</span>
            <span className="fee-value">{formatFee(feeEstimate)}</span>
          </div>
          <div className="fee-row">
            <span className="fee-label">Estimated Time</span>
            <span className="fee-value highlight">
              {fastMode ? '~2 min' : '~15 min'}
            </span>
          </div>
          <div className="fee-row">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={fastMode}
                onChange={(e) => setFastMode(e.target.checked)}
              />
              <span className="fee-label">Fast Mode (Higher fee, faster finality)</span>
            </label>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ color: '#f85149', fontSize: '0.875rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Bridge Button */}
      <button
        className={`bridge-button ${isLoading ? 'loading' : ''}`}
        onClick={handleBridge}
        disabled={isLoading || !amount || !recipientAddress}
      >
        {isLoading ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="spin">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
            Processing...
          </>
        ) : (
          <>
            Bridge {selectedToken}
          </>
        )}
      </button>

      {/* Active Transfer Status */}
      {activeTransfer && (
        <div className="transfer-status">
          <div className="transfer-status-header">
            <span className="transfer-status-title">Transfer in Progress</span>
            <span className={`transfer-status-badge ${activeTransfer.status}`}>
              {activeTransfer.status}
            </span>
          </div>

          <div className="transfer-progress">
            {getProgressSteps(activeTransfer.status).map((step) => (
              <div
                key={step.name}
                className={`progress-step ${step.completed ? 'completed' : ''} ${step.active ? 'active' : ''}`}
              />
            ))}
          </div>

          <div className="transfer-details">
            <div className="transfer-detail-row">
              <span>Amount</span>
              <span>{activeTransfer.amount} {activeTransfer.token}</span>
            </div>
            <div className="transfer-detail-row">
              <span>Route</span>
              <span>
                {getChainInfo(activeTransfer.sourceChain).symbol} → {getChainInfo(activeTransfer.destinationChain).symbol}
              </span>
            </div>
            <div className="transfer-detail-row">
              <span>Transfer ID</span>
              <span>{activeTransfer.transferId.slice(0, 8)}...{activeTransfer.transferId.slice(-6)}</span>
            </div>
            {activeTransfer.sourceTxHash && (
              <div className="transfer-detail-row">
                <span>Source TX</span>
                <span>{activeTransfer.sourceTxHash.slice(0, 8)}...</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default OmniBridge;

