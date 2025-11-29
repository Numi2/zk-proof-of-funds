/**
 * PCD Keeper Status Panel
 *
 * Real-time display of the autonomous PCD Keeper running in the Shade Agent TEE.
 * Shows sync status, tachystamp queue, and event history.
 */

import React, { useState, useMemo } from 'react';
import { usePcdKeeperEvents, type KeeperEvent, type KeeperEventType } from '../../hooks/usePcdKeeperEvents';
import './KeeperStatusPanel.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface KeeperStatusPanelProps {
  /** WebSocket URL override. */
  wsUrl?: string;
  /** Whether to show event log. */
  showEventLog?: boolean;
  /** Max events to display. */
  maxEventsDisplay?: number;
  /** Compact mode. */
  compact?: boolean;
  /** Custom class name. */
  className?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

const ConnectionIndicator: React.FC<{ connected: boolean; connecting: boolean }> = ({
  connected,
  connecting,
}) => (
  <div className={`keeper-connection-indicator ${connected ? 'connected' : connecting ? 'connecting' : 'disconnected'}`}>
    <span className="keeper-connection-dot" />
    <span className="keeper-connection-label">
      {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
    </span>
  </div>
);

const StatCard: React.FC<{
  label: string;
  value: string | number;
  sublabel?: string;
  status?: 'ok' | 'warning' | 'error';
}> = ({ label, value, sublabel, status }) => (
  <div className={`keeper-stat-card ${status ? `status-${status}` : ''}`}>
    <div className="keeper-stat-label">{label}</div>
    <div className="keeper-stat-value">{value}</div>
    {sublabel && <div className="keeper-stat-sublabel">{sublabel}</div>}
  </div>
);

const EventIcon: React.FC<{ type: KeeperEventType }> = ({ type }) => {
  const icons: Record<string, string> = {
    connected: '🔗',
    keeper_started: '▶️',
    keeper_stopped: '⏹️',
    sync_started: '🔄',
    sync_completed: '✅',
    tachystamp_queued: '📝',
    tachystamp_submitted: '🚀',
    epoch_boundary: '📅',
    warning: '⚠️',
    error: '❌',
    status_update: '📊',
  };
  return <span className="keeper-event-icon">{icons[type] || '•'}</span>;
};

const EventItem: React.FC<{ event: KeeperEvent }> = ({ event }) => {
  const time = new Date(event.timestamp).toLocaleTimeString();
  
  const getMessage = () => {
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'sync_started':
        return `Syncing blocks ${data.fromHeight} → ${data.toHeight}`;
      case 'sync_completed':
        if (data.success) {
          return `Synced to height ${data.newHeight} (${data.blocksSynced} blocks, ${data.durationMs}ms)`;
        }
        return `Sync failed: ${data.error}`;
      case 'tachystamp_queued':
        return `Tachystamp queued for policy ${data.policyId} (epoch ${data.epoch})`;
      case 'tachystamp_submitted':
        return `Tachystamp ${data.tachystampId} submitted (policy ${data.policyId})`;
      case 'epoch_boundary':
        return `Epoch ${data.oldEpoch} → ${data.newEpoch}`;
      case 'warning':
        return `[${data.code}] ${data.message}`;
      case 'error':
        return `[${data.code}] ${data.message}`;
      default:
        return JSON.stringify(data).slice(0, 100);
    }
  };

  return (
    <div className={`keeper-event-item event-${event.type}`}>
      <EventIcon type={event.type} />
      <span className="keeper-event-time">{time}</span>
      <span className="keeper-event-message">{getMessage()}</span>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export const KeeperStatusPanel: React.FC<KeeperStatusPanelProps> = ({
  wsUrl,
  showEventLog = true,
  maxEventsDisplay = 20,
  compact = false,
  className = '',
}) => {
  const [expandedEvents, setExpandedEvents] = useState(false);

  const {
    isConnected,
    isConnecting,
    status,
    config,
    events,
    lastError,
    reconnectAttempts,
    connect,
    disconnect,
    requestSync,
    clearEvents,
  } = usePcdKeeperEvents({
    url: wsUrl,
    statusInterval: 5,
    onError: (err) => console.error('[KeeperPanel]', err),
  });

  // Compute derived values
  const syncStatus = useMemo(() => {
    if (!status) return { label: 'Unknown', status: 'warning' as const };
    if (status.blocksBehind === 0) return { label: 'Synced', status: 'ok' as const };
    if (status.blocksBehind <= 10) return { label: 'Nearly synced', status: 'ok' as const };
    if (status.blocksBehind <= 100) return { label: 'Syncing', status: 'warning' as const };
    return { label: 'Behind', status: 'error' as const };
  }, [status]);

  const displayedEvents = useMemo(
    () => events.slice(0, expandedEvents ? events.length : maxEventsDisplay),
    [events, expandedEvents, maxEventsDisplay]
  );

  const formatHeight = (height: number) => height.toLocaleString();

  // Handlers
  const handleSyncClick = async () => {
    try {
      await requestSync();
    } catch (err) {
      console.error('Sync request failed:', err);
    }
  };

  if (compact) {
    return (
      <div className={`keeper-status-panel compact ${className}`}>
        <ConnectionIndicator connected={isConnected} connecting={isConnecting} />
        {status && (
          <div className="keeper-compact-stats">
            <span className="keeper-compact-stat">
              <strong>{formatHeight(status.pcdHeight)}</strong>
              <small>/{formatHeight(status.chainHeight)}</small>
            </span>
            <span className={`keeper-compact-status ${syncStatus.status}`}>
              {syncStatus.label}
            </span>
            {status.pendingTachystamps > 0 && (
              <span className="keeper-compact-pending">
                {status.pendingTachystamps} pending
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`keeper-status-panel ${className}`}>
      {/* Header */}
      <div className="keeper-panel-header">
        <div className="keeper-panel-title">
          <span className="keeper-panel-title-icon">🔐</span>
          <span>PCD Keeper</span>
          <span className="keeper-panel-subtitle">Autonomous State Manager</span>
        </div>
        <ConnectionIndicator connected={isConnected} connecting={isConnecting} />
      </div>

      {/* Connection Error */}
      {lastError && !isConnected && (
        <div className="keeper-error-banner">
          <span>⚠️ {lastError.message}</span>
          {reconnectAttempts > 0 && (
            <span className="keeper-reconnect-count">
              Reconnect attempt {reconnectAttempts}
            </span>
          )}
          <button className="keeper-reconnect-btn" onClick={connect}>
            Retry
          </button>
        </div>
      )}

      {/* Status Grid */}
      {status && (
        <div className="keeper-stats-grid">
          <StatCard
            label="PCD Height"
            value={formatHeight(status.pcdHeight)}
            sublabel={`/ ${formatHeight(status.chainHeight)}`}
            status={syncStatus.status}
          />
          <StatCard
            label="Blocks Behind"
            value={status.blocksBehind}
            sublabel={syncStatus.label}
            status={syncStatus.status}
          />
          <StatCard
            label="Pending Stamps"
            value={status.pendingTachystamps}
            sublabel={status.currentEpoch ? `Epoch ${status.currentEpoch}` : undefined}
          />
          <StatCard
            label="Total Syncs"
            value={status.totalSyncs}
            sublabel={`${status.totalTachystampsSubmitted} stamps sent`}
          />
        </div>
      )}

      {/* Config Info */}
      {config && (
        <div className="keeper-config-info">
          <span className="keeper-config-label">Strategy:</span>
          <span className="keeper-config-value">{config.epochStrategy}</span>
          <span className="keeper-config-divider">•</span>
          <span className="keeper-config-label">Poll:</span>
          <span className="keeper-config-value">{config.pollIntervalSecs}s</span>
          <span className="keeper-config-divider">•</span>
          <span className="keeper-config-label">Auto-submit:</span>
          <span className="keeper-config-value">
            {config.autoSubmitTachystamps ? 'Yes' : 'No'}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="keeper-actions">
        <button
          className="keeper-action-btn primary"
          onClick={handleSyncClick}
          disabled={!isConnected}
        >
          Force Sync
        </button>
        <button
          className="keeper-action-btn"
          onClick={isConnected ? disconnect : connect}
        >
          {isConnected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      {/* Event Log */}
      {showEventLog && (
        <div className="keeper-event-log">
          <div className="keeper-event-log-header">
            <span className="keeper-event-log-title">Event Log</span>
            <div className="keeper-event-log-actions">
              {events.length > maxEventsDisplay && (
                <button
                  className="keeper-event-log-toggle"
                  onClick={() => setExpandedEvents(!expandedEvents)}
                >
                  {expandedEvents ? 'Collapse' : `Show all (${events.length})`}
                </button>
              )}
              <button className="keeper-event-log-clear" onClick={clearEvents}>
                Clear
              </button>
            </div>
          </div>
          <div className="keeper-event-list">
            {displayedEvents.length === 0 ? (
              <div className="keeper-event-empty">No events yet</div>
            ) : (
              displayedEvents.map((event, i) => (
                <EventItem key={`${event.timestamp}-${i}`} event={event} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default KeeperStatusPanel;

