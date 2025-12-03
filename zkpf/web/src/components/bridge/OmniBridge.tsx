/**
 * OmniBridge Component
 * 
 * Full-featured cross-chain bridge UI supporting NEAR, Ethereum, Arbitrum, Base, and Solana.
 * Uses the Omni Bridge SDK patterns for transfers.
 * 
 * @see https://github.com/Near-One/bridge-sdk-js
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useBridge, type ChainId } from '../../contexts/BridgeContext';
import { useFeeEstimate, useTransfer } from '../../hooks/useBridge';
import { TokenSelector, type Token } from './TokenSelector';
import { TransferProgress, type TransferStep } from './TransferProgress';
import { 
  validateAddress, 
  getAddressPlaceholder, 
  truncateAddress,
} from '../../utils/address-validation';
import './OmniBridge.css';

// ============================================================================
// Types
// ============================================================================

interface Chain {
  id: ChainId;
  name: string;
  symbol: string;
  nativeCurrency: string;
  icon: React.ReactNode;
  color: string;
}

// ============================================================================
// Constants
// ============================================================================

const SUPPORTED_CHAINS: Chain[] = [
  { id: 'near', name: 'NEAR Protocol', symbol: 'NEAR', nativeCurrency: 'NEAR', icon: <NearIcon />, color: '#00ec97' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', nativeCurrency: 'ETH', icon: <EthereumIcon />, color: '#627eea' },
  { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', nativeCurrency: 'ETH', icon: <ArbitrumIcon />, color: '#28a0f0' },
  { id: 'base', name: 'Base', symbol: 'BASE', nativeCurrency: 'ETH', icon: <BaseIcon />, color: '#0052ff' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', nativeCurrency: 'SOL', icon: <SolanaIcon />, color: '#9945ff' },
];

// ============================================================================
// Component
// ============================================================================

export const OmniBridge: React.FC = () => {
  // Bridge context
  const { 
    state, 
    connectWallet, 
    isChainConnected, 
    getConnectedAddress,
    initiateTransfer,
  } = useBridge();
  
  // Form state
  const [sourceChain, setSourceChain] = useState<ChainId>('ethereum');
  const [destinationChain, setDestinationChain] = useState<ChainId>('near');
  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [amount, setAmount] = useState<string>('');
  const [recipientAddress, setRecipientAddress] = useState<string>('');
  const [useSameAddress, setUseSameAddress] = useState<boolean>(true);
  const [fastMode, setFastMode] = useState<boolean>(false);
  
  // UI state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [activeTransferId, setActiveTransferId] = useState<string | null>(null);
  const [showWalletConnect, setShowWalletConnect] = useState<boolean>(false);
  
  // Fee estimation
  const { fee: feeEstimate, isLoading: isFeeLoading } = useFeeEstimate({
    sourceChain,
    destinationChain,
    token: selectedToken,
    amount,
    fastMode,
  });
  
  // Transfer tracking
  const { transfer: activeTransfer } = useTransfer(activeTransferId);
  
  // Derived state
  const sourceConnection = getConnectedAddress(sourceChain);
  const destinationConnection = getConnectedAddress(destinationChain);
  const isSourceConnected = isChainConnected(sourceChain);
  const isDestConnected = isChainConnected(destinationChain);
  
  // Get chain info
  const getChainInfo = useCallback((chainId: ChainId): Chain => {
    return SUPPORTED_CHAINS.find(c => c.id === chainId) || SUPPORTED_CHAINS[0];
  }, []);
  
  // Auto-fill recipient when using same address
  useEffect(() => {
    if (useSameAddress && destinationConnection) {
      setRecipientAddress(destinationConnection);
      setAddressError(null);
    }
  }, [useSameAddress, destinationConnection]);
  
  // Validate recipient address
  useEffect(() => {
    if (!recipientAddress || (useSameAddress && destinationConnection)) {
      setAddressError(null);
      return;
    }
    
    const result = validateAddress(destinationChain, recipientAddress);
    setAddressError(result.isValid ? null : result.error || 'Invalid address');
  }, [recipientAddress, destinationChain, useSameAddress, destinationConnection]);
  
  // Swap chains
  const handleSwapChains = useCallback(() => {
    setSourceChain(destinationChain);
    setDestinationChain(sourceChain);
    setRecipientAddress('');
    setAddressError(null);
  }, [sourceChain, destinationChain]);
  
  // Connect source wallet
  const handleConnectSource = useCallback(async () => {
    try {
      setError(null);
      await connectWallet(sourceChain);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  }, [connectWallet, sourceChain]);
  
  // Connect destination wallet
  const handleConnectDestination = useCallback(async () => {
    try {
      setError(null);
      await connectWallet(destinationChain);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  }, [connectWallet, destinationChain]);
  
  // Handle token selection
  const handleTokenChange = useCallback((token: Token) => {
    setSelectedToken(token.symbol);
  }, []);
  
  // Handle amount max
  const handleMaxAmount = useCallback(() => {
    // Would get actual balance here
    setAmount('1000');
  }, []);
  
  // Initiate bridge transfer
  const handleBridge = useCallback(async () => {
    // Validation
    if (!isSourceConnected) {
      setError('Please connect your source chain wallet');
      return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    const finalRecipient = useSameAddress ? destinationConnection : recipientAddress;
    
    if (!finalRecipient) {
      setError('Please enter or connect a recipient address');
      return;
    }
    
    const validation = validateAddress(destinationChain, finalRecipient);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid recipient address');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    try {
      const transferId = await initiateTransfer({
        sourceChain,
        destinationChain,
        token: selectedToken,
        amount,
        recipient: finalRecipient,
        fastMode,
      });
      
      setActiveTransferId(transferId);
      setAmount('');
      setRecipientAddress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setIsProcessing(false);
    }
  }, [
    isSourceConnected,
    amount,
    useSameAddress,
    destinationConnection,
    recipientAddress,
    destinationChain,
    initiateTransfer,
    sourceChain,
    selectedToken,
    fastMode,
  ]);
  
  // Close transfer modal
  const handleCloseTransfer = useCallback(() => {
    setActiveTransferId(null);
  }, []);
  
  // Format fee display
  const formattedFee = useMemo(() => {
    if (!feeEstimate) return null;
    const amount = parseFloat(feeEstimate.amount);
    if (amount < 0.000001) return `< 0.000001 ${feeEstimate.currency}`;
    return `${amount.toFixed(6)} ${feeEstimate.currency}`;
  }, [feeEstimate]);
  
  // Estimated time based on chains
  const estimatedTime = useMemo(() => {
    if (fastMode) return '~2 min';
    
    // NEAR is fast, Solana is fast, EVM chains need finality
    if (sourceChain === 'near' || sourceChain === 'solana') {
      return '~5 min';
    }
    return '~15 min';
  }, [sourceChain, fastMode]);
  
  // Can submit?
  const canSubmit = useMemo(() => {
    return (
      isSourceConnected &&
      amount &&
      parseFloat(amount) > 0 &&
      (useSameAddress ? destinationConnection : recipientAddress) &&
      !addressError &&
      !isProcessing
    );
  }, [isSourceConnected, amount, useSameAddress, destinationConnection, recipientAddress, addressError, isProcessing]);

  return (
    <div className="omni-bridge">
      {/* Header */}
      <div className="omni-bridge-header">
        <div>
          <h2 className="omni-bridge-title">
            <BridgeIcon />
            Omni Bridge
          </h2>
          <p className="omni-bridge-subtitle">
            Transfer assets across NEAR, Ethereum, Arbitrum, Base, and Solana
          </p>
        </div>
        {state.network === 'testnet' && (
          <span className="testnet-indicator">Testnet</span>
        )}
      </div>

      {/* Source Chain */}
      <div className="chain-selector">
        <span className="chain-selector-label">From</span>
        <div className="chain-card">
          <div className="chain-dropdown">
            <select
              className="chain-select"
              value={sourceChain}
              onChange={(e) => setSourceChain(e.target.value as ChainId)}
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
            <span className="chain-icon-display" style={{ background: getChainInfo(sourceChain).color }}>
              {getChainInfo(sourceChain).icon}
            </span>
          </div>
          
          {isSourceConnected ? (
            <div className="wallet-status connected">
              <CheckIcon />
              <span className="wallet-address">{truncateAddress(sourceConnection || '')}</span>
            </div>
          ) : (
            <button className="connect-chain-btn" onClick={handleConnectSource}>
              <WalletIcon />
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      {/* Swap Button */}
      <button className="swap-direction-button" onClick={handleSwapChains}>
        <SwapIcon />
      </button>

      {/* Destination Chain */}
      <div className="chain-selector">
        <span className="chain-selector-label">To</span>
        <div className="chain-card">
          <div className="chain-dropdown">
            <select
              className="chain-select"
              value={destinationChain}
              onChange={(e) => setDestinationChain(e.target.value as ChainId)}
            >
              {SUPPORTED_CHAINS.filter(c => c.id !== sourceChain).map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
            <span className="chain-icon-display" style={{ background: getChainInfo(destinationChain).color }}>
              {getChainInfo(destinationChain).icon}
            </span>
          </div>
          
          {isDestConnected ? (
            <div className="wallet-status connected">
              <CheckIcon />
              <span className="wallet-address">{truncateAddress(destinationConnection || '')}</span>
            </div>
          ) : (
            <button className="connect-chain-btn secondary" onClick={handleConnectDestination}>
              <WalletIcon />
              Connect (Optional)
            </button>
          )}
        </div>
      </div>

      {/* Token & Amount */}
      <div className="token-amount-section">
        <span className="section-label">Amount</span>
        <div className="token-row">
          <TokenSelector
            chainId={sourceChain}
            value={selectedToken}
            onChange={handleTokenChange}
            showBalance={isSourceConnected}
            size="lg"
          />
          <div className="amount-input-wrapper">
            <input
              type="number"
              className="amount-input"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="any"
            />
            <button className="max-button" onClick={handleMaxAmount}>
              MAX
            </button>
          </div>
        </div>
      </div>

      {/* Recipient Address */}
      <div className="recipient-section">
        <div className="recipient-header">
          <span className="section-label">Recipient on {getChainInfo(destinationChain).name}</span>
          {isDestConnected && (
            <label className="same-address-toggle">
              <input
                type="checkbox"
                checked={useSameAddress}
                onChange={(e) => setUseSameAddress(e.target.checked)}
              />
              Use connected wallet
            </label>
          )}
        </div>
        
        <div className="recipient-input-wrapper">
          <input
            type="text"
            className={`recipient-input ${addressError ? 'error' : ''}`}
            placeholder={getAddressPlaceholder(destinationChain)}
            value={useSameAddress && destinationConnection ? destinationConnection : recipientAddress}
            onChange={(e) => {
              setUseSameAddress(false);
              setRecipientAddress(e.target.value);
            }}
            disabled={useSameAddress && !!destinationConnection}
          />
          {addressError && (
            <span className="input-error">{addressError}</span>
          )}
        </div>
      </div>

      {/* Fee Summary */}
      {(amount && parseFloat(amount) > 0) && (
        <div className="fee-summary">
          <div className="fee-row">
            <span className="fee-label">Estimated Fee</span>
            <span className="fee-value">
              {isFeeLoading ? (
                <LoadingDots />
              ) : formattedFee || (
                <span className="fee-unavailable">Calculating...</span>
              )}
            </span>
          </div>
          <div className="fee-row">
            <span className="fee-label">Estimated Time</span>
            <span className="fee-value highlight">{estimatedTime}</span>
          </div>
          <div className="fee-row">
            <label className="fast-mode-toggle">
              <input
                type="checkbox"
                checked={fastMode}
                onChange={(e) => setFastMode(e.target.checked)}
              />
              <span className="fee-label">Fast Mode</span>
              <span className="fast-mode-hint">(Higher fee, faster finality)</span>
            </label>
          </div>
          <div className="fee-row">
            <span className="fee-label">You will receive</span>
            <span className="fee-value receive-amount">
              ~{amount || '0'} {selectedToken}
            </span>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="error-banner">
          <AlertIcon />
          {error}
          <button className="error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Bridge Button */}
      <button
        className={`bridge-button ${isProcessing ? 'loading' : ''} ${!canSubmit ? 'disabled' : ''}`}
        onClick={handleBridge}
        disabled={!canSubmit}
      >
        {isProcessing ? (
          <>
            <LoadingSpinner />
            Processing...
          </>
        ) : !isSourceConnected ? (
          <>
            <WalletIcon />
            Connect Wallet to Bridge
          </>
        ) : (
          <>
            <BridgeIcon />
            Bridge {selectedToken}
          </>
        )}
      </button>

      {/* Powered by */}
      <div className="powered-by">
        <span>Powered by</span>
        <a href="https://github.com/Near-One/bridge-sdk-js" target="_blank" rel="noopener noreferrer">
          Omni Bridge SDK
        </a>
      </div>

      {/* Active Transfer Modal */}
      {activeTransfer && (
        <div className="transfer-modal-overlay" onClick={handleCloseTransfer}>
          <div className="transfer-modal" onClick={(e) => e.stopPropagation()}>
            <TransferProgress
              transfer={{
                ...activeTransfer,
                sourceChain: activeTransfer.sourceChain as ChainId,
                destinationChain: activeTransfer.destinationChain as ChainId,
                status: activeTransfer.status as TransferStep,
                token: activeTransfer.asset,
                createdAt: activeTransfer.createdAt || Math.floor(Date.now() / 1000),
              }}
              onClose={handleCloseTransfer}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Icons
// ============================================================================

function BridgeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3L4 7l4 4" />
      <path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

function LoadingDots() {
  return <span className="loading-dots">...</span>;
}

// Chain Icons
function NearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 3.5L12 12l4.5 8.5h-3L9 12l4.5-8.5h3zM7.5 3.5v17h-3v-17h3z" />
    </svg>
  );
}

function EthereumIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1.5l-7.5 11L12 17l7.5-4.5L12 1.5z" opacity="0.6" />
      <path d="M12 17l-7.5-4.5L12 22.5l7.5-10L12 17z" />
    </svg>
  );
}

function ArbitrumIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18l6.63 3.68L12 11.54 5.37 7.86 12 4.18zM5 9.18l6 3.32v6.32l-6-3.32V9.18zm14 0v6.32l-6 3.32V12.5l6-3.32z" />
    </svg>
  );
}

function BaseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function SolanaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5 17.5l3-3h12l-3 3h-12zM4.5 6.5l3 3h12l-3-3h-12zM4.5 12l3-3h12l-3 3h-12z" />
    </svg>
  );
}

export default OmniBridge;
