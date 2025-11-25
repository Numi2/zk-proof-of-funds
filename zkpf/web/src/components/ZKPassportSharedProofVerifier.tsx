// Shared Proof Verifier Component
// Allows users to verify proofs shared via link or JSON input

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ZKPassport } from '@zkpassport/sdk';
import type { ShareableProofBundle, ProofVerificationSummary } from '../utils/shareable-proof';
import {
  decodeShareableProof,
  parseProofFromSearchParams,
  generateProofSummary,
  isProofExpired,
  getStoredProofs,
} from '../utils/shareable-proof';

type VerificationStatus = 'idle' | 'loading' | 'verifying' | 'verified' | 'invalid' | 'expired' | 'error';

interface VerificationResult {
  status: VerificationStatus;
  bundle: ShareableProofBundle | null;
  summary: ProofVerificationSummary | null;
  sdkVerified: boolean | null;
  error: string | null;
}

export function ZKPassportSharedProofVerifier() {
  const [searchParams] = useSearchParams();
  const [inputMode, setInputMode] = useState<'url' | 'json' | 'stored'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [storedProofsRefreshKey, setStoredProofsRefreshKey] = useState(0);
  const [verificationResult, setVerificationResult] = useState<VerificationResult>({
    status: 'idle',
    bundle: null,
    summary: null,
    sdkVerified: null,
    error: null,
  });

  const zkPassport = useMemo(() => new ZKPassport('zkpf.dev'), []);
  
  // Refresh stored proofs when switching to stored tab or when refresh key changes
  const storedProofs = useMemo(
    () => Object.values(getStoredProofs()),
    [storedProofsRefreshKey]
  );
  
  // Refresh stored proofs when switching to stored tab
  useEffect(() => {
    if (inputMode === 'stored') {
      setStoredProofsRefreshKey(k => k + 1);
    }
  }, [inputMode]);

  // Check URL params on mount
  useEffect(() => {
    const bundle = parseProofFromSearchParams(searchParams);
    if (bundle) {
      verifyBundle(bundle);
    }
  }, [searchParams]);

  const verifyBundle = useCallback(async (bundle: ShareableProofBundle) => {
    setVerificationResult({
      status: 'verifying',
      bundle,
      summary: null,
      sdkVerified: null,
      error: null,
    });

    try {
      // Check expiry first
      if (isProofExpired(bundle)) {
        setVerificationResult({
          status: 'expired',
          bundle,
          summary: generateProofSummary(bundle),
          sdkVerified: false,
          error: 'This proof has expired based on the policy validity period.',
        });
        return;
      }

      // Generate summary from query result
      const summary = generateProofSummary(bundle);

      // Verify with ZKPassport SDK
      let sdkVerified = false;
      try {
        const result = await zkPassport.verify({
          proofs: bundle.proofs,
          queryResult: bundle.queryResult,
          scope: bundle.policy.scope,
          devMode: bundle.policy.devMode,
          validity: bundle.policy.validity,
        });
        sdkVerified = result.verified === true;
      } catch (sdkError) {
        console.warn('SDK verification failed:', sdkError);
        // Continue with local verification if SDK fails
      }

      // Determine overall status
      // A proof is valid if:
      // 1. All policy checks passed (and there are checks to verify)
      // 2. There are proofs present
      // 3. SDK verification succeeded (when available) OR we accept local-only verification in dev mode
      // Note: empty checks array should NOT be considered valid - it indicates incomplete/malformed query results
      const hasChecks = summary.checks.length > 0;
      const allChecksPassed = hasChecks && summary.checks.every(c => c.passed);
      const hasProofs = bundle.proofs.length > 0;
      const acceptLocalOnly = bundle.policy.devMode === true;
      const isValid = allChecksPassed && hasProofs && (sdkVerified || acceptLocalOnly);

      setVerificationResult({
        status: isValid ? 'verified' : 'invalid',
        bundle,
        summary,
        sdkVerified,
        error: isValid ? null : 'Proof verification failed - one or more checks did not pass.',
      });
    } catch (error) {
      setVerificationResult({
        status: 'error',
        bundle,
        summary: bundle ? generateProofSummary(bundle) : null,
        sdkVerified: false,
        error: error instanceof Error ? error.message : 'Failed to verify proof',
      });
    }
  }, [zkPassport]);

  const handleVerifyUrl = useCallback(() => {
    try {
      setVerificationResult(prev => ({ ...prev, status: 'loading', error: null }));
      
      // Try to extract proof from URL
      const url = new URL(urlInput);
      const proofParam = url.searchParams.get('proof');
      const idParam = url.searchParams.get('id');
      
      if (proofParam) {
        const bundle = decodeShareableProof(proofParam);
        verifyBundle(bundle);
      } else if (idParam) {
        const stored = getStoredProofs();
        const bundle = stored[idParam];
        if (bundle) {
          verifyBundle(bundle);
        } else {
          setVerificationResult({
            status: 'error',
            bundle: null,
            summary: null,
            sdkVerified: null,
            error: 'Proof not found. Short URLs only work on the device where the proof was generated.',
          });
        }
      } else {
        // Maybe the entire input is just the encoded proof
        const bundle = decodeShareableProof(urlInput);
        verifyBundle(bundle);
      }
    } catch (error) {
      setVerificationResult({
        status: 'error',
        bundle: null,
        summary: null,
        sdkVerified: null,
        error: error instanceof Error ? error.message : 'Invalid URL or proof data',
      });
    }
  }, [urlInput, verifyBundle]);

  const handleVerifyJson = useCallback(() => {
    try {
      setVerificationResult(prev => ({ ...prev, status: 'loading', error: null }));
      const bundle = JSON.parse(jsonInput) as ShareableProofBundle;
      
      // Basic validation
      if (!bundle.version || !bundle.proofId || !bundle.proofs || !bundle.queryResult) {
        throw new Error('Invalid proof bundle format');
      }
      
      verifyBundle(bundle);
    } catch (error) {
      setVerificationResult({
        status: 'error',
        bundle: null,
        summary: null,
        sdkVerified: null,
        error: error instanceof Error ? error.message : 'Invalid JSON format',
      });
    }
  }, [jsonInput, verifyBundle]);

  const handleSelectStored = useCallback((bundle: ShareableProofBundle) => {
    verifyBundle(bundle);
  }, [verifyBundle]);

  const resetVerification = useCallback(() => {
    setVerificationResult({
      status: 'idle',
      bundle: null,
      summary: null,
      sdkVerified: null,
      error: null,
    });
    setUrlInput('');
    setJsonInput('');
  }, []);

  const { status, bundle, summary, sdkVerified, error } = verificationResult;

  return (
    <div className="shared-proof-verifier">
      <section className="card">
        <header>
          <p className="eyebrow">Proof Verification</p>
          <h2>Verify a Shared Proof</h2>
          <p className="muted">
            Verify a ZKPassport proof that was shared with you. Paste the link, enter JSON, or select from stored proofs.
          </p>
        </header>
      </section>

      {/* Input Section - only show when not verified */}
      {status === 'idle' || status === 'error' || status === 'loading' ? (
        <section className="card">
          <header>
            <h3>Import Proof</h3>
          </header>

          {/* Input Mode Tabs */}
          <div className="input-mode-tabs">
            <button
              className={`input-tab ${inputMode === 'url' ? 'active' : ''}`}
              onClick={() => setInputMode('url')}
            >
              🔗 URL / Link
            </button>
            <button
              className={`input-tab ${inputMode === 'json' ? 'active' : ''}`}
              onClick={() => setInputMode('json')}
            >
              📄 JSON
            </button>
            <button
              className={`input-tab ${inputMode === 'stored' ? 'active' : ''}`}
              onClick={() => setInputMode('stored')}
            >
              💾 Stored ({storedProofs.length})
            </button>
          </div>

          {/* URL Input */}
          {inputMode === 'url' && (
            <div className="input-section">
              <div className="form-group">
                <label htmlFor="proof-url">Proof URL or Encoded Proof</label>
                <textarea
                  id="proof-url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste the shared proof link here..."
                  rows={3}
                  className="proof-input-textarea"
                />
              </div>
              <button
                className="primary-button"
                onClick={handleVerifyUrl}
                disabled={!urlInput.trim() || status === 'loading'}
              >
                {status === 'loading' ? 'Loading...' : 'Verify Proof'}
              </button>
            </div>
          )}

          {/* JSON Input */}
          {inputMode === 'json' && (
            <div className="input-section">
              <div className="form-group">
                <label htmlFor="proof-json">Proof Bundle JSON</label>
                <textarea
                  id="proof-json"
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder='{"version": 1, "proofId": "...", ...}'
                  rows={8}
                  className="proof-input-textarea mono"
                />
              </div>
              <div className="json-input-actions">
                <button
                  className="primary-button"
                  onClick={handleVerifyJson}
                  disabled={!jsonInput.trim() || status === 'loading'}
                >
                  {status === 'loading' ? 'Loading...' : 'Verify JSON'}
                </button>
                <label className="file-upload-label">
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          setJsonInput(ev.target?.result as string);
                        };
                        reader.readAsText(file);
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                  📁 Upload JSON File
                </label>
              </div>
            </div>
          )}

          {/* Stored Proofs */}
          {inputMode === 'stored' && (
            <div className="input-section">
              {storedProofs.length === 0 ? (
                <p className="muted">No stored proofs found on this device.</p>
              ) : (
                <div className="stored-proofs-list">
                  {storedProofs
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map((proof) => (
                      <div
                        key={proof.proofId}
                        className="stored-proof-item"
                        onClick={() => handleSelectStored(proof)}
                      >
                        <div className="stored-proof-info">
                          <span className="stored-proof-label">{proof.policy.label}</span>
                          <span className="stored-proof-time">
                            {new Date(proof.timestamp).toLocaleString()}
                          </span>
                        </div>
                        <div className="stored-proof-id">
                          <code>{proof.proofId}</code>
                        </div>
                        {isProofExpired(proof) && (
                          <span className="expired-tag">Expired</span>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && status === 'error' && (
            <div className="verification-error">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
            </div>
          )}
        </section>
      ) : null}

      {/* Verification Status */}
      {(status === 'verifying' || status === 'verified' || status === 'invalid' || status === 'expired') && (
        <section className="card verification-result-card">
          <header>
            <h3>Verification Result</h3>
          </header>

          {/* Status Banner */}
          <div className={`verification-banner status-${status}`}>
            {status === 'verifying' && (
              <>
                <span className="status-spinner">⏳</span>
                <span>Verifying proof...</span>
              </>
            )}
            {status === 'verified' && (
              <>
                <span className="status-icon">✓</span>
                <span>Proof Verified Successfully</span>
              </>
            )}
            {status === 'invalid' && (
              <>
                <span className="status-icon">✗</span>
                <span>Proof Invalid</span>
              </>
            )}
            {status === 'expired' && (
              <>
                <span className="status-icon">⚠</span>
                <span>Proof Expired</span>
              </>
            )}
          </div>

          {bundle && summary && (
            <>
              {/* Policy Information */}
              <div className="result-section">
                <h4>Policy</h4>
                <div className="policy-details">
                  <p className="policy-label">{bundle.policy.label}</p>
                  <p className="policy-purpose">{bundle.policy.purpose}</p>
                  {bundle.policy.devMode && (
                    <span className="dev-mode-badge">Dev Mode</span>
                  )}
                </div>
              </div>

              {/* Verification Checks */}
              {summary.checks.length > 0 && (
                <div className="result-section">
                  <h4>Verification Checks</h4>
                  <ul className="checks-list">
                    {summary.checks.map((check, i) => (
                      <li key={i} className={`check-item ${check.passed ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{check.passed ? '✓' : '✗'}</span>
                        <span className="check-name">{check.name}</span>
                        {check.details && (
                          <span className="check-details">{check.details}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Disclosed Information */}
              {summary.disclosedData && Object.keys(summary.disclosedData).length > 0 && (
                <div className="result-section">
                  <h4>Disclosed Information</h4>
                  <dl className="disclosed-data-list">
                    {Object.entries(summary.disclosedData).map(([key, value]) => (
                      <div key={key} className="disclosed-item">
                        <dt>{formatFieldName(key)}</dt>
                        <dd>{formatValue(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Proof Details */}
              <div className="result-section">
                <h4>Proof Details</h4>
                <dl className="proof-details-list">
                  <div className="detail-item">
                    <dt>Proof ID</dt>
                    <dd><code>{bundle.proofId}</code></dd>
                  </div>
                  <div className="detail-item">
                    <dt>Request ID</dt>
                    <dd><code>{bundle.requestId}</code></dd>
                  </div>
                  {bundle.uniqueIdentifier && (
                    <div className="detail-item">
                      <dt>Unique Identifier</dt>
                      <dd><code>{bundle.uniqueIdentifier}</code></dd>
                    </div>
                  )}
                  <div className="detail-item">
                    <dt>Generated</dt>
                    <dd>{new Date(bundle.timestamp).toLocaleString()}</dd>
                  </div>
                  {summary.expiresAt && (
                    <div className="detail-item">
                      <dt>{isProofExpired(bundle) ? 'Expired' : 'Expires'}</dt>
                      <dd className={isProofExpired(bundle) ? 'expired' : ''}>
                        {new Date(summary.expiresAt).toLocaleString()}
                      </dd>
                    </div>
                  )}
                  <div className="detail-item">
                    <dt>Proof Count</dt>
                    <dd>{bundle.proofs.length} proof(s)</dd>
                  </div>
                  {bundle.duration && (
                    <div className="detail-item">
                      <dt>Generation Time</dt>
                      <dd>{formatDuration(bundle.duration)}</dd>
                    </div>
                  )}
                  <div className="detail-item">
                    <dt>SDK Verification</dt>
                    <dd>
                      {sdkVerified === true ? (
                        <span className="sdk-verified">✓ Verified by SDK</span>
                      ) : sdkVerified === false ? (
                        <span className="sdk-not-verified">Local verification only</span>
                      ) : (
                        <span className="sdk-pending">Pending</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Raw Data Expandable */}
              <details className="raw-data-section">
                <summary>View Raw Proof Data</summary>
                <pre className="raw-data-pre">
                  {JSON.stringify(bundle, null, 2)}
                </pre>
              </details>
            </>
          )}

          {/* Error in verification */}
          {error && (
            <div className="verification-error">
              <span className="error-icon">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="result-actions">
            <button className="secondary-button" onClick={resetVerification}>
              Verify Another Proof
            </button>
          </div>
        </section>
      )}

      {/* Instructions */}
      <section className="card">
        <header>
          <h3>How It Works</h3>
        </header>
        <div className="instructions-grid">
          <div className="instruction-item">
            <span className="instruction-icon">1️⃣</span>
            <div>
              <h4>Receive a Proof</h4>
              <p>Get a proof link or JSON file from someone who completed ZKPassport verification.</p>
            </div>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">2️⃣</span>
            <div>
              <h4>Paste & Verify</h4>
              <p>Paste the link, enter the JSON, or upload the file to verify the proof.</p>
            </div>
          </div>
          <div className="instruction-item">
            <span className="instruction-icon">3️⃣</span>
            <div>
              <h4>Review Results</h4>
              <p>See what was verified, any disclosed information, and the proof validity.</p>
            </div>
          </div>
        </div>
      </section>
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

function formatValue(key: string, value: any): string {
  if (key === 'birthdate' && value) {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

