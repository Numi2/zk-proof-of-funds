import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CircuitInput, ProofBundle, PolicyDefinition } from '../types/zkpf';
import { formatPolicyThreshold, policyCategoryLabel, policyDisplayName, policyRailLabel } from '../utils/policy';
import type { ConnectionState } from './ProofWorkbench';
import type { AssetRail } from '../types/ui';
import { ZkpfClient } from '../api/zkpf';
import { BundleSummary } from './BundleSummary';
import { WalletConnector } from './WalletConnector';
import { BtcWalletConnector } from './BtcWalletConnector';
import { ZcashWalletConnector } from './ZcashWalletConnector';
import { ZashiSessionConnector } from './ZashiSessionConnector';
import { prepareProverArtifacts, generateBundle } from '../wasm/prover';

interface Props {
  client: ZkpfClient;
  connectionState: ConnectionState;
  onBundleReady?: (bundle: ProofBundle) => void;
}

type WasmStatus = 'idle' | 'loading' | 'ready' | 'error';

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

export function ProofBuilder({ client, connectionState, onBundleReady }: Props) {
  const [rawInput, setRawInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProofBundle | null>(null);
  const [wasmStatus, setWasmStatus] = useState<WasmStatus>('idle');
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
  const [walletMode, setWalletMode] = useState<'evm' | 'btc' | 'zcash' | 'zashi'>('zcash');
  const [preparedKey, setPreparedKey] = useState<string | null>(null);

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
  const policies = useMemo<PolicyDefinition[]>(() => policiesQuery.data ?? [], [policiesQuery.data]);

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

  const selectedPolicy = selectedPolicyId
    ? policies.find((policy) => policy.policy_id === selectedPolicyId) ?? null
    : null;

  const zashiPolicies = useMemo(
    () =>
      policies.filter(
        (policy) => policy.category?.toUpperCase() === 'ZASHI' || policy.required_custodian_id === 8001,
      ),
    [policies],
  );

  const activeZashiPolicy = useMemo(() => {
    if (walletMode !== 'zashi') {
      return null;
    }
    if (selectedPolicy && zashiPolicies.some((policy) => policy.policy_id === selectedPolicy.policy_id)) {
      return selectedPolicy;
    }
    return null;
  }, [selectedPolicy, walletMode, zashiPolicies]);

  useEffect(() => {
    if (walletMode !== 'zashi') {
      return;
    }
    if (!zashiPolicies.length) {
      if (selectedPolicyId !== null) {
        setSelectedPolicyId(null);
      }
      return;
    }
    if (!selectedPolicyId || !zashiPolicies.some((policy) => policy.policy_id === selectedPolicyId)) {
      setSelectedPolicyId(zashiPolicies[0].policy_id);
    }
  }, [walletMode, selectedPolicyId, zashiPolicies]);

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
    const { params, pk } = await client.loadArtifactsForKey(manifestMeta.key, manifestMeta.artifactUrls);
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

  const applySelectedPolicy = useCallback(
    (input: CircuitInput): CircuitInput => {
      if (!selectedPolicyId) {
        return input;
      }
      const next = { ...input, public: { ...input.public } };
      next.public.policy_id = selectedPolicyId;
      if (selectedPolicy) {
        next.public.threshold_raw = selectedPolicy.threshold_raw;
        next.public.required_currency_code = selectedPolicy.required_currency_code;
        next.public.required_custodian_id = selectedPolicy.required_custodian_id;
        next.public.verifier_scope_id = selectedPolicy.verifier_scope_id;
      }
      return next;
    },
    [selectedPolicy, selectedPolicyId],
  );

  const generateFromNormalizedJson = useCallback(
    async (normalizedJson: string, options?: { autoSendToVerifier?: boolean }) => {
      setIsGenerating(true);
      setError(null);
      setBundle(null);
      try {
        await ensureArtifacts();
        const proofBundle = await generateBundle(normalizedJson);
        setBundle(proofBundle);
        setWasmError(null);
        showToast('Proof bundle generated locally', 'success');

        if (options?.autoSendToVerifier && onBundleReady) {
          onBundleReady(proofBundle);
          showToast('Proof sent to verification console', 'success');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        setError(message);
        setWasmError(message);
        setWasmStatus('error');
      } finally {
        setIsGenerating(false);
      }
    },
    [ensureArtifacts, onBundleReady],
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
        const parsed = JSON.parse(attestationJson) as CircuitInput;
        const bound = applySelectedPolicy(parsed);
        const pretty = JSON.stringify(bound, null, 2);
        setRawInput(pretty);
        setBundle(null);
        setError(null);
        showToast('Wallet attestation loaded. Generating proof bundle…', 'success');

        const normalizedJson = JSON.stringify(bound);
        await generateFromNormalizedJson(normalizedJson, { autoSendToVerifier: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        setError(`Invalid wallet attestation JSON: ${message}`);
        showToast('Wallet attestation JSON could not be parsed', 'error');
      }
    },
    [applySelectedPolicy, generateFromNormalizedJson],
  );

  const handlePrefillWorkbench = useCallback(() => {
    if (bundle && onBundleReady) {
      onBundleReady(bundle);
      showToast('Proof sent to verification console', 'success');
    }
  }, [bundle, onBundleReady]);

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

  const handleZashiBundleReady = useCallback(
    (remoteBundle: ProofBundle) => {
      setBundle(remoteBundle);
      setRawInput('');
      setError(null);
      setWasmError(null);
      if (onBundleReady) {
        onBundleReady(remoteBundle);
      }
    },
    [onBundleReady],
  );

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

  return (
    <section className="proof-builder card">
      <header>
        <p className="eyebrow">Prover workspace</p>
        <h2>Create a proof bundle from attestation JSON</h2>
      </header>
      <p className="muted">
        The prover runs in your browser. Connect a wallet to auto-fill a non-custodial attestation, or paste the
        attestation JSON exported by your custody or treasury system to generate a shareable proof bundle, without
        sending sensitive witness data to the verifier.
      </p>

      <div className="wallet-mode-toggle">
        <p className="muted small">
          <strong>Choose wallet rail</strong>
        </p>
        <div className="wallet-mode-options">
          <label>
            <input
              type="radio"
              name="wallet-mode"
              value="evm"
              checked={walletMode === 'evm'}
              onChange={() => setWalletMode('evm')}
            />
            <span>Ethereum / EVM wallet (browser extension)</span>
          </label>
          <label>
            <input
              type="radio"
              name="wallet-mode"
              value="btc"
              checked={walletMode === 'btc'}
              onChange={() => setWalletMode('btc')}
            />
            <span>Bitcoin wallet (manual signing)</span>
          </label>
          <label>
            <input
              type="radio"
              name="wallet-mode"
              value="zcash"
              checked={walletMode === 'zcash'}
              onChange={() => setWalletMode('zcash')}
            />
            <span>Zcash wallet (UFVK + EVM signer)</span>
          </label>
          <label>
            <input
              type="radio"
              name="wallet-mode"
              value="zashi"
              checked={walletMode === 'zashi'}
              onChange={() => setWalletMode('zashi')}
            />
            <span>Zashi provider session (custodial)</span>
          </label>
        </div>
      </div>

      {walletMode === 'evm' && (
        <WalletConnector
          onAttestationReady={handleWalletAttestationReady}
          onShowToast={showToast}
          policy={selectedPolicy ?? undefined}
        />
      )}
      {walletMode === 'zashi' && (
        <ZashiSessionConnector
          client={client}
          policy={activeZashiPolicy}
          onBundleReady={handleZashiBundleReady}
          onShowToast={showToast}
        />
      )}
      {walletMode === 'btc' && (
        <BtcWalletConnector
          onAttestationReady={handleWalletAttestationReady}
          onShowToast={showToast}
          policy={selectedPolicy ?? undefined}
        />
      )}
      {walletMode === 'zcash' && (
        <ZcashWalletConnector
          onAttestationReady={handleWalletAttestationReady}
          onShowToast={showToast}
          policy={selectedPolicy ?? undefined}
        />
      )}
      <p className="muted small">
        This page lines up with the <strong>“Build proof bundle”</strong> step in the checklist. When you finish here,
        send the bundle to the Verify console to verify it.
      </p>

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
                ? 'Use Verify console below to verify bundles'
                : 'Verifier must be reachable to submit proofs'}
            </p>
          </div>
        </div>
        <div className={`builder-status ${wasmStatusClass}`}>
          <span className="status-dot" />
          <div>
            {wasmStatus === 'idle' ? (
              <button type="button" className="tiny-button" onClick={handleLoadSample}>
                Load sample attestation
              </button>
            ) : (
              <>
                <p className="builder-status-label">
                  {wasmStatus === 'ready'
                    ? 'WASM prover ready'
                    : wasmStatus === 'loading'
                      ? 'Preparing WASM runtime…'
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

      <p className="muted small">
        <strong>Step 1.</strong> Prepare the attestation payload you want to prove over. You can paste JSON from your
        custody / treasury systems or load the sample attestation to see the expected shape.
      </p>
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
            <li>Use policies from the verifier to fill in threshold, currency, scope, and policy_id fields.</li>
            <li>Make sure the nullifier and custodian hash are already normalized to 32-byte values.</li>
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

      <div className="builder-policy-panel">
        <p className="muted small">
          <strong>Step 2.</strong> Bind the prover input to a concrete verifier policy so the resulting bundle can be
          checked against your counterparty’s requested minimum balance.
        </p>
        <label className="field">
          <span>Bind to verifier policy</span>
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
                policies.map((policy) => {
                  const label = policyDisplayName(policy);
                  const threshold = formatPolicyThreshold(policy).formatted;
                  return (
                    <option key={policy.policy_id} value={policy.policy_id}>
                      {label} • {threshold} • Scope {policy.verifier_scope_id}
                    </option>
                  );
                })
              )}
            </select>
          )}
        </label>
        {selectedPolicy && (
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
              <dd>{formatPolicyThreshold(selectedPolicy).formatted}</dd>
            </div>
            <div>
              <dt>Custodian</dt>
              <dd>
                {selectedPolicy.required_custodian_id === 0
                  ? 'Any custodian'
                  : selectedPolicy.required_custodian_id}
              </dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{selectedPolicy.verifier_scope_id}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="builder-actions">
        <button type="button" onClick={handleGenerate} disabled={disabled}>
          {isGenerating ? 'Generating proof…' : 'Generate proof bundle'}
        </button>
      </div>

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
            <pre>{JSON.stringify(bundle, null, 2)}</pre>
          </div>
          <BundleSummary bundle={bundle} assetRail={rail} />
        </>
      )}

    </section>
  );
}
