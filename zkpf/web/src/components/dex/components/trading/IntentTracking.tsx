/**
 * NEAR Intent Tracking Component
 * 
 * Displays active NEAR Intents and their status for cross-chain swaps.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNear } from '../../context/NearContext';
import './IntentTracking.css';

interface Intent {
  id: string;
  sourceToken: string;
  targetToken: string;
  sourceAmount: string;
  targetAmount: string;
  status: 'pending' | 'matching' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  resolverContract?: string;
  txHash?: string;
}

export function IntentTracking() {
  const { isConnected, accountId } = useNear();
  const [intents, setIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(false);

  // Load intents from localStorage (in production, this would query the resolver contract)
  useEffect(() => {
    if (!isConnected || !accountId) {
      setIntents([]);
      return;
    }

    const loadIntents = () => {
      try {
        const stored = localStorage.getItem(`near_intents_${accountId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setIntents(parsed.filter((i: Intent) => 
            ['pending', 'matching', 'executing'].includes(i.status)
          ));
        }
      } catch (err) {
        console.error('Failed to load intents:', err);
      }
    };

    loadIntents();
    const interval = setInterval(loadIntents, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [isConnected, accountId]);

  const getStatusIcon = (status: Intent['status']) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'matching': return '🔍';
      case 'executing': return '⚡';
      case 'completed': return '✅';
      case 'failed': return '❌';
    }
  };

  const getStatusColor = (status: Intent['status']) => {
    switch (status) {
      case 'pending':
      case 'matching': return 'status-pending';
      case 'executing': return 'status-executing';
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
    }
  };

  if (!isConnected) {
    return (
      <div className="intent-tracking-empty">
        <span className="empty-icon">◈</span>
        <p>Connect your NEAR wallet to track intents</p>
      </div>
    );
  }

  if (intents.length === 0) {
    return (
      <div className="intent-tracking-empty">
        <span className="empty-icon">📋</span>
        <p>No active intents</p>
        <p className="empty-hint">Create a swap intent in the Swap & Deposit tab</p>
      </div>
    );
  }

  return (
    <div className="intent-tracking">
      <div className="intent-tracking-header">
        <h3 className="intent-tracking-title">
          <span className="title-icon">📋</span>
          Active Intents
        </h3>
        <span className="intent-count">{intents.length}</span>
      </div>

      <div className="intent-list">
        {intents.map((intent) => (
          <div key={intent.id} className={`intent-card ${getStatusColor(intent.status)}`}>
            <div className="intent-header">
              <span className="intent-id">{intent.id.slice(0, 16)}...</span>
              <span className={`intent-status ${getStatusColor(intent.status)}`}>
                {getStatusIcon(intent.status)} {intent.status}
              </span>
            </div>

            <div className="intent-swap">
              <div className="swap-from">
                <span className="amount">{intent.sourceAmount}</span>
                <span className="token">{intent.sourceToken}</span>
              </div>
              <span className="swap-arrow">→</span>
              <div className="swap-to">
                <span className="amount">{intent.targetAmount}</span>
                <span className="token">{intent.targetToken}</span>
              </div>
            </div>

            {intent.resolverContract && (
              <div className="intent-resolver">
                <span className="resolver-label">Resolver:</span>
                <span className="resolver-name">{intent.resolverContract}</span>
              </div>
            )}

            <div className="intent-footer">
              <span className="intent-time">
                Created {new Date(intent.createdAt).toLocaleString()}
              </span>
              {intent.txHash && (
                <a
                  href={`https://nearblocks.io/txns/${intent.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="intent-tx-link"
                >
                  View Tx →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

