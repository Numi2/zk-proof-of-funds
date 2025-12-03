/**
 * NEAR Deposit/Withdrawal Component
 * 
 * Handles depositing tokens to Orderly and withdrawing tokens back to NEAR wallet
 */

import React, { useState, useMemo } from 'react';
import { useNear } from '../../context/NearContext';
import { NearOrderlyService, TOKEN_CONTRACTS } from '../../../../services/near-orderly';
import './NearDepositWithdraw.css';

type ActionType = 'deposit' | 'withdraw';

interface Token {
  symbol: string;
  name: string;
  contractId: string;
  icon: string;
  decimals: number;
}

export const NearDepositWithdraw: React.FC = () => {
  const {
    isConnected,
    networkId,
    service,
    tokenBalances,
    refreshBalances,
  } = useNear();

  const [action, setAction] = useState<ActionType>('deposit');
  const [selectedToken, setSelectedToken] = useState<string>('USDC');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Available tokens based on network
  const availableTokens = useMemo<Token[]>(() => {
    const contracts = TOKEN_CONTRACTS[networkId];
    return [
      {
        symbol: 'USDC',
        name: 'USD Coin',
        contractId: contracts.USDC,
        icon: '$',
        decimals: 6,
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        contractId: contracts.USDT,
        icon: '₮',
        decimals: 6,
      },
      {
        symbol: 'NEAR',
        name: 'NEAR Protocol',
        contractId: contracts.NEAR,
        icon: '◈',
        decimals: 24,
      },
    ];
  }, [networkId]);

  const currentToken = availableTokens.find(t => t.symbol === selectedToken) || availableTokens[0];
  const currentBalance = tokenBalances[currentToken.contractId];

  // Handle deposit - Call ft_transfer_call on token contract
  const handleDeposit = async () => {
    if (!service || !isConnected) {
      setError('Please connect your NEAR wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      // Call depositToken which uses ft_transfer_call
      const txHash = await service.depositToken(
        currentToken.contractId,
        amount,
        currentToken.decimals
      );

      setSuccess(
        `Successfully deposited ${amount} ${selectedToken}!\n` +
        `Transaction: ${txHash}\n` +
        `Your funds will be available in your Orderly account shortly.`
      );
      setAmount('');
      
      // Refresh balances after deposit
      setTimeout(() => {
        refreshBalances();
      }, 3000);
    } catch (err) {
      console.error('Deposit failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Deposit failed';
      
      // Provide helpful error messages
      if (errorMessage.includes('storage')) {
        setError(
          'Storage deposit required. Please deposit NEAR for storage first using the Storage tab.'
        );
      } else if (errorMessage.includes('balance')) {
        setError('Insufficient balance. Please check your wallet balance.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle withdrawal
  const handleWithdraw = async () => {
    if (!service || !isConnected) {
      setError('Please connect your NEAR wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!currentBalance) {
      setError('No balance available for this token');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      await service.withdrawToken(currentToken.contractId, amount);
      setSuccess(`Successfully withdrawn ${amount} ${selectedToken}`);
      setAmount('');
      
      // Refresh balances after withdrawal
      setTimeout(() => {
        refreshBalances();
      }, 2000);
    } catch (err) {
      console.error('Withdrawal failed:', err);
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (action === 'deposit') {
      await handleDeposit();
    } else {
      await handleWithdraw();
    }
  };

  const handleMaxAmount = () => {
    if (action === 'withdraw' && currentBalance) {
      // Convert balance to human-readable format
      const balance = parseFloat(currentBalance.balance) / Math.pow(10, currentToken.decimals);
      setAmount(balance.toString());
    }
  };

  if (!isConnected) {
    return (
      <div className="near-deposit-withdraw">
        <div className="connect-prompt">
          <span className="prompt-icon">◈</span>
          <p>Connect your NEAR wallet to deposit or withdraw tokens</p>
        </div>
      </div>
    );
  }

  return (
    <div className="near-deposit-withdraw">
      {/* Action Tabs */}
      <div className="action-tabs">
        <button
          className={`action-tab ${action === 'deposit' ? 'active' : ''}`}
          onClick={() => setAction('deposit')}
        >
          <span className="tab-icon">↓</span>
          Deposit
        </button>
        <button
          className={`action-tab ${action === 'withdraw' ? 'active' : ''}`}
          onClick={() => setAction('withdraw')}
        >
          <span className="tab-icon">↑</span>
          Withdraw
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="deposit-withdraw-form">
        {/* Token Selector */}
        <div className="form-group">
          <label htmlFor="token">Token</label>
          <select
            id="token"
            value={selectedToken}
            onChange={(e) => setSelectedToken(e.target.value)}
            className="token-select"
          >
            {availableTokens.map((token) => (
              <option key={token.symbol} value={token.symbol}>
                {token.icon} {token.symbol} - {token.name}
              </option>
            ))}
          </select>
        </div>

        {/* Amount Input */}
        <div className="form-group">
          <div className="amount-label">
            <label htmlFor="amount">Amount</label>
            {action === 'withdraw' && currentBalance && (
              <button
                type="button"
                onClick={handleMaxAmount}
                className="max-btn"
              >
                Max: {(parseFloat(currentBalance.balance) / Math.pow(10, currentToken.decimals)).toFixed(4)}
              </button>
            )}
          </div>
          <div className="amount-input-container">
            <input
              type="text"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="amount-input"
            />
            <span className="token-symbol">{currentToken.icon} {selectedToken}</span>
          </div>
        </div>

        {/* Balance Display */}
        {currentBalance && (
          <div className="balance-display">
            <div className="balance-row">
              <span className="label">Orderly Balance:</span>
              <span className="value">
                {(parseFloat(currentBalance.balance) / Math.pow(10, currentToken.decimals)).toFixed(4)} {selectedToken}
              </span>
            </div>
            {parseFloat(currentBalance.pending_transfer) > 0 && (
              <div className="balance-row">
                <span className="label">Pending Transfer:</span>
                <span className="value warning">
                  {(parseFloat(currentBalance.pending_transfer) / Math.pow(10, currentToken.decimals)).toFixed(4)} {selectedToken}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error/Success Messages */}
        {error && (
          <div className="message error">
            <span className="message-icon">⚠</span>
            <span className="message-text">{error}</span>
          </div>
        )}

        {success && (
          <div className="message success">
            <span className="message-icon">✓</span>
            <span className="message-text" style={{ whiteSpace: 'pre-line' }}>{success}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isProcessing || !amount}
          className="submit-btn"
        >
          {isProcessing ? (
            <>
              <span className="loading-spinner" />
              Processing...
            </>
          ) : (
            <>
              <span className="btn-icon">{action === 'deposit' ? '↓' : '↑'}</span>
              {action === 'deposit' ? 'Deposit' : 'Withdraw'} {selectedToken}
            </>
          )}
        </button>
      </form>

      {/* Info Section */}
      <div className="info-section">
        <h4 className="info-title">
          <span className="info-icon">ℹ</span>
          {action === 'deposit' ? 'Deposit' : 'Withdrawal'} Information
        </h4>
        {action === 'deposit' ? (
          <ul className="info-list">
            <li>Deposits are processed immediately after confirmation</li>
            <li>Ensure you have enough NEAR for gas fees (~0.001 NEAR)</li>
            <li>Storage deposit may be required for new tokens</li>
            <li>Testnet tokens can be obtained from the faucet</li>
          </ul>
        ) : (
          <ul className="info-list">
            <li>Withdrawals are processed within 1-5 minutes</li>
            <li>Gas fee: ~0.12 NEAR (120 Tgas)</li>
            <li>Minimum withdrawal: 0.01 {selectedToken}</li>
            <li>Withdrawn funds will appear in your NEAR wallet</li>
          </ul>
        )}
      </div>

      {/* Testnet Faucet Link */}
      {networkId === 'testnet' && (
        <div className="faucet-link">
          <p>
            Need testnet USDC?{' '}
            <a
              href="https://testnet.nearblocks.io/address/ft-faucet-usdc.orderly.testnet"
              target="_blank"
              rel="noopener noreferrer"
            >
              Visit the Faucet →
            </a>
          </p>
        </div>
      )}
    </div>
  );
};

