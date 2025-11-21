import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, ZkpfClient } from '../api/zkpf';
import type { AttestResponse, ProofBundle, VerifyResponse } from '../types/zkpf';
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
  prefillBundle?: string | null;
  onPrefillConsumed?: () => void;
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
  orchard: {
    label: 'Zcash Orchard (shielded)',
    description:
      'Non-custodial proof-of-funds over the Zcash Orchard shielded pool. Anchors, Merkle paths, and UFVK ownership are enforced in the inner Orchard circuit.',
    checklist: [
      'Bundle UFVK + Orchard notes into an Orchard proof-of-funds rail (ZCASH_ORCHARD).',
      'Snapshot height and Orchard anchor must match your wallet / lightwalletd view.',
      'Holder binding ties the UFVK to policy/scope/epoch without exposing raw keys.',
    ],
    endpointDetail: 'Proof sourced from Zcash Orchard shielded funds.',
  },
};

export function ProofWorkbench({ client, connectionState, prefillBundle, onPrefillConsumed }: Props) {
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
  const [holderId, setHolderId] = useState('');
  const [snapshotId, setSnapshotId] = useState('');
  const [attestLoading, setAttestLoading] = useState(false);
  const [attestError, setAttestError] = useState<string | null>(null);
  const [attestResult, setAttestResult] = useState<AttestResponse | null>(null);

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
      return;
    }
  }, [policies, selectedPolicyId]);

  // Whenever the selected policy changes, clear any previous verifier result so we
  // don't show a stale "Proof accepted" banner for an earlier policy choice.
  useEffect(() => {
    setVerifyResponse(null);
    setVerifyError(null);
  }, [selectedPolicyId]);

  const handleRawInput = useCallback(
    (value: string) => {
      setRawInput(value);
      setVerifyResponse(null);
      setVerifyError(null);
      setAttestResult(null);
      setAttestError(null);
      if (!value.trim()) {
        setBundle(null);
        setParseError(null);
        setHolderId('');
        setSnapshotId('');
        return;
      }
      try {
        const parsed = parseProofBundle(value);
        setBundle(parsed);
        // Auto-select Orchard rail context when the bundle declares it explicitly.
        if (parsed.rail_id === 'ZCASH_ORCHARD') {
          setAssetRail('orchard');
        }
        setParseError(null);
      } catch (err) {
        setBundle(null);
        setParseError((err as Error).message);
      }
    },
    [setAssetRail],
  );

  useEffect(() => {
    if (!prefillBundle) return;
    handleRawInput(prefillBundle);
    onPrefillConsumed?.();
  }, [prefillBundle, handleRawInput, onPrefillConsumed]);

  const selectedPolicy = selectedPolicyId
    ? policies.find((policy) => policy.policy_id === selectedPolicyId) ?? null
    : null;

  // Default snapshot identifier for custodial proofs derived from the bundle epoch.
  useEffect(() => {
    if (!bundle) {
      setSnapshotId('');
      setAttestResult(null);
      return;
    }
    if (!snapshotId) {
      const epoch = bundle.public_inputs.current_epoch;
      setSnapshotId(`custodial-epoch-${epoch}`);
    }
  }, [bundle, snapshotId]);

  // If a bundle is loaded and it declares a policy_id that exists in the currently
  // loaded policies, auto-align the selection to that policy to reduce confusion.
  useEffect(() => {
    if (!bundle || !policies.length) return;
    const bundlePolicyId = bundle.public_inputs.policy_id;
    const exists = policies.some((p) => p.policy_id === bundlePolicyId);
    if (exists && selectedPolicyId !== bundlePolicyId) {
      setSelectedPolicyId(bundlePolicyId);
    }
  }, [bundle, policies, selectedPolicyId]);

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
    const policyIdForVerify = bundle.public_inputs.policy_id;
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyResponse(null);
    setAttestResult(null);
    setAttestError(null);
    try {
      const response =
        mode === 'bundle'
          ? await client.verifyBundle(policyIdForVerify, bundle)
          : await client.verifyProof({
              circuit_version: bundle.circuit_version,
              proof: bundle.proof,
              public_inputs: publicInputsToBytes(bundle.public_inputs),
              policy_id: policyIdForVerify,
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
    setHolderId('');
    setSnapshotId('');
    setAttestResult(null);
    setAttestError(null);
  };

  const selectedRail = assetRailCopy[assetRail];

  const canAttest =
    !!bundle &&
    !!verifyResponse?.valid &&
    !isVerifying &&
    holderId.trim().length > 0 &&
    snapshotId.trim().length > 0;

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
          ? `Circuit v${bundle.circuit_version} • Policy ${bundle.public_inputs.policy_id}${
              bundle.rail_id ? ` • Rail ${bundle.rail_id}` : ''
            }`
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
              ? 'Ready to submit.'
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

  const handleAttest = async () => {
    if (!bundle) return;
    const policyIdForAttest = bundle.public_inputs.policy_id;
    setAttestLoading(true);
    setAttestError(null);
    setAttestResult(null);
    try {
      const response = await client.attestOnChain({
        holder_id: holderId.trim(),
        snapshot_id: snapshotId.trim(),
        policy_id: policyIdForAttest,
        bundle,
      });
      setAttestResult(response);
      showToast(
        response.valid ? 'On-chain attestation submitted' : 'On-chain attestation failed',
        response.valid ? 'success' : 'error',
      );
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : (err as Error).message ?? 'Unknown error';
      setAttestError(message);
      showToast('On-chain attestation request failed', 'error');
    } finally {
      setAttestLoading(false);
    }
  };

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
              <label>
                <input
                  type="radio"
                  name="asset-rail"
                  value="orchard"
                  checked={assetRail === 'orchard'}
                  onChange={() => setAssetRail('orchard')}
                />
                <span>Zcash Orchard PoF</span>
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
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || policiesQuery.isLoading || !bundle}
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
            <VerificationBanner
              response={verifyResponse}
              endpoint={mode}
              assetRail={assetRail}
              railId={bundle?.rail_id}
            />
          )}
          {verifyError && <p className="error">{verifyError}</p>}
          <div className="onchain-attestation-panel">
            <div className="onchain-attestation-header">
              <h3>On-chain attestation (optional)</h3>
              <p className="muted small">
                Publish a successful proof-of-funds verification to the configured EVM{' '}
                <code>AttestationRegistry</code>. Identifiers are hashed to <code>bytes32</code>{' '}
                on the backend before calling the contract.
              </p>
            </div>
            <div className="onchain-attestation-grid">
              <label className="field">
                <span>Holder ID</span>
                <input
                  type="text"
                  value={holderId}
                  onChange={(event) => setHolderId(event.target.value)}
                  placeholder="e.g. hashed KYC record or internal treasury account code"
                />
              </label>
              <label className="field">
                <span>Snapshot ID</span>
                <input
                  type="text"
                  value={snapshotId}
                  onChange={(event) => setSnapshotId(event.target.value)}
                  placeholder={`custodial-epoch-${bundle.public_inputs.current_epoch}`}
                />
              </label>
            </div>
            <div className="actions">
              <button
                type="button"
                onClick={handleAttest}
                disabled={!canAttest || attestLoading}
                className="verify-button secondary"
              >
                {attestLoading ? (
                  <>
                    <span className="spinner"></span>
                    <span>Publishing attestation…</span>
                  </>
                ) : (
                  <>
                    <span>↗</span>
                    <span>Publish attestation on-chain</span>
                  </>
                )}
              </button>
            </div>
            {attestError && (
              <div className="error-message">
                <span className="error-icon">⚠️</span>
                <span>{attestError}</span>
              </div>
            )}
            {attestResult && (
              <AttestationBanner
                response={attestResult}
              />
            )}
          </div>
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
  railId,
}: {
  response: VerifyResponse;
  endpoint: VerificationMode;
  assetRail: AssetRail;
  railId?: string;
}) {
  const intent = response.valid ? 'success' : 'error';
  const railLabel =
    assetRail === 'orchard'
      ? 'Zcash Orchard rail'
      : assetRail === 'onchain'
        ? 'On-chain rail'
        : 'Fiat rail';
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
            {response.circuit_version} • {railLabel}
            {railId && (
              <>
                {' '}
                • Rail ID <span className="mono">{railId}</span>
              </>
            )}
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

function AttestationBanner({ response }: { response: AttestResponse }) {
  const intent = response.valid ? 'success' : 'error';
  return (
    <div className={`verification-banner ${intent}`}>
      <div className="verification-content">
        <div className="verification-icon">{response.valid ? '✓' : '✗'}</div>
        <div>
          <h3>{response.valid ? 'On-chain attestation recorded' : 'On-chain attestation failed'}</h3>
          <p className="muted small">
            Holder&nbsp;
            <span className="mono">{response.holder_id}</span> • Policy{' '}
            <span className="mono">{response.policy_id}</span> • Snapshot{' '}
            <span className="mono">{response.snapshot_id}</span>
          </p>
        </div>
      </div>
      <div className="verification-error">
        {response.tx_hash && (
          <span className="mono">
            Tx hash: {response.tx_hash}
          </span>
        )}
        {response.attestation_id && (
          <span className="mono">
            Attestation ID: {response.attestation_id}
          </span>
        )}
        {response.chain_id != null && (
          <span className="mono">
            Chain ID: {response.chain_id}
          </span>
        )}
        {!response.valid && response.error && (
          <span className="mono">
            Error: {response.error}
            {response.error_code && ` (code: ${response.error_code})`}
          </span>
        )}
      </div>
    </div>
  );
}
