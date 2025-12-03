import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, ZkpfClient } from '../api/zkpf';
import type { AttestResponse, PolicyCategory, PolicyDefinition, ProofBundle, VerifyResponse } from '../types/zkpf';
import { publicInputsToBytes } from '../utils/bytes';
import { parseProofBundle } from '../utils/parse';
import { formatPolicyThreshold, getCurrencyMeta, policyDisplayName, policyRailLabel } from '../utils/policy';
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
  prefillCustomPolicy?: PolicyDefinition | null;
  onPrefillConsumed?: () => void;
  onVerificationOutcome?: (outcome: 'accepted' | 'rejected' | 'error' | 'pending' | 'reset') => void;
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
      'Combine balances from cold and hot wallets, smart contracts, or L2 rollups. The verifier sees commitments that prove you meet the threshold, not your full wallet list.',
    checklist: [
      'Use your custody or indexer systems to export the data the prover needs for each scope.',
      'Keep wallet inventory private—only commitments, not raw addresses, go into the bundle.',
    ],
    endpointDetail: 'Proof sourced from digital asset custody accounts.',
  },
  orchard: {
    label: 'Zcash Orchard (shielded)',
    description:
      'Non-custodial proof-of-funds over the Zcash Orchard shielded pool. Ownership and balances are checked inside the Orchard circuit without exposing viewing keys.',
    checklist: [
      'Include UFVK and Orchard notes in a ZCASH_ORCHARD proof-of-funds rail.',
      'Make sure the snapshot height and Orchard anchor match what your wallet or lightwalletd shows.',
      'Holder binding ties the UFVK to policy, scope, and epoch without exposing the keys themselves.',
    ],
    endpointDetail: 'Proof sourced from Zcash Orchard shielded funds.',
  },
};

const assetRailToCategory: Record<AssetRail, PolicyCategory> = {
  onchain: 'ONCHAIN',
  orchard: 'ZCASH_ORCHARD',
};

function inferAssetRail(railId?: string | null): AssetRail {
  const normalized = railId?.toUpperCase();
  if (normalized?.includes('ORCHARD')) {
    return 'orchard';
  }
  // Default to onchain for other rail types
  return 'onchain';
}

/**
 * Returns a human-readable label for the rail.
 * Use this instead of showing the raw rail_id to users.
 */
function railDisplayLabel(railId?: string | null): string {
  if (!railId || railId.trim() === '') {
    return 'Custodial attestation';
  }
  const normalized = railId.toUpperCase();
  if (normalized.includes('ORCHARD') || normalized.includes('ZCASH')) {
    return 'Zcash Orchard';
  }
  if (normalized === 'CUSTODIAL_ATTESTATION') {
    return 'Custodial attestation';
  }
  if (normalized.includes('STARKNET')) {
    return 'Starknet L2';
  }
  if (normalized.includes('MINA')) {
    return 'Mina recursive';
  }
  if (normalized.includes('OMNI') || normalized.includes('BRIDGE')) {
    return 'Omni bridge';
  }
  if (normalized.includes('AXELAR')) {
    return 'Axelar GMP';
  }
  // Fallback: humanize the rail ID
  return railId.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizePolicyCategory(policy: PolicyDefinition): PolicyCategory {
  const raw = policy.category?.toUpperCase() as PolicyCategory | undefined;
  if (raw === 'ONCHAIN' || raw === 'ZCASH_ORCHARD') {
    return raw;
  }
  return 'ZCASH_ORCHARD';
}

export function ProofWorkbench({
  client,
  connectionState,
  prefillBundle,
  prefillCustomPolicy,
  onPrefillConsumed,
  onVerificationOutcome,
}: Props) {
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
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [attestLoading, setAttestLoading] = useState(false);
  const [attestError, setAttestError] = useState<string | null>(null);
  const [attestResult, setAttestResult] = useState<AttestResponse | null>(null);
  const [customPolicy, setCustomPolicy] = useState<PolicyDefinition | null>(null);

  const policiesQuery = useQuery<PolicyDefinition[]>({
    queryKey: ['policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  
  // Merge custom policy with fetched policies (custom policy takes priority)
  const policies = useMemo<PolicyDefinition[]>(() => {
    const fetchedPolicies = policiesQuery.data ?? [];
    if (customPolicy) {
      // Put custom policy at the start of the list, remove any duplicate
      return [customPolicy, ...fetchedPolicies.filter(p => p.policy_id !== customPolicy.policy_id)];
    }
    return fetchedPolicies;
  }, [policiesQuery.data, customPolicy]);
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
    (value: string, providedPolicies?: PolicyDefinition[]) => {
      setRawInput(value);
      setVerifyResponse(null);
      setVerifyError(null);
      setAttestResult(null);
      setAttestError(null);
      onVerificationOutcome?.('reset');
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
        // Auto-select rail context based on bundle properties.
        if (parsed.rail_id === 'ZCASH_ORCHARD') {
          setAssetRail('orchard');
        }
        
        // Auto-create a custom policy from bundle if no matching policy exists
        // This handles cases where bundles are loaded manually without going through the wallet flow
        const policiesToCheck = providedPolicies ?? policies;
        const bundlePolicyId = parsed.public_inputs.policy_id;
        const matchingPolicy = policiesToCheck.find(p => p.policy_id === bundlePolicyId);
        
        if (!matchingPolicy && !customPolicy) {
          // Create a synthetic custom policy from the bundle's public inputs
          // This allows verification of bundles loaded manually (e.g., drag & drop)
          const currencyMeta = getCurrencyMeta(parsed.public_inputs.required_currency_code);
          const thresholdRaw = parsed.public_inputs.threshold_raw;
          const divisor = currencyMeta.decimals > 0 ? 10 ** currencyMeta.decimals : 1;
          const thresholdValue = thresholdRaw / divisor;
          
          // Generate a descriptive label based on the bundle's parameters
          const thresholdLabel = thresholdRaw === 0
            ? `exactly 0 ${currencyMeta.code}`
            : `≥ ${thresholdValue.toLocaleString()} ${currencyMeta.code}`;
          
          const syntheticPolicy: PolicyDefinition = {
            policy_id: bundlePolicyId,
            threshold_raw: thresholdRaw,
            required_currency_code: parsed.public_inputs.required_currency_code,
            verifier_scope_id: parsed.public_inputs.verifier_scope_id,
            // Infer category and rail from currency code and rail_id
            category: parsed.rail_id === 'ZCASH_ORCHARD' ? 'ZCASH_ORCHARD' 
              : parsed.public_inputs.required_currency_code === 5915971 ? 'ZASHI'
              : 'ONCHAIN',
            rail_id: parsed.rail_id || 'CUSTODIAL_ATTESTATION',
            label: `Prove ${thresholdLabel} (from bundle)`,
          };
          setCustomPolicy(syntheticPolicy);
          setSelectedPolicyId(bundlePolicyId);
        }
        
        setParseError(null);
      } catch (err) {
        setBundle(null);
        setParseError((err as Error).message);
      }
    },
    [onVerificationOutcome, setAssetRail, policies, customPolicy],
  );

  useEffect(() => {
    if (!prefillBundle) return;
    // Pass the custom policy through if provided, so we don't auto-create one
    if (prefillCustomPolicy) {
      setCustomPolicy(prefillCustomPolicy);
      setSelectedPolicyId(prefillCustomPolicy.policy_id);
    }
    // Pass current policies so the handler can check for matches
    handleRawInput(prefillBundle, policies);
    onPrefillConsumed?.();
  }, [prefillBundle, prefillCustomPolicy, handleRawInput, onPrefillConsumed, policies]);

  const selectedPolicy = selectedPolicyId
    ? policies.find((policy) => policy.policy_id === selectedPolicyId) ?? null
    : null;

  const policyMismatchWarning = useMemo(() => {
    if (!bundle) {
      return null;
    }
    
    // If we have a custom policy that matches the bundle, no mismatch
    if (customPolicy && bundle.public_inputs.policy_id === customPolicy.policy_id) {
      // Verify the custom policy actually matches
      const publicInputs = bundle.public_inputs;
      if (
        publicInputs.threshold_raw === customPolicy.threshold_raw &&
        publicInputs.required_currency_code === customPolicy.required_currency_code &&
        publicInputs.verifier_scope_id === customPolicy.verifier_scope_id
      ) {
        return null;
      }
    }
    
    if (!selectedPolicy) {
      return null;
    }
    
    const publicInputs = bundle.public_inputs;
    const problems: string[] = [];

    if (publicInputs.policy_id !== selectedPolicy.policy_id) {
      problems.push(
        `policy_id mismatch: bundle has ${publicInputs.policy_id}, but selected policy is ${selectedPolicy.policy_id}`,
      );
    }
    if (publicInputs.threshold_raw !== selectedPolicy.threshold_raw) {
      problems.push(
        `threshold_raw mismatch: bundle has ${publicInputs.threshold_raw}, but policy expects ${selectedPolicy.threshold_raw}`,
      );
    }
    if (publicInputs.required_currency_code !== selectedPolicy.required_currency_code) {
      problems.push(
        `required_currency_code mismatch: bundle has ${publicInputs.required_currency_code}, but policy expects ${selectedPolicy.required_currency_code}`,
      );
    }
    if (publicInputs.verifier_scope_id !== selectedPolicy.verifier_scope_id) {
      problems.push(
        `verifier_scope_id mismatch: bundle has ${publicInputs.verifier_scope_id}, but policy expects ${selectedPolicy.verifier_scope_id}`,
      );
    }

    if (!problems.length) {
      return null;
    }

    return `Bundle public inputs do not match the currently configured policy: ${problems.join(
      '; ',
    )}. This usually means the proof was generated against an earlier policy configuration.`;
  }, [bundle, selectedPolicy, customPolicy]);

  const policiesForRail = useMemo(() => {
    if (!policies.length) {
      return [];
    }
    const targetCategory = assetRailToCategory[assetRail];
    return policies.filter((policy) => normalizePolicyCategory(policy) === targetCategory);
  }, [assetRail, policies]);

  // Always include custom policy in displayed policies, even if it doesn't match the rail filter
  const displayedPolicies = useMemo(() => {
    const railFiltered = policiesForRail.length ? policiesForRail : policies;
    // Ensure custom policy is always included at the top if present
    if (customPolicy && !railFiltered.some(p => p.policy_id === customPolicy.policy_id)) {
      return [customPolicy, ...railFiltered];
    }
    return railFiltered;
  }, [policiesForRail, policies, customPolicy]);
  
  // Check if we're in streamlined mode (bundle + custom policy from wallet)
  const isStreamlinedMode = Boolean(customPolicy && bundle);

  useEffect(() => {
    if (bundle) {
      return;
    }
    if (!displayedPolicies.length) {
      setSelectedPolicyId(null);
      return;
    }
    if (!selectedPolicyId || !displayedPolicies.some((policy) => policy.policy_id === selectedPolicyId)) {
      setSelectedPolicyId(displayedPolicies[0].policy_id);
    }
  }, [assetRail, bundle, displayedPolicies, selectedPolicyId]);

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

  useEffect(() => {
    if (!bundle) {
      return;
    }
    setAssetRail((prev) => {
      const nextRail = inferAssetRail(bundle.rail_id);
      return prev === nextRail ? prev : nextRail;
    });
  }, [bundle]);

  const handleLoadSample = useCallback(async () => {
    try {
      const samplePath =
        assetRail === 'orchard'
          ? '/sample-bundle-orchard.json'
          : '/sample-bundle-onchain.json';
      const response = await fetch(samplePath);
      if (!response.ok) {
        throw new Error(`Sample bundle request failed (${response.status})`);
      }
      const text = await response.text();
      handleRawInput(text);
      showToast(
        assetRail === 'orchard'
          ? 'Loaded Zcash Orchard sample bundle'
          : 'Loaded on-chain sample bundle',
        'success',
      );
    } catch (err) {
      const message = (err as Error).message ?? 'Unknown error';
      setParseError(`Unable to load sample bundle: ${message}`);
      showToast('Failed to load sample bundle', 'error');
    }
  }, [assetRail, handleRawInput]);

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
    
    // Use the bundle's policy_id for verification (this is what the proof was generated against)
    const policyIdForVerify = bundle.public_inputs.policy_id;
    setIsVerifying(true);
    setVerifyError(null);
    setVerifyResponse(null);
    setAttestResult(null);
    setAttestError(null);
    try {
      onVerificationOutcome?.('pending');
      
      // ALWAYS auto-compose the policy from the bundle's public inputs before verification.
      // This ensures the backend knows about the policy, regardless of whether it's a
      // custom policy, a wallet-generated policy, or a manually loaded bundle.
      // The compose endpoint is idempotent - it will return the existing policy if one
      // already exists with matching parameters.
      const currencyMeta = getCurrencyMeta(bundle.public_inputs.required_currency_code);
      const thresholdRaw = bundle.public_inputs.threshold_raw;
      const divisor = currencyMeta.decimals > 0 ? 10 ** currencyMeta.decimals : 1;
      const thresholdValue = thresholdRaw / divisor;
      const thresholdLabel = thresholdRaw === 0
        ? `exactly 0 ${currencyMeta.code}`
        : `≥ ${thresholdValue.toLocaleString()} ${currencyMeta.code}`;
      
      // Infer category from rail_id or currency code
      const category = bundle.rail_id === 'ZCASH_ORCHARD' ? 'ZCASH_ORCHARD'
        : bundle.public_inputs.required_currency_code === 999001 ? 'ZCASH_ORCHARD'
        : 'ONCHAIN';
      
      try {
        await client.composePolicy({
          category,
          rail_id: bundle.rail_id || 'CUSTODIAL_ATTESTATION',
          label: customPolicy?.label ?? `Prove ${thresholdLabel} (from bundle)`,
          options: customPolicy?.options ?? {},
          threshold_raw: bundle.public_inputs.threshold_raw,
          required_currency_code: bundle.public_inputs.required_currency_code,
          verifier_scope_id: bundle.public_inputs.verifier_scope_id,
          // Pass the exact policy_id from the bundle so verification matches
          policy_id: policyIdForVerify,
        });
        console.log('[ZKPF] Policy auto-composed for bundle verification');
      } catch (composeErr) {
        // If policy already exists or compose fails for other reasons, continue
        // The verify call will provide a more specific error if needed
        console.warn('Policy compose warning (may be expected if policy exists):', composeErr);
      }
      
      // Debug logging for verification - format matching backend for easy comparison
      const nullifierHex = bundle.public_inputs.nullifier.slice(0, 8)
        .map(b => b.toString(16).padStart(2, '0')).join('');
      const custodianHex = bundle.public_inputs.custodian_pubkey_hash.slice(0, 8)
        .map(b => b.toString(16).padStart(2, '0')).join('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('[ZKPF Debug] VERIFICATION REQUEST (Frontend)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`[ZKPF Debug] mode=${mode}, policy_id=${policyIdForVerify}`);
      console.log(`[ZKPF Debug] rail_id=${bundle.rail_id}, circuit_version=${bundle.circuit_version}`);
      console.log(`[ZKPF Debug] Proof length: ${bundle.proof.length} bytes`);
      console.log(`[ZKPF Debug] Public inputs:
  threshold_raw: ${bundle.public_inputs.threshold_raw}
  currency_code: ${bundle.public_inputs.required_currency_code}
  epoch: ${bundle.public_inputs.current_epoch}
  scope_id: ${bundle.public_inputs.verifier_scope_id}
  policy_id: ${bundle.public_inputs.policy_id}`);
      console.log(`[ZKPF Debug] Nullifier (first 8 bytes): ${nullifierHex}`);
      console.log(`[ZKPF Debug] Custodian hash (first 8 bytes): ${custodianHex}`);
      if (bundle.public_inputs.snapshot_block_height !== undefined) {
        console.log(`[ZKPF Debug] Orchard snapshot_block_height: ${bundle.public_inputs.snapshot_block_height}`);
      }
      if (bundle.public_inputs.snapshot_anchor_orchard) {
        const anchorHex = bundle.public_inputs.snapshot_anchor_orchard.slice(0, 8)
          .map((b: number) => b.toString(16).padStart(2, '0')).join('');
        console.log(`[ZKPF Debug] Orchard anchor (first 8 bytes): ${anchorHex}`);
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
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
      if (response.valid) {
        onVerificationOutcome?.('accepted');
      } else {
        onVerificationOutcome?.('rejected');
      }
    } catch (err) {
      setVerifyError((err as ApiError).message);
      onVerificationOutcome?.('error');
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
          ? `Policy manifest failed to load. ${policiesError}`
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
        ? `Bundle JSON error: ${parseError}`
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
        ? `Verifier request failed: ${verifyError}`
        : verifyResponse
          ? verifyResponse.valid
            ? 'Proof accepted by backend'
            : verifyResponse.error
              ? `Proof rejected: ${verifyResponse.error}`
              : 'Proof rejected'
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


  // Streamlined mode: simplified UI when coming from wallet with custom policy
  if (isStreamlinedMode && customPolicy) {
    return (
      <section className="proof-workbench card streamlined-workbench">
        <header>
          <p className="eyebrow">Verify your wallet proof</p>
          <h2>One-click verification</h2>
        </header>
        
        <div className="streamlined-banner">
          <div className="streamlined-banner-icon">✨</div>
          <div className="streamlined-banner-content">
            <h3>Proof ready for verification</h3>
            <p>Your proof bundle was generated from your wallet and is ready to verify.</p>
          </div>
        </div>

        <div className="streamlined-policy-card">
          <div className="streamlined-policy-header">
            <span className="streamlined-policy-badge">Custom Policy</span>
            <span className="streamlined-policy-id">ID: {customPolicy.policy_id}</span>
          </div>
          <dl className="streamlined-policy-details">
            <div>
              <dt>Proving</dt>
              <dd>{policyDisplayName(customPolicy)}</dd>
            </div>
            <div>
              <dt>Threshold</dt>
              <dd>{formatPolicyThreshold(customPolicy).formatted}</dd>
            </div>
            <div>
              <dt>Rail</dt>
              <dd>{policyRailLabel(customPolicy)}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{customPolicy.verifier_scope_id}</dd>
            </div>
          </dl>
        </div>

        <div className="streamlined-bundle-info">
          <div className="streamlined-bundle-row">
            <span className="streamlined-bundle-label">Circuit Version</span>
            <span className="streamlined-bundle-value">{bundle?.circuit_version}</span>
          </div>
          <div className="streamlined-bundle-row">
            <span className="streamlined-bundle-label">Rail ID</span>
            <span className="streamlined-bundle-value mono">{bundle?.rail_id || 'Default'}</span>
          </div>
          <div className="streamlined-bundle-row">
            <span className="streamlined-bundle-label">Epoch</span>
            <span className="streamlined-bundle-value">{bundle?.public_inputs.current_epoch}</span>
          </div>
        </div>

        <div className="streamlined-actions">
          <button
            type="button"
            onClick={handleVerify}
            disabled={isVerifying || !bundle}
            className="streamlined-verify-button"
          >
            {isVerifying ? (
              <>
                <span className="spinner"></span>
                <span>Verifying proof…</span>
              </>
            ) : (
              <>
                <span>✓</span>
                <span>Verify Proof</span>
              </>
            )}
          </button>
          
          <button
            type="button"
            className="streamlined-secondary-button"
            onClick={() => {
              setCustomPolicy(null);
              const fetchedPolicies = policiesQuery.data ?? [];
              if (fetchedPolicies.length > 0) {
                setSelectedPolicyId(fetchedPolicies[0].policy_id);
              }
            }}
          >
            Switch to advanced mode
          </button>
        </div>

        {verifyResponse && (
          <VerificationBanner
            response={verifyResponse}
            endpoint={mode}
            railId={bundle?.rail_id}
          />
        )}
        
        {verifyError && (
          <div className="error-message">
            <span className="error-icon">⚠️</span>
            <span>Verification failed: {verifyError}</span>
          </div>
        )}

        {verifyResponse?.valid && (
          <div className="streamlined-success-actions">
            <h4>What's next?</h4>
            <div className="streamlined-next-steps">
              <div className="streamlined-next-step">
                <span className="next-step-icon">📥</span>
                <div>
                  <strong>Download proof bundle</strong>
                  <p className="muted small">Save the verified proof for your records</p>
                </div>
                <button
                  type="button"
                  className="tiny-button"
                  onClick={() => {
                    if (!bundle) return;
                    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `proof-bundle-${Date.now()}.json`;
                    link.click();
                    URL.revokeObjectURL(link.href);
                    showToast('Bundle downloaded', 'success');
                  }}
                >
                  Download
                </button>
              </div>
              <div className="streamlined-next-step">
                <span className="next-step-icon">🔗</span>
                <div>
                  <strong>On-chain attestation</strong>
                  <p className="muted small">Publish proof to blockchain for permanent record</p>
                </div>
                <button
                  type="button"
                  className="tiny-button"
                  onClick={() => {
                    setCustomPolicy(null);
                    const fetchedPolicies = policiesQuery.data ?? [];
                    if (fetchedPolicies.length > 0) {
                      setSelectedPolicyId(fetchedPolicies[0].policy_id);
                    }
                  }}
                >
                  Open advanced
                </button>
              </div>
            </div>
          </div>
        )}

        {bundle && <BundleSummary bundle={bundle} assetRail={assetRail} />}
      </section>
    );
  }

  return (
    <section className="proof-workbench card">
      <header>
        <p className="eyebrow">Verification</p>
        <h2>Verify your proof</h2>
      </header>
      <p className="muted">
        Upload or paste your proof bundle to verify it. We'll automatically detect all the settings for you.
      </p>
      

      {/* Only show technical flow steps when no bundle loaded - keep it simple */}
      {!bundle && connectionState !== 'connected' && (
        <FlowVisualizer steps={flowSteps.slice(0, 2)} />
      )}

      {/* Custom Policy Banner - shown when using a custom policy from wallet (but no bundle yet) */}
      {customPolicy && !bundle && (
        <div className="custom-policy-banner">
          <div className="custom-policy-banner-content">
            <span className="custom-policy-banner-icon">✨</span>
            <div className="custom-policy-banner-text">
              <strong>Custom policy from your wallet</strong>
              <p>
                This policy was automatically configured based on your wallet balance.
                The proof bundle was generated against policy ID <strong>{customPolicy.policy_id}</strong>.
              </p>
            </div>
            <button 
              type="button" 
              className="ghost tiny-button"
              onClick={() => {
                setCustomPolicy(null);
                // Reset to first fetched policy
                const fetchedPolicies = policiesQuery.data ?? [];
                if (fetchedPolicies.length > 0) {
                  setSelectedPolicyId(fetchedPolicies[0].policy_id);
                }
              }}
            >
              Clear custom policy
            </button>
          </div>
        </div>
      )}

      {!bundle && (
        <div 
          className={`upload-zone ${isDragging ? 'dragging' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="upload-zone-content">
            <div className="upload-zone-icon">📄</div>
            <h3>Drop your proof file here</h3>
            <p className="muted">or click to browse</p>
            <label className="file-input-label">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => handleFileUpload(event.target.files)}
                className="file-input"
              />
              <span className="file-input-button">Choose proof file</span>
            </label>
          </div>
          <div className="upload-zone-divider">
            <span>or paste JSON</span>
          </div>
          <textarea
            id={textareaId}
            placeholder="Paste your proof bundle JSON here…"
            value={rawInput}
            onChange={(event) => handleRawInput(event.target.value)}
            spellCheck={false}
            className={`upload-zone-textarea ${parseError ? 'error-input' : ''}`}
          />
          {parseError && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              <span>{parseError}</span>
            </div>
          )}
        </div>
      )}

      {bundle && (
        <div className="bundle-loaded-bar">
          <div className="bundle-loaded-info">
            <span className="bundle-loaded-icon">✓</span>
            <span>Proof bundle loaded successfully</span>
          </div>
          <button type="button" className="ghost tiny-button" onClick={handleClear}>
            Load different proof
          </button>
        </div>
      )}
      {bundle && !parseError && (
        <>
          {/* Auto-detected summary - simplified for users */}
          <div className="auto-detected-summary">
            <div className="auto-detected-header">
              <div className="auto-detected-icon">✓</div>
              <div className="auto-detected-text">
                <h3>Proof bundle detected</h3>
                <p>All settings have been configured automatically from your proof.</p>
              </div>
            </div>
            
            <div className="auto-detected-details">
              <div className="auto-detected-item">
                <span className="auto-detected-label">Proof Type</span>
                <span className="auto-detected-value">
                  <span className="auto-detected-badge">
                    {assetRail === 'orchard' ? '🔒 Zcash Shielded' : '⛓️ On-chain'}
                  </span>
                </span>
              </div>
              <div className="auto-detected-item">
                <span className="auto-detected-label">Circuit</span>
                <span className="auto-detected-value mono">v{bundle.circuit_version}</span>
              </div>
              {selectedPolicy && (
                <div className="auto-detected-item">
                  <span className="auto-detected-label">Policy</span>
                  <span className="auto-detected-value">{formatPolicyThreshold(selectedPolicy).formatted}</span>
                </div>
              )}
              {bundle.public_inputs.current_epoch && (
                <div className="auto-detected-item">
                  <span className="auto-detected-label">Epoch</span>
                  <span className="auto-detected-value mono">{bundle.public_inputs.current_epoch}</span>
                </div>
              )}
            </div>

            {policyMismatchWarning && (
              <div className="error-message" style={{ marginTop: '1rem' }}>
                <span className="error-icon">⚠️</span>
                <span>{policyMismatchWarning}</span>
              </div>
            )}
          </div>

          {/* Collapsible advanced options for power users */}
          <button
            type="button"
            className="advanced-toggle"
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          >
            <span className={`advanced-toggle-arrow ${showAdvancedOptions ? 'open' : ''}`}>›</span>
            <span>Advanced options</span>
          </button>

          {showAdvancedOptions && (
            <div className="advanced-options-panel">
              <div className="advanced-option-group">
                <span className="advanced-option-label">Verification endpoint</span>
                <div className="mode-switch">
                  <label>
                    <input
                      type="radio"
                      name="verification-mode"
                      value="bundle"
                      checked={mode === 'bundle'}
                      onChange={() => setMode('bundle')}
                    />
                    <span>/verify-bundle</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="verification-mode"
                      value="raw"
                      checked={mode === 'raw'}
                      onChange={() => setMode('raw')}
                    />
                    <span>/verify</span>
                  </label>
                </div>
              </div>

              <div className="advanced-option-group">
                <span className="advanced-option-label">Asset rail context</span>
                <div className="asset-rail-switch">
                  <label>
                    <input
                      type="radio"
                      name="asset-rail"
                      value="onchain"
                      checked={assetRail === 'onchain'}
                      onChange={() => setAssetRail('onchain')}
                    />
                    <span>On-chain</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="asset-rail"
                      value="orchard"
                      checked={assetRail === 'orchard'}
                      onChange={() => setAssetRail('orchard')}
                    />
                    <span>Zcash Orchard</span>
                  </label>
                </div>
              </div>

              <div className="advanced-option-group">
                <span className="advanced-option-label">Policy selection</span>
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
                    disabled={!displayedPolicies.length}
                    className="advanced-select"
                  >
                    {!displayedPolicies.length ? (
                      <option value="">No policies available</option>
                    ) : (
                      displayedPolicies.map((policy) => {
                        const isCustom = customPolicy && policy.policy_id === customPolicy.policy_id;
                        const label = policyDisplayName(policy);
                        const threshold = formatPolicyThreshold(policy).formatted;
                        return (
                          <option key={policy.policy_id} value={policy.policy_id}>
                            {isCustom ? '✨ ' : ''}{label} • {threshold} • Scope {policy.verifier_scope_id}
                          </option>
                        );
                      })
                    )}
                  </select>
                )}
              </div>

              {policiesError && (
                <div className="error-message">
                  <span className="error-icon">⚠️</span>
                  <span>{policiesError}</span>
                </div>
              )}
              
              <div className="advanced-option-footer">
                <Link to="/policies" className="tiny-button ghost">
                  Open policy composer
                </Link>
              </div>
            </div>
          )}
          <div className="verify-action-panel">
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || policiesQuery.isLoading || !bundle}
              className="verify-button primary-cta"
            >
              {isVerifying ? (
                <>
                  <span className="spinner"></span>
                  <span>Verifying your proof…</span>
                </>
              ) : (
                <>
                  <span className="verify-icon">✓</span>
                  <span>Verify Proof</span>
                </>
              )}
            </button>
            <p className="verify-reassurance">
              {isVerifying 
                ? 'This typically takes just a few seconds…'
                : 'Your proof data stays secure. Only the verification result is stored.'}
            </p>
          </div>
          {verifyResponse && (
            <VerificationBanner
              response={verifyResponse}
              endpoint={mode}
              railId={bundle?.rail_id}
            />
          )}
          {verifyError && <p className="error">Verification failed: {verifyError}</p>}
          <div className="onchain-attestation-panel">
            <div className="onchain-attestation-header">
              <h3>On-chain attestation (optional)</h3>
              <p className="muted small">
              Optionally publish a successful proof-of-funds verification to the configured EVM{' '}
              <code>AttestationRegistry</code>. The backend hashes identifiers to <code>bytes32</code> using BLAKE3
              before calling the contract.
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
            {!canAttest && bundle && verifyResponse && verifyResponse.valid && !attestLoading && (
              <p className="muted small">
                Fill in Holder ID and Snapshot ID to publish an attestation. Use identifiers that make sense in your
                internal systems (for example, a hashed KYC record or treasury account code).
              </p>
            )}
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
  railId,
}: {
  response: VerifyResponse;
  endpoint: VerificationMode;
  railId?: string;
}) {
  const intent = response.valid ? 'success' : 'error';
  // Use the rail_id-based label for consistency
  const railLabel = railDisplayLabel(railId) + ' rail';
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
