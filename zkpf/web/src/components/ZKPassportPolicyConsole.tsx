import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ZKPassportPolicyClient } from '../api/zkpassport-policies';
import type { ZKPassportPolicyDefinition } from '../types/zkpassport';
import { ZKPassportPolicyComposer } from './ZKPassportPolicyComposer';
import { ZKPassportTemplateSelector } from './ZKPassportTemplateSelector';
import { ZKPassportHistory } from './ZKPassportHistory';
import type { PolicyTemplate } from '../config/zkpassport-templates';

interface Props {
  client: ZKPassportPolicyClient;
}

export function ZKPassportPolicyConsole({ client }: Props) {
  const queryClient = useQueryClient();
  const [requestedPolicyId, setRequestedPolicyId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<PolicyTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'catalog' | 'composer' | 'history'>('catalog');

  const policiesQuery = useQuery({
    queryKey: ['zkpassport-policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 60 * 1000,
    retry: 1,
  });

  const policies = useMemo<ZKPassportPolicyDefinition[]>(
    () => [...(policiesQuery.data ?? [])].sort((a, b) => b.policy_id - a.policy_id),
    [policiesQuery.data],
  );

  const filteredPolicies = useMemo(() => {
    if (!searchQuery.trim()) {
      return policies;
    }
    const query = searchQuery.toLowerCase();
    return policies.filter((policy) => 
      policy.label.toLowerCase().includes(query) ||
      policy.description?.toLowerCase().includes(query) ||
      policy.purpose.toLowerCase().includes(query) ||
      policy.policy_id.toString().includes(query) ||
      policy.useCases?.some(uc => uc.toLowerCase().includes(query))
    );
  }, [policies, searchQuery]);

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

  const inspectorPolicy = useMemo<ZKPassportPolicyDefinition | null>(() => {
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
      setSearchQuery('');
      void queryClient.invalidateQueries({ queryKey: ['zkpassport-policies', client.baseUrl] });
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
      `Policy: ${inspectorPolicy.label}`,
      `ID: ${inspectorPolicy.policy_id}`,
      `Purpose: ${inspectorPolicy.purpose}`,
      inspectorPolicy.description ? `Description: ${inspectorPolicy.description}` : '',
      `Query: ${JSON.stringify(inspectorPolicy.query, null, 2)}`,
    ].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('copied');
    } catch (err) {
      console.error('Unable to copy policy summary', err);
      setCopyStatus('error');
    }
  }, [inspectorPolicy]);

  const handleDeletePolicy = useCallback(async (policyId: number) => {
    if (!confirm(`Are you sure you want to delete policy ${policyId}?`)) {
      return;
    }
    try {
      await client.deletePolicy(policyId);
      void queryClient.invalidateQueries({ queryKey: ['zkpassport-policies', client.baseUrl] });
      if (requestedPolicyId === policyId) {
        setRequestedPolicyId(null);
      }
    } catch (error) {
      alert(`Failed to delete policy: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [client, queryClient, client.baseUrl, requestedPolicyId]);

  const handleTemplateSelect = useCallback((template: PolicyTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateSelector(false);
    setActiveTab('composer');
  }, []);

  const handleDuplicatePolicy = useCallback(() => {
    if (!inspectorPolicy) return;
    // Create a template-like object from the existing policy for the composer
    const duplicateTemplate: PolicyTemplate = {
      id: `duplicate-${inspectorPolicy.policy_id}`,
      name: `${inspectorPolicy.label} (Copy)`,
      category: 'kyc-compliance',
      description: inspectorPolicy.description || inspectorPolicy.purpose,
      icon: '📋',
      tags: [],
      purpose: inspectorPolicy.purpose,
      query: inspectorPolicy.query,
      useCases: inspectorPolicy.useCases || [],
    };
    setSelectedTemplate(duplicateTemplate);
    setActiveTab('composer');
  }, [inspectorPolicy]);

  const renderTableBody = () => {
    if (policiesQuery.isLoading) {
      return (
        <tr>
          <td colSpan={4} className="policy-table-status">
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
          <td colSpan={4} className="policy-table-status error">
            {message}
          </td>
        </tr>
      );
    }
    if (!policies.length) {
      return (
        <tr>
          <td colSpan={4} className="policy-table-status">
            No policies configured yet. Use the composer to create one.
          </td>
        </tr>
      );
    }
    if (!filteredPolicies.length) {
      return (
        <tr>
          <td colSpan={4} className="policy-table-status">
            No policies matched "{searchQuery}". Clear filters to see everything again.
          </td>
        </tr>
      );
    }

    return filteredPolicies.map((policy) => {
      const isSelected = inspectorPolicy?.policy_id === policy.policy_id;
      const useCasesStr = policy.useCases?.join(', ') || '—';
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
        >
          <td>
            <strong>{policy.label}</strong>
            <p className="muted small">
              #{policy.policy_id}
            </p>
          </td>
          <td>{policy.purpose.substring(0, 50)}{policy.purpose.length > 50 ? '...' : ''}</td>
          <td>{useCasesStr}</td>
          <td>
            {policy.scope || '—'}
          </td>
        </tr>
      );
    });
  };

  return (
    <div className="policy-console">
      {/* Tab Navigation */}
      <div className="zkpassport-tabs" style={{ marginBottom: '1.5rem' }}>
        <button
          className={`zkpassport-tab ${activeTab === 'catalog' ? 'active' : ''}`}
          onClick={() => setActiveTab('catalog')}
        >
          <span>📋 Policy Catalog</span>
        </button>
        <button
          className={`zkpassport-tab ${activeTab === 'composer' ? 'active' : ''}`}
          onClick={() => setActiveTab('composer')}
        >
          <span>✏️ Create Policy</span>
        </button>
        <button
          className={`zkpassport-tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span>📜 History</span>
        </button>
      </div>

      {activeTab === 'catalog' && (
        <div className="policy-console-grid">
          <div className="policy-console-column">
            <section className="card policy-catalog-card">
              <header>
                <p className="eyebrow">ZKPassport Policy Catalog</p>
                <h2>Review Policies</h2>
                <p className="muted">
                  Search and inspect ZKPassport policies. Create new policies to define identity verification requirements.
                </p>
              </header>

              <div className="policy-metrics">
                <div>
                  <p className="muted small">Policies</p>
                  <strong>{policies.length || '—'}</strong>
                </div>
              </div>

              <div className="policy-filters">
                <label className="policy-search">
                  <span className="sr-only">Search policies</span>
                  <input
                    type="search"
                    placeholder="Search by label, purpose, or ID"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  {searchQuery && (
                    <button type="button" className="ghost tiny-button" onClick={() => setSearchQuery('')}>
                      Clear
                    </button>
                  )}
                </label>
              </div>

              <div className="policy-table-wrapper">
                <table className="policy-table">
                  <thead>
                    <tr>
                      <th>Policy</th>
                      <th>Purpose</th>
                      <th>Use Cases</th>
                      <th>Scope</th>
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
                <p className="eyebrow">Policy Inspector</p>
                <h3>Policy Details</h3>
                <p className="muted small">Select a row to see the exact verification requirements.</p>
              </header>
              {inspectorPolicy ? (
                <>
                  <div className="policy-inspector-summary">
                    <p className="policy-inspector-label">{inspectorPolicy.label}</p>
                    <p className="muted small">{inspectorPolicy.description || inspectorPolicy.purpose}</p>
                  </div>
                  <div className="policy-inspector-grid">
                    <div>
                      <span>Policy ID</span>
                      <strong>#{inspectorPolicy.policy_id}</strong>
                    </div>
                    <div>
                      <span>Purpose</span>
                      <strong>{inspectorPolicy.purpose}</strong>
                    </div>
                    <div>
                      <span>Scope</span>
                      <strong>{inspectorPolicy.scope || 'None'}</strong>
                    </div>
                    <div>
                      <span>Validity</span>
                      <strong>{inspectorPolicy.validity ? `${inspectorPolicy.validity}s` : 'Default'}</strong>
                    </div>
                    <div>
                      <span>Dev Mode</span>
                      <strong>{inspectorPolicy.devMode ? 'Yes' : 'No'}</strong>
                    </div>
                    {inspectorPolicy.useCases && inspectorPolicy.useCases.length > 0 && (
                      <div>
                        <span>Use Cases</span>
                        <strong>{inspectorPolicy.useCases.join(', ')}</strong>
                      </div>
                    )}
                  </div>
                  <details className="policy-options-block">
                    <summary>Query Requirements</summary>
                    <pre>{JSON.stringify(inspectorPolicy.query, null, 2)}</pre>
                  </details>
                  <div className="policy-inspector-actions">
                    <button type="button" className="tiny-button" onClick={handleCopyInspector}>
                      📋 Copy summary
                    </button>
                    <button type="button" className="tiny-button" onClick={handleDuplicatePolicy}>
                      📑 Duplicate
                    </button>
                    <button 
                      type="button" 
                      className="tiny-button" 
                      onClick={() => handleDeletePolicy(inspectorPolicy.policy_id)}
                      style={{ background: 'rgba(248, 113, 113, 0.15)', borderColor: 'rgba(248, 113, 113, 0.5)', color: '#f87171' }}
                    >
                      🗑 Delete
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
                <p className="muted small">Select a policy to view its details.</p>
              )}
            </section>

            {/* Quick actions */}
            <section className="card">
              <header>
                <h3>Quick Actions</h3>
              </header>
              <div className="button-group">
                <button 
                  type="button" 
                  className="primary-button"
                  onClick={() => setShowTemplateSelector(true)}
                >
                  📦 Use Template
                </button>
                <button 
                  type="button" 
                  className="secondary-button"
                  onClick={() => setActiveTab('composer')}
                >
                  ✏️ Create Custom
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {activeTab === 'composer' && (
        <div className="policy-console-column" style={{ maxWidth: '800px' }}>
          {selectedTemplate && (
            <section className="card" style={{ marginBottom: '1.5rem' }}>
              <header>
                <p className="eyebrow">Template Selected</p>
                <h3>{selectedTemplate.icon} {selectedTemplate.name}</h3>
                <p className="muted small">{selectedTemplate.description}</p>
              </header>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  type="button" 
                  className="tiny-button"
                  onClick={() => setShowTemplateSelector(true)}
                >
                  Change Template
                </button>
                <button 
                  type="button" 
                  className="tiny-button"
                  onClick={() => setSelectedTemplate(null)}
                  style={{ background: 'transparent', borderColor: 'rgba(148, 163, 184, 0.4)' }}
                >
                  Clear Template
                </button>
              </div>
            </section>
          )}
          
          {!selectedTemplate && (
            <section className="card" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
              <p className="muted">Start from scratch or use a pre-built template</p>
              <button 
                type="button" 
                className="primary-button"
                onClick={() => setShowTemplateSelector(true)}
                style={{ marginTop: '1rem' }}
              >
                📦 Browse Templates
              </button>
            </section>
          )}

          <ZKPassportPolicyComposer 
            client={client} 
            onComposed={handlePolicyComposed}
            initialTemplate={selectedTemplate || undefined}
          />
        </div>
      )}

      {activeTab === 'history' && (
        <section className="card">
          <ZKPassportHistory />
        </section>
      )}

      {/* Template Selector Modal */}
      {showTemplateSelector && (
        <ZKPassportTemplateSelector
          onSelect={handleTemplateSelect}
          onClose={() => setShowTemplateSelector(false)}
        />
      )}
    </div>
  );
}

