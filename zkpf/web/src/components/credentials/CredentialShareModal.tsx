/**
 * CredentialShareModal - Share a credential with counterparties
 */

import React, { useState, useCallback, useEffect } from 'react';
import type { Credential } from './CredentialCard';

interface CredentialShareModalProps {
  credential: Credential;
  onClose: () => void;
}

type ShareMethod = 'link' | 'json' | 'download';

export const CredentialShareModal: React.FC<CredentialShareModalProps> = ({
  credential,
  onClose,
}) => {
  const [shareMethod, setShareMethod] = useState<ShareMethod>('link');
  const [copied, setCopied] = useState(false);
  const [shareLink, setShareLink] = useState('');

  useEffect(() => {
    // Generate a shareable link with the credential data
    const baseUrl = window.location.origin;
    const credentialData = {
      id: credential.id,
      chain: credential.chain,
      provenValue: credential.provenValue,
      currency: credential.currency,
      threshold: credential.threshold,
      thresholdType: credential.thresholdType,
      policyId: credential.policyId,
      scopeId: credential.scopeId,
      proofHash: credential.proofHash,
      createdAt: credential.createdAt,
      expiresAt: credential.expiresAt,
    };
    const encodedCredential = btoa(JSON.stringify(credentialData));
    setShareLink(`${baseUrl}/credentials?verify=${encodedCredential}`);
  }, [credential]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [shareLink]);

  const handleCopyJson = useCallback(async () => {
    try {
      const jsonString = JSON.stringify(credential, null, 2);
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [credential]);

  const handleDownloadJson = useCallback(() => {
    const jsonString = JSON.stringify(credential, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credential-${credential.chain}-${credential.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [credential]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        
        <div className="share-modal-header">
          <h2>Share Credential</h2>
          <p className="muted">
            Share this proof-of-funds credential with your counterparty
          </p>
        </div>

        {/* Credential Summary */}
        <div className="share-credential-summary">
          <div className="summary-chain">
            <span className="chain-icon">{credential.chainIcon}</span>
            <span>{credential.chain}</span>
          </div>
          <div className="summary-value">
            {credential.thresholdType === 'gte' ? '≥ ' : ''}
            {credential.provenValue.toLocaleString()} {credential.currency}
          </div>
          <div className="summary-expiry">
            Expires: {new Date(credential.expiresAt).toLocaleDateString()}
          </div>
        </div>

        {/* Share Method Tabs */}
        <div className="share-method-tabs">
          <button
            className={`share-tab ${shareMethod === 'link' ? 'active' : ''}`}
            onClick={() => setShareMethod('link')}
          >
            🔗 Verification Link
          </button>
          <button
            className={`share-tab ${shareMethod === 'json' ? 'active' : ''}`}
            onClick={() => setShareMethod('json')}
          >
            📋 Copy JSON
          </button>
          <button
            className={`share-tab ${shareMethod === 'download' ? 'active' : ''}`}
            onClick={() => setShareMethod('download')}
          >
            📥 Download
          </button>
        </div>

        {/* Share Method Content */}
        <div className="share-method-content">
          {shareMethod === 'link' && (
            <div className="share-link">
              <p className="method-description">
                Share this link with your counterparty. They can verify the credential instantly.
              </p>
              <div className="link-input-group">
                <input
                  type="text"
                  value={shareLink}
                  readOnly
                  className="link-input"
                />
                <button 
                  className="copy-button"
                  onClick={handleCopyLink}
                >
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
              <p className="link-note muted small">
                The link contains the credential data for verification.
              </p>
            </div>
          )}

          {shareMethod === 'json' && (
            <div className="share-json">
              <p className="method-description">
                Copy the credential JSON for manual verification or integration.
              </p>
              <pre className="json-preview">
                {JSON.stringify(credential, null, 2).slice(0, 600)}
                {JSON.stringify(credential, null, 2).length > 600 ? '\n...' : ''}
              </pre>
              <button className="primary-button" onClick={handleCopyJson}>
                {copied ? '✓ Copied!' : '📋 Copy Full JSON'}
              </button>
            </div>
          )}

          {shareMethod === 'download' && (
            <div className="share-download">
              <p className="method-description">
                Download the credential as a JSON file for archival or sharing.
              </p>
              <div className="download-preview">
                <div className="download-file-icon">📄</div>
                <div className="download-file-info">
                  <span className="download-filename">
                    credential-{credential.chain}-{credential.id.slice(0, 8)}.json
                  </span>
                  <span className="download-filesize">
                    ~{(JSON.stringify(credential).length / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
              <button className="primary-button" onClick={handleDownloadJson}>
                📥 Download JSON File
              </button>
            </div>
          )}
        </div>

        {/* Security Note */}
        <div className="share-security-note">
          <span className="security-icon">🔒</span>
          <p>
            <strong>Privacy preserved:</strong> The credential only proves your balance meets the threshold. 
            Your actual balance, wallet addresses, and transaction history remain private.
          </p>
        </div>
      </div>
    </div>
  );
};

export default CredentialShareModal;
