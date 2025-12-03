/**
 * NEAR Assets Page
 * 
 * Central page for managing NEAR wallet, deposits, withdrawals, and storage
 */

import { useState } from 'react';
import { NearWalletConnect } from '../../components/near/NearWalletConnect';
import { NearDepositWithdraw } from '../../components/near/NearDepositWithdraw';
import { NearStorageManagement } from '../../components/near/NearStorageManagement';
import { useNear } from '../../context/NearContext';
import './NearAssetsPage.css';

type TabType = 'overview' | 'deposit-withdraw' | 'storage';

export default function NearAssetsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const { isConnected, accountId, nearBalance, tokenBalances, networkId } = useNear();

  // Get token count
  const tokenCount = Object.keys(tokenBalances).length;

  return (
    <div className="near-assets-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="header-content">
          <h1 className="page-title">
            <span className="title-icon">◈</span>
            NEAR Assets
          </h1>
          <p className="page-description">
            Manage your NEAR wallet, deposit tokens to Orderly, and configure storage
          </p>
        </div>
        <div className="network-badge" data-network={networkId}>
          {networkId}
        </div>
      </div>

      {/* Wallet Connection Card */}
      <div className="wallet-section">
        <NearWalletConnect />
      </div>

      {/* Main Content */}
      <div className="content-section">
        {/* Tabs */}
        <div className="tabs-container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <span className="tab-icon">📊</span>
              <span className="tab-label">Overview</span>
            </button>
            <button
              className={`tab ${activeTab === 'deposit-withdraw' ? 'active' : ''}`}
              onClick={() => setActiveTab('deposit-withdraw')}
            >
              <span className="tab-icon">💰</span>
              <span className="tab-label">Deposit/Withdraw</span>
            </button>
            <button
              className={`tab ${activeTab === 'storage' ? 'active' : ''}`}
              onClick={() => setActiveTab('storage')}
            >
              <span className="tab-icon">🔒</span>
              <span className="tab-label">Storage</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        <div className="tab-content">
          {activeTab === 'overview' && (
            <div className="overview-tab">
              {isConnected ? (
                <>
                  {/* Account Info */}
                  <div className="info-card">
                    <h3 className="card-title">
                      <span className="card-icon">👤</span>
                      Account Information
                    </h3>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-label">Account ID:</span>
                        <span className="info-value">{accountId}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Network:</span>
                        <span className="info-value">{networkId}</span>
                      </div>
                      {nearBalance && (
                        <>
                          <div className="info-item">
                            <span className="info-label">Available Balance:</span>
                            <span className="info-value">
                              {(parseFloat(nearBalance.available) / 1e24).toFixed(4)} NEAR
                            </span>
                          </div>
                          <div className="info-item">
                            <span className="info-label">Staked:</span>
                            <span className="info-value">
                              {(parseFloat(nearBalance.staked) / 1e24).toFixed(4)} NEAR
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Token Balances */}
                  {tokenCount > 0 && (
                    <div className="info-card">
                      <h3 className="card-title">
                        <span className="card-icon">💎</span>
                        Token Balances on Orderly
                      </h3>
                      <div className="token-list">
                        {Object.entries(tokenBalances).map(([tokenId, balance]) => {
                          // Try to extract token symbol from contract ID
                          const symbol = tokenId.split('.')[0].toUpperCase();
                          const decimals = 6; // Most tokens use 6 decimals
                          const balanceAmount = parseFloat(balance.balance) / Math.pow(10, decimals);
                          const pendingAmount = parseFloat(balance.pending_transfer) / Math.pow(10, decimals);

                          return (
                            <div key={tokenId} className="token-item">
                              <div className="token-info">
                                <span className="token-symbol">{symbol}</span>
                                <span className="token-id">{tokenId}</span>
                              </div>
                              <div className="token-balance">
                                <span className="balance-main">
                                  {balanceAmount.toFixed(4)}
                                </span>
                                {pendingAmount > 0 && (
                                  <span className="balance-pending">
                                    Pending: {pendingAmount.toFixed(4)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="quick-actions-card">
                    <h3 className="card-title">Quick Actions</h3>
                    <div className="action-buttons">
                      <button
                        onClick={() => setActiveTab('deposit-withdraw')}
                        className="action-button"
                      >
                        <span className="action-icon">↓</span>
                        <span className="action-label">Deposit</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('deposit-withdraw')}
                        className="action-button"
                      >
                        <span className="action-icon">↑</span>
                        <span className="action-label">Withdraw</span>
                      </button>
                      <button
                        onClick={() => setActiveTab('storage')}
                        className="action-button"
                      >
                        <span className="action-icon">🔒</span>
                        <span className="action-label">Manage Storage</span>
                      </button>
                    </div>
                  </div>

                  {/* Resources */}
                  <div className="resources-card">
                    <h3 className="card-title">
                      <span className="card-icon">📚</span>
                      Resources
                    </h3>
                    <ul className="resource-list">
                      <li>
                        <a
                          href={`https://${networkId === 'mainnet' ? '' : 'testnet.'}nearblocks.io/address/${accountId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on Explorer →
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://orderly.network/docs"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Orderly Documentation →
                        </a>
                      </li>
                      <li>
                        <a
                          href="https://docs.near.org/"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          NEAR Documentation →
                        </a>
                      </li>
                      {networkId === 'testnet' && (
                        <li>
                          <a
                            href="https://testnet.nearblocks.io/address/ft-faucet-usdc.orderly.testnet"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Testnet USDC Faucet →
                          </a>
                        </li>
                      )}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon">◈</span>
                  <h3>Connect Your NEAR Wallet</h3>
                  <p>Connect your NEAR wallet to view your assets and manage deposits</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'deposit-withdraw' && (
            <div className="deposit-withdraw-tab">
              <NearDepositWithdraw />
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="storage-tab">
              <NearStorageManagement />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

