/**
 * Bound Identity Verifier Component
 * 
 * Verifies and displays bound identity proofs that tie ZKPassport identity
 * to ZKPF funds proofs via cryptographic binding.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import type { 
  BoundIdentityProof, 
  BoundIdentityVerificationResult,
} from '../types/bound-identity';
import { 
  verifyBoundIdentityProof, 
  decodeBoundIdentityProof,
  loadBoundIdentityProofs,
  deleteBoundIdentityProof,
} from '../utils/bound-identity';
import { getCurrencyMeta } from '../utils/policy';

// ============================================================================
// Types
// ============================================================================

interface Props {
  /** Pre-loaded proof to verify */
  initialProof?: BoundIdentityProof | null;
  /** Callback when verification completes */
  onVerificationComplete?: (result: BoundIdentityVerificationResult) => void;
}

type VerifyStep = 'input' | 'verifying' | 'result' | 'history';

// ============================================================================
// Helper Components
// ============================================================================

function VerificationBadge({ 
  passed, 
  label, 
  details 
}: { 
  passed: boolean; 
  label: string; 
  details?: string;
}) {
  return (
    <div className={`verification-badge ${passed ? 'passed' : 'failed'}`}>
      <span className="badge-icon">{passed ? '✓' : '✗'}</span>
      <div className="badge-content">
        <span className="badge-label">{label}</span>
        {details && <span className="badge-details">{details}</span>}
      </div>
    </div>
  );
}

function ProofDetailRow({ 
  label, 
  value, 
  mono = false 
}: { 
  label: string; 
  value: React.ReactNode; 
  mono?: boolean;
}) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className={`detail-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

// ============================================================================
// Component
// ============================================================================

export function BoundIdentityVerifier({
  initialProof,
  onVerificationComplete,
}: Props) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // State
  const [step, setStep] = useState<VerifyStep>('input');
  const [proof, setProof] = useState<BoundIdentityProof | null>(initialProof ?? null);
  const [result, setResult] = useState<BoundIdentityVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_isVerifying, setIsVerifying] = useState(false);
  const [inputText, setInputText] = useState('');
  const [savedProofs, setSavedProofs] = useState<BoundIdentityProof[]>([]);
  
  // Load saved proofs on mount
  useEffect(() => {
    setSavedProofs(loadBoundIdentityProofs());
  }, []);
  
  // Check for proof in URL on mount
  useEffect(() => {
    const encodedProof = searchParams.get('proof');
    if (encodedProof && !proof) {
      try {
        const decoded = decodeBoundIdentityProof(encodedProof);
        setProof(decoded);
        // Auto-verify when loaded from URL
        verifyProof(decoded);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid proof in URL');
      }
    }
  }, [searchParams, proof]);
  
  // Auto-verify initial proof
  useEffect(() => {
    if (initialProof && !result) {
      verifyProof(initialProof);
    }
  }, [initialProof]);
  
  // Verify the proof
  const verifyProof = useCallback(async (proofToVerify: BoundIdentityProof) => {
    setIsVerifying(true);
    setError(null);
    setStep('verifying');
    
    try {
      // Small delay for animation
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const verificationResult = await verifyBoundIdentityProof(proofToVerify, {
        verifyIdentitySdk: false, // SDK verification not available in browser
        verifyFundsBackend: false, // Would need backend endpoint
      });
      
      setResult(verificationResult);
      setStep('result');
      onVerificationComplete?.(verificationResult);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setStep('input');
    } finally {
      setIsVerifying(false);
    }
  }, [onVerificationComplete]);
  
  // Handle file upload
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content) as BoundIdentityProof;
        
        // Validate structure
        if (!parsed.bondId || !parsed.holderBinding || !parsed.identity || !parsed.funds) {
          throw new Error('Invalid bound identity proof structure');
        }
        
        setProof(parsed);
        verifyProof(parsed);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse proof file');
      }
    };
    reader.readAsText(file);
  }, [verifyProof]);
  
  // Handle text input
  const handleTextSubmit = useCallback(() => {
    if (!inputText.trim()) {
      setError('Please enter a proof');
      return;
    }
    
    try {
      // Try parsing as JSON first
      let parsed: BoundIdentityProof;
      try {
        parsed = JSON.parse(inputText) as BoundIdentityProof;
      } catch {
        // Try decoding as base64url
        parsed = decodeBoundIdentityProof(inputText);
      }
      
      // Validate structure
      if (!parsed.bondId || !parsed.holderBinding || !parsed.identity || !parsed.funds) {
        throw new Error('Invalid bound identity proof structure');
      }
      
      setProof(parsed);
      verifyProof(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse proof');
    }
  }, [inputText, verifyProof]);
  
  // Delete a saved proof
  const handleDeleteProof = useCallback((bondId: string) => {
    deleteBoundIdentityProof(bondId);
    setSavedProofs(prev => prev.filter(p => p.bondId !== bondId));
  }, []);
  
  // Verify a saved proof
  const handleVerifySavedProof = useCallback((savedProof: BoundIdentityProof) => {
    setProof(savedProof);
    verifyProof(savedProof);
  }, [verifyProof]);
  
  // Format timestamp
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };
  
  // Format expiry
  const formatExpiry = (validUntil: number) => {
    const now = Math.floor(Date.now() / 1000);
    const remaining = validUntil - now;
    
    if (remaining <= 0) {
      return 'Expired';
    }
    
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    
    if (days > 0) {
      return `${days}d ${hours}h remaining`;
    }
    return `${hours}h remaining`;
  };
  
  // Overall status
  const overallStatus = useMemo(() => {
    if (!result) return 'unknown';
    if (result.valid) return 'valid';
    if (result.expired) return 'expired';
    return 'invalid';
  }, [result]);
  
  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case 'input':
        return (
          <div className="verifier-input-section">
            <div className="input-options">
              <div className="input-option">
                <div className="option-header">
                  <span className="option-icon">📁</span>
                  <div>
                    <strong>Upload Proof File</strong>
                    <p className="muted small">Upload a bound identity proof JSON file</p>
                  </div>
                </div>
                <label className="upload-button">
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  Choose File
                </label>
              </div>
              
              <div className="option-divider">
                <span>or</span>
              </div>
              
              <div className="input-option">
                <div className="option-header">
                  <span className="option-icon">📋</span>
                  <div>
                    <strong>Paste Proof Data</strong>
                    <p className="muted small">Paste JSON or encoded proof string</p>
                  </div>
                </div>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder='{"bondId": "...", "holderBinding": {...}, ...}'
                  rows={6}
                  className="proof-input-textarea"
                />
                <button
                  type="button"
                  className="verify-button"
                  onClick={handleTextSubmit}
                  disabled={!inputText.trim()}
                >
                  Verify Proof
                </button>
              </div>
            </div>
            
            {error && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                <span>{error}</span>
              </div>
            )}
            
            {savedProofs.length > 0 && (
              <div className="saved-proofs-section">
                <button
                  type="button"
                  className="ghost view-history-button"
                  onClick={() => setStep('history')}
                >
                  📜 View {savedProofs.length} saved proof{savedProofs.length !== 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        );
        
      case 'verifying':
        return (
          <div className="verifying-section">
            <div className="verifying-animation">
              <div className="verify-ring">
                <div className="verify-ring-inner"></div>
              </div>
              <div className="verify-icon">🔍</div>
            </div>
            <h3>Verifying Bound Identity Proof</h3>
            <p className="muted">Checking cryptographic binding and proof validity...</p>
            
            <div className="verification-steps">
              <div className="verification-step-item active">
                <span className="spinner tiny"></span>
                <span>Verifying identity proof structure</span>
              </div>
              <div className="verification-step-item">
                <span className="step-dot">○</span>
                <span>Verifying funds proof structure</span>
              </div>
              <div className="verification-step-item">
                <span className="step-dot">○</span>
                <span>Checking holder binding</span>
              </div>
              <div className="verification-step-item">
                <span className="step-dot">○</span>
                <span>Validating expiration</span>
              </div>
            </div>
          </div>
        );
        
      case 'result':
        return (
          <div className="verification-result-section">
            {/* Overall Status Banner */}
            <div className={`status-banner ${overallStatus}`}>
              <div className="status-icon">
                {overallStatus === 'valid' && '✓'}
                {overallStatus === 'expired' && '⏰'}
                {overallStatus === 'invalid' && '✗'}
                {overallStatus === 'unknown' && '?'}
              </div>
              <div className="status-content">
                <h3>
                  {overallStatus === 'valid' && 'Proof Valid'}
                  {overallStatus === 'expired' && 'Proof Expired'}
                  {overallStatus === 'invalid' && 'Proof Invalid'}
                  {overallStatus === 'unknown' && 'Unknown Status'}
                </h3>
                <p>
                  {overallStatus === 'valid' && 'The identity-funds bond is cryptographically valid and unexpired.'}
                  {overallStatus === 'expired' && 'The proof was valid but has passed its expiration date.'}
                  {overallStatus === 'invalid' && 'One or more verification checks failed.'}
                </p>
              </div>
            </div>
            
            {/* Verification Details */}
            {result && (
              <div className="verification-details">
                <h4>Verification Checks</h4>
                
                <div className="verification-badges">
                  <VerificationBadge
                    passed={result.identityVerified}
                    label="Identity Verified"
                    details={result.details.identity.sdkVerified ? 'Proofs valid' : 'Check failed'}
                  />
                  <VerificationBadge
                    passed={result.fundsVerified}
                    label="Funds Verified"
                    details={result.details.funds.thresholdMet ? 'Threshold met' : 'Check failed'}
                  />
                  <VerificationBadge
                    passed={result.bindingVerified}
                    label="Binding Valid"
                    details={result.details.binding.commitmentValid ? 'Commitment matches' : 'Check failed'}
                  />
                  <VerificationBadge
                    passed={!result.expired}
                    label="Not Expired"
                    details={proof ? formatExpiry(proof.metadata.validUntil) : ''}
                  />
                </div>
                
                {/* Detailed Breakdown */}
                <div className="verification-breakdown">
                  <div className="breakdown-section">
                    <h5>Identity Check Details</h5>
                    <div className="breakdown-items">
                      <div className={`breakdown-item ${result.details.identity.queryResultsPassed ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.identity.queryResultsPassed ? '✓' : '✗'}</span>
                        <span>Query results present</span>
                      </div>
                      <div className={`breakdown-item ${result.details.identity.sdkVerified ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.identity.sdkVerified ? '✓' : '✗'}</span>
                        <span>SDK verification passed</span>
                      </div>
                      <div className={`breakdown-item ${result.details.identity.disclosuresValid ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.identity.disclosuresValid ? '✓' : '✗'}</span>
                        <span>Disclosures valid</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="breakdown-section">
                    <h5>Funds Check Details</h5>
                    <div className="breakdown-items">
                      <div className={`breakdown-item ${result.details.funds.proofValid ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.funds.proofValid ? '✓' : '✗'}</span>
                        <span>Proof structure valid</span>
                      </div>
                      <div className={`breakdown-item ${result.details.funds.thresholdMet ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.funds.thresholdMet ? '✓' : '✗'}</span>
                        <span>Threshold requirement met</span>
                      </div>
                      <div className={`breakdown-item ${result.details.funds.railMatched ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.funds.railMatched ? '✓' : '✗'}</span>
                        <span>Rail type matched</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="breakdown-section">
                    <h5>Binding Check Details</h5>
                    <div className="breakdown-items">
                      <div className={`breakdown-item ${result.details.binding.commitmentValid ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.binding.commitmentValid ? '✓' : '✗'}</span>
                        <span>Commitment valid</span>
                      </div>
                      <div className={`breakdown-item ${result.details.binding.nullifierUnused ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.binding.nullifierUnused ? '✓' : '✗'}</span>
                        <span>Nullifier unused</span>
                      </div>
                      <div className={`breakdown-item ${result.details.binding.scopeMatched ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.binding.scopeMatched ? '✓' : '✗'}</span>
                        <span>Scope matched</span>
                      </div>
                      <div className={`breakdown-item ${result.details.binding.epochValid ? 'passed' : 'failed'}`}>
                        <span className="check-icon">{result.details.binding.epochValid ? '✓' : '✗'}</span>
                        <span>Epoch valid</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Proof Information */}
            {proof && (
              <div className="proof-info-section">
                <h4>Proof Information</h4>
                
                <div className="info-cards">
                  <div className="info-card">
                    <div className="info-card-header">
                      <span className="info-card-icon">🆔</span>
                      <strong>Bond Details</strong>
                    </div>
                    <div className="info-card-content">
                      <ProofDetailRow label="Bond ID" value={proof.bondId} mono />
                      <ProofDetailRow label="Created" value={formatDate(proof.timestamp)} />
                      <ProofDetailRow label="Valid Until" value={formatDate(proof.metadata.validUntil * 1000)} />
                      <ProofDetailRow label="Purpose" value={proof.metadata.purpose} />
                      <ProofDetailRow label="Scope" value={proof.metadata.scope} mono />
                      {proof.metadata.devMode && (
                        <ProofDetailRow label="Mode" value={<span className="dev-badge">DEV MODE</span>} />
                      )}
                    </div>
                  </div>
                  
                  <div className="info-card">
                    <div className="info-card-header">
                      <span className="info-card-icon">👤</span>
                      <strong>Identity</strong>
                    </div>
                    <div className="info-card-content">
                      {proof.identity.uniqueIdentifier && (
                        <ProofDetailRow 
                          label="Unique ID" 
                          value={`${proof.identity.uniqueIdentifier.slice(0, 16)}...`} 
                          mono 
                        />
                      )}
                      {proof.identity.disclosures.ageVerified && (
                        <ProofDetailRow 
                          label="Age" 
                          value={`≥ ${proof.identity.disclosures.ageVerified.minimumAge}`} 
                        />
                      )}
                      {proof.identity.disclosures.nationality && (
                        <ProofDetailRow 
                          label="Nationality" 
                          value={proof.identity.disclosures.nationality} 
                        />
                      )}
                      {proof.identity.disclosures.passportValid && (
                        <ProofDetailRow 
                          label="Passport" 
                          value="Valid" 
                        />
                      )}
                      <ProofDetailRow 
                        label="Proofs" 
                        value={`${proof.identity.zkpassportProof.proofs.length} proof(s)`} 
                      />
                    </div>
                  </div>
                  
                  <div className="info-card">
                    <div className="info-card-header">
                      <span className="info-card-icon">$</span>
                      <strong>Funds</strong>
                    </div>
                    <div className="info-card-content">
                      <ProofDetailRow 
                        label="Policy ID" 
                        value={proof.funds.verifiedPolicy.policyId} 
                        mono 
                      />
                      <ProofDetailRow 
                        label="Threshold" 
                        value={`≥ ${(proof.funds.verifiedPolicy.thresholdRaw / 100_000_000).toLocaleString()} ${getCurrencyMeta(proof.funds.verifiedPolicy.currencyCode).code}`} 
                      />
                      <ProofDetailRow 
                        label="Rail" 
                        value={proof.funds.verifiedPolicy.rail} 
                      />
                      {proof.funds.snapshot && (
                        <ProofDetailRow 
                          label="Block Height" 
                          value={proof.funds.snapshot.blockHeight.toLocaleString()} 
                        />
                      )}
                    </div>
                  </div>
                  
                  <div className="info-card">
                    <div className="info-card-header">
                      <span className="info-card-icon">🔗</span>
                      <strong>Binding</strong>
                    </div>
                    <div className="info-card-content">
                      <ProofDetailRow 
                        label="Scope ID" 
                        value={proof.holderBinding.scopeId} 
                        mono 
                      />
                      <ProofDetailRow 
                        label="Epoch" 
                        value={proof.holderBinding.epoch} 
                        mono 
                      />
                      <ProofDetailRow 
                        label="Binding" 
                        value={`${proof.holderBinding.binding.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')}...`} 
                        mono 
                      />
                      <ProofDetailRow 
                        label="Nullifier" 
                        value={`${proof.holderBinding.nullifier.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')}...`} 
                        mono 
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Actions */}
            <div className="result-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setProof(null);
                  setResult(null);
                  setInputText('');
                  setStep('input');
                }}
              >
                Verify Another
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => navigate('/bound-identity')}
              >
                Create New Bond
              </button>
            </div>
          </div>
        );
        
      case 'history':
        return (
          <div className="history-section">
            <div className="history-header">
              <h3>Saved Bound Identity Proofs</h3>
              <button
                type="button"
                className="ghost small"
                onClick={() => setStep('input')}
              >
                ← Back
              </button>
            </div>
            
            {savedProofs.length === 0 ? (
              <div className="empty-history">
                <span className="empty-icon">📭</span>
                <p>No saved proofs found</p>
                <p className="muted small">Create a bound identity proof to save it here</p>
              </div>
            ) : (
              <div className="history-list">
                {savedProofs.map((savedProof) => (
                  <div key={savedProof.bondId} className="history-item">
                    <div className="history-item-header">
                      <span className="history-item-icon">🔗</span>
                      <div className="history-item-title">
                        <strong>{savedProof.metadata.purpose}</strong>
                        <span className="mono small">{savedProof.bondId}</span>
                      </div>
                      <div className="history-item-meta">
                        <span className={`expiry-badge ${Date.now() / 1000 > savedProof.metadata.validUntil ? 'expired' : ''}`}>
                          {formatExpiry(savedProof.metadata.validUntil)}
                        </span>
                      </div>
                    </div>
                    <div className="history-item-details">
                      <span>Created: {formatDate(savedProof.timestamp)}</span>
                      <span>Scope: {savedProof.metadata.scope}</span>
                    </div>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="tiny-button"
                        onClick={() => handleVerifySavedProof(savedProof)}
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        className="tiny-button ghost danger"
                        onClick={() => handleDeleteProof(savedProof.bondId)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
    }
  };
  
  return (
    <section className="bound-identity-verifier card">
      <header>
        <p className="eyebrow">Verification</p>
        <h2>Bound Identity Proof Verifier</h2>
      </header>
      
      <div className="verifier-intro">
        <p className="muted">
          Verify that a bound identity proof is valid—confirming the cryptographic bond 
          between identity and funds proofs, and checking expiration.
        </p>
      </div>
      
      {renderStepContent()}
      
      <style>{`
        .bound-identity-verifier {
          max-width: 900px;
        }
        
        .verifier-intro {
          margin-bottom: 1.5rem;
        }
        
        /* Input Section */
        .verifier-input-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        
        .input-options {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .input-option {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 1.25rem;
        }
        
        .option-header {
          display: flex;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        
        .option-icon {
          font-size: 1.5rem;
        }
        
        .option-divider {
          display: flex;
          align-items: center;
          gap: 1rem;
          color: var(--text-muted);
        }
        
        .option-divider::before,
        .option-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255, 255, 255, 0.08);
        }
        
        .upload-button {
          display: inline-block;
          padding: 0.5rem 1rem;
          background: var(--accent-primary);
          color: white;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          transition: opacity 0.2s;
        }
        
        .upload-button:hover {
          opacity: 0.9;
        }
        
        .proof-input-textarea {
          width: 100%;
          padding: 0.75rem;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: white;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.85rem;
          resize: vertical;
          margin-bottom: 0.75rem;
        }
        
        .proof-input-textarea:focus {
          outline: none;
          border-color: var(--accent-primary);
        }
        
        .verify-button {
          padding: 0.5rem 1.25rem;
          background: var(--accent-primary);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }
        
        .verify-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .saved-proofs-section {
          text-align: center;
        }
        
        .view-history-button {
          opacity: 0.8;
        }
        
        /* Verifying Animation */
        .verifying-section {
          text-align: center;
          padding: 2rem;
        }
        
        .verifying-animation {
          position: relative;
          width: 120px;
          height: 120px;
          margin: 0 auto 1.5rem;
        }
        
        .verify-ring {
          position: absolute;
          inset: 0;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top-color: var(--accent-primary);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        .verify-ring-inner {
          position: absolute;
          inset: 15px;
          border: 2px solid rgba(255, 255, 255, 0.05);
          border-top-color: var(--accent-secondary, #6366f1);
          border-radius: 50%;
          animation: spin 1.5s linear infinite reverse;
        }
        
        .verify-icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 2rem;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .verification-steps {
          text-align: left;
          max-width: 280px;
          margin: 1.5rem auto 0;
        }
        
        .verification-step-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0;
          color: rgba(255, 255, 255, 0.4);
        }
        
        .verification-step-item.active {
          color: white;
        }
        
        .step-dot {
          opacity: 0.4;
        }
        
        /* Result Section */
        .verification-result-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        
        .status-banner {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.25rem;
          border-radius: 12px;
        }
        
        .status-banner.valid {
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05));
          border: 1px solid rgba(34, 197, 94, 0.3);
        }
        
        .status-banner.expired {
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(251, 191, 36, 0.05));
          border: 1px solid rgba(251, 191, 36, 0.3);
        }
        
        .status-banner.invalid {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05));
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .status-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: bold;
        }
        
        .status-banner.valid .status-icon {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }
        
        .status-banner.expired .status-icon {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
        }
        
        .status-banner.invalid .status-icon {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }
        
        .status-content h3 {
          margin: 0;
          font-size: 1.25rem;
        }
        
        .status-content p {
          margin: 0.25rem 0 0;
          opacity: 0.8;
        }
        
        /* Verification Badges */
        .verification-badges {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 0.75rem;
        }
        
        .verification-badge {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.75rem 1rem;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        .verification-badge.passed {
          border-color: rgba(34, 197, 94, 0.3);
        }
        
        .verification-badge.failed {
          border-color: rgba(239, 68, 68, 0.3);
        }
        
        .badge-icon {
          font-size: 1.25rem;
        }
        
        .verification-badge.passed .badge-icon {
          color: #22c55e;
        }
        
        .verification-badge.failed .badge-icon {
          color: #ef4444;
        }
        
        .badge-content {
          display: flex;
          flex-direction: column;
        }
        
        .badge-label {
          font-weight: 500;
          font-size: 0.9rem;
        }
        
        .badge-details {
          font-size: 0.75rem;
          opacity: 0.6;
        }
        
        /* Breakdown */
        .verification-breakdown {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }
        
        .breakdown-section {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
          padding: 1rem;
        }
        
        .breakdown-section h5 {
          margin: 0 0 0.75rem;
          font-size: 0.85rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        
        .breakdown-items {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        
        .breakdown-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.85rem;
        }
        
        .breakdown-item.passed .check-icon {
          color: #22c55e;
        }
        
        .breakdown-item.failed .check-icon {
          color: #ef4444;
        }
        
        /* Info Cards */
        .proof-info-section h4 {
          margin-bottom: 1rem;
        }
        
        .info-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
        }
        
        .info-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          overflow: hidden;
        }
        
        .info-card-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        
        .info-card-icon {
          font-size: 1.25rem;
        }
        
        .info-card-content {
          padding: 0.75rem 1rem;
        }
        
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.35rem 0;
          font-size: 0.85rem;
        }
        
        .detail-label {
          color: var(--text-muted);
        }
        
        .detail-value.mono {
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.8rem;
        }
        
        .dev-badge {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          padding: 0.15rem 0.5rem;
          border-radius: 4px;
          font-size: 0.7rem;
          font-weight: 600;
        }
        
        /* Actions */
        .result-actions {
          display: flex;
          gap: 1rem;
          justify-content: center;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        
        /* History */
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }
        
        .history-header h3 {
          margin: 0;
        }
        
        .empty-history {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
        }
        
        .empty-icon {
          font-size: 3rem;
          display: block;
          margin-bottom: 1rem;
        }
        
        .history-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        
        .history-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 1rem;
        }
        
        .history-item-header {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
        }
        
        .history-item-icon {
          font-size: 1.5rem;
        }
        
        .history-item-title {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        
        .history-item-meta {
          flex-shrink: 0;
        }
        
        .expiry-badge {
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }
        
        .expiry-badge.expired {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }
        
        .history-item-details {
          display: flex;
          gap: 1rem;
          margin: 0.5rem 0 0.75rem 2.25rem;
          font-size: 0.8rem;
          color: var(--text-muted);
        }
        
        .history-item-actions {
          display: flex;
          gap: 0.5rem;
          margin-left: 2.25rem;
        }
        
        .tiny-button.danger {
          color: #ef4444;
        }
        
        .tiny-button.danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        /* Error message */
        .error-message {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 8px;
          color: #ef4444;
        }
      `}</style>
    </section>
  );
}

export default BoundIdentityVerifier;

