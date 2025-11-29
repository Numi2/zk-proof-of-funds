import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ZkpfClient } from '../api/zkpf';
import type { PolicyDefinition } from '../types/zkpf';
import { PolicyComposer } from './PolicyComposer';
import {
  formatPolicyThreshold,
  groupPoliciesByCategory,
  matchesPolicyQuery,
  policyCategoryLabel,
  policyDisplayName,
  policyNarrative,
  policyRailLabel,
  policyShortSummary,
  uniqueScopes,
} from '../utils/policy';

interface Props {
  client: ZkpfClient;
}

type CategoryFilter = 'ALL' | 'DEMO' | 'FIAT' | 'ZCASH_ORCHARD' | 'ZASHI' | 'STARKNET' | 'USDC' | 'OTHER';

const FILTER_LABELS: Record<CategoryFilter, string> = {
  ALL: 'All',
  DEMO: 'Demo',
  FIAT: 'Fiat',
  ZCASH_ORCHARD: 'Orchard',
  ZASHI: 'Zashi',
  STARKNET: 'Starknet',
  USDC: 'USDC',
  OTHER: 'Other',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function PolicyConsole({ client }: Props) {
  const queryClient = useQueryClient();
  const [requestedPolicyId, setRequestedPolicyId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const policiesQuery = useQuery({
    queryKey: ['policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 60 * 1000,
    retry: 1,
  });

  const policies = useMemo<PolicyDefinition[]>(
    () => [...(policiesQuery.data ?? [])].sort((a, b) => a.policy_id - b.policy_id),
    [policiesQuery.data],
  );

  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const category = policy.category?.toUpperCase() ?? 'UNSPECIFIED';
      let matchesCategory = false;
      if (categoryFilter === 'ALL') {
        matchesCategory = true;
      } else if (categoryFilter === 'OTHER') {
        // "Other" captures categories not in our main filters
        const mainCategories = ['DEMO', 'FIAT', 'ZCASH_ORCHARD', 'ZASHI', 'STARKNET', 'USDC', 'USDC_STARKNET'];
        matchesCategory = !mainCategories.includes(category);
      } else if (categoryFilter === 'STARKNET') {
        // Include both STARKNET and STARKNET_DEFI
        matchesCategory = category === 'STARKNET' || category === 'STARKNET_DEFI';
      } else if (categoryFilter === 'USDC') {
        // Include both USDC and USDC_STARKNET
        matchesCategory = category === 'USDC' || category === 'USDC_STARKNET';
      } else {
        matchesCategory = category === categoryFilter;
      }
      return matchesCategory && matchesPolicyQuery(policy, searchQuery);
    });
  }, [policies, categoryFilter, searchQuery]);

  const activePolicyId = useMemo(() => {
    if (!policies.length) {
      return null;
    }
    if (filteredPolicies.length) {
      if (requestedPolicyId == null) {
        return filteredPolicies[0].policy_id;
      }
      if (filteredPolicies.some((policy) => policy.policy_id === requestedPolicyId)) {
        return requestedPolicyId;
      }
      return filteredPolicies[0].policy_id;
    }
    if (requestedPolicyId != null && policies.some((policy) => policy.policy_id === requestedPolicyId)) {
      return requestedPolicyId;
    }
    return policies[0].policy_id;
  }, [filteredPolicies, policies, requestedPolicyId]);

  const inspectorPolicy = useMemo<PolicyDefinition | null>(() => {
    if (activePolicyId == null) {
      return null;
    }
    return policies.find((policy) => policy.policy_id === activePolicyId) ?? null;
  }, [activePolicyId, policies]);

  useEffect(() => {
    if (copyStatus === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setCopyStatus('idle'), copyStatus === 'copied' ? 2000 : 2500);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const handlePolicyComposed = useCallback(
    (policyId: number) => {
      setRequestedPolicyId(policyId);
      setCategoryFilter('ALL');
      setSearchQuery('');
      void queryClient.invalidateQueries({ queryKey: ['policies', client.baseUrl] });
    },
    [client.baseUrl, queryClient],
  );

  const handleCopyInspector = useCallback(async () => {
    if (!inspectorPolicy) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyStatus('error');
      return;
    }
    const summary = [
      policyDisplayName(inspectorPolicy),
      policyShortSummary(inspectorPolicy),
      policyNarrative(inspectorPolicy),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('copied');
    } catch (err) {
      console.error('Unable to copy policy summary', err);
      setCopyStatus('error');
    }
  }, [inspectorPolicy]);

  const policyOptions = inspectorPolicy?.options && isRecord(inspectorPolicy.options) ? inspectorPolicy.options : null;
  const scopeCount = uniqueScopes(policies);
  const maxThresholdPolicy = useMemo(() => {
    if (!policies.length) {
      return null;
    }
    return policies.reduce((current, candidate) =>
      candidate.threshold_raw > current.threshold_raw ? candidate : current,
    );
  }, [policies]);
  const maxThresholdLabel = maxThresholdPolicy ? formatPolicyThreshold(maxThresholdPolicy).formatted : '—';
  const categoryCounts = useMemo(() => {
    const groups = groupPoliciesByCategory(policies);
    const mainCategories = ['DEMO', 'FIAT', 'ZCASH_ORCHARD', 'ZASHI', 'STARKNET', 'STARKNET_DEFI', 'USDC', 'USDC_STARKNET'];
    const otherCount = policies.filter(p => !mainCategories.includes(p.category?.toUpperCase() ?? '')).length;
    return {
      ALL: policies.length,
      DEMO: groups.DEMO?.length ?? 0,
      FIAT: groups.FIAT?.length ?? 0,
      ZCASH_ORCHARD: groups.ZCASH_ORCHARD?.length ?? 0,
      ZASHI: groups.ZASHI?.length ?? 0,
      STARKNET: (groups.STARKNET?.length ?? 0) + (groups.STARKNET_DEFI?.length ?? 0),
      USDC: (groups.USDC?.length ?? 0) + (groups.USDC_STARKNET?.length ?? 0),
      OTHER: otherCount,
    } satisfies Record<CategoryFilter, number>;
  }, [policies]);

  const renderTableBody = () => {
    if (policiesQuery.isLoading) {
      return (
        <tr>
          <td colSpan={5} className="policy-table-status">
            Loading policies…
          </td>
        </tr>
      );
    }
    if (policiesQuery.error) {
      const message =
        policiesQuery.error instanceof Error ? policiesQuery.error.message : 'Unable to load policies';
      return (
        <tr>
          <td colSpan={5} className="policy-table-status error">
            {message}
          </td>
        </tr>
      );
    }
    if (!policies.length) {
      return (
        <tr>
          <td colSpan={5} className="policy-table-status">
            No policies configured yet. Use the composer to create one.
          </td>
        </tr>
      );
    }
    if (!filteredPolicies.length) {
      return (
        <tr>
          <td colSpan={5} className="policy-table-status">
            No policies matched “{searchQuery}”. Clear filters to see everything again.
          </td>
        </tr>
      );
    }

    return filteredPolicies.map((policy) => {
      const threshold = formatPolicyThreshold(policy).formatted;
      const isSelected = inspectorPolicy?.policy_id === policy.policy_id;
      return (
        <tr
          key={policy.policy_id}
          className={isSelected ? 'policy-row-highlight policy-row' : 'policy-row'}
          onClick={() => setRequestedPolicyId(policy.policy_id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setRequestedPolicyId(policy.policy_id);
            }
          }}
          role="button"
          tabIndex={0}
          aria-selected={isSelected}
          title={policyShortSummary(policy)}
        >
          <td>
            <strong>{policyDisplayName(policy)}</strong>
            <p className="muted small">
              #{policy.policy_id} • {policyCategoryLabel(policy)}
            </p>
          </td>
          <td>{threshold}</td>
          <td>Scope {policy.verifier_scope_id}</td>
          <td>—</td>
          <td>{policyRailLabel(policy)}</td>
        </tr>
      );
    });
  };

  return (
    <div className="policy-console">
      <div className="policy-console-grid">
        <div className="policy-console-column">
          <section className="card policy-catalog-card">
            <header>
              <p className="eyebrow">Policy catalog</p>
              <h2>Review verifier policies</h2>
              <p className="muted">
                Search, filter, and inspect the stored policies your verifier will accept. Compose a new entry whenever
                you need a fresh threshold, scope, or rail configuration.
              </p>
            </header>

            <div className="policy-metrics">
              <div>
                <p className="muted small">Policies</p>
                <strong>{policies.length || '—'}</strong>
              </div>
              <div>
                <p className="muted small">Unique scopes</p>
                <strong>{scopeCount || '—'}</strong>
              </div>
              <div>
                <p className="muted small">Largest threshold</p>
                <strong>{maxThresholdLabel}</strong>
              </div>
            </div>

            <div className="policy-filters">
              <label className="policy-search">
                <span className="sr-only">Search policies</span>
                <input
                  type="search"
                  placeholder="Search by label, scope, custodian, or ID"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
                {searchQuery && (
                  <button type="button" className="ghost tiny-button" onClick={() => setSearchQuery('')}>
                    Clear
                  </button>
                )}
              </label>
              <div className="policy-pill-group">
                {(Object.keys(FILTER_LABELS) as CategoryFilter[]).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={filter === categoryFilter ? 'policy-pill active' : 'policy-pill'}
                    onClick={() => setCategoryFilter(filter)}
                  >
                    {FILTER_LABELS[filter]}
                    <span className="count">{categoryCounts[filter]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="policy-table-wrapper">
              <table className="policy-table">
                <thead>
                  <tr>
                    <th>Policy</th>
                    <th>Threshold</th>
                    <th>Scope</th>
                    <th>Custodian</th>
                    <th>Rail</th>
                  </tr>
                </thead>
                <tbody>{renderTableBody()}</tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="policy-console-column">
          <section className="card policy-inspector-card">
            <header className="policy-inspector-header">
              <p className="eyebrow">Policy inspector</p>
              <h3>Understand the binding</h3>
              <p className="muted small">Select a row to see the exact guardrails enforced by the verifier.</p>
            </header>
            {inspectorPolicy ? (
              <>
                <div className="policy-inspector-summary">
                  <p className="policy-inspector-label">{policyDisplayName(inspectorPolicy)}</p>
                  {inspectorPolicy.description ? (
                    <p className="policy-inspector-description">{inspectorPolicy.description}</p>
                  ) : (
                    <p className="muted small">{policyNarrative(inspectorPolicy)}</p>
                  )}
                </div>
                {inspectorPolicy.purpose && (
                  <div className="policy-inspector-purpose">
                    <span className="purpose-label">Purpose:</span>
                    <span>{inspectorPolicy.purpose}</span>
                  </div>
                )}
                <div className="policy-inspector-grid">
                  <div>
                    <span>Policy ID</span>
                    <strong>#{inspectorPolicy.policy_id}</strong>
                  </div>
                  <div>
                    <span>Threshold</span>
                    <strong>{formatPolicyThreshold(inspectorPolicy).formatted}</strong>
                  </div>
                  <div>
                    <span>Scope</span>
                    <strong>{inspectorPolicy.verifier_scope_id}</strong>
                  </div>
                  <div>
                    <span>Category</span>
                    <strong>{policyCategoryLabel(inspectorPolicy)}</strong>
                  </div>
                  <div>
                    <span>Rail</span>
                    <strong>{policyRailLabel(inspectorPolicy)}</strong>
                  </div>
                </div>
                {inspectorPolicy.useCases && inspectorPolicy.useCases.length > 0 && (
                  <div className="policy-inspector-use-cases">
                    <span className="use-cases-title">Use cases</span>
                    <ul className="use-cases-list">
                      {inspectorPolicy.useCases.map((useCase, idx) => (
                        <li key={idx}>{useCase}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {policyOptions && (
                  <details className="policy-options-block">
                    <summary>Rail options</summary>
                    <pre>{JSON.stringify(policyOptions, null, 2)}</pre>
                  </details>
                )}
                <div className="policy-inspector-actions">
                  <button type="button" className="tiny-button" onClick={handleCopyInspector}>
                    Copy summary
                  </button>
                  {copyStatus === 'copied' && <span className="success-message inline">Copied</span>}
                  {copyStatus === 'error' && (
                    <span className="error-message inline">
                      <span className="error-icon">⚠️</span>
                      <span>Unable to copy</span>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="muted small">Policies will populate here once the verifier exposes them.</p>
            )}
          </section>

          <PolicyComposer client={client} onComposed={handlePolicyComposed} />
        </div>
      </div>
    </div>
  );
}
