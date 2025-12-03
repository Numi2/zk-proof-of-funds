import React from 'react';
import { usePersonhoodVerification } from '../../hooks/usePersonhoodVerification';
import './PersonhoodBadge.css';

export function PersonhoodBadge() {
  const { isVerified, verificationLevel } = usePersonhoodVerification();

  if (!isVerified) {
    return null;
  }

  return (
    <div className="dex-personhood-badge">
      <span className="dex-personhood-icon">✓</span>
      <div className="dex-personhood-info">
        <span className="dex-personhood-label">Verified</span>
        {verificationLevel && (
          <span className="dex-personhood-level">{verificationLevel}</span>
        )}
      </div>
    </div>
  );
}

