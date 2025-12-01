/**
 * CredentialCard - Display a single proof-of-funds credential
 * 
 * Displays real verified credentials with their chain origin,
 * proof details, and status.
 */

import React from 'react';

export interface Credential {
  id: string;
  chain: string;
  chainIcon: string;
  provenValue: number;
  currency: string;
  threshold: number;
  thresholdType: 'gte' | 'exact' | 'range';
  status: 'pending' | 'verified' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  policyId: number;
  scopeId: number;
  proofHash: string;
  nullifier?: string;
  attestationTxHash?: string;
  circuitVersion?: number;
  railId?: string;
  metadata?: {
    label?: string;
    counterparty?: string;
    purpose?: string;
  };
}

interface CredentialCardProps {
  credential: Credential;
  onShare: () => void;
  onRevoke: () => void;
  compact?: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  zcash: '#f4b728',
  mina: '#e6007a',
  starknet: '#29296e',
  near: '#00c08b',
  ethereum: '#627eea',
};

const STATUS_CONFIG = {
  pending: { icon: '⏳', label: 'Pending', color: '#f59e0b' },
  verified: { icon: '✓', label: 'Verified', color: '#22c55e' },
  expired: { icon: '⏰', label: 'Expired', color: '#6b7280' },
  revoked: { icon: '✗', label: 'Revoked', color: '#ef4444' },
};

export const CredentialCard: React.FC<CredentialCardProps> = ({
  credential,
  onShare,
  onRevoke,
  compact = false,
}) => {
  const chainColor = CHAIN_COLORS[credential.chain] ?? '#666';
  const statusConfig = STATUS_CONFIG[credential.status];
  
  const isActive = credential.status === 'verified';
  const expiresIn = getExpiresIn(credential.expiresAt);

  if (compact) {
    return (
      <div 
        className="credential-card credential-card-compact"
        style={{ '--chain-color': chainColor } as React.CSSProperties}
      >
        <div className="credential-compact-header">
          <span className="credential-chain-icon">{credential.chainIcon}</span>
          <span className="credential-value">
            {formatValue(credential.provenValue)} {credential.currency}
          </span>
          <span 
            className={`credential-status credential-status-${credential.status}`}
            style={{ color: statusConfig.color }}
          >
            {statusConfig.icon}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`credential-card credential-card-${credential.status}`}
      style={{ '--chain-color': chainColor } as React.CSSProperties}
    >
      {/* Header */}
      <div className="credential-header">
        <div className="credential-chain">
          <span className="credential-chain-icon">{credential.chainIcon}</span>
          <span className="credential-chain-name">{credential.chain}</span>
        </div>
        <div 
          className={`credential-status-badge credential-status-${credential.status}`}
          style={{ backgroundColor: statusConfig.color }}
        >
          <span>{statusConfig.icon}</span>
          <span>{statusConfig.label}</span>
        </div>
      </div>

      {/* Value */}
      <div className="credential-value-section">
        <div className="credential-proven-label">Proven Balance</div>
        <div className="credential-proven-value">
          {credential.thresholdType === 'gte' && '≥ '}
          {formatValue(credential.provenValue)} 
          <span className="credential-currency">{credential.currency}</span>
        </div>
        {credential.threshold > 0 && (
          <div className="credential-threshold">
            Threshold: {formatValue(credential.threshold)} {credential.currency}
          </div>
        )}
      </div>

      {/* Metadata */}
      {credential.metadata?.label && (
        <div className="credential-label">
          <span className="label-icon">🏷️</span>
          {credential.metadata.label}
        </div>
      )}

      {/* Details Grid */}
      <div className="credential-details">
        <div className="credential-detail">
          <span className="detail-label">Policy ID</span>
          <span className="detail-value">{credential.policyId}</span>
        </div>
        <div className="credential-detail">
          <span className="detail-label">Scope</span>
          <span className="detail-value">{credential.scopeId}</span>
        </div>
        <div className="credential-detail">
          <span className="detail-label">Created</span>
          <span className="detail-value">{formatDate(credential.createdAt)}</span>
        </div>
        <div className="credential-detail">
          <span className="detail-label">Expires</span>
          <span className={`detail-value ${expiresIn.urgent ? 'urgent' : ''}`}>
            {expiresIn.label}
          </span>
        </div>
      </div>

      {/* Proof Hash */}
      <div className="credential-proof-hash">
        <span className="hash-label">Proof Hash</span>
        <code className="hash-value">
          {credential.proofHash.slice(0, 12)}...{credential.proofHash.slice(-8)}
        </code>
      </div>

      {/* On-chain attestation */}
      {credential.attestationTxHash && (
        <div className="credential-attestation">
          <span className="attestation-icon">⛓️</span>
          <span className="attestation-label">On-chain attestation</span>
          <code className="attestation-tx">
            {credential.attestationTxHash.slice(0, 10)}...
          </code>
        </div>
      )}

      {/* Actions */}
      <div className="credential-actions">
        {isActive && (
          <>
            <button className="credential-action-btn primary" onClick={onShare}>
              <span>↗</span> Share
            </button>
            <button className="credential-action-btn secondary" onClick={onRevoke}>
              Revoke
            </button>
          </>
        )}
        {credential.status === 'expired' && (
          <button className="credential-action-btn primary">
            <span>↻</span> Renew
          </button>
        )}
      </div>
    </div>
  );
};

function formatValue(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getExpiresIn(expiresAt: string): { label: string; urgent: boolean } {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();
  
  if (diffMs < 0) {
    return { label: 'Expired', urgent: true };
  }
  
  const diffHours = diffMs / (1000 * 60 * 60);
  const diffDays = diffHours / 24;
  
  if (diffHours < 24) {
    return { label: `${Math.ceil(diffHours)}h`, urgent: true };
  }
  if (diffDays < 7) {
    return { label: `${Math.ceil(diffDays)}d`, urgent: diffDays < 3 };
  }
  
  return { label: formatDate(expiresAt), urgent: false };
}

export default CredentialCard;

