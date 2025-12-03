import React from 'react';
import { useZKPFCredit } from '../../context/ZKPFCreditContext';
import './CreditBadge.css';

export function CreditBadge() {
  const { creditInfo, isLoading } = useZKPFCredit();

  if (isLoading) {
    return (
      <div className="dex-credit-badge dex-credit-loading">
        <span className="dex-credit-icon">⏳</span>
        <span>Verifying...</span>
      </div>
    );
  }

  if (!creditInfo || !creditInfo.proofValid) {
    return null;
  }

  return (
    <div className="dex-credit-badge dex-credit-verified">
      <span className="dex-credit-icon">✓</span>
      <div className="dex-credit-info">
        <span className="dex-credit-tier">{creditInfo.tier}</span>
        <span className="dex-credit-amount">
          ${creditInfo.availableCredit.toLocaleString()} credit
        </span>
      </div>
    </div>
  );
}

