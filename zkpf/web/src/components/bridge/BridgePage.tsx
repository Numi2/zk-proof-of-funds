/**
 * BridgePage - Main entry point for the Omni Bridge
 * 
 * Provides tabs for Bridge, History, Proofs, and Settings
 */

import React, { useState } from 'react';
import { BridgeProvider } from '../../contexts/BridgeContext';
import { OmniBridge } from './OmniBridge';
import { BridgeHistory } from './BridgeHistory';
import { BridgedAssetProof } from './BridgedAssetProof';
import './BridgePage.css';

type Tab = 'bridge' | 'history' | 'proofs';

export const BridgePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('bridge');

  return (
    <BridgeProvider>
      <div className="bridge-page">
        {/* Header */}
        <div className="bridge-page-header">
          <h1 className="bridge-page-title">
            <BridgeLogoIcon />
            Omni Bridge
          </h1>
          <p className="bridge-page-subtitle">
            Powered by the{' '}
            <a 
              href="https://github.com/Near-One/bridge-sdk-js" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              Omni Bridge SDK
            </a>
            {' '}— The next generation of Rainbow Bridge
          </p>
        </div>

        {/* Tabs */}
        <div className="bridge-tabs">
          <button
            className={`bridge-tab ${activeTab === 'bridge' ? 'active' : ''}`}
            onClick={() => setActiveTab('bridge')}
          >
            <BridgeIcon />
            Bridge
          </button>
          <button
            className={`bridge-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <HistoryIcon />
            History
          </button>
          <button
            className={`bridge-tab ${activeTab === 'proofs' ? 'active' : ''}`}
            onClick={() => setActiveTab('proofs')}
          >
            <ShieldIcon />
            Proofs
          </button>
        </div>

        {/* Content */}
        <div className="bridge-content">
          {activeTab === 'bridge' && <OmniBridge />}
          {activeTab === 'history' && <BridgeHistory />}
          {activeTab === 'proofs' && <BridgedAssetProof />}
        </div>

        {/* Supported Chains */}
        <div className="supported-chains">
          <span className="chains-label">Supported Networks</span>
          <div className="chains-list">
            <ChainBadge name="NEAR" color="#00ec97" icon="N" />
            <ChainBadge name="Ethereum" color="#627eea" icon="Ξ" />
            <ChainBadge name="Arbitrum" color="#28a0f0" icon="A" />
            <ChainBadge name="Base" color="#0052ff" icon="B" />
            <ChainBadge name="Solana" color="#9945ff" icon="S" />
          </div>
        </div>

        {/* Features */}
        <div className="bridge-features">
          <div className="feature-card">
            <FastIcon />
            <div className="feature-content">
              <h4>Fast Transfers</h4>
              <p>2-15 minute cross-chain transfers with fast mode</p>
            </div>
          </div>
          <div className="feature-card">
            <SecureIcon />
            <div className="feature-content">
              <h4>Secure</h4>
              <p>MPC signatures and cryptographic proofs</p>
            </div>
          </div>
          <div className="feature-card">
            <ProofIcon />
            <div className="feature-content">
              <h4>Verifiable</h4>
              <p>Generate proofs for zkpf attestations</p>
            </div>
          </div>
        </div>
      </div>
    </BridgeProvider>
  );
};

// Chain Badge Component
function ChainBadge({ name, color, icon }: { name: string; color: string; icon: string }) {
  return (
    <div className="chain-badge" style={{ '--chain-color': color } as React.CSSProperties}>
      <span className="chain-badge-icon" style={{ background: color }}>{icon}</span>
      <span className="chain-badge-name">{name}</span>
    </div>
  );
}

// Icons
function BridgeLogoIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3L4 7l4 4" />
      <path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

function BridgeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 3L4 7l4 4" />
      <path d="M4 7h16" />
      <path d="M16 21l4-4-4-4" />
      <path d="M20 17H4" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function FastIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SecureIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function ProofIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}

export default BridgePage;
