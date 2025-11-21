import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, ZkpfClient } from '../api/zkpf';
import type { PolicyDefinition, ProofBundle, VerifyResponse } from '../types/zkpf';
import { publicInputsToBytes } from '../utils/bytes';
import { parseProofBundle } from '../utils/parse';
import { BundleSummary } from './BundleSummary';
import type { AssetRail } from '../types/ui';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error';
type FlowStepStatus = 'pending' | 'active' | 'complete' | 'error';

interface FlowStep {
  id: string;
  title: string;
  description: string;
  status: FlowStepStatus;
  detail?: string;
  action?: ReactNode;
}

type VerificationMode = 'bundle' | 'raw';

interface Props {
  client: ZkpfClient;
  connectionState: ConnectionState;
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

const assetRailCopy: Record<
  AssetRail,
  {
    label: string;
    description: string;
    checklist: string[];
    endpointDetail: string;
  }
> = {
  onchain: {
    label: 'On-chain wallets',
    description:
      'Aggregate balances from cold + hot wallets, smart contracts, or L2 rollups. The verifier only sees the threshold-aligned commitments.',
    checklist: [
      'Use custody pipes to export Merkle roots / nullifiers per scope.',
      'Keep wallet inventory private—only commitments land in the bundle.',
    ],
    endpointDetail: 'Proof sourced from digital asset custody accounts.',
  },
  fiat: {
    label: 'Fiat / bank balances',
    description:
      'Mirror fiat settlement accounts (banks, trust companies, money market funds) by encoding account attestations inside the bundle.',
    checklist: [
      'Convert statements to witness data before exporting the bundle.',
      'Reference ISO currency + custodian IDs to map to policy requirements.',
    ],
    endpointDetail: 'Proof sourced from fiat banking rails.',
  },
};

export function ProofWorkbench({ client, connectionState }: Props) {
  const textareaId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rawInput, setRawInput] = useState('');
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<VerificationMode>('bundle');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResponse, setVerifyResponse] = useState<VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [assetRail, setAssetRail] = useState<AssetRail>('onchain');

  const policiesQuery = useQuery({
    queryKey: ['policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const policies = useMemo(() => policiesQuery.data ?? [], [policiesQuery.data]);
  const policiesError = policiesQuery.error
    ? (policiesQuery.error as Error).message ?? 'Unable to load policies'
    : undefined;

  useEffect(() => {
    if (!policies.length) {
      setSelectedPolicyId(null);
      return;
    }
    if (!selectedPolicyId || !policies.some((policy) => policy.policy_id === selectedPolicyId)) {
      setSelectedPolicyId(policies[0].policy_id);
    }
  }, [policies, selectedPolicyId]);

  const selectedPolicy = selectedPolicyId
    ? policies.find((policy) => policy.policy_id === selectedPolicyId) ?? null
    : null;
  const policyWarnings =
    bundle && selectedPolicy ? computePolicyMismatches(selectedPolicy, bundle) : [];

  const handleRawInput = useCallback((value: string) => {
    setRawInput(value);
    setVerifyResponse(null);
    setVerifyError(null);
    if (!value.trim()) {
      setBundle(null);
      setParseError(null);
      return;
    }
    try {
      const parsed = parseProofBundle(value);
      setBundle(parsed);
      setParseError(null);
    } catch (err) {
      setBundle(null);
      setParseError((err as Error).message);
    }
  }, []);

  const handleLoadSample = useCallback(async () => {
    try {
      const response = await fetch('/sample-bundle.json');
      if (!response.ok) {
        throw new Error(`Sample bundle request failed (${response.status})`);
      }
      const text = await response.text();
      handleRawInput(text);
      showToast('Loaded sample bundle', 'success');
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error';
      setParseError(`Unable to load sample bundle: ${message}`);
      showToast('Failed to load sample bundle', 'error');
    }
  }, [handleRawInput]);

  const handleFileUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
      setParseError('Please upload a JSON file');
      return;
    }
    
    try {
      const text = await file.text();
      handleRawInput(text);
      showToast(`Loaded ${file.name}`, 'success');
    } catch (err) {
      setParseError(`Failed to read file: ${(err as Error).message}`);
    }
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleVerify = async () => {
    if (!bundle) return;
    if (!selectedPolicyId) {
      setVerifyError('Select a policy before verifying');
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyResponse(null);
    try {
      const response =
        mode === 'bundle'
          ? await client.verifyBundle(selectedPolicyId, bundle)
          : await client.verifyProof({
              circuit_version: bundle.circuit_version,
              proof: bundle.proof,
              public_inputs: publicInputsToBytes(bundle.public_inputs),
              policy_id: selectedPolicyId,
            });
      setVerifyResponse(response);
    } catch (err) {
      setVerifyError((err as ApiError).message);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClear = () => {
    setRawInput('');
    setBundle(null);
    setParseError(null);
    setVerifyResponse(null);
    setVerifyError(null);
  };

  const selectedRail = assetRailCopy[assetRail];

  const flowSteps = useMemo<FlowStep[]>(() => {
    const connectionStep: FlowStep = {
      id: 'connect',
      title: 'Connect to verifier',
      description:
        connectionState === 'connected'
          ? 'Connected to backend'
          : connectionState === 'connecting'
            ? 'Establishing connection…'
            : connectionState === 'error'
              ? 'Unable to reach backend'
              : 'Ensure the verifier endpoint is reachable to get started.',
      status:
        connectionState === 'connected'
          ? 'complete'
          : connectionState === 'connecting'
            ? 'active'
            : connectionState === 'error'
              ? 'error'
              : 'pending',
      detail: client.baseUrl,
    };

    const policiesStep: FlowStep = {
      id: 'policies',
      title: 'Load verifier policies',
      description: policiesQuery.isLoading
        ? 'Requesting policy manifest…'
        : policiesError
          ? policiesError
          : policies.length
            ? `Loaded ${policies.length} policy${policies.length === 1 ? '' : 'ies'}`
            : 'No policies found. Update backend configuration.',
      status: policiesQuery.isLoading
        ? 'active'
        : policiesError
          ? 'error'
          : policies.length
            ? 'complete'
            : 'pending',
    };

    const bundleStep: FlowStep = {
      id: 'bundle',
      title: 'Prepare a proof bundle',
      description: parseError
        ? parseError
        : bundle
          ? `Circuit v${bundle.circuit_version} • Policy ${bundle.public_inputs.policy_id}`
          : rawInput
            ? 'Validating bundle…'
            : 'Paste JSON, upload a file, or load the sample bundle.',
      status: parseError ? 'error' : bundle ? 'complete' : rawInput ? 'active' : 'pending',
      action:
        !bundle && !parseError ? (
          <button type="button" className="tiny-button" onClick={handleLoadSample}>
            Load sample bundle
          </button>
        ) : undefined,
    };

    const verifyStep: FlowStep = {
      id: 'verify',
      title: 'Send to verifier',
      description: verifyError
        ? verifyError
        : verifyResponse
          ? verifyResponse.valid
            ? 'Proof accepted by backend'
            : verifyResponse.error ?? 'Proof rejected'
          : isVerifying
            ? 'Verifier is running…'
            : bundle
              ? 'Ready to submit once you pick a policy.'
              : 'Waiting for bundle.',
      detail:
        verifyResponse && !verifyResponse.valid && verifyResponse.error_code
          ? `Error code: ${verifyResponse.error_code}`
          : selectedRail.endpointDetail,
      status: isVerifying
        ? 'active'
        : verifyError || (verifyResponse && !verifyResponse.valid)
          ? 'error'
          : verifyResponse?.valid
            ? 'complete'
            : bundle
              ? 'pending'
              : 'pending',
    };

    return [connectionStep, policiesStep, bundleStep, verifyStep];
  }, [
    bundle,
    client.baseUrl,
    connectionState,
    handleLoadSample,
    isVerifying,
    parseError,
    policies.length,
    policiesError,
    policiesQuery.isLoading,
    rawInput,
    selectedRail.endpointDetail,
    verifyError,
    verifyResponse,
  ]);

  return (
    <section className="proof-workbench card">
      <header>
        <p className="eyebrow">Proof console</p>
        <h2>Submit a proof bundle</h2>
      </header>
      <p className="muted">
        Paste JSON emitted by the prover CLI (`zkpf-test-fixtures`, `zkpf-prover`, or your custody
        pipeline). The bundle is validated locally before hitting the verifier.
      </p>
      <FlowVisualizer steps={flowSteps} />
      <div className="input-grid">
        <label className="field" htmlFor={textareaId}>
          <span>Bundle JSON</span>
          <textarea
            id={textareaId}
            placeholder='{"circuit_version":3,"proof":[...],"public_inputs":{...}}'
            value={rawInput}
            onChange={(event) => handleRawInput(event.target.value)}
            spellCheck={false}
            className={parseError ? 'error-input' : ''}
          />
          {parseError && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              <span>{parseError}</span>
            </div>
          )}
        </label>
        <div 
          className={`upload-panel ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="upload-icon">📁</div>
          <p><strong>Drag & drop a JSON file here</strong></p>
          <p className="muted small">or</p>
          <label className="file-input-label">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={(event) => handleFileUpload(event.target.files)}
              className="file-input"
            />
            <span className="file-input-button">Choose file</span>
          </label>
          <p className="muted small">
            💡 Tip: Run <code>cargo test -p zkpf-test-fixtures</code> to generate a test bundle
          </p>
          {rawInput && (
            <div className="actions">
              <button type="button" className="ghost" onClick={handleClear}>
                Clear input
              </button>
            </div>
          )}
        </div>
      </div>
      {bundle && !parseError && (
        <>
          <div className="mode-switch">
            <label>
              <input
                type="radio"
                name="verification-mode"
                value="bundle"
                checked={mode === 'bundle'}
                onChange={() => setMode('bundle')}
              />
              <span>POST /zkpf/verify-bundle</span>
            </label>
            <label>
              <input
                type="radio"
                name="verification-mode"
                value="raw"
                checked={mode === 'raw'}
                onChange={() => setMode('raw')}
              />
              <span>POST /zkpf/verify</span>
            </label>
          </div>
          <div className="asset-rail-panel">
            <div className="asset-rail-switch">
              <label>
                <input
                  type="radio"
                  name="asset-rail"
                  value="onchain"
                  checked={assetRail === 'onchain'}
                  onChange={() => setAssetRail('onchain')}
                />
                <span>On-chain proof</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="asset-rail"
                  value="fiat"
                  checked={assetRail === 'fiat'}
                  onChange={() => setAssetRail('fiat')}
                />
                <span>Fiat proof</span>
              </label>
            </div>
            <div className="asset-rail-body">
              <p className="asset-rail-label">{selectedRail.label}</p>
              <p className="asset-rail-description">{selectedRail.description}</p>
              <ul className="asset-rail-checklist">
                {selectedRail.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="policy-panel">
            <label className="field">
              <span>Select Policy</span>
              {policiesQuery.isLoading ? (
                <div className="policy-loading">
                  <span className="spinner small"></span>
                  <span>Loading policies…</span>
                </div>
              ) : (
                <select
                  value={selectedPolicyId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedPolicyId(value ? Number(value) : null);
                  }}
                  disabled={!policies.length}
                >
                  {!policies.length ? (
                    <option value="">No policies available</option>
                  ) : (
                    policies.map((policy) => (
                      <option key={policy.policy_id} value={policy.policy_id}>
                        Policy #{policy.policy_id} • Scope {policy.verifier_scope_id} • Threshold {policy.threshold_raw.toLocaleString()}
                      </option>
                    ))
                  )}
                </select>
              )}
            </label>
            {selectedPolicy && (
              <>
                <div className="policy-details-header">
                  <h4>Policy Details</h4>
                </div>
                <dl className="policy-details">
                  <div>
                    <dt>Threshold</dt>
                    <dd>{selectedPolicy.threshold_raw.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Currency Code</dt>
                    <dd>{selectedPolicy.required_currency_code}</dd>
                  </div>
                  <div>
                    <dt>Custodian ID</dt>
                    <dd>{selectedPolicy.required_custodian_id}</dd>
                  </div>
                  <div>
                    <dt>Scope ID</dt>
                    <dd>{selectedPolicy.verifier_scope_id}</dd>
                  </div>
                </dl>
              </>
            )}
            {policiesError && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                <span>{policiesError}</span>
              </div>
            )}
            {!policies.length && !policiesQuery.isLoading && !policiesError && (
              <div className="warning">
                <strong>No policies available.</strong> Configure the verifier first by updating the policies configuration.
              </div>
            )}
            {policyWarnings.length > 0 && (
              <div className="warning">
                <strong>Policy mismatch detected:</strong> Bundle public inputs disagree with this policy for: <strong>{policyWarnings.join(', ')}</strong>.
              </div>
            )}
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || !selectedPolicyId || policiesQuery.isLoading}
              className="verify-button"
            >
              {isVerifying ? (
                <>
                  <span className="spinner"></span>
                  <span>Verifying…</span>
                </>
              ) : (
                <>
                  <span>✓</span>
                  <span>Send to verifier</span>
                </>
              )}
            </button>
          </div>
          {verifyResponse && (
            <VerificationBanner response={verifyResponse} endpoint={mode} assetRail={assetRail} />
          )}
          {verifyError && <p className="error">{verifyError}</p>}
          <BundleSummary bundle={bundle} assetRail={assetRail} />
        </>
      )}
    </section>
  );
}

function FlowVisualizer({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flow-visualizer">
      {steps.map((step, index) => (
        <div key={step.id} className={`flow-step ${step.status}`}>
          <div className="flow-step-header">
            <div className="flow-step-icon">
              {step.status === 'complete' && '✓'}
              {step.status === 'error' && '⚠'}
              {step.status === 'active' && <span className="spinner tiny"></span>}
              {step.status === 'pending' && '•'}
            </div>
            <div>
              <p className="flow-step-title">{step.title}</p>
              <p className="flow-step-description">{step.description}</p>
              {step.detail && <p className="flow-step-detail">{step.detail}</p>}
            </div>
          </div>
          {step.action && <div className="flow-step-action">{step.action}</div>}
          {index < steps.length - 1 && <div className="flow-connector" aria-hidden />}
        </div>
      ))}
    </div>
  );
}

function VerificationBanner({
  response,
  endpoint,
  assetRail,
}: {
  response: VerifyResponse;
  endpoint: VerificationMode;
  assetRail: AssetRail;
}) {
  const intent = response.valid ? 'success' : 'error';
  return (
    <div className={`verification-banner ${intent}`}>
      <div className="verification-content">
        <div className="verification-icon">
          {response.valid ? '✓' : '✗'}
        </div>
        <div>
          <h3>{response.valid ? 'Proof accepted' : 'Proof rejected'}</h3>
          <p className="muted small">
            {endpoint === 'bundle' ? '/zkpf/verify-bundle' : '/zkpf/verify'} • Circuit version{' '}
            {response.circuit_version} • {assetRail === 'onchain' ? 'On-chain rail' : 'Fiat rail'}
          </p>
        </div>
      </div>
      {!response.valid && response.error && (
        <div className="verification-error">
          <strong>Error:</strong> <span className="mono">{response.error}</span>
          {response.error_code && (
            <span className="error-code">Code: {response.error_code}</span>
          )}
        </div>
      )}
    </div>
  );
}

function computePolicyMismatches(policy: PolicyDefinition, bundle: ProofBundle): string[] {
  const inputs = bundle.public_inputs;
  const mismatches: string[] = [];
  if (inputs.threshold_raw !== policy.threshold_raw) mismatches.push('threshold_raw');
  if (inputs.required_currency_code !== policy.required_currency_code)
    mismatches.push('required_currency_code');
  if (inputs.required_custodian_id !== policy.required_custodian_id)
    mismatches.push('required_custodian_id');
  if (inputs.verifier_scope_id !== policy.verifier_scope_id) mismatches.push('verifier_scope_id');
  if (inputs.policy_id !== policy.policy_id) mismatches.push('policy_id');
  return mismatches;
}

