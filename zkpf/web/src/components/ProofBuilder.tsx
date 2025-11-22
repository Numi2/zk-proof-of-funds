import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CircuitInput, ProofBundle } from '../types/zkpf';
import type { ConnectionState } from './ProofWorkbench';
import type { AssetRail } from '../types/ui';
import { ZkpfClient } from '../api/zkpf';
import { BundleSummary } from './BundleSummary';
import { prepareProverArtifacts, generateBundle } from '../wasm/prover';
import { toUint8Array } from '../utils/bytes';

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

  const paramsQuery = useQuery({
    queryKey: ['params', client.baseUrl],
    queryFn: () => client.getParams(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const proverArtifacts = useMemo(() => {
    if (!paramsQuery.data) {
      return null;
    }
    return {
      paramsBytes: toUint8Array(paramsQuery.data.params),
      pkBytes: toUint8Array(paramsQuery.data.pk),
      key: `${paramsQuery.data.params_hash}:${paramsQuery.data.pk_hash}`,
      manifestVersion: paramsQuery.data.manifest_version,
      circuitVersion: paramsQuery.data.circuit_version,
      paramsHash: paramsQuery.data.params_hash,
      pkHash: paramsQuery.data.pk_hash,
    };
  }, [paramsQuery.data]);

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
    if (!proverArtifacts) {
      throw new Error('Verifier manifest not loaded yet.');
    }
    if (wasmStatus !== 'ready') {
      setWasmStatus('loading');
      setWasmError(null);
    }
    await prepareProverArtifacts({
      params: proverArtifacts.paramsBytes,
      pk: proverArtifacts.pkBytes,
      key: proverArtifacts.key,
    });
    setWasmStatus('ready');
  }, [proverArtifacts, wasmStatus]);

  const handleGenerate = useCallback(async () => {
    if (!rawInput.trim()) {
      setError('Paste an attestation JSON payload before generating a proof.');
      return;
    }
    let normalizedJson: string;
    try {
      const parsed = JSON.parse(rawInput) as CircuitInput;
      normalizedJson = JSON.stringify(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(`Invalid JSON: ${message}`);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setBundle(null);
    try {
      await ensureArtifacts();
      const proofBundle = await generateBundle(normalizedJson);
      setBundle(proofBundle);
      setWasmError(null);
      showToast('Proof bundle generated locally', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setError(message);
      setWasmError(message);
      setWasmStatus('error');
    } finally {
      setIsGenerating(false);
    }
  }, [ensureArtifacts, rawInput]);

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
    !proverArtifacts;

  const rail = railFromBundle(bundle);

  return (
    <section className="proof-builder card">
      <header>
        <p className="eyebrow">Prover workspace</p>
        <h2>Create a proof bundle from attestation JSON</h2>
      </header>
      <p className="muted">
        The WASM prover runs locally in your browser. Paste the attestation payload exported by your
        custody or treasury system and generate a shareable proof bundle without sending witnesses to
        the verifier.
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
                ? 'Use Proof Console below to verify bundles'
                : 'Verifier must be reachable to submit proofs'}
            </p>
          </div>
        </div>
        <div className={`builder-status ${wasmStatusClass}`}>
          <span className="status-dot" />
          <div>
            <p className="builder-status-label">
              {wasmStatus === 'ready'
                ? 'WASM prover ready'
                : wasmStatus === 'loading'
                  ? 'Preparing WASM runtime…'
                  : wasmStatus === 'error'
                    ? 'WASM initialization failed'
                    : 'Waiting for prover artifacts'}
            </p>
            <p className="builder-status-detail">
              {proverArtifacts
                ? `Circuit v${proverArtifacts.circuitVersion} • Manifest v${proverArtifacts.manifestVersion}`
                : 'Fetching params + proving key'}
            </p>
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
            This payload mirrors <code>ZkpfCircuitInput</code>: balances + custody metadata under{' '}
            <code>attestation</code> and policy bindings under <code>public</code>.
          </p>
          <ul>
            <li>Witness data never leaves the browser—the proving key stays client-side.</li>
            <li>Use policies from the verifier to populate threshold, currency, and scope fields.</li>
            <li>Nullifier + custodian hash must already be normalized to 32-byte values.</li>
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

      <div className="builder-actions">
        <button type="button" onClick={handleGenerate} disabled={disabled}>
          {isGenerating ? 'Generating proof…' : 'Generate proof bundle'}
        </button>
      </div>

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
