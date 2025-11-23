import { useState } from 'react';
import type { ZkpfClient } from '../api/zkpf';
import { ApiError } from '../api/zkpf';
import type { PolicyCategory, PolicyComposeRequest } from '../types/zkpf';

interface Props {
  client: ZkpfClient;
  onComposed?: (policyId: number) => void;
}

function isoCurrencyCode(code: string): number {
  switch (code.toUpperCase()) {
    case 'USD':
      return 840;
    case 'EUR':
      return 978;
    default:
      throw new Error(`Unsupported currency code: ${code}`);
  }
}

export function PolicyComposer({ client, onComposed }: Props) {
  const [category, setCategory] = useState<PolicyCategory>('FIAT');
  const [label, setLabel] = useState('');

  // FIAT options
  const [fiatCurrency, setFiatCurrency] = useState<'USD' | 'EUR'>('USD');
  const [fiatThreshold, setFiatThreshold] = useState('10000');
  const [fiatCustodianId, setFiatCustodianId] = useState('42');
  const [fiatScopeId, setFiatScopeId] = useState('100');

  // On-chain options
  const [onchainCurrency, setOnchainCurrency] = useState<'USD' | 'EUR'>('USD');
  const [onchainThreshold, setOnchainThreshold] = useState('100000');
  const [onchainScopeId, setOnchainScopeId] = useState('200');

  // Orchard options
  const [orchardThreshold, setOrchardThreshold] = useState('50');
  const [orchardScopeId, setOrchardScopeId] = useState('300');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit: React.FormEventHandler = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      let payload: PolicyComposeRequest;

      if (category === 'FIAT') {
        const currencyCode = isoCurrencyCode(fiatCurrency);
        const human = Number(fiatThreshold);
        if (!Number.isFinite(human) || human <= 0) {
          throw new Error('Enter a positive numeric threshold.');
        }
        const thresholdRaw = Math.round(human * 100); // cents
        const custodianId = Number(fiatCustodianId);
        const scopeId = Number(fiatScopeId);
        if (!Number.isFinite(custodianId) || custodianId < 0) {
          throw new Error('Enter a valid custodian ID.');
        }
        if (!Number.isFinite(scopeId) || scopeId < 0) {
          throw new Error('Enter a valid scope ID.');
        }

        const effectiveLabel =
          label.trim() || `Fiat: ≥ ${human.toLocaleString()} ${fiatCurrency} (custodian ${custodianId})`;

        payload = {
          category,
          rail_id: 'CUSTODIAL_ATTESTATION',
          label: effectiveLabel,
          options: {
            tier: 'CUSTOM',
            fiat_currency: fiatCurrency,
            fiat_decimals: 2,
            human_threshold: human,
          },
          threshold_raw: thresholdRaw,
          required_currency_code: currencyCode,
          required_custodian_id: custodianId,
          verifier_scope_id: scopeId,
        };
      } else if (category === 'ONCHAIN') {
        const currencyCode = isoCurrencyCode(onchainCurrency);
        const human = Number(onchainThreshold);
        if (!Number.isFinite(human) || human <= 0) {
          throw new Error('Enter a positive numeric threshold.');
        }
        const thresholdRaw = Math.round(human * 100);
        const scopeId = Number(onchainScopeId);
        if (!Number.isFinite(scopeId) || scopeId < 0) {
          throw new Error('Enter a valid scope ID.');
        }

        const effectiveLabel =
          label.trim() || `On-chain: ≥ ${human.toLocaleString()} ${onchainCurrency} (multi-wallet)`;

        payload = {
          category,
          rail_id: 'ONCHAIN_WALLET',
          label: effectiveLabel,
          options: {
            asset_mode: 'BASKET',
            display_currency: onchainCurrency,
            fiat_decimals: 2,
            human_threshold: human,
          },
          threshold_raw: thresholdRaw,
          required_currency_code: currencyCode,
          // Synthetic ID representing the on-chain rail operator / indexer.
          required_custodian_id: 1000,
          verifier_scope_id: scopeId,
        };
      } else {
        // ZCASH_ORCHARD
        const human = Number(orchardThreshold);
        if (!Number.isFinite(human) || human <= 0) {
          throw new Error('Enter a positive numeric threshold.');
        }
        const thresholdRaw = Math.round(human * 1e8); // zats
        const scopeId = Number(orchardScopeId);
        if (!Number.isFinite(scopeId) || scopeId < 0) {
          throw new Error('Enter a valid scope ID.');
        }

        const effectiveLabel = label.trim() || `Orchard: ≥ ${human.toLocaleString()} ZEC`;

        payload = {
          category,
          rail_id: 'ZCASH_ORCHARD',
          label: effectiveLabel,
          options: {
            network: 'mainnet',
            pool: 'orchard',
            threshold_zec_display: human,
            zec_decimals: 8,
          },
          threshold_raw: thresholdRaw,
          // Synthetic code for ZEC; must match the Orchard rail configuration.
          required_currency_code: 999001,
          // Orchard rail uses 0 for this field and does not enforce a custodian allowlist.
          required_custodian_id: 0,
          verifier_scope_id: scopeId,
        };
      }

      setLoading(true);
      const response = await client.composePolicy(payload);
      setLoading(false);

      const policy: any = response.policy;
      const policyId: number | undefined = typeof policy?.policy_id === 'number' ? policy.policy_id : undefined;
      if (policyId != null) {
        onComposed?.(policyId);
      }

      setSuccess(response.summary || 'Policy composed');
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message ?? 'Unknown error');
      }
    }
  };

  return (
    <section className="policy-composer">
      <header className="policy-composer-header">
        <h4>Compose a policy</h4>
        <p className="muted small">
          Quickly mint or reuse a policy for the selected rail. The verifier enforces the numeric
          expectations stored on the backend.
        </p>
      </header>
      <form className="policy-composer-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Category</span>
          <select
            value={category}
            onChange={(event) => {
              const next = event.target.value as PolicyCategory;
              setCategory(next);
              setError(null);
              setSuccess(null);
            }}
          >
            <option value="FIAT">Fiat proof</option>
            <option value="ONCHAIN">On-chain proof</option>
            <option value="ZCASH_ORCHARD">Zcash Orchard PoF</option>
          </select>
        </label>
        <label className="field">
          <span>Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. HNW: ≥ 250,000 USD at Custodian 42"
          />
        </label>

        {category === 'FIAT' && (
          <>
            <label className="field">
              <span>Fiat currency</span>
              <select
                value={fiatCurrency}
                onChange={(event) => setFiatCurrency(event.target.value as 'USD' | 'EUR')}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="field">
              <span>Minimum balance ({fiatCurrency})</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={fiatThreshold}
                onChange={(event) => setFiatThreshold(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Custodian ID</span>
              <input
                type="number"
                min="0"
                step="1"
                value={fiatCustodianId}
                onChange={(event) => setFiatCustodianId(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Scope ID</span>
              <input
                type="number"
                min="0"
                step="1"
                value={fiatScopeId}
                onChange={(event) => setFiatScopeId(event.target.value)}
              />
            </label>
          </>
        )}

        {category === 'ONCHAIN' && (
          <>
            <label className="field">
              <span>Display currency</span>
              <select
                value={onchainCurrency}
                onChange={(event) => setOnchainCurrency(event.target.value as 'USD' | 'EUR')}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="field">
              <span>Minimum balance ({onchainCurrency})</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={onchainThreshold}
                onChange={(event) => setOnchainThreshold(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Scope ID</span>
              <input
                type="number"
                min="0"
                step="1"
                value={onchainScopeId}
                onChange={(event) => setOnchainScopeId(event.target.value)}
              />
            </label>
          </>
        )}

        {category === 'ZCASH_ORCHARD' && (
          <>
            <label className="field">
              <span>Minimum balance (ZEC)</span>
              <input
                type="number"
                min="0"
                step="0.00000001"
                value={orchardThreshold}
                onChange={(event) => setOrchardThreshold(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Scope ID</span>
              <input
                type="number"
                min="0"
                step="1"
                value={orchardScopeId}
                onChange={(event) => setOrchardScopeId(event.target.value)}
              />
            </label>
          </>
        )}

        <div className="policy-composer-actions">
          <button type="submit" className="tiny-button" disabled={loading}>
            {loading ? 'Composing…' : 'Compose / reuse policy'}
          </button>
          {error && (
            <span className="error-message inline">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </span>
          )}
          {success && !error && <span className="success-message inline">{success}</span>}
        </div>
      </form>
    </section>
  );
}


