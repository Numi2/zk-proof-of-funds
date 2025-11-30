import React, { useState } from 'react';
import { OmniBridge } from './OmniBridge';
import { BridgeHistory } from './BridgeHistory';

type Tab = 'bridge' | 'history';

export const BridgePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('bridge');

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem 1rem' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <h1 style={{ color: '#fff', marginBottom: '0.5rem', fontSize: '2rem' }}>
          🌉 Omni Bridge
        </h1>
        <p style={{ color: '#8b949e', margin: 0 }}>
          Powered by the Omni Bridge SDK - The next generation of Rainbow Bridge
        </p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1.5rem',
          background: 'rgba(22, 27, 34, 0.6)',
          padding: '0.25rem',
          borderRadius: '10px',
        }}
      >
        <button
          onClick={() => setActiveTab('bridge')}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'all 0.2s ease',
            background: activeTab === 'bridge' ? 'rgba(88, 166, 255, 0.2)' : 'transparent',
            color: activeTab === 'bridge' ? '#58a6ff' : '#8b949e',
          }}
        >
          Bridge
        </button>
        <button
          onClick={() => setActiveTab('history')}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'all 0.2s ease',
            background: activeTab === 'history' ? 'rgba(88, 166, 255, 0.2)' : 'transparent',
            color: activeTab === 'history' ? '#58a6ff' : '#8b949e',
          }}
        >
          History
        </button>
      </div>

      {/* Content */}
      {activeTab === 'bridge' ? <OmniBridge /> : <BridgeHistory />}

      {/* Supported Chains */}
      <div
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'rgba(22, 27, 34, 0.4)',
          borderRadius: '12px',
          textAlign: 'center',
        }}
      >
        <p style={{ color: '#8b949e', fontSize: '0.875rem', margin: '0 0 0.75rem' }}>
          Supported Networks
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {[
            { name: 'NEAR', color: '#00ec97' },
            { name: 'Ethereum', color: '#627eea' },
            { name: 'Arbitrum', color: '#28a0f0' },
            { name: 'Base', color: '#0052ff' },
            { name: 'Solana', color: '#9945ff' },
          ].map((chain) => (
            <div
              key={chain.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: '20px',
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: chain.color,
                }}
              />
              <span style={{ color: '#fff', fontSize: '0.875rem' }}>{chain.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Info */}
      <div
        style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(88, 166, 255, 0.1)',
          borderRadius: '12px',
          border: '1px solid rgba(88, 166, 255, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          <div style={{ fontSize: '0.875rem', color: '#8b949e' }}>
            <strong style={{ color: '#fff' }}>How it works:</strong> The Omni Bridge uses light client proofs
            to securely transfer assets between chains without trusted intermediaries. Transfers are
            verified on-chain using cryptographic proofs from the source network.
          </div>
        </div>
      </div>
    </div>
  );
};

export default BridgePage;

