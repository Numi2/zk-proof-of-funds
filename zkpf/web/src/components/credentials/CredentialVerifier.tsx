/**
 * CredentialVerifier - Verify real proof-of-funds credentials
 * 
 * Uses the actual ZKPF verification API to cryptographically
 * verify proof bundles.
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { ZkpfClient, detectDefaultBase } from '../../api/zkpf';
import type { ProofBundle, VerifyResponse, ByteArray } from '../../types/zkpf';
import { parseProofBundle } from '../../utils/parse';
import { getCurrencyMeta } from '../../utils/policy';

interface VerificationResult {
  valid: boolean;
  chain: string;
  chainIcon: string;
  provenValue: number;
  currency: string;
  currencyCode: number;
  threshold: number;
  thresholdType: 'gte' | 'exact';
  policyId: number;
  scopeId: number;
  currentEpoch: number;
  circuitVersion: number;
  railId?: string;
  nullifier?: string;
  error?: string;
  errorCode?: string;
}

export interface CredentialVerifierProps {
  /** Pre-filled credential JSON from shared link */
  prefillJson?: string | null;
}

/**
 * Convert a ByteArray (number[]) to a hex string
 */
function byteArrayToHex(bytes: ByteArray | string | undefined): string | undefined {
  if (!bytes) return undefined;
  if (typeof bytes === 'string') return bytes;
  if (Array.isArray(bytes)) {
    return '0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return undefined;
}

export const CredentialVerifier: React.FC<CredentialVerifierProps> = ({ prefillJson }) => {
  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
  const [credentialJson, setCredentialJson] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bundle, setBundle] = useState<ProofBundle | null>(null);

  const client = useMemo(() => new ZkpfClient(detectDefaultBase()), []);

  const handleInputChange = useCallback((value: string) => {
    setCredentialJson(value);
    setResult(null);
    setParseError(null);
    setVerifyError(null);
    setBundle(null);

    if (!value.trim()) return;

    try {
      const parsed = parseProofBundle(value);
      setBundle(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON format');
    }
  }, []);

  // Handle prefilled JSON from shared link
  useEffect(() => {
    if (prefillJson) {
      handleInputChange(prefillJson);
    }
  }, [prefillJson, handleInputChange]);

  const handleVerify = useCallback(async () => {
    if (!bundle) {
      setVerifyError('Please enter a valid proof bundle');
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);
    setResult(null);

    try {
      // Call the real verification API
      const response: VerifyResponse = await client.verifyBundle(
        bundle.public_inputs.policy_id,
        bundle
      );

      // Get currency metadata
      const currencyMeta = getCurrencyMeta(bundle.public_inputs.required_currency_code);
      const divisor = currencyMeta.decimals > 0 ? 10 ** currencyMeta.decimals : 1;
      const thresholdValue = bundle.public_inputs.threshold_raw / divisor;

      // Determine chain from rail_id
      let chain = 'unknown';
      let chainIcon = '🔗';
      if (bundle.rail_id?.includes('ORCHARD') || bundle.rail_id?.includes('ZCASH')) {
        chain = 'zcash';
        chainIcon = '🛡️';
      } else if (bundle.rail_id?.includes('MINA')) {
        chain = 'mina';
        chainIcon = '∞';
      } else if (bundle.rail_id?.includes('STARK')) {
        chain = 'starknet';
        chainIcon = '⬡';
      } else if (bundle.rail_id?.includes('NEAR')) {
        chain = 'near';
        chainIcon = '◈';
      }

      // Convert nullifier from ByteArray to hex string
      const nullifierHex = byteArrayToHex(bundle.public_inputs.nullifier);

      const verificationResult: VerificationResult = {
        valid: response.valid,
        chain,
        chainIcon,
        provenValue: thresholdValue,
        currency: currencyMeta.code,
        currencyCode: bundle.public_inputs.required_currency_code,
        threshold: thresholdValue,
        thresholdType: 'gte',
        policyId: bundle.public_inputs.policy_id,
        scopeId: bundle.public_inputs.verifier_scope_id,
        currentEpoch: bundle.public_inputs.current_epoch,
        circuitVersion: bundle.circuit_version,
        railId: bundle.rail_id,
        nullifier: nullifierHex,
        error: response.error ?? undefined,
        errorCode: response.error_code ?? undefined,
      };

      setResult(verificationResult);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification request failed');
    } finally {
      setIsVerifying(false);
    }
  }, [bundle, client]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file && (file.type === 'application/json' || file.name.endsWith('.json'))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        handleInputChange(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  }, [handleInputChange]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        handleInputChange(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  }, [handleInputChange]);

  const handleClear = useCallback(() => {
    setCredentialJson('');
    setResult(null);
    setParseError(null);
    setVerifyError(null);
    setBundle(null);
  }, []);

  // Bundle preview info
  const bundlePreview = useMemo(() => {
    if (!bundle) return null;
    const currencyMeta = getCurrencyMeta(bundle.public_inputs.required_currency_code);
    const divisor = currencyMeta.decimals > 0 ? 10 ** currencyMeta.decimals : 1;
    return {
      circuitVersion: bundle.circuit_version,
      policyId: bundle.public_inputs.policy_id,
      threshold: (bundle.public_inputs.threshold_raw / divisor).toLocaleString(),
      currency: currencyMeta.code,
      railId: bundle.rail_id || 'Default',
      epoch: bundle.public_inputs.current_epoch,
    };
  }, [bundle]);

  return (
    <div className="credential-verifier">
      <div className="verifier-header">
        <h3>Verify a Credential</h3>
        <p className="verifier-description">
          Cryptographically verify any proof-of-funds credential. 
          The proof is validated against the on-chain verifier.
        </p>
      </div>

      {/* Prefill Notice */}
      {prefillJson && bundle && (
        <div className="prefill-notice">
          <span className="prefill-icon">🔗</span>
          <span>Credential loaded from shared link. Click verify to check it.</span>
        </div>
      )}

      {/* Input Mode Tabs */}
      <div className="verifier-mode-tabs">
        <button
          className={`mode-tab ${inputMode === 'paste' ? 'active' : ''}`}
          onClick={() => setInputMode('paste')}
        >
          <span>📋</span> Paste JSON
        </button>
        <button
          className={`mode-tab ${inputMode === 'upload' ? 'active' : ''}`}
          onClick={() => setInputMode('upload')}
        >
          <span>📁</span> Upload File
        </button>
      </div>

      {/* Input Area */}
      <div className="verifier-input-area">
        {inputMode === 'paste' && (
          <div className="paste-input">
            <textarea
              value={credentialJson}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder='{"circuit_version": 3, "proof": [...], "public_inputs": {...}}'
              className={`credential-textarea ${parseError ? 'error' : ''}`}
              spellCheck={false}
            />
            <div className="paste-actions">
              {credentialJson && (
                <button className="text-button" onClick={handleClear}>
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {inputMode === 'upload' && (
          <div 
            className={`upload-drop-zone ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="drop-zone-content">
              <span className="drop-zone-icon">📁</span>
              <p><strong>Drop proof bundle file here</strong></p>
              <p className="muted">or</p>
              <label className="file-input-label">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="file-input-hidden"
                />
                <span className="file-input-button">Choose file</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Parse Error */}
      {parseError && (
        <div className="verifier-error">
          <span className="error-icon">⚠️</span>
          <span>Parse error: {parseError}</span>
        </div>
      )}

      {/* Bundle Preview */}
      {bundle && bundlePreview && !parseError && (
        <div className="bundle-preview">
          <h4>Bundle Detected</h4>
          <div className="preview-grid">
            <div className="preview-item">
              <span className="preview-label">Circuit</span>
              <span className="preview-value">v{bundlePreview.circuitVersion}</span>
            </div>
            <div className="preview-item">
              <span className="preview-label">Policy ID</span>
              <span className="preview-value">{bundlePreview.policyId}</span>
            </div>
            <div className="preview-item">
              <span className="preview-label">Threshold</span>
              <span className="preview-value">≥ {bundlePreview.threshold} {bundlePreview.currency}</span>
            </div>
            <div className="preview-item">
              <span className="preview-label">Rail</span>
              <span className="preview-value">{bundlePreview.railId}</span>
            </div>
          </div>
        </div>
      )}

      {/* Verify Error */}
      {verifyError && (
        <div className="verifier-error">
          <span className="error-icon">⚠️</span>
          <span>{verifyError}</span>
        </div>
      )}

      {/* Verify Button */}
      <button
        className="verify-button primary-button"
        onClick={handleVerify}
        disabled={!bundle || isVerifying}
      >
        {isVerifying ? (
          <>
            <span className="spinner"></span>
            Verifying...
          </>
        ) : (
          <>
            <span>✓</span>
            Verify Proof
          </>
        )}
      </button>

      {/* Result Display */}
      {result && (
        <div className={`verification-result ${result.valid ? 'valid' : 'invalid'}`}>
          <div className="result-header">
            <span className="result-icon">{result.valid ? '✓' : '✗'}</span>
            <div>
              <h4>{result.valid ? 'Proof Verified ✓' : 'Verification Failed'}</h4>
              {result.error && <p className="result-error">{result.error}</p>}
              {result.errorCode && <p className="result-error-code">Code: {result.errorCode}</p>}
            </div>
          </div>

          <div className="result-details">
            <div className="result-chain">
              <span className="chain-icon">{result.chainIcon}</span>
              <span className="chain-name">{result.chain}</span>
              {result.railId && <span className="rail-badge">{result.railId}</span>}
            </div>

            <div className="result-grid">
              <div className="result-item">
                <span className="result-label">Proven Value</span>
                <span className="result-value highlight">
                  ≥ {result.provenValue.toLocaleString()} {result.currency}
                </span>
              </div>
              <div className="result-item">
                <span className="result-label">Policy ID</span>
                <span className="result-value">{result.policyId}</span>
              </div>
              <div className="result-item">
                <span className="result-label">Scope ID</span>
                <span className="result-value">{result.scopeId}</span>
              </div>
              <div className="result-item">
                <span className="result-label">Circuit Version</span>
                <span className="result-value">v{result.circuitVersion}</span>
              </div>
              <div className="result-item">
                <span className="result-label">Epoch</span>
                <span className="result-value">{result.currentEpoch}</span>
              </div>
              {result.nullifier && (
                <div className="result-item result-item-full">
                  <span className="result-label">Nullifier</span>
                  <code className="result-value mono">
                    {result.nullifier.slice(0, 16)}...{result.nullifier.slice(-8)}
                  </code>
                </div>
              )}
            </div>

            {result.valid && (
              <div className="result-actions">
                <button 
                  className="secondary-button"
                  onClick={() => {
                    const blob = new Blob([credentialJson], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `verified-proof-${result.policyId}-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  📥 Download Verified Proof
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trust Info */}
      <div className="verifier-trust-info">
        <h4>🔐 Verification Process</h4>
        <ul>
          <li>Zero-knowledge proof is cryptographically verified by the backend</li>
          <li>Policy compliance is checked against the registered policy</li>
          <li>Nullifier prevents double-use of the same proof</li>
          <li>Public inputs are validated for consistency</li>
        </ul>
      </div>
    </div>
  );
};

export default CredentialVerifier;
