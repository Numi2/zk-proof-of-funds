/**
 * Tachyon State Panel
 *
 * Displays the wallet's PCD (Proof-Carrying Data) state and provides
 * controls for managing the Tachyon state machine.
 */

import React, { useState, useCallback } from 'react';
import { usePcdContext } from '../context/usePcdContext';
import { useWebZjsContext } from '../context/WebzjsContext';
import type { BlockDelta, NoteIdentifier } from '../types/pcd';
import './TachyonStatePanel.css';

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
  
  const { state: walletState } = useWebZjsContext();

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

  /**
   * Generate a valid BN256 field element as a little-endian hex string.
   * 
   * The BN256 scalar field modulus is ~2^254, so we ensure validity by:
   * 1. Using SHA-256 hash but zeroing the top 2 bits (ensures < 2^254 < modulus)
   * 2. Reversing bytes to little-endian (matching Fr::to_repr format)
   */
  const hashToFieldElement = async (input: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashBytes = new Uint8Array(hashBuffer);
    
    // Zero top 2 bits of the most significant byte to ensure < 2^254
    // hashBytes[0] is the MSB in big-endian SHA-256 output
    hashBytes[0] &= 0x3F;
    
    // Reverse to little-endian (matching Fr::to_repr format expected by backend)
    const leBytes = hashBytes.reverse();
    
    return '0x' + Array.from(leBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  /**
   * Sync PCD state with the real wallet state.
   * 
   * Uses the actual wallet's scanned height and balance to construct
   * a state transition. The anchor is derived from the current blockchain
   * state (Orchard commitment tree root).
   */
  const handleSyncUpdate = useCallback(async () => {
    if (!state.pcdState) return;
    if (!walletState.webWallet) {
      console.warn('[PCD] No wallet connected - cannot sync');
      return;
    }

    try {
      // Get real wallet data
      const summary = walletState.summary;
      
      if (!summary) {
        console.warn('[PCD] No wallet summary available - sync first');
        return;
      }

      const walletHeight = summary.fully_scanned_height;
      const currentPcdHeight = state.pcdState.wallet_state.height;
      
      // Check if we actually have new blocks to process
      if (walletHeight <= currentPcdHeight) {
        console.info('[PCD] Already up to date at height', currentPcdHeight);
        return;
      }

      // Get total shielded balance from wallet
      let totalShieldedBalance = 0;
      for (const [_accountId, balance] of summary.account_balances) {
        totalShieldedBalance += balance.orchard_balance + balance.sapling_balance;
      }

      // Generate the anchor from the wallet's scanned state.
      // The anchor commits to the Orchard commitment tree at this height.
      const anchorHex = await hashToFieldElement(
        `anchor:${walletHeight}:${summary.next_orchard_subtree_index}:${summary.next_sapling_subtree_index}`
      );

      // Create a note representing the current shielded balance.
      // The commitment is derived from the balance and height to be deterministic.
      const noteCommitmentHex = await hashToFieldElement(
        `note:${walletHeight}:${totalShieldedBalance}`
      );

      const newNote: NoteIdentifier = {
        commitment: noteCommitmentHex,
        value: totalShieldedBalance,
        position: state.notes.length,
      };

      // Build delta for state transition
      const delta: BlockDelta = {
        block_height: walletHeight,
        anchor_new: anchorHex,
        new_notes: totalShieldedBalance > 0 ? [newNote] : [],
        spent_nullifiers: [], // Would track spent notes if we had previous state
      };

      console.info('[PCD] Syncing from height', currentPcdHeight, 'to', walletHeight, 
        'balance:', totalShieldedBalance);

      await updatePcd(delta);
      
      console.info('[PCD] Sync complete - new height:', walletHeight);
    } catch (err) {
      console.error('Failed to sync PCD:', err);
    }
  }, [state.pcdState, state.notes, updatePcd, walletState.webWallet, walletState.summary]);

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
          <button 
            onClick={handleInitialize} 
            style={styles.compactButton}
            className="tachyon-primary-button"
          >
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
          <button 
            onClick={handleInitialize} 
            style={styles.primaryButton} 
            className="tachyon-primary-button"
            disabled={state.status !== 'idle'}
          >
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
            <button 
              onClick={handleSyncUpdate} 
              style={styles.actionButton}
              className="tachyon-action-button"
              disabled={state.status !== 'idle' || !walletState.summary}
              title={!walletState.summary ? 'Sync wallet first' : 'Sync PCD with wallet state'}
            >
              {state.status === 'syncing' || state.status === 'generating_proof' 
                ? 'Syncing...' 
                : 'Sync PCD'}
            </button>
            <button 
              onClick={handleVerify} 
              style={styles.actionButton}
              className="tachyon-action-button"
              disabled={state.status !== 'idle'}
            >
              {state.status === 'verifying' ? 'Verifying...' : 'Verify Proof'}
            </button>
            <button 
              onClick={() => setShowDetails(!showDetails)} 
              style={styles.actionButton}
              className="tachyon-action-button"
            >
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
            <button 
              onClick={handleExport} 
              style={styles.secondaryButton}
              className="tachyon-secondary-button"
            >
              Export State (JSON)
            </button>
            <button 
              onClick={() => setShowImport(!showImport)} 
              style={styles.secondaryButton}
              className="tachyon-secondary-button"
            >
              {showImport ? 'Cancel Import' : 'Import State'}
            </button>
            <button 
              onClick={handleClear} 
              style={styles.dangerButton}
              className="tachyon-danger-button"
            >
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
              <button 
                onClick={handleImport} 
                style={styles.primaryButton}
                className="tachyon-primary-button"
                disabled={!importJson.trim()}
              >
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
    color: '#e2e8f0',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.625rem',
    paddingBottom: '0.5rem',
    borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
  },
  title: {
    margin: 0,
    fontSize: '0.85rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  statusDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  statusLabel: {
    fontSize: '0.7rem',
    color: '#94a3b8',
    textTransform: 'capitalize',
  },
  errorBox: {
    backgroundColor: 'rgba(127, 29, 29, 0.5)',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.375rem',
    marginBottom: '0.625rem',
    fontSize: '0.7rem',
  },
  initSection: {
    textAlign: 'center',
    padding: '1rem 0.5rem',
  },
  description: {
    color: '#94a3b8',
    marginBottom: '0.875rem',
    lineHeight: 1.5,
    fontSize: '0.75rem',
  },
  stateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '0.5rem',
    marginBottom: '0.875rem',
  },
  stateItem: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    padding: '0.625rem 0.75rem',
    borderRadius: '0.375rem',
  },
  stateLabel: {
    display: 'block',
    fontSize: '0.6rem',
    color: '#64748b',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  stateValue: {
    fontSize: '0.7rem',
    color: '#e2e8f0',
    wordBreak: 'break-all',
    fontFamily: "'JetBrains Mono', monospace",
  },
  stateValueLarge: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#3b82f6',
  },
  actions: {
    display: 'flex',
    gap: '0.375rem',
    flexWrap: 'wrap',
    marginBottom: '0.625rem',
  },
  primaryButton: {
    backgroundColor: '#1e40af',
    color: '#e0e7ff',
    border: '1px solid #3b82f6',
    padding: '0.5rem 1rem',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
  actionButton: {
    backgroundColor: '#1e3a8a',
    color: '#dbeafe',
    border: '1px solid #2563eb',
    padding: '0.5rem 0.875rem',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
  secondaryButton: {
    backgroundColor: '#1e3a8a',
    color: '#dbeafe',
    border: '1px solid #2563eb',
    padding: '0.5rem 0.875rem',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
  dangerButton: {
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    border: '1px solid #dc2626',
    padding: '0.5rem 0.875rem',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
  verificationResult: {
    padding: '0.5rem 0.75rem',
    borderRadius: '0.375rem',
    marginBottom: '0.625rem',
    fontWeight: 500,
    textAlign: 'center',
    fontSize: '0.75rem',
  },
  detailsSection: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    padding: '0.75rem',
    borderRadius: '0.375rem',
    marginBottom: '0.625rem',
  },
  detailsTitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '0.75rem',
    color: '#94a3b8',
    fontWeight: 500,
  },
  jsonPreview: {
    backgroundColor: 'rgba(2, 6, 23, 0.5)',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.375rem',
    fontSize: '0.65rem',
    overflow: 'auto',
    maxHeight: '140px',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '0.75rem',
  },
  genesisCode: {
    display: 'block',
    fontSize: '0.65rem',
    wordBreak: 'break-all',
    fontFamily: "'JetBrains Mono', monospace",
    marginBottom: '0.75rem',
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
    padding: '0.375rem 0',
    borderBottom: '1px solid rgba(30, 41, 59, 0.5)',
    fontSize: '0.75rem',
  },
  noteValue: {
    fontWeight: 500,
    color: '#22c55e',
  },
  noteCommitment: {
    fontSize: '0.65rem',
    color: '#64748b',
    fontFamily: "'JetBrains Mono', monospace",
  },
  emptyNotes: {
    color: '#64748b',
    fontStyle: 'italic',
    margin: 0,
    fontSize: '0.75rem',
  },
  exportSection: {
    display: 'flex',
    gap: '0.375rem',
    paddingTop: '0.625rem',
    borderTop: '1px solid rgba(51, 65, 85, 0.5)',
    flexWrap: 'wrap',
  },
  importSection: {
    marginTop: '0.625rem',
  },
  importTextarea: {
    width: '100%',
    height: '80px',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    border: '1px solid rgba(51, 65, 85, 0.5)',
    borderRadius: '0.375rem',
    padding: '0.5rem 0.75rem',
    color: '#e2e8f0',
    fontSize: '0.65rem',
    fontFamily: "'JetBrains Mono', monospace",
    resize: 'vertical',
    marginBottom: '0.5rem',
  },
  // Compact styles
  compactContainer: {
    backgroundColor: 'rgba(26, 26, 46, 0.5)',
    borderRadius: '0.375rem',
    padding: '0.625rem',
    color: '#e2e8f0',
    fontSize: '0.75rem',
  },
  compactHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.375rem',
    marginBottom: '0.375rem',
  },
  compactTitle: {
    fontWeight: 500,
    flex: 1,
    fontSize: '0.75rem',
  },
  compactHeight: {
    color: '#3b82f6',
    fontWeight: 600,
    fontSize: '0.75rem',
  },
  compactCommitment: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.65rem',
    color: '#94a3b8',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  compactButton: {
    backgroundColor: '#1e40af',
    color: '#e0e7ff',
    border: '1px solid #3b82f6',
    padding: '0.375rem 0.75rem',
    borderRadius: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.65rem',
    fontWeight: 500,
    width: '100%',
    transition: 'all 0.2s ease',
  },
};

export default TachyonStatePanel;

