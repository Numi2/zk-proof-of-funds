/**
 * Tachyon State Panel
 *
 * Displays the wallet's PCD (Proof-Carrying Data) state and provides
 * controls for managing the Tachyon state machine.
 */

import React, { useState, useCallback } from 'react';
import { usePcdContext } from '../context/PcdContext';
import type { BlockDelta, NoteIdentifier } from '../types/pcd';

interface TachyonStatePanelProps {
  /** Compact mode for embedding in other components */
  compact?: boolean;
}

export function TachyonStatePanel({ compact = false }: TachyonStatePanelProps) {
  const {
    state,
    initializePcd,
    updatePcd,
    verifyPcd,
    exportPcdState,
    importPcdState,
    clearPcdState,
  } = usePcdContext();

  const [showDetails, setShowDetails] = useState(false);
  const [verificationResult, setVerificationResult] = useState<boolean | null>(null);
  const [importJson, setImportJson] = useState('');
  const [showImport, setShowImport] = useState(false);

  const handleInitialize = useCallback(async () => {
    try {
      await initializePcd([]);
    } catch (err) {
      console.error('Failed to initialize PCD:', err);
    }
  }, [initializePcd]);

  const handleDemoUpdate = useCallback(async () => {
    if (!state.pcdState) return;

    // Create a demo block delta (simulating a new block)
    const demoNote: NoteIdentifier = {
      commitment: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
      value: Math.floor(Math.random() * 1000000),
      position: state.notes.length,
    };

    const delta: BlockDelta = {
      block_height: state.pcdState.wallet_state.height + 1,
      anchor_new: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
      new_notes: [demoNote],
      spent_nullifiers: [],
    };

    try {
      await updatePcd(delta);
    } catch (err) {
      console.error('Failed to update PCD:', err);
    }
  }, [state.pcdState, state.notes, updatePcd]);

  const handleVerify = useCallback(async () => {
    const result = await verifyPcd();
    setVerificationResult(result);
    setTimeout(() => setVerificationResult(null), 5000);
  }, [verifyPcd]);

  const handleExport = useCallback(() => {
    const json = exportPcdState();
    if (json) {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tachyon-state-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [exportPcdState]);

  const handleImport = useCallback(async () => {
    if (!importJson.trim()) return;
    try {
      await importPcdState(importJson);
      setImportJson('');
      setShowImport(false);
    } catch (err) {
      console.error('Failed to import:', err);
    }
  }, [importJson, importPcdState]);

  const handleClear = useCallback(async () => {
    if (confirm('Are you sure you want to clear the Tachyon state? This cannot be undone.')) {
      await clearPcdState();
    }
  }, [clearPcdState]);

  const formatCommitment = (hex: string) => {
    if (hex.length <= 16) return hex;
    return `${hex.slice(0, 10)}...${hex.slice(-6)}`;
  };

  const formatTimestamp = (ts: number | null) => {
    if (!ts) return 'Never';
    return new Date(ts).toLocaleString();
  };

  const statusIcon = {
    idle: '✓',
    syncing: '⟳',
    verifying: '🔍',
    generating_proof: '⚙️',
    error: '✗',
  }[state.status];

  const statusColor = {
    idle: '#22c55e',
    syncing: '#3b82f6',
    verifying: '#8b5cf6',
    generating_proof: '#f59e0b',
    error: '#ef4444',
  }[state.status];

  if (compact) {
    return (
      <div style={styles.compactContainer}>
        <div style={styles.compactHeader}>
          <span style={{ ...styles.statusDot, backgroundColor: statusColor }} />
          <span style={styles.compactTitle}>Tachyon State</span>
          {state.isInitialized && (
            <span style={styles.compactHeight}>
              H: {state.pcdState?.wallet_state.height ?? 0}
            </span>
          )}
        </div>
        {state.isInitialized ? (
          <div style={styles.compactCommitment}>
            S: {formatCommitment(state.pcdState?.s_current ?? '')}
          </div>
        ) : (
          <button onClick={handleInitialize} style={styles.compactButton}>
            Initialize
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>
          <span style={{ ...styles.statusDot, backgroundColor: statusColor }} />
          Tachyon State Machine
        </h3>
        <span style={styles.statusLabel}>
          {statusIcon} {state.status.replace('_', ' ')}
        </span>
      </div>

      {state.error && (
        <div style={styles.errorBox}>
          <strong>Error:</strong> {state.error}
        </div>
      )}

      {!state.isInitialized ? (
        <div style={styles.initSection}>
          <p style={styles.description}>
            Initialize the Tachyon state machine to enable proof-carrying data (PCD) for your wallet.
            This creates a genesis state and proof chain.
          </p>
          <button onClick={handleInitialize} style={styles.primaryButton} disabled={state.status !== 'idle'}>
            {state.status === 'generating_proof' ? 'Initializing...' : 'Initialize Tachyon State'}
          </button>
        </div>
      ) : (
        <>
          <div style={styles.stateGrid}>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>State Commitment (S)</label>
              <code style={styles.stateValue}>{state.pcdState?.s_current ?? 'N/A'}</code>
            </div>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>Last PCD Height</label>
              <span style={styles.stateValueLarge}>{state.pcdState?.wallet_state.height ?? 0}</span>
            </div>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>Chain Length</label>
              <span style={styles.stateValueLarge}>{state.pcdState?.chain_length ?? 0}</span>
            </div>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>Circuit Version</label>
              <span style={styles.stateValue}>v{state.pcdState?.circuit_version ?? 0}</span>
            </div>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>Notes in Wallet</label>
              <span style={styles.stateValueLarge}>{state.notes.length}</span>
            </div>
            <div style={styles.stateItem}>
              <label style={styles.stateLabel}>Last Sync</label>
              <span style={styles.stateValue}>{formatTimestamp(state.lastSyncAt)}</span>
            </div>
          </div>

          <div style={styles.actions}>
            <button onClick={handleDemoUpdate} style={styles.actionButton} disabled={state.status !== 'idle'}>
              {state.status === 'syncing' || state.status === 'generating_proof' 
                ? 'Updating...' 
                : 'Update PCD (Demo Block)'}
            </button>
            <button onClick={handleVerify} style={styles.actionButton} disabled={state.status !== 'idle'}>
              {state.status === 'verifying' ? 'Verifying...' : 'Verify Proof'}
            </button>
            <button onClick={() => setShowDetails(!showDetails)} style={styles.actionButton}>
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {verificationResult !== null && (
            <div style={{
              ...styles.verificationResult,
              backgroundColor: verificationResult ? '#dcfce7' : '#fee2e2',
              color: verificationResult ? '#166534' : '#991b1b',
            }}>
              {verificationResult ? '✓ Proof verified successfully' : '✗ Proof verification failed'}
            </div>
          )}

          {showDetails && (
            <div style={styles.detailsSection}>
              <h4 style={styles.detailsTitle}>Wallet State Details</h4>
              <pre style={styles.jsonPreview}>
                {JSON.stringify(state.pcdState?.wallet_state, null, 2)}
              </pre>

              <h4 style={styles.detailsTitle}>Genesis Commitment</h4>
              <code style={styles.genesisCode}>{state.pcdState?.s_genesis}</code>

              <h4 style={styles.detailsTitle}>Current Notes ({state.notes.length})</h4>
              {state.notes.length > 0 ? (
                <ul style={styles.notesList}>
                  {state.notes.slice(0, 5).map((note, idx) => (
                    <li key={idx} style={styles.noteItem}>
                      <span style={styles.noteValue}>{note.value.toLocaleString()} sat</span>
                      <code style={styles.noteCommitment}>{formatCommitment(note.commitment)}</code>
                    </li>
                  ))}
                  {state.notes.length > 5 && (
                    <li style={styles.noteItem}>...and {state.notes.length - 5} more</li>
                  )}
                </ul>
              ) : (
                <p style={styles.emptyNotes}>No notes in wallet</p>
              )}
            </div>
          )}

          <div style={styles.exportSection}>
            <button onClick={handleExport} style={styles.secondaryButton}>
              Export State (JSON)
            </button>
            <button onClick={() => setShowImport(!showImport)} style={styles.secondaryButton}>
              {showImport ? 'Cancel Import' : 'Import State'}
            </button>
            <button onClick={handleClear} style={styles.dangerButton}>
              Clear State
            </button>
          </div>

          {showImport && (
            <div style={styles.importSection}>
              <textarea
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                placeholder="Paste exported JSON here..."
                style={styles.importTextarea}
              />
              <button onClick={handleImport} style={styles.primaryButton} disabled={!importJson.trim()}>
                Import
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    padding: '24px',
    color: '#e2e8f0',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '16px',
    borderBottom: '1px solid #334155',
  },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusLabel: {
    fontSize: '0.875rem',
    color: '#94a3b8',
    textTransform: 'capitalize',
  },
  errorBox: {
    backgroundColor: '#7f1d1d',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '0.875rem',
  },
  initSection: {
    textAlign: 'center',
    padding: '32px',
  },
  description: {
    color: '#94a3b8',
    marginBottom: '24px',
    lineHeight: 1.6,
  },
  stateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  stateItem: {
    backgroundColor: '#0f172a',
    padding: '16px',
    borderRadius: '8px',
  },
  stateLabel: {
    display: 'block',
    fontSize: '0.75rem',
    color: '#64748b',
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  stateValue: {
    fontSize: '0.875rem',
    color: '#e2e8f0',
    wordBreak: 'break-all',
    fontFamily: "'JetBrains Mono', monospace",
  },
  stateValueLarge: {
    fontSize: '1.5rem',
    fontWeight: 600,
    color: '#3b82f6',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '16px',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'background-color 0.2s',
  },
  actionButton: {
    backgroundColor: '#334155',
    color: '#e2e8f0',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    color: '#94a3b8',
    border: '1px solid #334155',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    transition: 'all 0.2s',
  },
  dangerButton: {
    backgroundColor: 'transparent',
    color: '#f87171',
    border: '1px solid #7f1d1d',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
  },
  verificationResult: {
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontWeight: 500,
    textAlign: 'center',
  },
  detailsSection: {
    backgroundColor: '#0f172a',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  detailsTitle: {
    margin: '0 0 12px 0',
    fontSize: '0.875rem',
    color: '#94a3b8',
    fontWeight: 500,
  },
  jsonPreview: {
    backgroundColor: '#020617',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '0.75rem',
    overflow: 'auto',
    maxHeight: '200px',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '20px',
  },
  genesisCode: {
    display: 'block',
    fontSize: '0.75rem',
    wordBreak: 'break-all',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '20px',
    color: '#6366f1',
  },
  notesList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  noteItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #1e293b',
    fontSize: '0.875rem',
  },
  noteValue: {
    fontWeight: 500,
    color: '#22c55e',
  },
  noteCommitment: {
    fontSize: '0.75rem',
    color: '#64748b',
    fontFamily: "'JetBrains Mono', monospace",
  },
  emptyNotes: {
    color: '#64748b',
    fontStyle: 'italic',
    margin: 0,
  },
  exportSection: {
    display: 'flex',
    gap: '8px',
    paddingTop: '16px',
    borderTop: '1px solid #334155',
  },
  importSection: {
    marginTop: '16px',
  },
  importTextarea: {
    width: '100%',
    height: '120px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px',
    color: '#e2e8f0',
    fontSize: '0.75rem',
    fontFamily: "'JetBrains Mono', monospace",
    resize: 'vertical',
    marginBottom: '12px',
  },
  // Compact styles
  compactContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '12px',
    color: '#e2e8f0',
    fontSize: '0.875rem',
  },
  compactHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  compactTitle: {
    fontWeight: 500,
    flex: 1,
  },
  compactHeight: {
    color: '#3b82f6',
    fontWeight: 600,
  },
  compactCommitment: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.75rem',
    color: '#94a3b8',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  compactButton: {
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.75rem',
    width: '100%',
  },
};

export default TachyonStatePanel;

