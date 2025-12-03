/**
 * Login Page
 * 
 * Dedicated page for users to login or create an Orderly account.
 * Shows account status and provides clear guidance on the login/registration process.
 */

import { useState } from 'react';
import { LoginOrCreateAccount } from '../components/auth';
import './LoginPage.css';

export default function LoginPage() {
  const [chainType, setChainType] = useState<'EVM' | 'SOL' | 'NEAR'>('EVM');

  return (
    <div className="login-page">
      <div className="login-page-container">
        <div className="login-page-header">
          <h1 className="page-title">
            <span className="title-icon">🔐</span>
            Welcome to Orderly Network
          </h1>
          <p className="page-subtitle">
            Connect your wallet to login with an existing account or create a new one
          </p>
        </div>

        {/* Chain Type Selector */}
        <div className="chain-type-selector">
          <button
            className={`chain-type-btn ${chainType === 'EVM' ? 'active' : ''}`}
            onClick={() => setChainType('EVM')}
          >
            <span className="chain-icon">⚡</span>
            <span className="chain-name">EVM</span>
            <span className="chain-description">MetaMask, WalletConnect</span>
          </button>
          <button
            className={`chain-type-btn ${chainType === 'SOL' ? 'active' : ''}`}
            onClick={() => setChainType('SOL')}
          >
            <span className="chain-icon">◎</span>
            <span className="chain-name">Solana</span>
            <span className="chain-description">Phantom</span>
          </button>
          <button
            className={`chain-type-btn ${chainType === 'NEAR' ? 'active' : ''}`}
            onClick={() => setChainType('NEAR')}
          >
            <span className="chain-icon">Ⓝ</span>
            <span className="chain-name">NEAR</span>
            <span className="chain-description">HOT, Meteor, Nightly</span>
          </button>
        </div>

        {/* Login or Create Account Component */}
        <LoginOrCreateAccount chainType={chainType} />

        {/* Additional Info */}
        <div className="login-info-section">
          <h3 className="info-title">How it works</h3>
          <div className="info-grid">
            <div className="info-card">
              <div className="info-card-icon">🔌</div>
              <h4 className="info-card-title">1. Connect Wallet</h4>
              <p className="info-card-text">
                Connect your {chainType === 'EVM' ? 'EVM' : chainType === 'SOL' ? 'Solana' : 'NEAR'} wallet using the button in the header
              </p>
            </div>
            <div className="info-card">
              <div className="info-card-icon">🔍</div>
              <h4 className="info-card-title">2. Check Account</h4>
              <p className="info-card-text">
                We'll automatically check if you have an existing Orderly account
              </p>
            </div>
            <div className="info-card">
              <div className="info-card-icon">
                {chainType === 'EVM' ? '✅' : chainType === 'SOL' ? '📝' : '🔐'}
              </div>
              <h4 className="info-card-title">3. Login or Create</h4>
              <p className="info-card-text">
                {chainType === 'EVM' 
                  ? 'If you have an account, you\'ll be logged in. Otherwise, create a new one with a simple signature.'
                  : chainType === 'SOL'
                  ? 'Create your account by signing a message with your wallet'
                  : 'Connect your NEAR wallet and create an Orderly account to start trading'
                }
              </p>
            </div>
            <div className="info-card">
              <div className="info-card-icon">🚀</div>
              <h4 className="info-card-title">4. Start Trading</h4>
              <p className="info-card-text">
                Once connected, you can deposit funds and start trading perpetual futures
              </p>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="features-section">
          <h3 className="features-title">Why Orderly Network?</h3>
          <ul className="features-list">
            <li>
              <span className="feature-icon">⚡</span>
              <span>Cross-chain trading on multiple networks</span>
            </li>
            <li>
              <span className="feature-icon">💰</span>
              <span>Low fees and high liquidity</span>
            </li>
            <li>
              <span className="feature-icon">🔒</span>
              <span>Secure and decentralized</span>
            </li>
            <li>
              <span className="feature-icon">📊</span>
              <span>Advanced trading features</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

