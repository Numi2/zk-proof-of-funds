/**
 * Mina Rail Status Panel
 *
 * Displays the current status of the Mina Recursive Rail,
 * including epoch aggregation progress and proof status.
 */

import { useState, useCallback } from 'react';
import {
  useMinaRailStatus,
  useMinaRailEpoch,
  useEpochFinalizationEvents,
} from '../services/mina-rail/hooks';
import { formatAggregationProgress, formatEpochProofSummary } from '../services/mina-rail/utils';
import type { MinaRailEpochProof, MinaRailSyncStatus } from '../types/mina-rail';

interface MinaRailPanelProps {
  /** Whether to show detailed shard information */
  showShardDetails?: boolean;
  /** Callback when an epoch is finalized */
  onEpochFinalized?: (proof: MinaRailEpochProof) => void;
  /** Custom class name */
  className?: string;
}

const STATUS_COLORS: Record<MinaRailSyncStatus, string> = {
  idle: '#22c55e',
  syncing: '#3b82f6',
  aggregating: '#f59e0b',
  finalizing: '#8b5cf6',
  bridging: '#06b6d4',
  error: '#ef4444',
};

const STATUS_LABELS: Record<MinaRailSyncStatus, string> = {
  idle: 'Ready',
  syncing: 'Syncing...',
  aggregating: 'Aggregating Proofs',
  finalizing: 'Finalizing Epoch',
  bridging: 'Bridging to L1',
  error: 'Error',
};

export function MinaRailPanel({
  showShardDetails = false,
  onEpochFinalized,
  className = '',
}: MinaRailPanelProps) {
  const { status, isLoading, error, refresh } = useMinaRailStatus();
  const { epochState: _epochState, epochProof: _epochProof } = useMinaRailEpoch(status?.currentEpoch);
  const { latestFinalizedEpoch, isConnected } = useEpochFinalizationEvents(onEpochFinalized);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  if (isLoading && !status) {
    return (
      <div className={`mina-rail-panel ${className}`} style={styles.container}>
        <div style={styles.loadingContainer}>
          <div style={styles.spinner} />
          <span style={styles.loadingText}>Connecting to Mina Rail...</span>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return null;
  }

  if (!status) return null;

  const syncStatus = status.syncStatus;
  const statusColor = STATUS_COLORS[syncStatus];
  const statusLabel = STATUS_LABELS[syncStatus];
  const completedShards = status.shards.filter(s => s.isProofGenerated).length;
  const totalShards = status.shards.length;

  return (
    <div className={`mina-rail-panel ${className}`} style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={styles.railIcon}>🚂</span>
          <h3 style={styles.title}>Mina Recursive Rail</h3>
          <div style={{ ...styles.statusBadge, backgroundColor: statusColor }}>
            {statusLabel}
          </div>
        </div>
        
        <div style={styles.connectionStatus}>
          <span style={{
            ...styles.connectionDot,
            backgroundColor: isConnected ? '#22c55e' : '#6b7280'
          }} />
          <span style={styles.connectionText}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Epoch Summary */}
      <div style={styles.epochSummary}>
        <div style={styles.epochCard}>
          <span style={styles.epochLabel}>Current Epoch</span>
          <span style={styles.epochValue}>{status.currentEpoch}</span>
        </div>
        <div style={styles.epochCard}>
          <span style={styles.epochLabel}>Tachystamps</span>
          <span style={styles.epochValue}>{status.totalTachystamps.toLocaleString()}</span>
        </div>
        <div style={styles.epochCard}>
          <span style={styles.epochLabel}>Latest Finalized</span>
          <span style={styles.epochValue}>{status.latestFinalizedEpoch}</span>
        </div>
      </div>

      {/* Aggregation Progress */}
      <div style={styles.progressSection}>
        <div style={styles.progressHeader}>
          <span style={styles.progressLabel}>Aggregation Progress</span>
          <span style={styles.progressValue}>
            {formatAggregationProgress(completedShards, totalShards)}
          </span>
        </div>
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${status.aggregationProgress}%`,
            }}
          />
        </div>
      </div>

      {/* Shard Details (expandable) */}
      {showShardDetails && (
        <>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={styles.expandButton}
          >
            {isExpanded ? '▼ Hide Shards' : '▶ Show Shards'}
          </button>
          
          {isExpanded && (
            <div style={styles.shardGrid}>
              {status.shards.map((shard) => (
                <div
                  key={shard.shardId}
                  style={{
                    ...styles.shardCard,
                    borderColor: shard.isProofGenerated ? '#22c55e' : '#6b7280',
                  }}
                >
                  <span style={styles.shardId}>Shard {shard.shardId}</span>
                  <span style={styles.shardCount}>
                    {shard.tachystampCount} stamps
                  </span>
                  <span style={{
                    ...styles.shardStatus,
                    color: shard.isProofGenerated ? '#22c55e' : '#f59e0b'
                  }}>
                    {shard.isProofGenerated ? '✓ Proven' : '⏳ Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Latest Finalized Epoch */}
      {latestFinalizedEpoch && (
        <div style={styles.finalizedSection}>
          <div style={styles.finalizedHeader}>
            <span style={styles.checkmark}>✅</span>
            <span style={styles.finalizedTitle}>
              {formatEpochProofSummary(
                latestFinalizedEpoch.proofCount,
                latestFinalizedEpoch.epoch
              )}
            </span>
          </div>
          <div style={styles.finalizedDetails}>
            <span style={styles.detailItem}>
              Nullifier Root: {latestFinalizedEpoch.nullifierRoot.slice(0, 10)}...
            </span>
            <span style={styles.detailItem}>
              Mina Slot: {latestFinalizedEpoch.minaSlot}
            </span>
          </div>
        </div>
      )}

      {/* Time to Next Epoch */}
      {status.timeToNextEpoch > 0 && (
        <div style={styles.timeToEpoch}>
          <span style={styles.clockIcon}>⏱️</span>
          <span style={styles.timeText}>
            Next epoch in {formatTime(status.timeToNextEpoch)}
          </span>
        </div>
      )}

      {/* Error Display */}
      {status.error && (
        <div style={styles.errorBanner}>
          <span style={styles.errorIcon}>⚠️</span>
          <span>{status.error}</span>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={handleRefresh}
        disabled={isLoading}
        style={{
          ...styles.refreshButton,
          opacity: isLoading ? 0.5 : 1,
        }}
      >
        {isLoading ? 'Refreshing...' : '↻ Refresh'}
      </button>
    </div>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: '12px',
    padding: '16px',
    border: '1px solid #2d2d44',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '24px',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2px solid #3b82f6',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: '14px',
  },
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    backgroundColor: '#451a1a',
    borderRadius: '8px',
  },
  errorIcon: {
    fontSize: '16px',
  },
  errorText: {
    color: '#f87171',
    fontSize: '14px',
    flex: 1,
  },
  retryButton: {
    padding: '6px 12px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  railIcon: {
    fontSize: '20px',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: '#f3f4f6',
  },
  statusBadge: {
    padding: '4px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500,
    color: 'white',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  connectionDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  connectionText: {
    fontSize: '11px',
    color: '#9ca3af',
  },
  epochSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '12px',
    marginBottom: '16px',
  },
  epochCard: {
    backgroundColor: '#252540',
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  epochLabel: {
    fontSize: '11px',
    color: '#9ca3af',
    textTransform: 'uppercase',
  },
  epochValue: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#f3f4f6',
  },
  progressSection: {
    marginBottom: '16px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  progressLabel: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  progressValue: {
    fontSize: '12px',
    color: '#f3f4f6',
  },
  progressBar: {
    height: '8px',
    backgroundColor: '#2d2d44',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#8b5cf6',
    borderRadius: '4px',
    transition: 'width 0.3s ease',
  },
  expandButton: {
    width: '100%',
    padding: '8px',
    backgroundColor: 'transparent',
    border: '1px solid #2d2d44',
    borderRadius: '6px',
    color: '#9ca3af',
    cursor: 'pointer',
    fontSize: '12px',
    marginBottom: '12px',
  },
  shardGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '8px',
    marginBottom: '16px',
  },
  shardCard: {
    backgroundColor: '#252540',
    borderRadius: '6px',
    padding: '8px',
    borderLeft: '3px solid',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  shardId: {
    fontSize: '10px',
    color: '#9ca3af',
  },
  shardCount: {
    fontSize: '12px',
    color: '#f3f4f6',
    fontWeight: 500,
  },
  shardStatus: {
    fontSize: '10px',
  },
  finalizedSection: {
    backgroundColor: '#1a2e1a',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '12px',
    border: '1px solid #22c55e33',
  },
  finalizedHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  checkmark: {
    fontSize: '14px',
  },
  finalizedTitle: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#22c55e',
  },
  finalizedDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  detailItem: {
    fontSize: '11px',
    color: '#9ca3af',
    fontFamily: 'monospace',
  },
  timeToEpoch: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#252540',
    borderRadius: '6px',
    marginBottom: '12px',
  },
  clockIcon: {
    fontSize: '14px',
  },
  timeText: {
    fontSize: '12px',
    color: '#f3f4f6',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#451a1a',
    borderRadius: '6px',
    color: '#f87171',
    fontSize: '12px',
    marginBottom: '12px',
  },
  refreshButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
};

// Add keyframes for spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);

export default MinaRailPanel;

