import { useMemo } from 'react';
import type { ProofBundle } from '../types/zkpf';
import { bytesToBase64, bytesToHex, formatEpoch, truncateMiddle } from '../utils/bytes';
import type { AssetRail } from '../types/ui';

interface Props {
  bundle: ProofBundle;
  assetRail: AssetRail;
}

const numberFormatter = new Intl.NumberFormat('en-US');

const railMeta: Record<
  AssetRail,
  {
    label: string;
    summary: string;
    highlights: string[];
  }
> = {
  onchain: {
    label: 'On-chain',
    summary: 'Wallets, smart contracts, and custody accounts combined into a single proof of total balance.',
    highlights: [
      'Cold and hot wallet mix is hidden',
      'Nullifier prevents counting the same balance twice',
      'Works for both L1 and L2 balances',
    ],
  },
  fiat: {
    label: 'Fiat',
    summary: 'Bank, trust, or money market balances represented as structured data for the verifier.',
    highlights: ['ISO currency mapping', 'Custodian IDs mirror treasury ledgers', 'Pairs well with bank attestations'],
  },
  orchard: {
    label: 'Zcash Orchard',
    summary:
      'Non-custodial Zcash Orchard shielded balances proven against an Orchard anchor and viewing key, checked entirely inside the circuit.',
    highlights: [
      'Snapshot height and Orchard Merkle anchor shown as public inputs',
      'UFVK-bound holder binding without exposing the keys themselves',
      'Inner Orchard circuit follows consensus rules for the Orchard Merkle tree',
    ],
  },
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

export function BundleSummary({ bundle, assetRail }: Props) {
  const { public_inputs: inputs, rail_id } = bundle;
  const proofBase64 = useMemo(() => bytesToBase64(bundle.proof), [bundle]);
  const normalizedJson = useMemo(() => JSON.stringify(bundle, null, 2), [bundle]);
  const rail = railMeta[assetRail];

  const handleCopyProof = async () => {
    try {
      await navigator.clipboard.writeText(proofBase64);
      showToast('Proof copied to clipboard', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      showToast(`Failed to copy proof: ${message}`, 'error');
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(normalizedJson);
      showToast('JSON copied to clipboard', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      showToast(`Failed to copy JSON: ${message}`, 'error');
    }
  };

  return (
    <div className="bundle-summary">
      <section>
        <h3>Policy checks</h3>
        <dl>
          <div>
            <dt>Threshold</dt>
            <dd>{numberFormatter.format(inputs.threshold_raw)}</dd>
          </div>
          <div>
            <dt>Currency code</dt>
            <dd>{inputs.required_currency_code}</dd>
          </div>
          <div>
            <dt>Verifier scope</dt>
            <dd>{inputs.verifier_scope_id}</dd>
          </div>
          <div>
            <dt>Policy ID</dt>
            <dd>{inputs.policy_id}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Epoch + nullifier</h3>
        <dl>
          <div>
            <dt>Current epoch</dt>
            <dd>{formatEpoch(inputs.current_epoch)}</dd>
          </div>
          <div>
            <dt>Nullifier</dt>
            <dd className="mono">{truncateMiddle(bytesToHex(inputs.nullifier, 16), 80)}</dd>
          </div>
          <div>
            <dt>Custodian pubkey hash</dt>
            <dd className="mono">
              {truncateMiddle(bytesToHex(inputs.custodian_pubkey_hash, 16), 80)}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Rail metadata</h3>
        <dl>
          <div>
            <dt>Rail ID</dt>
            <dd>{rail_id && rail_id.trim().length > 0 ? rail_id : 'CUSTODIAL_ATTESTATION (legacy)'}</dd>
          </div>
          <div>
            <dt>Snapshot height</dt>
            <dd>{inputs.snapshot_block_height ?? 'n/a'}</dd>
          </div>
          <div>
            <dt>Snapshot anchor (Orchard)</dt>
            <dd className="mono">
              {inputs.snapshot_anchor_orchard
                ? truncateMiddle(bytesToHex(inputs.snapshot_anchor_orchard, 16), 80)
                : 'n/a'}
            </dd>
          </div>
          <div>
            <dt>Holder binding</dt>
            <dd className="mono">
              {inputs.holder_binding
                ? truncateMiddle(bytesToHex(inputs.holder_binding, 16), 80)
                : 'n/a'}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h3>Proof material</h3>
        <dl>
          <div>
            <dt>Bytes</dt>
            <dd>{bundle.proof.length}</dd>
          </div>
          <div>
            <dt>Base64 preview</dt>
            <dd className="mono">{truncateMiddle(proofBase64, 96)}</dd>
          </div>
        </dl>
        <div className="actions">
          <button type="button" onClick={handleCopyProof}>
            Copy proof (base64)
          </button>
        </div>
      </section>
      <section>
        <h3>Normalized JSON</h3>
        <textarea
          className="json-preview"
          readOnly
          value={normalizedJson}
          spellCheck={false}
        />
        <div className="actions">
          <button type="button" className="ghost" onClick={handleCopyJson}>
            Copy JSON
          </button>
        </div>
      </section>
      <section>
        <h3>Asset rail context</h3>
        <dl>
          <div>
            <dt>Rail</dt>
            <dd>{rail.label}</dd>
          </div>
          <div>
            <dt>Summary</dt>
            <dd>{rail.summary}</dd>
          </div>
        </dl>
        <ul className="asset-rail-highlight-list">
          {rail.highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

