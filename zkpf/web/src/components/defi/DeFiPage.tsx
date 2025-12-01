import React, { useState } from 'react';
import { AxelarCreditRail } from './AxelarCreditRail';
import { StarknetBridge } from './StarknetBridge';
import { OmniBridge } from '../bridge/OmniBridge';
import { NearIntents } from './NearIntents';
import './DeFiPage.css';

type Tab = 'near-intents' | 'axelar' | 'starknet' | 'omni';

export const DeFiPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('near-intents');

  return (
    <div className="defi-page">
      {/* Header */}
      <div className="defi-header">
        <div>
          <h1 className="defi-title">🌉 CrossChain</h1>
          <p className="defi-subtitle">
            Cross-chain proof-of-funds credentials and asset bridging
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="defi-tabs">
        <button
          onClick={() => setActiveTab('near-intents')}
          className={`defi-tab ${activeTab === 'near-intents' ? 'active' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12l2 2 4-4" />
          </svg>
          NEAR Intents
        </button>
        <button
          onClick={() => setActiveTab('axelar')}
          className={`defi-tab ${activeTab === 'axelar' ? 'active' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          Axelar Credit Rail
        </button>
        <button
          onClick={() => setActiveTab('starknet')}
          className={`defi-tab ${activeTab === 'starknet' ? 'active' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          Starknet L2
        </button>
        <button
          onClick={() => setActiveTab('omni')}
          className={`defi-tab ${activeTab === 'omni' ? 'active' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3L4 7l4 4" />
            <path d="M4 7h16" />
            <path d="M16 21l4-4-4-4" />
            <path d="M20 17H4" />
          </svg>
          Omni Bridge
        </button>
      </div>

      {/* Content */}
      <div className="defi-content">
        {activeTab === 'near-intents' && <NearIntents />}
        {activeTab === 'axelar' && <AxelarCreditRail />}
        {activeTab === 'starknet' && <StarknetBridge />}
        {activeTab === 'omni' && <OmniBridge />}
      </div>
    </div>
  );
};

export default DeFiPage;

