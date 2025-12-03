import React from 'react';
import { useConnectionHealth } from '../hooks/useConnectionHealth';
import './ConnectionStatus.css';

export function ConnectionStatus() {
  const { status, latency, reconnect } = useConnectionHealth();

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'var(--dex-profit)';
      case 'connecting':
        return 'var(--dex-warning, #f59e0b)';
      case 'disconnected':
        return 'var(--dex-loss)';
      default:
        return 'var(--dex-text-tertiary)';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return latency ? `Connected (${latency}ms)` : 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="dex-connection-status">
      <div
        className="dex-connection-dot"
        style={{ backgroundColor: getStatusColor() }}
      />
      <span className="dex-connection-text">{getStatusText()}</span>
      {status === 'disconnected' && (
        <button
          className="dex-reconnect-button"
          onClick={reconnect}
          title="Reconnect"
        >
          ↻
        </button>
      )}
    </div>
  );
}

