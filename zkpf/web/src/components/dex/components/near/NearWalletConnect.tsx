/**
 * NEAR Wallet Connection Component
 * 
 * Displays wallet connection status and provides UI for connecting/disconnecting
 * NEAR wallets for use with Orderly Network.
 */

import React, { useState } from 'react';
import { useNear } from '../../context/NearContext';
import { NearOrderlyService } from '../../../../services/near-orderly';
import './NearWalletConnect.css';

export const NearWalletConnect: React.FC = () => {
  const {
    isConnected,
    isInitializing,
    accountId,
    nearBalance,
    storageBalance,
    networkId,
    connect,
    disconnect,
    error,
    clearError,
  } = useNear();

  const [showDetails, setShowDetails] = useState(false);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      console.error('Connection failed:', err);
    }
  };

  const handleDisconnect = () => {
    if (window.confirm('Are you sure you want to disconnect your NEAR wallet?')) {
      disconnect();
    }
  };

  if (isInitializing) {
    return (
      <div className="near-wallet-connect initializing">
        <div className="loading-spinner" />
        <span>Initializing NEAR...</span>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="near-wallet-connect disconnected">
        {error && (
          <div className="connection-error">
            <span className="error-icon">⚠</span>
            <span>{error}</span>
            <button onClick={clearError} className="close-error">×</button>
          </div>
        )}
        <button onClick={handleConnect} className="connect-btn">
          <span className="btn-icon">◈</span>
          <span>Connect NEAR Wallet</span>
        </button>
        <p className="network-label">Network: {networkId}</p>
      </div>
    );
  }

  const formattedBalance = nearBalance 
    ? NearOrderlyService.formatNearAmount(nearBalance.available, 4)
    : '0';

  const formattedStorage = storageBalance
    ? NearOrderlyService.formatNearAmount(storageBalance.total, 4)
    : '0';

  const formattedAvailableStorage = storageBalance
    ? NearOrderlyService.formatNearAmount(storageBalance.available, 4)
    : '0';

  return (
    <div className="near-wallet-connect connected">
      {error && (
        <div className="connection-error">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button onClick={clearError} className="close-error">×</button>
        </div>
      )}
      
      <div className="wallet-summary" onClick={() => setShowDetails(!showDetails)}>
        <div className="wallet-info">
          <span className="wallet-icon">◈</span>
          <div className="wallet-details">
            <span className="account-id">{accountId}</span>
            <span className="balance">{formattedBalance} NEAR</span>
          </div>
        </div>
        <button className="expand-btn" aria-label={showDetails ? 'Collapse' : 'Expand'}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ transform: showDetails ? 'rotate(180deg)' : 'none' }}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      </div>

      {showDetails && (
        <div className="wallet-expanded">
          <div className="balance-details">
            <div className="balance-row">
              <span className="label">Available Balance:</span>
              <span className="value">{formattedBalance} NEAR</span>
            </div>
            {nearBalance && (
              <>
                <div className="balance-row">
                  <span className="label">Staked:</span>
                  <span className="value">
                    {NearOrderlyService.formatNearAmount(nearBalance.staked, 4)} NEAR
                  </span>
                </div>
                <div className="balance-row">
                  <span className="label">Storage Deposit:</span>
                  <span className="value">{formattedStorage} NEAR</span>
                </div>
                {storageBalance && parseFloat(formattedAvailableStorage) > 0 && (
                  <div className="balance-row">
                    <span className="label">Storage Available:</span>
                    <span className="value success">{formattedAvailableStorage} NEAR</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="wallet-actions">
            <button onClick={handleDisconnect} className="disconnect-btn">
              Disconnect
            </button>
          </div>

          <div className="network-info">
            <span className="network-label">Network: {networkId}</span>
          </div>
        </div>
      )}
    </div>
  );
};

