/**
 * TachyonWallet - Unified Multi-Chain Wallet Dashboard
 * 
 * A Tachyon-inspired wallet that orchestrates proving across:
 * - Zcash (Orchard) for privacy-preserving balance proofs
 * - Mina for recursive SNARK aggregation
 * - Starknet for DeFi position proving
 * - Axelar for cross-chain attestation transport
 * - NEAR for TEE-backed private AI agent
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import './TachyonWallet.css';

// Types
interface ChainBalance {
  chain: string;
  currency: string;
  balance: string;
  spendable: string;
  pending: string;
  blockHeight: number;
  lastSync: Date;
}

interface RailStatus {
  id: string;
  name: string;
  status: 'connected' | 'syncing' | 'disconnected' | 'error';
  capabilities: string[];
  lastActivity: Date | null;
  syncProgress?: number;
}

interface ProofRecord {
  id: string;
  policyId: number;
  railId: string;
  timestamp: Date;
  status: 'pending' | 'verified' | 'expired' | 'failed';
  targetChains: string[];
}

interface AttestationRecord {
  id: string;
  policyId: number;
  epoch: number;
  sourceChain: string;
  targetChains: string[];
  status: 'pending' | 'relaying' | 'confirmed' | 'failed';
  expiresAt: Date;
}

// Rail capabilities
const RAIL_CAPABILITIES: Record<string, string[]> = {
  'ZCASH_ORCHARD': ['Shielded Balance', 'Private Transfer', 'Note Management'],
  'MINA_RECURSIVE': ['Recursive Proofs', 'Proof Aggregation', 'State Compression'],
  'STARKNET_L2': ['DeFi Positions', 'Account Abstraction', 'Session Keys'],
  'AXELAR_GMP': ['Cross-Chain Transport', 'Message Relay', 'Receipt Broadcasting'],
  'NEAR_TEE': ['Private AI', 'TEE Compute', 'Key Derivation'],
};

// Rail colors for visual distinction
const RAIL_COLORS: Record<string, string> = {
  'ZCASH_ORCHARD': '#f4b728',
  'MINA_RECURSIVE': '#ef6537',
  'STARKNET_L2': '#ec796b',
  'AXELAR_GMP': '#17c3b2',
  'NEAR_TEE': '#00ec97',
};

export function TachyonWallet() {
  // State
  const [balances, setBalances] = useState<ChainBalance[]>([]);
  const [rails, setRails] = useState<RailStatus[]>([
    { id: 'ZCASH_ORCHARD', name: 'Zcash Orchard', status: 'connected', capabilities: RAIL_CAPABILITIES['ZCASH_ORCHARD'], lastActivity: new Date() },
    { id: 'MINA_RECURSIVE', name: 'Mina Recursive', status: 'connected', capabilities: RAIL_CAPABILITIES['MINA_RECURSIVE'], lastActivity: new Date() },
    { id: 'STARKNET_L2', name: 'Starknet L2', status: 'syncing', capabilities: RAIL_CAPABILITIES['STARKNET_L2'], lastActivity: null, syncProgress: 67 },
    { id: 'AXELAR_GMP', name: 'Axelar GMP', status: 'connected', capabilities: RAIL_CAPABILITIES['AXELAR_GMP'], lastActivity: new Date() },
    { id: 'NEAR_TEE', name: 'NEAR TEE Agent', status: 'disconnected', capabilities: RAIL_CAPABILITIES['NEAR_TEE'], lastActivity: null },
  ]);
  const [proofs, setProofs] = useState<ProofRecord[]>([]);
  const [attestations, setAttestations] = useState<AttestationRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'rails' | 'proofs' | 'attestations' | 'agent'>('overview');
  const [isProving, setIsProving] = useState(false);
  const [selectedRails, setSelectedRails] = useState<string[]>(['ZCASH_ORCHARD']);

  // Mock data loading
  useEffect(() => {
    // Simulate balance data
    setBalances([
      { chain: 'Zcash', currency: 'ZEC', balance: '12.45', spendable: '12.45', pending: '0', blockHeight: 2345678, lastSync: new Date() },
      { chain: 'Starknet', currency: 'ETH', balance: '2.5', spendable: '2.5', pending: '0', blockHeight: 123456, lastSync: new Date() },
      { chain: 'Starknet', currency: 'STRK', balance: '1500', spendable: '1400', pending: '100', blockHeight: 123456, lastSync: new Date() },
    ]);

    // Simulate proof history
    setProofs([
      { id: 'proof-1', policyId: 100001, railId: 'ZCASH_ORCHARD', timestamp: new Date(Date.now() - 3600000), status: 'verified', targetChains: ['starknet'] },
      { id: 'proof-2', policyId: 200001, railId: 'STARKNET_L2', timestamp: new Date(Date.now() - 7200000), status: 'verified', targetChains: [] },
    ]);

    // Simulate attestations
    setAttestations([
      { id: 'attest-1', policyId: 100001, epoch: 1700000000, sourceChain: 'ZCASH_ORCHARD', targetChains: ['starknet', 'near'], status: 'confirmed', expiresAt: new Date(Date.now() + 86400000) },
    ]);
  }, []);

  // Computed values
  const totalUsdValue = useMemo(() => {
    // Mock USD values
    const rates: Record<string, number> = { ZEC: 25, ETH: 2200, STRK: 1.5 };
    return balances.reduce((sum, b) => sum + parseFloat(b.balance) * (rates[b.currency] || 0), 0);
  }, [balances]);

  const connectedRailCount = useMemo(() => 
    rails.filter(r => r.status === 'connected').length,
    [rails]
  );

  // Handlers
  const handleGenerateProof = useCallback(async () => {
    if (selectedRails.length === 0) return;
    
    setIsProving(true);
    
    // Simulate proof generation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newProof: ProofRecord = {
      id: `proof-${Date.now()}`,
      policyId: 100001,
      railId: selectedRails.length > 1 ? 'MINA_RECURSIVE' : selectedRails[0],
      timestamp: new Date(),
      status: 'pending',
      targetChains: [],
    };
    
    setProofs(prev => [newProof, ...prev]);
    setIsProving(false);
  }, [selectedRails]);

  const handleBroadcastAttestation = useCallback(async (proofId: string, targetChains: string[]) => {
    const proof = proofs.find(p => p.id === proofId);
    if (!proof) return;

    const newAttestation: AttestationRecord = {
      id: `attest-${Date.now()}`,
      policyId: proof.policyId,
      epoch: Math.floor(Date.now() / 1000),
      sourceChain: proof.railId,
      targetChains,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
    };

    setAttestations(prev => [newAttestation, ...prev]);
    setProofs(prev => prev.map(p => 
      p.id === proofId ? { ...p, targetChains, status: 'verified' as const } : p
    ));
  }, [proofs]);

  const toggleRailSelection = useCallback((railId: string) => {
    setSelectedRails(prev => 
      prev.includes(railId) 
        ? prev.filter(r => r !== railId)
        : [...prev, railId]
    );
  }, []);

  return (
    <div className="tachyon-wallet">
      {/* Header */}
      <header className="tachyon-header">
        <div className="tachyon-brand">
          <div className="tachyon-logo">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" />
              <path d="M12 20L20 12L28 20L20 28L12 20Z" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="20" cy="20" r="4" fill="currentColor" />
            </svg>
          </div>
          <div className="tachyon-title">
            <h1>Tachyon Wallet</h1>
            <p className="tachyon-subtitle">Multi-chain ZK Proof-of-Funds</p>
          </div>
        </div>
        
        <div className="tachyon-stats">
          <div className="stat">
            <span className="stat-value">${totalUsdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            <span className="stat-label">Total Value</span>
          </div>
          <div className="stat">
            <span className="stat-value">{connectedRailCount}/{rails.length}</span>
            <span className="stat-label">Rails Active</span>
          </div>
          <div className="stat">
            <span className="stat-value">{proofs.filter(p => p.status === 'verified').length}</span>
            <span className="stat-label">Valid Proofs</span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="tachyon-nav">
        {(['overview', 'rails', 'proofs', 'attestations', 'agent'] as const).map(tab => (
          <button
            key={tab}
            className={`nav-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="tachyon-content">
        {activeTab === 'overview' && (
          <div className="overview-grid">
            {/* Balance Cards */}
            <section className="balance-section">
              <h2>Balances</h2>
              <div className="balance-cards">
                {balances.map((b, i) => (
                  <div key={i} className="balance-card">
                    <div className="balance-chain">{b.chain}</div>
                    <div className="balance-amount">
                      {b.balance} <span className="balance-currency">{b.currency}</span>
                    </div>
                    <div className="balance-meta">
                      <span>Block #{b.blockHeight.toLocaleString()}</span>
                      {parseFloat(b.pending) > 0 && (
                        <span className="pending">+{b.pending} pending</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Quick Proof Generation */}
            <section className="quick-proof-section">
              <h2>Generate Proof</h2>
              <div className="rail-selector">
                {rails.filter(r => r.status === 'connected').map(rail => (
                  <button
                    key={rail.id}
                    className={`rail-chip ${selectedRails.includes(rail.id) ? 'selected' : ''}`}
                    style={{ '--rail-color': RAIL_COLORS[rail.id] } as React.CSSProperties}
                    onClick={() => toggleRailSelection(rail.id)}
                  >
                    {rail.name}
                  </button>
                ))}
              </div>
              {selectedRails.length > 1 && (
                <p className="aggregation-note">
                  Multiple rails selected – proofs will be aggregated via Mina
                </p>
              )}
              <button 
                className="prove-button"
                onClick={handleGenerateProof}
                disabled={isProving || selectedRails.length === 0}
              >
                {isProving ? (
                  <>
                    <span className="spinner" />
                    Generating...
                  </>
                ) : (
                  'Generate Proof'
                )}
              </button>
            </section>

            {/* Recent Activity */}
            <section className="activity-section">
              <h2>Recent Activity</h2>
              <div className="activity-list">
                {[...proofs, ...attestations]
                  .sort((a, b) => {
                    const aTime = 'timestamp' in a ? a.timestamp : a.expiresAt;
                    const bTime = 'timestamp' in b ? b.timestamp : b.expiresAt;
                    return bTime.getTime() - aTime.getTime();
                  })
                  .slice(0, 5)
                  .map(item => (
                    <div key={item.id} className="activity-item">
                      <div className="activity-icon">
                        {'timestamp' in item ? '🔐' : '📡'}
                      </div>
                      <div className="activity-details">
                        <span className="activity-type">
                          {'timestamp' in item ? 'Proof Generated' : 'Attestation'}
                        </span>
                        <span className="activity-meta">
                          Policy {item.policyId} • {
                            'timestamp' in item 
                              ? item.timestamp.toLocaleTimeString()
                              : `Expires ${item.expiresAt.toLocaleDateString()}`
                          }
                        </span>
                      </div>
                      <span className={`activity-status status-${item.status}`}>
                        {item.status}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          </div>
        )}

        {activeTab === 'rails' && (
          <div className="rails-view">
            <h2>Chain Rails</h2>
            <p className="rails-description">
              Each rail provides specific proving capabilities. Tachyon uses each chain only for its comparative advantage.
            </p>
            <div className="rails-grid">
              {rails.map(rail => (
                <div 
                  key={rail.id} 
                  className={`rail-card status-${rail.status}`}
                  style={{ '--rail-color': RAIL_COLORS[rail.id] } as React.CSSProperties}
                >
                  <div className="rail-header">
                    <h3>{rail.name}</h3>
                    <span className={`rail-status ${rail.status}`}>
                      {rail.status === 'syncing' ? `${rail.syncProgress}%` : rail.status}
                    </span>
                  </div>
                  <div className="rail-capabilities">
                    {rail.capabilities.map(cap => (
                      <span key={cap} className="capability-tag">{cap}</span>
                    ))}
                  </div>
                  <div className="rail-footer">
                    {rail.lastActivity && (
                      <span className="last-activity">
                        Last active: {rail.lastActivity.toLocaleTimeString()}
                      </span>
                    )}
                    <button className="rail-action">
                      {rail.status === 'disconnected' ? 'Connect' : 'Sync'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'proofs' && (
          <div className="proofs-view">
            <h2>Proof History</h2>
            <table className="proofs-table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Rail</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {proofs.map(proof => (
                  <tr key={proof.id}>
                    <td>#{proof.policyId}</td>
                    <td>
                      <span 
                        className="rail-badge"
                        style={{ backgroundColor: RAIL_COLORS[proof.railId] }}
                      >
                        {proof.railId.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{proof.timestamp.toLocaleString()}</td>
                    <td>
                      <span className={`status-badge ${proof.status}`}>
                        {proof.status}
                      </span>
                    </td>
                    <td>
                      {proof.status === 'verified' && proof.targetChains.length === 0 && (
                        <button 
                          className="action-button"
                          onClick={() => handleBroadcastAttestation(proof.id, ['starknet', 'near'])}
                        >
                          Broadcast
                        </button>
                      )}
                      {proof.targetChains.length > 0 && (
                        <span className="broadcast-targets">
                          → {proof.targetChains.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'attestations' && (
          <div className="attestations-view">
            <h2>Cross-Chain Attestations</h2>
            <p className="attestations-description">
              Attestations are broadcast via Axelar GMP to target chains without bridging any assets.
            </p>
            <div className="attestations-list">
              {attestations.map(attest => (
                <div key={attest.id} className={`attestation-card status-${attest.status}`}>
                  <div className="attestation-header">
                    <span className="attestation-id">#{attest.id.slice(-8)}</span>
                    <span className={`attestation-status ${attest.status}`}>
                      {attest.status}
                    </span>
                  </div>
                  <div className="attestation-route">
                    <span className="source-chain">{attest.sourceChain}</span>
                    <span className="route-arrow">→</span>
                    <span className="target-chains">{attest.targetChains.join(', ')}</span>
                  </div>
                  <div className="attestation-meta">
                    <span>Policy #{attest.policyId}</span>
                    <span>Epoch {attest.epoch}</span>
                    <span>Expires {attest.expiresAt.toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'agent' && (
          <div className="agent-view">
            <h2>NEAR TEE Agent</h2>
            <p className="agent-description">
              A private AI agent running in a Trusted Execution Environment for wallet intelligence.
            </p>
            
            <div className="agent-status-card">
              <div className="agent-status-header">
                <span className="status-indicator disconnected" />
                <span>Agent Disconnected</span>
              </div>
              <p>Connect to the NEAR TEE agent to enable:</p>
              <ul className="agent-features">
                <li>Private portfolio analysis</li>
                <li>Proof strategy recommendations</li>
                <li>Natural language interactions</li>
                <li>Privacy-preserving explanations</li>
              </ul>
              <button className="connect-agent-button">
                Connect Agent
              </button>
            </div>
            
            <div className="agent-chat disabled">
              <div className="chat-placeholder">
                <span>💬</span>
                <p>Agent chat will appear here when connected</p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="tachyon-footer">
        <p>
          <strong>Tachyon Wallet</strong> – Privacy-first multi-chain proof-of-funds.
          Never bridges assets, only proofs.
        </p>
      </footer>
    </div>
  );
}

export default TachyonWallet;

