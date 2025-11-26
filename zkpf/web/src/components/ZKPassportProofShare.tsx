// Proof Sharing UI Component
// Shows after successful verification with options to share the proof

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import QRCode from 'react-qr-code';
import type { ShareableProofBundle } from '../utils/shareable-proof';
import {
  createShareableUrl,
  saveProofToStorage,
  formatProofAsJson,
  generateProofSummary,
  isProofExpired,
} from '../utils/shareable-proof';

interface Props {
  proofBundle: ShareableProofBundle;
  onClose?: () => void;
}

export function ZKPassportProofShare({ proofBundle, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [shareMode, setShareMode] = useState<'link' | 'qr' | 'json'>('link');
  const [useShortUrl, setUseShortUrl] = useState(true);
  const savedToStorageRef = useRef(false);
  
  const summary = useMemo(() => generateProofSummary(proofBundle), [proofBundle]);
  const expired = useMemo(() => isProofExpired(proofBundle), [proofBundle]);
  
  // Full URL (proof encoded in URL) - computed without side effects
  const fullShareUrl = useMemo(() => createShareableUrl(proofBundle), [proofBundle]);
  
  // Short URL base (proof ID in URL, requires storage)
  const shortShareUrl = useMemo(() => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    return `${base}/zkpassport/verify/shared?id=${proofBundle.proofId}`;
  }, [proofBundle.proofId]);
  
  // Save to storage only once when using short URL (side effect in useEffect)
  useEffect(() => {
    if (useShortUrl && !savedToStorageRef.current) {
      saveProofToStorage(proofBundle);
      savedToStorageRef.current = true;
    }
  }, [useShortUrl, proofBundle]);
  
  const shareUrl = useShortUrl ? shortShareUrl : fullShareUrl;

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [shareUrl]);

  const handleDownloadJson = useCallback(() => {
    const json = formatProofAsJson(proofBundle);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zkpassport-proof-${proofBundle.proofId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [proofBundle]);

  const handleCopyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatProofAsJson(proofBundle));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [proofBundle]);

  return (
    <div className="proof-share-container">
      <div className="proof-share-header">
        <div className="proof-share-title">
          <span className="proof-share-icon">🔗</span>
          <h3>Share Your Proof</h3>
        </div>
        {onClose && (
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {/* Verification Summary */}
      <div className="proof-summary-card">
        <div className="proof-summary-badge">
          {summary.verified && !expired ? (
            <span className="badge badge-success">✓ Verified</span>
          ) : expired ? (
            <span className="badge badge-warning">⚠ Expired</span>
          ) : (
            <span className="badge badge-error">✗ Invalid</span>
          )}
        </div>
        <div className="proof-summary-info">
          <p className="proof-policy-label">{summary.policyLabel}</p>
          <p className="proof-timestamp">
            Verified on {new Date(summary.timestamp).toLocaleString()}
          </p>
          {summary.expiresAt && (
            <p className={`proof-expiry ${expired ? 'expired' : ''}`}>
              {expired ? 'Expired' : 'Expires'}: {new Date(summary.expiresAt).toLocaleString()}
            </p>
          )}
        </div>

        {/* Checks Summary */}
        {summary.checks.length > 0 && (
          <div className="proof-checks">
            <p className="proof-checks-label">Verified Checks:</p>
            <ul className="proof-checks-list">
              {summary.checks.map((check, i) => (
                <li key={i} className={check.passed ? 'check-passed' : 'check-failed'}>
                  {check.passed ? '✓' : '✗'} {check.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Disclosed Data */}
        {summary.disclosedData && Object.keys(summary.disclosedData).length > 0 && (
          <div className="proof-disclosed">
            <p className="proof-disclosed-label">Disclosed Information:</p>
            <dl className="proof-disclosed-list">
              {Object.entries(summary.disclosedData).map(([key, value]) => (
                <div key={key} className="disclosed-item">
                  <dt>{formatFieldName(key)}</dt>
                  <dd>{formatFieldValue(key, value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {/* Share Mode Tabs */}
      <div className="share-mode-tabs">
        <button
          className={`share-tab ${shareMode === 'link' ? 'active' : ''}`}
          onClick={() => setShareMode('link')}
        >
          📋 Link
        </button>
        <button
          className={`share-tab ${shareMode === 'qr' ? 'active' : ''}`}
          onClick={() => setShareMode('qr')}
        >
          📱 QR Code
        </button>
        <button
          className={`share-tab ${shareMode === 'json' ? 'active' : ''}`}
          onClick={() => setShareMode('json')}
        >
          📄 JSON
        </button>
      </div>

      {/* Share Content */}
      <div className="share-content">
        {shareMode === 'link' && (
          <div className="share-link-section">
            <div className="url-type-toggle">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={useShortUrl}
                  onChange={(e) => setUseShortUrl(e.target.checked)}
                />
                <span>Use short URL</span>
              </label>
              <span className="url-hint">
                {useShortUrl 
                  ? 'Stored locally, works on this device' 
                  : 'Full proof in URL, works anywhere'}
              </span>
            </div>
            
            <div className="share-url-container">
              <input 
                type="text" 
                readOnly 
                value={shareUrl}
                className="share-url-input"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button 
                className={`copy-button ${copied ? 'copied' : ''}`}
                onClick={handleCopyLink}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>

            <p className="share-instructions">
              Share this link with anyone who needs to verify your proof. They can paste it into the 
              verification tool or visit it directly.
            </p>
          </div>
        )}

        {shareMode === 'qr' && (
          <div className="share-qr-section">
            <div className="qr-code-wrapper">
              <QRCode value={shareUrl} size={220} level="M" />
            </div>
            <p className="qr-instructions">
              Scan this QR code to verify the proof on another device.
            </p>
            <button className="secondary-button" onClick={handleCopyLink}>
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
        )}

        {shareMode === 'json' && (
          <div className="share-json-section">
            <div className="json-preview">
              <pre>{formatProofAsJson(proofBundle).substring(0, 500)}...</pre>
            </div>
            <div className="json-actions">
              <button className="primary-button" onClick={handleDownloadJson}>
                ⬇ Download JSON
              </button>
              <button className="secondary-button" onClick={handleCopyJson}>
                {copied ? '✓ Copied!' : 'Copy JSON'}
              </button>
            </div>
            <p className="json-instructions">
              Download or copy the full proof bundle for programmatic verification or backup.
            </p>
          </div>
        )}
      </div>

      {/* Proof ID Footer */}
      <div className="proof-id-footer">
        <span className="proof-id-label">Proof ID:</span>
        <code className="proof-id-value">{proofBundle.proofId}</code>
      </div>
    </div>
  );
}

// Helper functions
function formatFieldName(key: string): string {
  return key
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatFieldValue(key: string, value: any): string {
  if (key === 'birthdate' && value) {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return String(value);
    }
  }
  return String(value);
}

