/**
 * Enhanced Assets Page
 * 
 * Comprehensive asset management page that supports:
 * - EVM chains (Arbitrum, Base, Optimism) via Orderly SDK
 * - NEAR Protocol via custom integration
 * - Deposits and withdrawals across all supported chains
 * - Balance overview and transaction history
 */

import { useState } from 'react';
import { AssetsModule } from "@orderly.network/portfolio";
import { useAccount } from '@orderly.network/hooks';
import { AccountStatusEnum } from '@orderly.network/types';
import { EVMDepositWithdraw } from '../../components/evm';
import { NearDepositWithdraw } from '../../components/near/NearDepositWithdraw';
import { NearStorageManagement } from '../../components/near/NearStorageManagement';
import { NearWalletConnect } from '../../components/near/NearWalletConnect';
import { UsdcFaucet } from "../../components/faucet";
import { LoginOrCreateAccount } from "../../components/auth";
import { useNear } from '../../context/NearContext';
import { NearIntents } from '../../../defi/NearIntents';
import { IntentTracking } from '../../components/trading/IntentTracking';
import './EnhancedAssetsPage.css';

type ChainType = 'evm' | 'near';
type TabType = 'overview' | 'deposit' | 'withdraw' | 'storage' | 'swap' | 'intents';

export default function EnhancedAssetsPage() {
  const [selectedChain, setSelectedChain] = useState<ChainType>('evm');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  
  // Orderly SDK hooks for EVM
  const { account, state: accountState } = useAccount();
  
  // NEAR context
  const { isConnected: nearConnected, accountId: nearAccountId } = useNear();

  const isEVMConnected = accountState.status >= AccountStatusEnum.SignedIn;
  const connecting = accountState.status < AccountStatusEnum.SignedIn;
  const isAnyWalletConnected = isEVMConnected || nearConnected;

  return (
    <div className="enhanced-assets-page">
      {/* Page Header */}
      <div className="assets-page-header">
        <div className="header-content">
          <h1 className="page-title">
            <span className="title-icon">💰</span>
            Assets & Deposits
          </h1>
          <p className="page-description">
            Manage your funds across multiple chains and trade with confidence
          </p>
        </div>

        {/* Chain Selector */}
        <div className="chain-selector">
          <button
            className={`chain-btn ${selectedChain === 'evm' ? 'active' : ''}`}
            onClick={() => {
              setSelectedChain('evm');
              setActiveTab('overview');
            }}
          >
            <span className="chain-icon">⚡</span>
            <div className="chain-info">
              <div className="chain-name">EVM Chains</div>
              <div className="chain-subtitle">Arbitrum, Base, Optimism</div>
            </div>
          </button>
          <button
            className={`chain-btn ${selectedChain === 'near' ? 'active' : ''}`}
            onClick={() => {
              setSelectedChain('near');
              setActiveTab('overview');
            }}
          >
            <span className="chain-icon">◈</span>
            <div className="chain-info">
              <div className="chain-name">NEAR Protocol</div>
              <div className="chain-subtitle">Fast & Low Cost</div>
            </div>
          </button>
        </div>
      </div>

      {/* Login or Create Account Section */}
      {selectedChain === 'evm' && (
        <div className="auth-section-wrapper">
          <LoginOrCreateAccount chainType="EVM" />
        </div>
      )}

      {/* Connection Status Banner */}
      {!isAnyWalletConnected && selectedChain === 'near' && (
        <div className="connection-banner">
          <div className="banner-icon">🔌</div>
          <div className="banner-content">
            <h3>Connect Your Wallet</h3>
            <p>
              Connect your NEAR wallet to deposit and trade on NEAR Protocol
            </p>
          </div>
        </div>
      )}

      {/* Faucet (testnet only) */}
      <div className="faucet-section">
        <UsdcFaucet />
      </div>

      {/* Main Content */}
      <div className="assets-content">
        {selectedChain === 'evm' ? (
          <div className="evm-assets-content">
            {/* Tabs for EVM */}
            <div className="content-tabs">
              <button
                className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                <span className="tab-icon">📊</span>
                Overview
              </button>
              <button
                className={`tab-btn ${activeTab === 'deposit' ? 'active' : ''}`}
                onClick={() => setActiveTab('deposit')}
              >
                <span className="tab-icon">⬇️</span>
                Deposit
              </button>
              <button
                className={`tab-btn ${activeTab === 'withdraw' ? 'active' : ''}`}
                onClick={() => setActiveTab('withdraw')}
              >
                <span className="tab-icon">⬆️</span>
                Withdraw
              </button>
              <button
                className={`tab-btn ${activeTab === 'swap' ? 'active' : ''}`}
                onClick={() => setActiveTab('swap')}
              >
                <span className="tab-icon">⇄</span>
                Swap & Deposit
              </button>
              <button
                className={`tab-btn ${activeTab === 'intents' ? 'active' : ''}`}
                onClick={() => setActiveTab('intents')}
              >
                <span className="tab-icon">📋</span>
                Intents
              </button>
            </div>

            {/* EVM Content */}
            <div className="tab-content">
              {activeTab === 'overview' && (
                <div className="overview-tab">
                  {/* Use Orderly's built-in AssetsPage for overview */}
                  <AssetsModule.AssetsPage />
                </div>
              )}

              {activeTab === 'deposit' && (
                <div className="deposit-tab">
                  <div className="content-section">
                    <div className="section-header">
                      <h2>Deposit USDC</h2>
                      <p>Deposit USDC from any supported EVM chain to start trading</p>
                    </div>
                    <EVMDepositWithdraw />
                  </div>
                  
                  <div className="info-section">
                    <h3>💡 How Deposits Work</h3>
                    <ul>
                      <li><strong>Multi-Chain Support:</strong> Deposit from Arbitrum, Base, Optimism, or Polygon</li>
                      <li><strong>Fast Settlement:</strong> Funds available within 1-2 minutes after confirmation</li>
                      <li><strong>One Balance:</strong> All deposits pool into a single trading balance</li>
                      <li><strong>No Lock-Up:</strong> Withdraw anytime (when not in open positions)</li>
                    </ul>
                    
                    <div className="supported-chains-grid">
                      <div className="chain-card">
                        <span className="chain-logo">🔷</span>
                        <strong>Arbitrum</strong>
                        <span className="chain-badge">Recommended</span>
                      </div>
                      <div className="chain-card">
                        <span className="chain-logo">🔵</span>
                        <strong>Base</strong>
                        <span className="chain-badge">Low Fees</span>
                      </div>
                      <div className="chain-card">
                        <span className="chain-logo">🔴</span>
                        <strong>Optimism</strong>
                        <span className="chain-badge">Fast</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'withdraw' && (
                <div className="withdraw-tab">
                  <div className="content-section">
                    <div className="section-header">
                      <h2>Withdraw USDC</h2>
                      <p>Withdraw your funds to any supported EVM chain</p>
                    </div>
                    <EVMDepositWithdraw />
                  </div>
                  
                  <div className="info-section">
                    <h3>⚠️ Important Notes</h3>
                    <ul>
                      <li><strong>Available Balance:</strong> Can only withdraw funds not locked in positions</li>
                      <li><strong>Processing Time:</strong> 10-30 minutes for cross-chain withdrawals</li>
                      <li><strong>Fees:</strong> Small gas fee + potential cross-chain fee</li>
                      <li><strong>Same-Day Limit:</strong> First withdrawal may have a lower limit</li>
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'swap' && (
                <div className="swap-tab">
                  <div className="content-section">
                    <div className="section-header">
                      <h2>Swap & Deposit via NEAR Intents</h2>
                      <p>Swap tokens from any chain (Zcash, Bitcoin, Ethereum, etc.) and auto-deposit to Orderly</p>
                    </div>
                    <NearIntents />
                  </div>
                  
                  <div className="info-section">
                    <h3>💡 How NEAR Intents Work</h3>
                    <ul>
                      <li><strong>Chain Abstraction:</strong> Express what you want, not how to do it</li>
                      <li><strong>Best Execution:</strong> Multiple solvers compete for best rates</li>
                      <li><strong>Auto-Deposit:</strong> Swapped USDC automatically deposits to your Orderly account</li>
                      <li><strong>ZK Privacy:</strong> Optionally use ZK proof-of-funds for privacy-preserving swaps</li>
                      <li><strong>Supported Chains:</strong> Zcash, Bitcoin, Ethereum, Arbitrum, Base, Solana, NEAR</li>
                    </ul>
                  </div>
                </div>
              )}

              {activeTab === 'intents' && (
                <div className="intents-tab">
                  <div className="content-section">
                    <div className="section-header">
                      <h2>NEAR Intent Tracking</h2>
                      <p>Monitor your cross-chain swap intents and their execution status</p>
                    </div>
                    <IntentTracking />
                  </div>
                  
                  <div className="info-section">
                    <h3>💡 About NEAR Intents</h3>
                    <ul>
                      <li><strong>Status Tracking:</strong> Monitor intent matching and execution in real-time</li>
                      <li><strong>Cross-Chain:</strong> Swap from Zcash, Bitcoin, Ethereum, and more</li>
                      <li><strong>Auto-Deposit:</strong> Completed swaps automatically deposit to your Orderly account</li>
                      <li><strong>Resolver Competition:</strong> Multiple solvers compete for best execution</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="near-assets-content">
            {/* NEAR Wallet Connection Card */}
            {!nearConnected && (
              <div className="near-connection-card">
                <NearWalletConnect />
              </div>
            )}

            {/* Tabs for NEAR */}
            <div className="content-tabs">
              <button
                className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                <span className="tab-icon">📊</span>
                Overview
              </button>
              <button
                className={`tab-btn ${activeTab === 'deposit' ? 'active' : ''}`}
                onClick={() => setActiveTab('deposit')}
                disabled={!nearConnected}
              >
                <span className="tab-icon">⬇️</span>
                Deposit
              </button>
              <button
                className={`tab-btn ${activeTab === 'withdraw' ? 'active' : ''}`}
                onClick={() => setActiveTab('withdraw')}
                disabled={!nearConnected}
              >
                <span className="tab-icon">⬆️</span>
                Withdraw
              </button>
              <button
                className={`tab-btn ${activeTab === 'storage' ? 'active' : ''}`}
                onClick={() => setActiveTab('storage')}
                disabled={!nearConnected}
              >
                <span className="tab-icon">💾</span>
                Storage
              </button>
            </div>

            {/* NEAR Content */}
            <div className="tab-content">
              {activeTab === 'overview' && (
                <div className="overview-tab">
                  {nearConnected ? (
                    <div className="near-overview">
                      <div className="account-card">
                        <h3>Connected Account</h3>
                        <div className="account-id">{nearAccountId}</div>
                      </div>
                      <div className="near-info">
                        <p>Switch to Deposit/Withdraw tabs to manage your funds</p>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon">◈</span>
                      <h3>Connect Your NEAR Wallet</h3>
                      <p>Connect your NEAR wallet above to view your assets and manage deposits</p>
                    </div>
                  )}
                </div>
              )}

              {(activeTab === 'deposit' || activeTab === 'withdraw') && (
                <div className="deposit-withdraw-tab">
                  <div className="section-header">
                    <h2>{activeTab === 'deposit' ? 'Deposit to Orderly' : 'Withdraw from Orderly'}</h2>
                    <p>
                      {activeTab === 'deposit' 
                        ? 'Deposit USDC, USDT, or NEAR to start trading'
                        : 'Withdraw your funds back to your NEAR wallet'
                      }
                    </p>
                  </div>
                  <NearDepositWithdraw />
                </div>
              )}

              {activeTab === 'storage' && (
                <div className="storage-tab">
                  <div className="section-header">
                    <h2>Storage Management</h2>
                    <p>Manage NEAR storage staking for your Orderly account</p>
                  </div>
                  <NearStorageManagement />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

