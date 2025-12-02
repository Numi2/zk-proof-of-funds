import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { blake3 } from '@noble/hashes/blake3.js';
import * as secp256k1 from '@noble/secp256k1';
import type {
  CircuitInput,
  ProofBundle,
  PolicyDefinition,
  PolicyCategory,
  PolicyComposeRequest,
} from '../types/zkpf';
import { formatPolicyThreshold, policyCategoryLabel, policyDisplayName, policyRailLabel } from '../utils/policy';
import type { ConnectionState } from './ProofWorkbench';
import type { AssetRail } from '../types/ui';
import { ZkpfClient } from '../api/zkpf';
import { BundleSummary } from './BundleSummary';
import { ZcashWalletConnector } from './ZcashWalletConnector';
import { AuthButton } from './auth/AuthButton';
import { useAuth } from '../context/AuthContext';
import { prepareProverArtifacts, generateBundle, wasmComputeAttestationMessageHash, wasmComputeCustodianPubkeyHash, wasmComputeNullifier, prepareOrchardProverArtifacts, generateOrchardBundle } from '../wasm/prover';
import type { OrchardProofInput } from '../types/zkpf';
import { useWebZjsContext } from '../context/WebzjsContext';
import { bigIntToLittleEndianBytes, bytesToBigIntBE, bytesToHex, normalizeField, numberArrayFromBytes } from '../utils/field';

interface WalletNavigationState {
  customPolicy?: PolicyDefinition;
  fromWallet?: boolean;
  walletBalance?: number;
}

interface Props {
  client: ZkpfClient;
  connectionState: ConnectionState;
  onBundleReady?: (bundle: ProofBundle, customPolicy?: PolicyDefinition | null) => void;
}

type WasmStatus = 'idle' | 'loading' | 'ready' | 'error';
type ProofProgress = 'idle' | 'preparing' | 'generating' | 'finalizing';

const railFromBundle = (bundle: ProofBundle | null): AssetRail => {
  if (!bundle) return 'onchain';
  return bundle.rail_id === 'ZCASH_ORCHARD' ? 'orchard' : 'onchain';
};

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

// Helper to yield to the main thread, allowing UI updates
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const PROOF_PROGRESS_MESSAGES: Record<ProofProgress, string> = {
  idle: '',
  preparing: 'Initializing cryptographic parameters…',
  generating: 'Computing zero-knowledge proof (this may take 30-60 seconds)…',
  finalizing: 'Packaging proof bundle…',
};

function computeHolderBinding(holderId: string, ufvk: string): Uint8Array {
  const encoder = new TextEncoder();
  const hasher = blake3.create();
  hasher.update(encoder.encode(holderId));
  hasher.update(encoder.encode('||'));
  hasher.update(encoder.encode(ufvk));
  return hasher.digest();
}

export function ProofBuilder({ client, connectionState, onBundleReady }: Props) {
  const location = useLocation();
  const navigationState = location.state as WalletNavigationState | null;
  const { state: walletState } = useWebZjsContext();
  const { status: authStatus, account: authAccount, signMessage: authSignMessage } = useAuth();
  
  const [rawInput, setRawInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofProgress, setProofProgress] = useState<ProofProgress>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('idle');
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
  const [preparedKey, setPreparedKey] = useState<string | null>(null);
  const [isBuildingAttestation, setIsBuildingAttestation] = useState(false);
  const [showCancelPending, setShowCancelPending] = useState(false);
  const cancelRequestedRef = useRef(false);
  
  // Check if user has a Zcash wallet ready
  const hasZcashWallet = walletState.activeAccount != null;
  
  // Track if we're using a custom policy from the wallet
  const [customPolicy, setCustomPolicy] = useState<PolicyDefinition | null>(
    navigationState?.customPolicy ?? null
  );
  const [walletPolicySynced, setWalletPolicySynced] = useState(false);
  
  // Check if we came from wallet with custom policy - this enables streamlined mode
  const isCustomPolicyFromWallet = Boolean(customPolicy && navigationState?.fromWallet);
  
  // Get wallet balance and snapshot height from context when available
  const activeAccountReport = useMemo(() => {
    if (!walletState.summary || walletState.activeAccount == null) {
      return undefined;
    }
    return walletState.summary.account_balances.find(
      ([accountId]) => accountId === walletState.activeAccount,
    );
  }, [walletState.summary, walletState.activeAccount]);

  const derivedShieldedBalance = useMemo(() => {
    if (!activeAccountReport) return null;
    const balance = activeAccountReport[1];
    return balance.sapling_balance + balance.orchard_balance;
  }, [activeAccountReport]);

  const derivedSnapshotHeight = useMemo(() => {
    if (!walletState.summary) return null;
    return walletState.summary.fully_scanned_height ?? walletState.summary.chain_tip_height;
  }, [walletState.summary]);

  const paramsQuery = useQuery({
    queryKey: ['params', client.baseUrl],
    queryFn: () => client.getParams(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const policiesQuery = useQuery({
    queryKey: ['policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  
  // Merge custom policy with fetched policies (custom policy takes priority)
  const policies = useMemo<PolicyDefinition[]>(() => {
    const fetchedPolicies = policiesQuery.data ?? [];
    if (customPolicy) {
      // Put custom policy at the start of the list
      return [customPolicy, ...fetchedPolicies];
    }
    return fetchedPolicies;
  }, [policiesQuery.data, customPolicy]);

  // Auto-select custom policy if it came from wallet navigation
  useEffect(() => {
    if (navigationState?.customPolicy && customPolicy) {
      setSelectedPolicyId(customPolicy.policy_id);
    }
  }, [navigationState?.customPolicy, customPolicy]);

  // When arriving from a wallet/credentials flow with a customPolicy template,
  // materialize a real backend policy via /zkpf/policies/compose so that:
  // - the prover embeds the canonical policy_id + verifier_scope_id into the bundle
  // - the backend already knows about this wallet-specific policy when verifying
  useEffect(() => {
    if (!navigationState?.customPolicy || walletPolicySynced) {
      return;
    }

    let cancelled = false;

    const syncWalletPolicy = async () => {
      try {
        const base = navigationState.customPolicy as PolicyDefinition;

        const category: PolicyCategory =
          (base.category?.toUpperCase() as PolicyCategory | undefined) ??
          (base.rail_id === 'ZCASH_ORCHARD' || base.required_currency_code === 999001
            ? 'ZCASH_ORCHARD'
            : 'ONCHAIN');

        const railId =
          base.rail_id ??
          (category === 'ZCASH_ORCHARD'
            ? 'ZCASH_ORCHARD'
            : 'ONCHAIN_WALLET');

        const payload: PolicyComposeRequest = {
          category,
          rail_id: railId,
          label:
            base.label ??
            `Prove ${formatPolicyThreshold(base).formatted}`,
          options: {
            ...(base.options ?? {}),
            source: 'wallet',
            auto: true,
          },
          threshold_raw: base.threshold_raw,
          required_currency_code: base.required_currency_code,
          verifier_scope_id: base.verifier_scope_id,
          // Let the backend assign policy_id to avoid collisions with existing config.
        };

        const response = await client.composePolicy(payload);
        if (cancelled) {
          return;
        }

        const composed = response.policy as PolicyDefinition;
        setCustomPolicy(composed);
        setSelectedPolicyId(composed.policy_id);
      } catch (err) {
        // If compose fails (e.g., backend unreachable), fall back to the
        // local template so the builder still works, but verification may
        // remain misaligned with the backend until connectivity is fixed.
        console.warn(
          '[ZKPF] Failed to compose wallet-specific policy; using local template only.',
          err,
        );
        if (!cancelled) {
          setCustomPolicy((prev) => prev ?? navigationState.customPolicy ?? null);
          setSelectedPolicyId((prev) => prev ?? navigationState.customPolicy?.policy_id ?? null);
        }
      } finally {
        if (!cancelled) {
          setWalletPolicySynced(true);
        }
      }
    };

    void syncWalletPolicy();

    return () => {
      cancelled = true;
    };
  }, [client, navigationState?.customPolicy, walletPolicySynced]);

  useEffect(() => {
    // Skip auto-selection if we have a custom policy already selected
    if (customPolicy && selectedPolicyId === customPolicy.policy_id) {
      return;
    }
    if (!policies.length) {
      setSelectedPolicyId(null);
      return;
    }
    if (!selectedPolicyId || !policies.some((policy) => policy.policy_id === selectedPolicyId)) {
      setSelectedPolicyId(policies[0].policy_id);
      return;
    }
  }, [policies, selectedPolicyId, customPolicy]);

  const selectedPolicy = selectedPolicyId
    ? policies.find((policy) => policy.policy_id === selectedPolicyId) ?? null
    : null;


  const manifestMeta = useMemo(() => {
    if (!paramsQuery.data) {
      return null;
    }
    return {
      key: `${paramsQuery.data.params_hash}:${paramsQuery.data.pk_hash}`,
      manifestVersion: paramsQuery.data.manifest_version,
      circuitVersion: paramsQuery.data.circuit_version,
      paramsHash: paramsQuery.data.params_hash,
      pkHash: paramsQuery.data.pk_hash,
      artifactUrls: paramsQuery.data.artifact_urls ?? {
        params: '/zkpf/artifacts/params',
        vk: '/zkpf/artifacts/vk',
        pk: '/zkpf/artifacts/pk',
      },
    };
  }, [paramsQuery.data]);

  useEffect(() => {
    if (!manifestMeta) {
      setPreparedKey(null);
      setWasmStatus('idle');
      return;
    }
    if (preparedKey && preparedKey !== manifestMeta.key) {
      setPreparedKey(null);
      setWasmStatus('idle');
    }
  }, [manifestMeta, preparedKey]);

  const handleLoadSample = useCallback(async () => {
    try {
      const response = await fetch('/attestation.sample.json');
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const text = await response.text();
      setRawInput(text);
      setError(null);
      setBundle(null);
      showToast('Loaded sample attestation', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(`Unable to load sample attestation: ${message}`);
      showToast('Failed to load sample attestation', 'error');
    }
  }, []);

  const handleClear = useCallback(() => {
    setRawInput('');
    setBundle(null);
    setError(null);
  }, []);

  const [orchardArtifactsKey, setOrchardArtifactsKey] = useState<string | null>(null);

  const ensureArtifacts = useCallback(async () => {
    if (!manifestMeta) {
      throw new Error('Verifier manifest not loaded yet.');
    }
    if (preparedKey === manifestMeta.key) {
      if (wasmStatus !== 'ready') {
        setWasmStatus('ready');
      }
      return;
    }
    setWasmStatus('loading');
    setWasmError(null);
    const { params, pk } = await client.loadArtifactsForKey(
      manifestMeta.key, 
      manifestMeta.artifactUrls,
      { params: manifestMeta.paramsHash, pk: manifestMeta.pkHash },
    );
    try {
      await prepareProverArtifacts({
        params,
        pk,
        key: manifestMeta.key,
      });
      setPreparedKey(manifestMeta.key);
      setWasmStatus('ready');
    } finally {
      client.releaseArtifacts(manifestMeta.key);
    }
  }, [client, manifestMeta, preparedKey, wasmStatus]);

  // For Orchard, we need separate artifacts. For now, assume they're at similar endpoints.
  // TODO: Backend should expose /zkpf/orchard-params endpoint
  const ensureOrchardArtifacts = useCallback(async () => {
    // For now, use the same artifact URLs but this should be a separate endpoint
    // when the backend supports Orchard artifacts
    if (!manifestMeta) {
      throw new Error('Orchard artifacts manifest not loaded yet.');
    }
    const key = `orchard:${manifestMeta.key}`;
    if (orchardArtifactsKey === key) {
      return;
    }
    setWasmStatus('loading');
    setWasmError(null);
    
    // TODO: Backend should provide Orchard-specific artifact URLs
    // For now, we'll try to use the same endpoints (this may not work)
    const artifactUrls = {
      params: '/zkpf/artifacts/orchard-params',
      vk: '/zkpf/artifacts/orchard-vk',
      pk: '/zkpf/artifacts/orchard-pk',
    };
    
    try {
      // Download Orchard artifacts
      // TODO: Backend should expose these via a dedicated endpoint
      const downloadArtifact = async (path: string): Promise<Uint8Array> => {
        const url = path.startsWith('http://') || path.startsWith('https://')
          ? path
          : `${client.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              `Orchard artifact not available: ${path}. ` +
              'The backend may not support Orchard proofs yet. ' +
              'Please check backend configuration or use the custodial prover.'
            );
          }
          throw new Error(`Failed to download artifact from ${url} (HTTP ${response.status})`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/html')) {
          throw new Error(
            `Artifact endpoint returned HTML instead of binary data: ${path}. ` +
            'This usually means the artifact route is not properly proxied to the backend.'
          );
        }
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      };
      
      const [params, vk, pk] = await Promise.all([
        downloadArtifact(artifactUrls.params),
        downloadArtifact(artifactUrls.vk),
        downloadArtifact(artifactUrls.pk),
      ]);
      
      await prepareOrchardProverArtifacts({
        params,
        vk,
        pk,
        key,
      });
      setOrchardArtifactsKey(key);
      setWasmStatus('ready');
    } catch (err) {
      // If Orchard artifacts aren't available, fall back to custodial
      console.warn('[ProofBuilder] Orchard artifacts not available, will use custodial prover:', err);
      throw new Error('Orchard prover artifacts not available. The backend may not support Orchard proofs yet.');
    }
  }, [client, manifestMeta, orchardArtifactsKey]);

  const applySelectedPolicy = useCallback(
    (input: CircuitInput): CircuitInput => {
      // Only apply policy overrides when we have the full policy object.
      // During race conditions, selectedPolicyId may be set while selectedPolicy
      // is still null. Applying partial overrides would create an inconsistent
      // circuit input where policy_id doesn't match the other policy fields.
      if (!selectedPolicy) {
        return input;
      }
      const next = { ...input, public: { ...input.public } };
      next.public.policy_id = selectedPolicy.policy_id;
      next.public.threshold_raw = selectedPolicy.threshold_raw;
      next.public.required_currency_code = selectedPolicy.required_currency_code;
      next.public.verifier_scope_id = selectedPolicy.verifier_scope_id;
      // Non-custodial rails (Zcash Orchard, on-chain wallets) default to 0
      next.public.required_custodian_id = selectedPolicy.required_custodian_id ?? 0;
      return next;
    },
    [selectedPolicy],
  );

  const generateFromNormalizedJson = useCallback(
    async (normalizedJson: string, options?: { autoSendToVerifier?: boolean }) => {
      setIsGenerating(true);
      setProofProgress('preparing');
      cancelRequestedRef.current = false;
      setShowCancelPending(false);
      setError(null);
      setBundle(null);
      
      try {
        // Yield to allow UI to update before heavy computation
        await yieldToMain();
        
        // Check if this is an Orchard policy
        const policyRailId = customPolicy?.rail_id || selectedPolicy?.rail_id;
        const isOrchardPolicy = policyRailId === 'ZCASH_ORCHARD';
        
        let proofBundle: ProofBundle;
        
        if (isOrchardPolicy) {
          // Use Orchard prover for ZCASH_ORCHARD policies
          // TODO: Build Orchard snapshot from wallet state
          // For now, check if we have the necessary wallet data
          // Get UFVK from localStorage
          const UFVK_STORAGE_KEY = 'zkpf-zcash-ufvk';
          let ufvk = '';
          try {
            ufvk = localStorage.getItem(UFVK_STORAGE_KEY) || '';
          } catch {
            // localStorage might be unavailable
          }
          
          if (!ufvk.trim()) {
            throw new Error(
              'Orchard full viewing key (UFVK) not found. ' +
              'Please go to the Wallet page and create or restore your wallet to generate Orchard proofs.'
            );
          }
          
          // Ensure Orchard artifacts are loaded
          await ensureOrchardArtifacts();
          
          const parsed = JSON.parse(normalizedJson) as CircuitInput;

          if (!walletState.webWallet || walletState.activeAccount == null) {
            throw new Error('Zcash web wallet is not connected. Please open the Wallet tab and connect/sync first.');
          }

          // Build a real Orchard snapshot (anchor + note witnesses) from the wallet.
          const snapshot = await walletState.webWallet.build_orchard_snapshot(
            walletState.activeAccount,
            BigInt(parsed.public.threshold_raw),
          );

          const orchardValue = snapshot.notes.reduce((sum, note) => sum + note.value_zats, 0);

          const snapshotHeight =
            parsed.public.snapshot_block_height ??
            snapshot.height ??
            derivedSnapshotHeight ??
            null;

          const snapshotAnchor = parsed.public.snapshot_anchor_orchard ?? snapshot.anchor ?? null;

          if (snapshotHeight === null || !snapshotAnchor) {
            throw new Error(
              'Orchard snapshot anchor/height missing from attestation. ' +
              'Please sync your Zcash wallet and rebuild the attestation so it includes the Orchard anchor.'
            );
          }

          if (snapshotAnchor.length !== 32) {
            throw new Error(
              `Invalid Orchard anchor length (${snapshotAnchor.length}); expected 32 bytes.`,
            );
          }

          if (orchardValue === null) {
            throw new Error('Orchard balance unavailable; sync your Zcash wallet and try again.');
          }

          if (orchardValue < parsed.public.threshold_raw) {
            throw new Error(
              `Orchard balance ${orchardValue} zats is below the policy threshold ${parsed.public.threshold_raw}.`
            );
          }

          // Check if cancelled during initialization
          if (cancelRequestedRef.current) {
            showToast('Proof generation cancelled', 'error');
            return;
          }
          
          // Update progress and yield before proof generation
          setProofProgress('generating');
          await yieldToMain();
          
          const nowEpoch = Math.floor(Date.now() / 1000);
          const holderId = parsed.attestation.account_id_hash || 'holder-default';

          const holderBinding = computeHolderBinding(holderId, ufvk);
          
          // Build Orchard proof input
          const orchardInput: OrchardProofInput = {
            snapshot: {
              height: snapshotHeight,
              anchor: snapshotAnchor,
              notes: snapshot.notes.map((note) => ({
                value_zats: note.value_zats,
                commitment: note.commitment,
                merkle_path: {
                  siblings: note.merkle_path.siblings,
                  position: note.merkle_path.position,
                },
              })),
            },
            fvk_encoded: ufvk,
            holder_id: holderId,
            threshold_zats: BigInt(parsed.public.threshold_raw),
            orchard_meta: {
              chain_id: 'ZEC',
              pool_id: 'ORCHARD',
              block_height: snapshotHeight,
              anchor_orchard: snapshotAnchor,
              holder_binding: Array.from(holderBinding),
            },
            public_meta: {
              policy_id: parsed.public.policy_id,
              verifier_scope_id: parsed.public.verifier_scope_id,
              current_epoch: parsed.public.current_epoch || nowEpoch,
              required_currency_code: parsed.public.required_currency_code,
            },
          };
          
          // Generate Orchard proof
          proofBundle = await generateOrchardBundle(orchardInput);
          
          // Orchard prover already sets rail_id correctly
          if (!proofBundle.rail_id) {
            proofBundle.rail_id = 'ZCASH_ORCHARD';
          }
        } else {
          // Use custodial prover for non-Orchard policies
          await ensureArtifacts();
          
          // Check if cancelled during initialization
          if (cancelRequestedRef.current) {
            showToast('Proof generation cancelled', 'error');
            return;
          }
          
          // Update progress and yield before proof generation
          setProofProgress('generating');
          await yieldToMain();
          
          // The actual proof generation - this is the CPU-intensive part
          proofBundle = await generateBundle(normalizedJson);
          
          // Set the rail_id on the bundle based on the policy and actual bundle content.
          // The WASM prover creates bundles with empty rail_id for backward compatibility,
          // so we set it explicitly here to ensure proper rail routing and UI display.
          const hasOrchardFields = proofBundle.public_inputs.snapshot_block_height != null 
            && proofBundle.public_inputs.snapshot_anchor_orchard != null;
          
          let railId: string;
          if (policyRailId === 'ZCASH_ORCHARD' && hasOrchardFields) {
            // Bundle has Orchard fields, use ZCASH_ORCHARD rail
            railId = 'ZCASH_ORCHARD';
          } else if (policyRailId === 'ZCASH_ORCHARD' && !hasOrchardFields) {
            // Policy wants ZCASH_ORCHARD but bundle lacks Orchard fields - use custodial
            railId = 'CUSTODIAL_ATTESTATION';
          } else {
            // Use policy rail_id or default to custodial
            railId = policyRailId || 'CUSTODIAL_ATTESTATION';
          }
          
          proofBundle.rail_id = railId;
          
          console.log('[ProofBuilder] Bundle rail assignment:', {
            policyRailId,
            hasOrchardFields,
            assignedRailId: railId,
          });
        }
        
        // Check if cancelled during generation (checked after blocking call completes)
        if (cancelRequestedRef.current) {
          showToast('Proof generation cancelled', 'error');
          return;
        }
        
        // Finalize
        setProofProgress('finalizing');
        await yieldToMain();
        
        setBundle(proofBundle);
        setWasmError(null);
        showToast('Proof bundle generated locally', 'success');

        if (options?.autoSendToVerifier && onBundleReady) {
          onBundleReady(proofBundle, customPolicy);
          showToast('Proof sent to verification console', 'success');
        }
      } catch (err) {
        if (!cancelRequestedRef.current) {
          const message = err instanceof Error ? err.message : 'unknown error';
          setError(message);
          setWasmError(message);
          setWasmStatus('error');
        }
      } finally {
        setIsGenerating(false);
        setProofProgress('idle');
        cancelRequestedRef.current = false;
        setShowCancelPending(false);
      }
    },
    [ensureArtifacts, ensureOrchardArtifacts, onBundleReady, customPolicy, selectedPolicy, derivedShieldedBalance, derivedSnapshotHeight, walletState.webWallet, walletState.activeAccount],
  );

  const handleGenerate = useCallback(async () => {
    if (!rawInput.trim()) {
      setError('Paste an attestation JSON payload before generating a proof.');
      return;
    }
    try {
      const parsed = JSON.parse(rawInput) as CircuitInput;
      const bound = applySelectedPolicy(parsed);
      const normalizedJson = JSON.stringify(bound);
      await generateFromNormalizedJson(normalizedJson, { autoSendToVerifier: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(`Invalid JSON: ${message}`);
    }
  }, [applySelectedPolicy, generateFromNormalizedJson, rawInput]);

  const handleWalletAttestationReady = useCallback(
    async (attestationJson: string) => {
      try {
        console.log('[ProofBuilder Debug] Received attestation JSON from wallet:', attestationJson.slice(0, 500));
        
        const parsed = JSON.parse(attestationJson) as CircuitInput;
        console.log('[ProofBuilder Debug] Parsed attestation:', {
          hasAttestation: !!parsed.attestation,
          hasPublic: !!parsed.public,
          attestationKeys: parsed.attestation ? Object.keys(parsed.attestation) : [],
          publicKeys: parsed.public ? Object.keys(parsed.public) : [],
        });
        
        const bound = applySelectedPolicy(parsed);
        console.log('[ProofBuilder Debug] After policy binding:', {
          threshold_raw: bound.public.threshold_raw,
          required_currency_code: bound.public.required_currency_code,
          verifier_scope_id: bound.public.verifier_scope_id,
          policy_id: bound.public.policy_id,
          nullifier: bound.public.nullifier,
          custodian_pubkey_hash: bound.public.custodian_pubkey_hash,
        });
        
        const pretty = JSON.stringify(bound, null, 2);
        setRawInput(pretty);
        setBundle(null);
        setError(null);
        showToast('Wallet attestation loaded. Generating proof bundle…', 'success');

        const normalizedJson = JSON.stringify(bound);
        console.log('[ProofBuilder Debug] Normalized JSON for WASM (first 500 chars):', normalizedJson.slice(0, 500));
        console.log('[ProofBuilder Debug] Normalized JSON length:', normalizedJson.length);
        
        await generateFromNormalizedJson(normalizedJson, { autoSendToVerifier: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.error('[ProofBuilder Debug] Error processing attestation:', err);
        setError(`Invalid wallet attestation JSON: ${message}`);
        showToast('Wallet attestation JSON could not be parsed', 'error');
      }
    },
    [applySelectedPolicy, generateFromNormalizedJson],
  );

  // Build attestation directly from wallet context (for streamlined custom policy flow)
  // Uses auth wallet for signing when available, otherwise uses synthetic key
  const buildAttestationFromWallet = useCallback(async () => {
    if (!selectedPolicy) {
      setError('Select a verifier policy before building a Zcash attestation.');
      return;
    }

    const effectiveBalance = derivedShieldedBalance ?? navigationState?.walletBalance ?? null;
    const effectiveSnapshotHeight = derivedSnapshotHeight ?? null;

    if (effectiveBalance === null || effectiveSnapshotHeight === null) {
      setError('Wallet balance or snapshot height not available. Please sync your wallet first.');
      return;
    }

    // Try to get UFVK from localStorage
    const UFVK_STORAGE_KEY = 'zkpf-zcash-ufvk';
    let ufvk = '';
    try {
      ufvk = localStorage.getItem(UFVK_STORAGE_KEY) || '';
    } catch {
      // localStorage might be unavailable
    }

    if (!ufvk.trim()) {
      setError('UFVK not found in browser storage. Please go to the Wallet page and re-create your wallet from your seed phrase, or use the "Use standard policy instead" button to access the full wallet connector.');
      return;
    }

    setIsBuildingAttestation(true);
    setError(null);

    try {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const issuedAtEpoch = nowEpoch;
      const validHours = 24;
      const validUntilEpoch = issuedAtEpoch + validHours * 3600;
      const attestationId = Math.floor(Math.random() * 1_000_000);

      const accountSeed = new TextEncoder().encode(`zcash:main:${ufvk.trim()}`);
      const blakeDigest = blake3(accountSeed);
      const accountField = normalizeField(bytesToBigIntBE(blakeDigest));
      const accountBytes = bigIntToLittleEndianBytes(accountField);
      const accountHex = bytesToHex(accountBytes);

      const scopeBigInt = BigInt(selectedPolicy.verifier_scope_id);
      const policyBigInt = BigInt(selectedPolicy.policy_id);
      const epochBigInt = BigInt(nowEpoch);
      const custodianId = selectedPolicy.required_custodian_id ?? 0;

      const circuitInput: CircuitInput = {
        attestation: {
          balance_raw: Math.floor(effectiveBalance),
          currency_code_int: selectedPolicy.required_currency_code,
          custodian_id: custodianId,
          attestation_id: attestationId,
          issued_at: issuedAtEpoch,
          valid_until: validUntilEpoch,
          account_id_hash: accountHex,
          custodian_pubkey: { x: new Array<number>(32).fill(0), y: new Array<number>(32).fill(0) },
          signature: {
            r: new Array<number>(32).fill(0),
            s: new Array<number>(32).fill(0),
          },
          message_hash: new Array<number>(32).fill(0),
        },
        public: {
          threshold_raw: selectedPolicy.threshold_raw,
          required_currency_code: selectedPolicy.required_currency_code,
          required_custodian_id: custodianId,
          current_epoch: nowEpoch,
          verifier_scope_id: selectedPolicy.verifier_scope_id,
          policy_id: selectedPolicy.policy_id,
          nullifier: ''.padEnd(64, '0'),
          custodian_pubkey_hash: ''.padEnd(64, '0'),
        },
      };

      const normalizedJson = JSON.stringify(circuitInput);

      // Compute message hash
      const messageHashBytes = await wasmComputeAttestationMessageHash(normalizedJson);
      circuitInput.attestation.message_hash = numberArrayFromBytes(messageHashBytes);

      let pubkeyX!: Uint8Array;
      let pubkeyY!: Uint8Array;
      let rBytes!: Uint8Array;
      let sBytes!: Uint8Array;

      // Use auth wallet for signing if connected, otherwise generate synthetic key
      if (authStatus === 'connected' && authAccount && authSignMessage) {
        try {
          // Sign the message hash using the connected wallet
          const sigBytes = await authSignMessage(messageHashBytes);
          
          // For wallets that return secp256k1 ECDSA signatures (Ethereum, etc.),
          // signatures are typically 64-65 bytes: r (32) || s (32) || [v (1)]
          // We try to recover the public key and use the original signature.
          //
          // However, passkeys return WebAuthn signatures which are:
          // 1. P-256 (secp256r1), NOT secp256k1
          // 2. DER-encoded ASN.1 format, not raw r||s
          // When recovery fails, we generate a deterministic secp256k1 keypair
          // and sign with it to maintain the auth wallet binding.
          
          let signatureValid = false;
          
          if (sigBytes.length >= 64 && sigBytes.length <= 72) {
            // Likely raw r||s or r||s||v format (secp256k1 wallets)
            const possibleR = sigBytes.slice(0, 32);
            const possibleS = sigBytes.slice(32, 64);
            const recovery = sigBytes.length > 64 ? sigBytes[64] : 0;
            const recoveryBit = recovery >= 27 ? recovery - 27 : recovery;
            
            const compactSig = new Uint8Array(65);
            compactSig[0] = recoveryBit;
            compactSig.set(possibleR, 1);
            compactSig.set(possibleS, 33);
            
            try {
              const recoveredBytes = secp256k1.recoverPublicKey(compactSig, messageHashBytes, { prehash: false });
              if (recoveredBytes) {
                const pubkeyPoint = secp256k1.Point.fromBytes(recoveredBytes);
                const uncompressed = pubkeyPoint.toBytes(false);
                pubkeyX = uncompressed.slice(1, 33);
                pubkeyY = uncompressed.slice(33);
                rBytes = possibleR;
                sBytes = possibleS;
                signatureValid = true;
              }
            } catch {
              // Recovery failed - signature may not be secp256k1 format
            }
          }
          
          if (!signatureValid) {
            // Signature is not in secp256k1 format (e.g., passkey P-256 DER).
            // Generate a deterministic secp256k1 keypair from the auth signature
            // and create a valid secp256k1 signature for the circuit.
            const keyHash = blake3(sigBytes);
            const derivedPrivKey = keyHash;
            // In @noble/secp256k1 v3, signAsync returns Uint8Array (64 bytes: r||s)
            const derivedSigBytes = await secp256k1.signAsync(messageHashBytes, derivedPrivKey, { prehash: false });
            const uncompressed = secp256k1.getPublicKey(derivedPrivKey, false) as Uint8Array;
            pubkeyX = uncompressed.slice(1, 33);
            pubkeyY = uncompressed.slice(33);
            rBytes = derivedSigBytes.slice(0, 32);
            sBytes = derivedSigBytes.slice(32, 64);
          }
          
          showToast(`Signed with ${authAccount.displayName}`, 'success');
        } catch (sigErr) {
          console.warn('Auth wallet signing failed, falling back to synthetic key:', sigErr);
          // Fallback to synthetic key
          const demoPrivKey = secp256k1.utils.randomSecretKey();
          // In @noble/secp256k1 v3, signAsync returns Uint8Array (64 bytes: r||s)
          const demoSigBytes = await secp256k1.signAsync(messageHashBytes, demoPrivKey, { prehash: false });
          const uncompressed = secp256k1.getPublicKey(demoPrivKey, false) as Uint8Array;
          pubkeyX = uncompressed.slice(1, 33);
          pubkeyY = uncompressed.slice(33);
          rBytes = demoSigBytes.slice(0, 32);
          sBytes = demoSigBytes.slice(32, 64);
        }
      } else {
        // Generate synthetic signing key (demo mode for non-custodial)
        const demoPrivKey = secp256k1.utils.randomSecretKey();
        // In @noble/secp256k1 v3, signAsync returns Uint8Array (64 bytes: r||s)
        const demoSigBytes = await secp256k1.signAsync(messageHashBytes, demoPrivKey, {
          prehash: false,
        });
        const uncompressed = secp256k1.getPublicKey(demoPrivKey, false) as Uint8Array;
        pubkeyX = uncompressed.slice(1, 33);
        pubkeyY = uncompressed.slice(33);
        rBytes = demoSigBytes.slice(0, 32);
        sBytes = demoSigBytes.slice(32, 64);
      }

      circuitInput.attestation.custodian_pubkey = {
        x: numberArrayFromBytes(pubkeyX),
        y: numberArrayFromBytes(pubkeyY),
      };
      circuitInput.attestation.signature = {
        r: numberArrayFromBytes(rBytes),
        s: numberArrayFromBytes(sBytes),
      };

      // Compute pubkey hash
      const pubkeyHashBytes = await wasmComputeCustodianPubkeyHash(pubkeyX, pubkeyY);
      circuitInput.public.custodian_pubkey_hash = bytesToHex(pubkeyHashBytes);

      // Compute nullifier
      const nullifierBytes = await wasmComputeNullifier(
        accountBytes,
        scopeBigInt,
        policyBigInt,
        epochBigInt,
      );
      circuitInput.public.nullifier = bytesToHex(nullifierBytes);

      const attestationJson = JSON.stringify(circuitInput, null, 2);
      setRawInput(attestationJson);
      setError(null);
      showToast('Zcash attestation JSON generated successfully!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build attestation';
      console.error('Failed to build attestation from wallet:', err);
      setError(message);
      showToast(message, 'error');
    } finally {
      setIsBuildingAttestation(false);
    }
  }, [selectedPolicy, derivedShieldedBalance, derivedSnapshotHeight, navigationState?.walletBalance, authStatus, authAccount, authSignMessage]);

  const handlePrefillWorkbench = useCallback(() => {
    if (bundle && onBundleReady) {
      onBundleReady(bundle, customPolicy);
      showToast('Proof sent to verification console', 'success');
    }
  }, [bundle, onBundleReady, customPolicy]);

  const handleDownloadBundle = useCallback(() => {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `proof-bundle-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    showToast('Bundle JSON downloaded', 'success');
  }, [bundle]);

  const handleCopyBundle = useCallback(async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2));
      showToast('Bundle copied to clipboard', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      showToast(`Failed to copy bundle: ${message}`, 'error');
    }
  }, [bundle]);

  const handleCancelGeneration = useCallback(() => {
    cancelRequestedRef.current = true;
    setShowCancelPending(true);
    showToast('Cancellation requested — will take effect after current step completes', 'error');
  }, []);

  const wasmStatusClass =
    wasmStatus === 'ready'
      ? 'connected'
      : wasmStatus === 'loading'
        ? 'connecting'
        : wasmStatus === 'error'
          ? 'error'
          : '';

  const disabled =
    !rawInput.trim() ||
    isGenerating ||
    paramsQuery.isLoading ||
    wasmStatus === 'loading' ||
    !manifestMeta;

  const rail = railFromBundle(bundle);
  const bundleJson = useMemo(() => (bundle ? JSON.stringify(bundle, null, 2) : ''), [bundle]);

  // Quick start: Load sample bundle and send to verification
  const handleQuickStart = useCallback(async () => {
    try {
      const response = await fetch('/sample-bundle-orchard.json');
      if (!response.ok) throw new Error(`Failed to load sample (${response.status})`);
      const sampleBundle = await response.json();
      
      // Create a synthetic policy matching the sample bundle's parameters
      const syntheticPolicy: PolicyDefinition = {
        policy_id: sampleBundle.public_inputs.policy_id,
        threshold_raw: sampleBundle.public_inputs.threshold_raw,
        required_currency_code: sampleBundle.public_inputs.required_currency_code,
        verifier_scope_id: sampleBundle.public_inputs.verifier_scope_id,
        category: 'ZCASH_ORCHARD',
        rail_id: sampleBundle.rail_id || 'ZCASH_ORCHARD',
        label: 'Zcash Shielded Proof',
      };
      
      showToast('Loading verification…', 'success');
      
      if (onBundleReady) {
        onBundleReady(sampleBundle, syntheticPolicy);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sample';
      showToast(message, 'error');
    }
  }, [onBundleReady]);

  return (
    <section className="proof-builder card">
      <header>
        <p className="eyebrow">Prover workspace</p>
        <h2>Build a zero-knowledge proof bundle</h2>
      </header>
      <p className="muted">
        Generate a cryptographic proof that verifies you meet a balance requirement—without revealing your actual balance or wallet addresses.
      </p>

      {/* Quick Start Banner - prominent for first-time visitors */}
      {!bundle && !rawInput.trim() && !isCustomPolicyFromWallet && (
        <div className="quick-start-banner">
          <div className="quick-start-content">
            <div className="quick-start-icon">⚡</div>
            <div className="quick-start-text">
              <h3>See it in action</h3>
              <p>Experience the full verification flow instantly with sample data.</p>
            </div>
            <button 
              type="button" 
              className="quick-start-button"
              onClick={handleQuickStart}
            >
              Try it now →
            </button>
          </div>
        </div>
      )}

      {/* Custom Policy Banner - shown when navigating from wallet */}
      {customPolicy && navigationState?.fromWallet && (
        <div className="custom-policy-banner">
          <div className="custom-policy-banner-content">
            <span className="custom-policy-banner-icon">✨</span>
            <div className="custom-policy-banner-text">
              <strong>Custom proof tailored to your balance</strong>
              <p>
                A policy was automatically created to prove your exact shielded balance of{' '}
                <strong>{((navigationState.walletBalance ?? 0) / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ZEC</strong>.
                This removes the friction of selecting a policy manually.
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
              Use standard policy instead
            </button>
          </div>
        </div>
      )}

      {/* STEP 1: Policy Selection - FIRST */}
      <div className="builder-policy-panel builder-policy-panel-primary">
        <header className="policy-panel-header">
          <div className="policy-step-badge">Step 1</div>
          <div>
            <h3>Select a verification policy</h3>
            <p className="muted small policy-explanation">
              A <strong>policy</strong> defines what the verifier will check—for example, "prove you have at least $100,000 USD" or "prove Zcash balance ≥ 50 ZEC." 
              Your counterparty (bank, exchange, lender) sets the policy requirements you need to meet. Choose the policy that matches their request.
            </p>
          </div>
        </header>
        
        <label className="field policy-selector-field">
          <span>Choose policy</span>
          {policiesQuery.isLoading ? (
            <div className="policy-loading">
              <span className="spinner small"></span>
              <span>Loading available policies…</span>
            </div>
          ) : (
            <select
              value={selectedPolicyId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedPolicyId(value ? Number(value) : null);
              }}
              disabled={!policies.length}
              className="policy-select-large"
            >
              {!policies.length ? (
                <option value="">No policies available</option>
              ) : (
                policies.map((policy) => {
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
        </label>
        
        {selectedPolicy && (
          <div className={`policy-selected-card ${customPolicy && selectedPolicy.policy_id === customPolicy.policy_id ? 'policy-selected-custom' : ''}`}>
            <div className="policy-selected-header">
              <span className="policy-selected-badge">
                {customPolicy && selectedPolicy.policy_id === customPolicy.policy_id ? '✨ Custom Policy' : 'Selected Policy'}
              </span>
              <span className="policy-id-badge">ID: {selectedPolicy.policy_id}</span>
            </div>
            {selectedPolicy.description && (
              <p className="policy-description">{selectedPolicy.description}</p>
            )}
            <dl className="policy-details">
              <div>
                <dt>Label</dt>
                <dd>{policyDisplayName(selectedPolicy)}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{policyCategoryLabel(selectedPolicy)}</dd>
              </div>
              <div>
                <dt>Rail</dt>
                <dd>{policyRailLabel(selectedPolicy)}</dd>
              </div>
              <div>
                <dt>Threshold</dt>
                <dd className="policy-threshold-value">{formatPolicyThreshold(selectedPolicy).formatted}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{selectedPolicy.verifier_scope_id}</dd>
              </div>
            </dl>
            {selectedPolicy.useCases && selectedPolicy.useCases.length > 0 && (
              <div className="policy-use-cases">
                <span className="use-cases-label">Use cases:</span>
                <span className="use-cases-list">{selectedPolicy.useCases.join(' • ')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connection Status */}
      <div className="builder-status-grid">
        <div className={`builder-status ${connectionState}`}>
          <span className="status-dot" />
          <div>
            <p className="builder-status-label">
              {connectionState === 'connected'
                ? 'Verifier online'
                : connectionState === 'connecting'
                  ? 'Connecting…'
                  : connectionState === 'error'
                    ? 'Backend unavailable'
                    : 'Idle'}
            </p>
            <p className="builder-status-detail">
              {connectionState === 'connected'
                ? 'Ready to generate and verify proofs'
                : 'Verifier must be reachable to submit proofs'}
            </p>
          </div>
        </div>
        <div className={`builder-status ${wasmStatusClass}`}>
          <span className="status-dot" />
          <div>
            {wasmStatus === 'idle' ? (
              <p className="builder-status-label">Prover ready to initialize</p>
            ) : (
              <>
                <p className="builder-status-label">
                  {wasmStatus === 'ready'
                    ? 'WASM prover ready'
                    : wasmStatus === 'loading'
                      ? 'Preparing WASM runtime…'
                      : wasmError?.includes('proof generation')
                        ? 'Proof generation failed'
                        : wasmError?.includes('hash mismatch')
                          ? 'Artifact download corrupted'
                          : 'WASM initialization failed'}
                </p>
                <p className="builder-status-detail">
                  {manifestMeta
                    ? `Circuit v${manifestMeta.circuitVersion} • Manifest v${manifestMeta.manifestVersion}`
                    : 'Fetching params + proving key'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {paramsQuery.error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{(paramsQuery.error as Error).message ?? 'Unable to load verifier params'}</span>
        </div>
      )}
      {wasmError && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{wasmError}</span>
        </div>
      )}

      {/* Streamlined Action Panel - shown when coming from wallet with custom policy */}
      {isCustomPolicyFromWallet && (
        <div className="builder-streamlined-panel">
          <header className="streamlined-panel-header">
            <div className="policy-step-badge policy-step-badge-success">Step 2</div>
            <div>
              <h3>Generate your proof</h3>
              <p className="muted small">
                Your wallet is connected. Generate the attestation JSON from your wallet data, then create the cryptographic proof.
              </p>
            </div>
          </header>

          <div className="streamlined-wallet-info">
            <div className="streamlined-info-row">
              <span className="streamlined-info-label">Shielded Balance</span>
              <span className="streamlined-info-value">
                {((derivedShieldedBalance ?? navigationState?.walletBalance ?? 0) / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ZEC
              </span>
            </div>
            {derivedSnapshotHeight && (
              <div className="streamlined-info-row">
                <span className="streamlined-info-label">Snapshot Height</span>
                <span className="streamlined-info-value mono">{derivedSnapshotHeight.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="streamlined-actions">
            <button 
              type="button" 
              onClick={buildAttestationFromWallet}
              disabled={isBuildingAttestation || !selectedPolicy}
              className="streamlined-action-button"
            >
              {isBuildingAttestation ? 'Building attestation…' : 'Generate Zcash attestation JSON'}
            </button>
            <button 
              type="button" 
              onClick={handleGenerate}
              disabled={disabled}
              className="streamlined-action-button primary"
            >
              {isGenerating ? 'Generating proof…' : 'Generate proof bundle'}
            </button>
          </div>

          {rawInput.trim() && (
            <div className="streamlined-attestation-preview">
              <header>
                <span className="preview-badge">✓ Attestation JSON Ready</span>
              </header>
              <pre className="attestation-preview-code">{rawInput.slice(0, 500)}{rawInput.length > 500 ? '...' : ''}</pre>
            </div>
          )}

          {error && error.includes('UFVK not found') && (
            <div className="streamlined-fallback-hint">
              <p className="muted small">
                💡 <strong>Tip:</strong> Your wallet was restored from a previous session. To use the streamlined flow, 
                please go back to the <a href="/wallet">Wallet page</a> and re-enter your seed phrase to regenerate your wallet keys. 
                Alternatively, click "Use standard policy instead" above to access the full wallet connector where you can enter your seed phrase or UFVK directly.
              </p>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Wallet / Data Source - hidden when coming from wallet with custom policy */}
      {!isCustomPolicyFromWallet && (
        <div className="builder-data-source-panel">
          <header className="data-source-header">
            <div className="policy-step-badge">Step 2</div>
            <div>
              <h3>Connect your wallet</h3>
              <p className="muted small">
                Set up your Zcash wallet to prove your balance. You can also connect an additional wallet for signing.
              </p>
            </div>
          </header>

          {/* Quick start guidance for users without a wallet */}
          {!hasZcashWallet && (
            <div className="builder-quickstart-card">
              <div className="quickstart-icon">🚀</div>
              <div className="quickstart-content">
                <h4>New here? Start with the Wallet</h4>
                <p className="muted small">
                  The easiest way to get started is to create a Zcash wallet first. You'll be able to receive funds and generate proofs.
                </p>
                <Link to="/wallet" className="quickstart-link">
                  Go to Wallet →
                </Link>
              </div>
            </div>
          )}

          {/* Auth wallet connection - for signing attestations */}
          <div className="builder-auth-section">
            <div className="auth-section-header">
              <h4>🔐 Optional: Connect a signing wallet</h4>
              <p className="muted small">
                Connect a wallet (Solana, NEAR, or Passkey) to cryptographically sign your attestation. 
                This links your proof to your identity. Not required for basic proofs.
              </p>
            </div>
            <div className="auth-section-controls">
              <AuthButton />
              {authStatus === 'connected' && authAccount && (
                <div className="auth-connected-badge">
                  <span className="auth-badge-icon">✓</span>
                  <span>Will sign with {authAccount.displayName}</span>
                </div>
              )}
            </div>
          </div>

          <ZcashWalletConnector
            onAttestationReady={handleWalletAttestationReady}
            onShowToast={showToast}
            policy={selectedPolicy ?? undefined}
            authAccount={authAccount}
            authSignMessage={authStatus === 'connected' ? authSignMessage : undefined}
          />
        </div>
      )}

      {/* STEP 3: Manual JSON Input (Alternative) - hidden when coming from wallet with custom policy */}
      {!isCustomPolicyFromWallet && (
        <div className="builder-manual-panel">
          <header className="manual-panel-header">
            <div className="policy-step-badge policy-step-badge-alt">Alternative</div>
            <div>
              <h3>Or paste attestation JSON directly</h3>
              <p className="muted small">
                If you have attestation JSON from your custody or treasury system, paste it here instead of connecting a wallet.
              </p>
            </div>
          </header>

          <div className="builder-grid">
            <label className="field">
              <span>Attestation JSON</span>
              <textarea
                value={rawInput}
                onChange={(event) => {
                  setRawInput(event.target.value);
                  setError(null);
                }}
                placeholder='{"attestation": {...}, "public": {...}}'
                spellCheck={false}
              />
            </label>
            <aside className="builder-sidepanel">
              <p>
                This payload matches the <code>ZkpfCircuitInput</code> shape: balances and custody details under{' '}
                <code>attestation</code> and policy fields under <code>public</code>.
              </p>
              <ul>
                <li>Witness data stays in your browser; the proving key is never uploaded.</li>
                <li>The selected policy above will override policy fields in the JSON.</li>
                <li>Make sure the nullifier and custodian hash are normalized to 32-byte values.</li>
              </ul>
              <div className="builder-sidepanel-actions">
                <button type="button" className="tiny-button" onClick={handleLoadSample}>
                  Load sample attestation
                </button>
                <button type="button" className="ghost tiny-button" onClick={handleClear}>
                  Clear input
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* Generate Button - hidden when in streamlined mode (buttons are in streamlined panel) */}
      {!isCustomPolicyFromWallet && (
        <div className="builder-actions">
          <button type="button" onClick={handleGenerate} disabled={disabled}>
            {isGenerating ? 'Generating proof…' : 'Generate proof bundle'}
          </button>
          {!selectedPolicy && (
            <p className="muted small builder-action-hint">
              ↑ Select a policy in Step 1 before generating
            </p>
          )}
        </div>
      )}

      {/* Proof Generation Progress Overlay */}
      {isGenerating && (
        <div className="proof-progress-overlay">
          <div className="proof-progress-card">
            <div className="proof-progress-spinner">
              <div className="spinner-ring"></div>
            </div>
            <h3>Generating Zero-Knowledge Proof</h3>
            <p className="proof-progress-message">
              {PROOF_PROGRESS_MESSAGES[proofProgress]}
            </p>
            <div className="proof-progress-steps">
              <div className={`proof-step ${proofProgress === 'preparing' ? 'active' : proofProgress !== 'idle' ? 'complete' : ''}`}>
                <span className="step-indicator">1</span>
                <span>Initialize</span>
              </div>
              <div className={`proof-step ${proofProgress === 'generating' ? 'active' : proofProgress === 'finalizing' ? 'complete' : ''}`}>
                <span className="step-indicator">2</span>
                <span>Compute Proof</span>
              </div>
              <div className={`proof-step ${proofProgress === 'finalizing' ? 'active' : ''}`}>
                <span className="step-indicator">3</span>
                <span>Finalize</span>
              </div>
            </div>
            <p className="proof-progress-hint">
              Please wait — this computation runs entirely in your browser and may take up to 600 seconds.
              The page will become unresponsive while the proof is being generated.
            </p>
            <button 
              type="button" 
              className="proof-cancel-button"
              onClick={handleCancelGeneration}
              disabled={showCancelPending}
            >
              {showCancelPending ? 'Cancelling…' : 'Cancel Generation'}
            </button>
          </div>
        </div>
      )}

      {!rawInput.trim() && !error && (
        <p className="muted small">
          Paste or load attestation JSON above to enable the prover. The checklist at the top of the page will move on
          once a bundle is ready.
        </p>
      )}

      {error && (
        <div className="error-message">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {bundle && !error && (
        <>
          <div className="builder-success">
            <div>
              <p className="builder-success-title">Proof bundle ready</p>
              <p className="muted small">
                Review the normalized JSON, download it for your records, or send it to the proof
                console for verification.
              </p>
            </div>
            <div className="builder-success-actions">
              <button type="button" onClick={handlePrefillWorkbench}>
                Send to verifier
              </button>
              <button type="button" onClick={handleDownloadBundle}>
                Download JSON
              </button>
              <button type="button" onClick={handleCopyBundle}>
                Copy JSON
              </button>
            </div>
          </div>
          <div className="builder-preview">
            <pre>{bundleJson}</pre>
          </div>
          <BundleSummary bundle={bundle} assetRail={rail} />
        </>
      )}

    </section>
  );
}
