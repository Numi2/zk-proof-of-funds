/**
 * EVM Deposit/Withdrawal Component
 * 
 * Handles depositing and withdrawing tokens to/from Orderly Network for EVM chains.
 * This component uses the native Orderly SDK functionality wrapped in a custom UI.
 * 
 * Supports:
 * - Arbitrum, Base, Optimism, Polygon, and other EVM chains
 * - USDC deposits via Vault smart contract
 * - EIP-712 signed withdrawals
 * - Automatic chain detection and switching
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAccount, useCollateral } from '@orderly.network/hooks';
import { AccountStatusEnum } from '@orderly.network/types';
import { AssetsModule } from '@orderly.network/portfolio';
import './EVMDepositWithdraw.css';

type ActionType = 'deposit' | 'withdraw';

interface SupportedChain {
  chainId: number;
  name: string;
  icon: string;
  vaultAddress: string;
  usdcAddress: string;
  explorerUrl: string;
}

// Orderly-supported EVM chains for deposit/withdrawal
const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    chainId: 42161, // Arbitrum One
    name: 'Arbitrum',
    icon: '🔷',
    vaultAddress: '0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    explorerUrl: 'https://arbiscan.io',
  },
  {
    chainId: 421614, // Arbitrum Sepolia (testnet)
    name: 'Arbitrum Sepolia',
    icon: '🔷',
    vaultAddress: '0x0EaC556c0C2321BA25b9DC01e4e3c95aD5CDCd2f',
    usdcAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
  {
    chainId: 8453, // Base
    name: 'Base',
    icon: '🔵',
    vaultAddress: '0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    explorerUrl: 'https://basescan.org',
  },
  {
    chainId: 10, // Optimism
    name: 'Optimism',
    icon: '🔴',
    vaultAddress: '0x816f722424B49Cf1275cc86DA9840Fbd5a6167e9',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    explorerUrl: 'https://optimistic.etherscan.io',
  },
];

export const EVMDepositWithdraw: React.FC = () => {
  const [action, setAction] = useState<ActionType>('deposit');
  const [amount, setAmount] = useState('');
  const [selectedChainId, setSelectedChainId] = useState<number>(421614); // Default to Arbitrum Sepolia testnet
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentChainId, setCurrentChainId] = useState<number | null>(null);

  // Orderly hooks
  const { account, state } = useAccount();
  const { availableBalance, totalValue } = useCollateral();

  // Get current chain from ethereum provider
  useEffect(() => {
    const getChainId = async () => {
      if ((window as any).ethereum) {
        try {
          const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' });
          setCurrentChainId(parseInt(chainId, 16));
        } catch (err) {
          console.error('Failed to get chain ID:', err);
        }
      }
    };

    getChainId();

    // Listen for chain changes
    if ((window as any).ethereum) {
      (window as any).ethereum.on('chainChanged', (chainId: string) => {
        setCurrentChainId(parseInt(chainId, 16));
      });
    }

    return () => {
      if ((window as any).ethereum?.removeListener) {
        (window as any).ethereum.removeListener('chainChanged', () => {});
      }
    };
  }, []);

  const selectedChain = useMemo(
    () => SUPPORTED_CHAINS.find(c => c.chainId === selectedChainId) || SUPPORTED_CHAINS[0],
    [selectedChainId]
  );

  const isCorrectChain = currentChainId === selectedChainId;
  const isConnected = state.status >= AccountStatusEnum.SignedIn;
  const connecting = state.status < AccountStatusEnum.SignedIn;

  // Handle chain switch
  const handleSwitchChain = useCallback(async () => {
    if (!isConnected) {
      setError('Wallet not connected');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);

      // Request chain switch via wallet
      await (window as any).ethereum?.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${selectedChainId.toString(16)}` }],
      });

      setSuccess(`Switched to ${selectedChain.name}`);
      setCurrentChainId(selectedChainId);
    } catch (err: any) {
      console.error('Chain switch failed:', err);
      
      // If chain doesn't exist, try to add it
      if (err.code === 4902) {
        setError(`Please add ${selectedChain.name} to your wallet first`);
      } else {
        setError(err.message || 'Failed to switch chain');
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isConnected, selectedChainId, selectedChain]);

  // Auto-switch chain when selected chain changes
  useEffect(() => {
    if (isConnected && !isCorrectChain && currentChainId !== null) {
      // Don't auto-switch, let user click the button
    }
  }, [isConnected, isCorrectChain, currentChainId, selectedChainId]);

  return (
    <div className="evm-deposit-withdraw">
      {!isConnected ? (
        <div className="connect-prompt">
          <span className="prompt-icon">🔌</span>
          <p>Connect your wallet to deposit or withdraw</p>
        </div>
      ) : (
        <>
          {/* Action Tabs */}
          <div className="action-tabs">
            <button
              className={`action-tab ${action === 'deposit' ? 'active' : ''}`}
              onClick={() => setAction('deposit')}
            >
              <span className="tab-icon">⬇️</span>
              Deposit
            </button>
            <button
              className={`action-tab ${action === 'withdraw' ? 'active' : ''}`}
              onClick={() => setAction('withdraw')}
            >
              <span className="tab-icon">⬆️</span>
              Withdraw
            </button>
          </div>

          {/* Chain Selector */}
          <div className="form-group">
            <label htmlFor="chain">Chain</label>
            <select
              id="chain"
              value={selectedChainId}
              onChange={(e) => setSelectedChainId(Number(e.target.value))}
              className="chain-select"
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.chainId} value={chain.chainId}>
                  {chain.icon} {chain.name}
                </option>
              ))}
            </select>
            
            {!isCorrectChain && (
              <div className="chain-warning">
                <span>⚠️ Please switch to {selectedChain.name}</span>
                <button
                  type="button"
                  onClick={handleSwitchChain}
                  disabled={isProcessing}
                  className="switch-chain-btn"
                >
                  Switch Chain
                </button>
              </div>
            )}
          </div>

          {/* Balance Display */}
          <div className="balance-display">
            <div className="balance-row">
              <span className="label">Available Balance:</span>
              <span className="value">${availableBalance?.toFixed(2) || '0.00'}</span>
            </div>
            <div className="balance-row">
              <span className="label">Total Value:</span>
              <span className="value">${totalValue?.toFixed(2) || '0.00'}</span>
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="message error">
              <span className="message-icon">❌</span>
              {error}
            </div>
          )}
          
          {success && (
            <div className="message success">
              <span className="message-icon">✅</span>
              {success}
            </div>
          )}

          {/* Orderly SDK Assets Page - Includes Deposit/Withdraw */}
          {isCorrectChain && (
            <div className="orderly-sdk-components">
              <AssetsModule.AssetsPage />
            </div>
          )}
          
          {!isCorrectChain && (
            <div className="sdk-notice">
              <p>
                <strong>Note:</strong> Please switch to {selectedChain.name} to access deposit and withdrawal functionality.
              </p>
              <p>
                The Orderly SDK Assets page provides full deposit/withdrawal functionality with multi-chain support.
              </p>
            </div>
          )}

          {/* Info Box */}
          <div className="info-box">
            <p className="info-title">ℹ️ {action === 'deposit' ? 'Deposit' : 'Withdrawal'} Process:</p>
            {action === 'deposit' ? (
              <ul className="info-list">
                <li>Deposits are made directly to the Orderly Vault contract</li>
                <li>You'll need to approve USDC spending first (one-time)</li>
                <li>Funds appear in your account within ~1-2 minutes</li>
                <li>Gas fees apply on {selectedChain.name}</li>
              </ul>
            ) : (
              <ul className="info-list">
                <li>Withdrawals are processed via Orderly's cross-chain system</li>
                <li>Funds arrive at your wallet within 10-30 minutes</li>
                <li>A small cross-chain fee may apply</li>
                <li>Must have sufficient available balance (not in open positions)</li>
              </ul>
            )}
          </div>

          {/* Vault Contract Link */}
          {isCorrectChain && (
            <a
              href={`${selectedChain.explorerUrl}/address/${selectedChain.vaultAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="vault-link"
            >
              View Vault Contract on Explorer ↗
            </a>
          )}
        </>
      )}
    </div>
  );
};

