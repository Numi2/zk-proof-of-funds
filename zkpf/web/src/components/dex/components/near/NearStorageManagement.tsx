/**
 * NEAR Storage Management Component
 * 
 * Handles storage staking/deposits required for NEAR smart contracts
 */

import React, { useState, useEffect } from 'react';
import { useNear } from '../../context/NearContext';
import { NearOrderlyService } from '../../../../services/near-orderly';
import './NearStorageManagement.css';

interface StorageCosts {
  registration: string;
  announceKey: string;
  tokenBalance: string;
}

export const NearStorageManagement: React.FC = () => {
  const {
    isConnected,
    service,
    storageBalance,
    refreshStorageBalance,
  } = useNear();

  const [storageCosts, setStorageCosts] = useState<StorageCosts | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load storage costs on mount
  useEffect(() => {
    if (!service || !isConnected) return;

    const loadCosts = async () => {
      try {
        const [bounds, keyCost, tokenCost] = await Promise.all([
          service.getStorageBalanceBounds(),
          service.getStorageCostOfAnnounceKey().catch(() => '0'),
          service.getStorageCostOfTokenBalance().catch(() => '0'),
        ]);

        setStorageCosts({
          registration: bounds.min,
          announceKey: keyCost,
          tokenBalance: tokenCost,
        });
      } catch (err) {
        console.error('Failed to load storage costs:', err);
      }
    };

    loadCosts();
  }, [service, isConnected]);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!service) {
      setError('Service not initialized');
      return;
    }

    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      setError('Please enter a valid deposit amount');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amountYocto = NearOrderlyService.parseNearAmount(depositAmount);
      if (!amountYocto) {
        throw new Error('Invalid amount');
      }

      await service.depositStorage(amountYocto, false);
      setSuccess(`Successfully deposited ${depositAmount} NEAR for storage`);
      setDepositAmount('');
      
      setTimeout(() => {
        refreshStorageBalance();
      }, 2000);
    } catch (err) {
      console.error('Storage deposit failed:', err);
      setError(err instanceof Error ? err.message : 'Storage deposit failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!service) {
      setError('Service not initialized');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setSuccess(null);

    try {
      const amountYocto = withdrawAmount 
        ? NearOrderlyService.parseNearAmount(withdrawAmount)
        : null;

      await service.withdrawStorage(amountYocto || undefined);
      
      const withdrawnAmount = withdrawAmount || 'all available';
      setSuccess(`Successfully withdrew ${withdrawnAmount} NEAR from storage`);
      setWithdrawAmount('');
      
      setTimeout(() => {
        refreshStorageBalance();
      }, 2000);
    } catch (err) {
      console.error('Storage withdrawal failed:', err);
      setError(err instanceof Error ? err.message : 'Storage withdrawal failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickDeposit = async (amount: string) => {
    setDepositAmount(amount);
    // Auto-submit after setting amount
    setTimeout(() => {
      if (service) {
        const amountYocto = NearOrderlyService.parseNearAmount(amount);
        if (amountYocto) {
          setIsProcessing(true);
          service.depositStorage(amountYocto, false)
            .then(() => {
              setSuccess(`Successfully deposited ${amount} NEAR for storage`);
              setDepositAmount('');
              setTimeout(refreshStorageBalance, 2000);
            })
            .catch((err) => {
              setError(err instanceof Error ? err.message : 'Storage deposit failed');
            })
            .finally(() => {
              setIsProcessing(false);
            });
        }
      }
    }, 100);
  };

  const handleMaxWithdraw = () => {
    if (storageBalance) {
      const available = NearOrderlyService.formatNearAmount(storageBalance.available, 8);
      setWithdrawAmount(available);
    }
  };

  if (!isConnected) {
    return (
      <div className="near-storage-management">
        <div className="connect-prompt">
          <span className="prompt-icon">🔒</span>
          <p>Connect your NEAR wallet to manage storage deposits</p>
        </div>
      </div>
    );
  }

  const formattedTotal = storageBalance
    ? NearOrderlyService.formatNearAmount(storageBalance.total, 6)
    : '0';

  const formattedAvailable = storageBalance
    ? NearOrderlyService.formatNearAmount(storageBalance.available, 6)
    : '0';

  const formattedMinDeposit = storageCosts
    ? NearOrderlyService.formatNearAmount(storageCosts.registration, 4)
    : '0';

  return (
    <div className="near-storage-management">
      <div className="storage-header">
        <h3 className="storage-title">
          <span className="title-icon">🔒</span>
          Storage Deposit
        </h3>
        <p className="storage-description">
          NEAR requires storage deposits to store data on-chain. Deposit NEAR to enable trading.
        </p>
      </div>

      {/* Current Balance */}
      {storageBalance && (
        <div className="storage-balance-card">
          <div className="balance-item">
            <span className="balance-label">Total Deposited</span>
            <span className="balance-value">{formattedTotal} NEAR</span>
          </div>
          <div className="balance-item">
            <span className="balance-label">Available to Withdraw</span>
            <span className="balance-value success">{formattedAvailable} NEAR</span>
          </div>
        </div>
      )}

      {/* Quick Deposit Actions */}
      <div className="quick-actions">
        <h4 className="section-title">Quick Deposit</h4>
        <div className="quick-buttons">
          <button
            onClick={() => handleQuickDeposit(formattedMinDeposit)}
            disabled={isProcessing}
            className="quick-btn"
          >
            <span className="btn-icon">💾</span>
            <span className="btn-label">Register</span>
            <span className="btn-amount">{formattedMinDeposit} NEAR</span>
          </button>
          <button
            onClick={() => handleQuickDeposit('1')}
            disabled={isProcessing}
            className="quick-btn"
          >
            <span className="btn-icon">💾</span>
            <span className="btn-label">Small</span>
            <span className="btn-amount">1 NEAR</span>
          </button>
          <button
            onClick={() => handleQuickDeposit('5')}
            disabled={isProcessing}
            className="quick-btn"
          >
            <span className="btn-icon">💾</span>
            <span className="btn-label">Medium</span>
            <span className="btn-amount">5 NEAR</span>
          </button>
        </div>
      </div>

      {/* Advanced Toggle */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <span>Advanced Options</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {showAdvanced && (
        <div className="advanced-section">
          {/* Custom Deposit */}
          <form onSubmit={handleDeposit} className="storage-form">
            <h4 className="section-title">Custom Deposit</h4>
            <div className="form-group">
              <label htmlFor="deposit">Amount (NEAR)</label>
              <input
                type="text"
                id="deposit"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                className="storage-input"
              />
            </div>
            <button
              type="submit"
              disabled={isProcessing || !depositAmount}
              className="submit-btn deposit"
            >
              {isProcessing ? (
                <>
                  <span className="loading-spinner" />
                  Depositing...
                </>
              ) : (
                <>
                  <span className="btn-icon">💾</span>
                  Deposit Storage
                </>
              )}
            </button>
          </form>

          {/* Withdraw */}
          <form onSubmit={handleWithdraw} className="storage-form">
            <h4 className="section-title">Withdraw Storage</h4>
            <div className="form-group">
              <div className="input-label">
                <label htmlFor="withdraw">Amount (NEAR)</label>
                <button
                  type="button"
                  onClick={handleMaxWithdraw}
                  className="max-btn"
                >
                  Max: {formattedAvailable}
                </button>
              </div>
              <input
                type="text"
                id="withdraw"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Leave empty for all available"
                className="storage-input"
              />
            </div>
            <button
              type="submit"
              disabled={isProcessing}
              className="submit-btn withdraw"
            >
              {isProcessing ? (
                <>
                  <span className="loading-spinner" />
                  Withdrawing...
                </>
              ) : (
                <>
                  <span className="btn-icon">↑</span>
                  Withdraw Storage
                </>
              )}
            </button>
          </form>

          {/* Storage Costs Info */}
          {storageCosts && (
            <div className="storage-costs">
              <h4 className="section-title">Storage Costs</h4>
              <div className="cost-item">
                <span className="cost-label">Account Registration:</span>
                <span className="cost-value">
                  {NearOrderlyService.formatNearAmount(storageCosts.registration, 4)} NEAR
                </span>
              </div>
              {storageCosts.announceKey !== '0' && (
                <div className="cost-item">
                  <span className="cost-label">Per Access Key:</span>
                  <span className="cost-value">
                    {NearOrderlyService.formatNearAmount(storageCosts.announceKey, 4)} NEAR
                  </span>
                </div>
              )}
              {storageCosts.tokenBalance !== '0' && (
                <div className="cost-item">
                  <span className="cost-label">Per Token:</span>
                  <span className="cost-value">
                    {NearOrderlyService.formatNearAmount(storageCosts.tokenBalance, 4)} NEAR
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="message error">
          <span className="message-icon">⚠</span>
          <span className="message-text">{error}</span>
        </div>
      )}

      {success && (
        <div className="message success">
          <span className="message-icon">✓</span>
          <span className="message-text">{success}</span>
        </div>
      )}

      {/* Info Box */}
      <div className="info-box">
        <h4 className="info-title">
          <span className="info-icon">ℹ</span>
          About Storage Deposits
        </h4>
        <ul className="info-list">
          <li>Storage deposits are required to store account data on NEAR</li>
          <li>Your deposit is refundable when you close your account</li>
          <li>Each new token requires additional storage deposit</li>
          <li>Minimum deposit: {formattedMinDeposit} NEAR</li>
        </ul>
      </div>
    </div>
  );
};

