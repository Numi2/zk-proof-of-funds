import { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ZKPassport, type ProofResult, type QueryResult } from '@zkpassport/sdk';
import QRCode from 'react-qr-code';
import type { ZKPassportPolicyClient } from '../api/zkpassport-policies';
import type { ZKPassportPolicyDefinition } from '../types/zkpassport';
import { ZKPassportProgress, type VerificationStage } from './ZKPassportProgress';
import { 
  getVerificationHistoryManager, 
  createQueryResultSummary,
} from '../utils/zkpassport-history';

interface Props {
  client: ZKPassportPolicyClient;
}

type VerificationStatus = 'idle' | 'requesting' | 'request-received' | 'generating-proof' | 'proof-generated' | 'verified' | 'rejected' | 'error';

export function ZKPassportVerifier({ client }: Props) {
  const [zkPassport] = useState(() => new ZKPassport('zkpf.dev'));
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);
  const historyManager = useRef(getVerificationHistoryManager());
  const verificationStartTime = useRef<number | null>(null);
  const [verificationState, setVerificationState] = useState<{
    status: VerificationStatus;
    requestId: string | null;
    url: string | null;
    proofs: ProofResult[];
    result: QueryResult | null;
    uniqueIdentifier: string | undefined;
    verified: boolean;
    error: string | null;
    bridgeConnected: boolean;
  }>({
    status: 'idle',
    requestId: null,
    url: null,
    proofs: [],
    result: null,
    uniqueIdentifier: undefined,
    verified: false,
    error: null,
    bridgeConnected: false,
  });

  const policiesQuery = useQuery({
    queryKey: ['zkpassport-policies', client.baseUrl],
    queryFn: () => client.getPolicies(),
    staleTime: 60 * 1000,
    retry: 1,
  });

  const policies = useMemo(() => policiesQuery.data || [], [policiesQuery.data]);
  const selectedPolicy = useMemo(() => {
    if (!selectedPolicyId) return null;
    return policies.find(p => p.policy_id === selectedPolicyId) || null;
  }, [policies, selectedPolicyId]);

  const buildQueryFromPolicy = useCallback(async (policy: ZKPassportPolicyDefinition) => {
    const builder = await zkPassport.request({
      name: 'ZKPF - Zero-Knowledge Proof of Funds',
      logo: '',
      purpose: policy.purpose,
      scope: policy.scope,
      validity: policy.validity,
      devMode: policy.devMode ?? false,
    });

    let query = builder;

    // Disclosure fields
    if (policy.query.discloseNationality) query = query.disclose('nationality');
    if (policy.query.discloseBirthdate) query = query.disclose('birthdate');
    if (policy.query.discloseFullname) query = query.disclose('fullname');
    if (policy.query.discloseFirstname) query = query.disclose('firstname');
    if (policy.query.discloseLastname) query = query.disclose('lastname');
    if (policy.query.discloseExpiryDate) query = query.disclose('expiry_date');
    if (policy.query.discloseDocumentNumber) query = query.disclose('document_number');
    if (policy.query.discloseDocumentType) query = query.disclose('document_type');
    if (policy.query.discloseIssuingCountry) query = query.disclose('issuing_country');
    if (policy.query.discloseGender) query = query.disclose('gender');

    // Age verification
    if (policy.query.ageGte !== undefined) query = query.gte('age', policy.query.ageGte);
    if (policy.query.ageLt !== undefined) query = query.lt('age', policy.query.ageLt);
    if (policy.query.ageLte !== undefined) query = query.lte('age', policy.query.ageLte);
    if (policy.query.ageRange) {
      query = query.range('age', policy.query.ageRange[0], policy.query.ageRange[1]);
    }

    // Birthdate verification
    if (policy.query.birthdateGte) query = query.gte('birthdate', new Date(policy.query.birthdateGte));
    if (policy.query.birthdateLt) query = query.lt('birthdate', new Date(policy.query.birthdateLt));
    if (policy.query.birthdateLte) query = query.lte('birthdate', new Date(policy.query.birthdateLte));
    if (policy.query.birthdateRange) {
      query = query.range('birthdate', new Date(policy.query.birthdateRange[0]), new Date(policy.query.birthdateRange[1]));
    }

    // Expiry date verification
    if (policy.query.expiryDateGte) query = query.gte('expiry_date', new Date(policy.query.expiryDateGte));
    if (policy.query.expiryDateLt) query = query.lt('expiry_date', new Date(policy.query.expiryDateLt));
    if (policy.query.expiryDateLte) query = query.lte('expiry_date', new Date(policy.query.expiryDateLte));
    if (policy.query.expiryDateRange) {
      query = query.range('expiry_date', new Date(policy.query.expiryDateRange[0]), new Date(policy.query.expiryDateRange[1]));
    }

    // Nationality checks
    if (policy.query.nationalityIn && policy.query.nationalityIn.length > 0) {
      query = query.in('nationality', policy.query.nationalityIn as any[]);
    }
    if (policy.query.nationalityOut && policy.query.nationalityOut.length > 0) {
      query = query.out('nationality', policy.query.nationalityOut as any[]);
    }

    // Issuing country checks
    if (policy.query.issuingCountryIn && policy.query.issuingCountryIn.length > 0) {
      query = query.in('issuing_country', policy.query.issuingCountryIn as any[]);
    }
    if (policy.query.issuingCountryOut && policy.query.issuingCountryOut.length > 0) {
      query = query.out('issuing_country', policy.query.issuingCountryOut as any[]);
    }

    // Equality checks
    if (policy.query.eqChecks) {
      for (const check of policy.query.eqChecks) {
        query = query.eq(check.field as any, check.value);
      }
    }

    // Binding
    if (policy.query.bindUserAddress) {
      const address = policy.query.bindUserAddress.startsWith('0x') 
        ? policy.query.bindUserAddress as `0x${string}`
        : `0x${policy.query.bindUserAddress}` as `0x${string}`;
      query = query.bind('user_address', address);
    }
    if (policy.query.bindChain) {
      query = query.bind('chain', policy.query.bindChain);
    }
    if (policy.query.bindCustomData) {
      query = query.bind('custom_data', policy.query.bindCustomData);
    }

    return query;
  }, [zkPassport]);

  const startVerification = useCallback(async () => {
    if (!selectedPolicy) {
      setVerificationState(prev => ({
        ...prev,
        status: 'error',
        error: 'Please select a policy first',
      }));
      return;
    }

    try {
      verificationStartTime.current = Date.now();
      setVerificationState(prev => ({ ...prev, status: 'requesting', error: null, proofs: [] }));
      
      const query = await buildQueryFromPolicy(selectedPolicy);
      const result = query.done();
      
      setVerificationState(prev => ({
        ...prev,
        status: 'requesting',
        requestId: result.requestId,
        url: result.url,
        bridgeConnected: result.isBridgeConnected(),
      }));

      // Set up event handlers
      result.onRequestReceived(() => {
        setVerificationState(prev => ({ ...prev, status: 'request-received' }));
      });

      result.onBridgeConnect(() => {
        setVerificationState(prev => ({ ...prev, bridgeConnected: true }));
      });

      result.onGeneratingProof(() => {
        setVerificationState(prev => ({ ...prev, status: 'generating-proof' }));
      });

      result.onProofGenerated((proof: ProofResult) => {
        setVerificationState(prev => ({
          ...prev,
          status: 'proof-generated',
          proofs: [...prev.proofs, proof],
        }));
      });

      result.onResult((response: {
        uniqueIdentifier: string | undefined;
        verified: boolean;
        result: QueryResult;
        queryResultErrors?: any;
      }) => {
        const duration = verificationStartTime.current 
          ? Date.now() - verificationStartTime.current 
          : undefined;
        
        // Record to history
        historyManager.current.addRecord({
          policyId: selectedPolicy?.policy_id || null,
          policyLabel: selectedPolicy?.label || 'Unknown Policy',
          status: response.verified ? 'verified' : 'error',
          uniqueIdentifier: response.uniqueIdentifier,
          requestId: result.requestId,
          queryResultSummary: createQueryResultSummary(response.result, selectedPolicy),
          proofCount: verificationState.proofs.length,
          error: response.verified ? undefined : 'Verification failed',
          duration,
          devMode: selectedPolicy?.devMode,
        });
        
        setVerificationState(prev => ({
          ...prev,
          status: response.verified ? 'verified' : 'error',
          uniqueIdentifier: response.uniqueIdentifier,
          verified: response.verified,
          result: response.result,
          error: response.verified ? null : 'Verification failed',
        }));
      });

      result.onReject(() => {
        setVerificationState(prev => ({ ...prev, status: 'rejected' }));
      });

      result.onError((error: string) => {
        setVerificationState(prev => ({
          ...prev,
          status: 'error',
          error,
        }));
      });
    } catch (error) {
      setVerificationState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to start verification',
      }));
    }
  }, [selectedPolicy, buildQueryFromPolicy]);

  const cancelRequest = useCallback(() => {
    if (verificationState.requestId) {
      zkPassport.cancelRequest(verificationState.requestId);
      setVerificationState({
        status: 'idle',
        requestId: null,
        url: null,
        proofs: [],
        result: null,
        uniqueIdentifier: undefined,
        verified: false,
        error: null,
        bridgeConnected: false,
      });
    }
  }, [zkPassport, verificationState.requestId]);

  return (
    <div className="zkpassport-verifier">
      <section className="card">
        <header>
          <p className="eyebrow">ZKPassport Verification</p>
          <h2>Verify Identity Against Policy</h2>
          <p className="muted">
            Select a policy and use ZKPassport to prove your identity meets the requirements.
          </p>
        </header>
      </section>

      <section className="card">
        <header>
          <h3>Select Policy</h3>
        </header>
        {policiesQuery.isLoading ? (
          <p>Loading policies...</p>
        ) : policies.length === 0 ? (
          <p className="muted">No policies available. Create a policy first.</p>
        ) : (
          <div className="form-group">
            <label>Policy</label>
            <select
              value={selectedPolicyId || ''}
              onChange={(e) => setSelectedPolicyId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Select a policy...</option>
              {policies.map(policy => (
                <option key={policy.policy_id} value={policy.policy_id}>
                  #{policy.policy_id}: {policy.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {selectedPolicy && (
          <div className="policy-preview-card" style={{ marginTop: '1rem' }}>
            <p className="eyebrow">Selected Policy</p>
            <h5>{selectedPolicy.label}</h5>
            <p className="muted small">{selectedPolicy.purpose}</p>
            {selectedPolicy.description && (
              <p className="muted small">{selectedPolicy.description}</p>
            )}
            {selectedPolicy.useCases && selectedPolicy.useCases.length > 0 && (
              <p className="muted small">
                <strong>Use Cases:</strong> {selectedPolicy.useCases.join(', ')}
              </p>
            )}
          </div>
        )}
      </section>

      {selectedPolicy && (
        <section className="card">
          <header>
            <h3>Verification Controls</h3>
          </header>
          <div className="button-group">
            <button
              onClick={startVerification}
              disabled={verificationState.status === 'requesting' || verificationState.status === 'generating-proof'}
              className="primary-button"
            >
              {verificationState.status === 'idle' ? 'Start Verification' : 'Verification in Progress...'}
            </button>
            {verificationState.requestId && (
              <button onClick={cancelRequest} className="secondary-button">
                Cancel Request
              </button>
            )}
          </div>
        </section>
      )}

      {/* Progress Component */}
      {verificationState.status !== 'idle' && (
        <ZKPassportProgress
          currentStage={verificationState.status as VerificationStage}
          proofCount={verificationState.proofs.length}
          error={verificationState.error}
        />
      )}

      <section className="card">
        <header>
          <h3>Verification Status</h3>
        </header>
        <div className="status-display">
          <div className={`status-badge status-${verificationState.status}`}>
            Status: {verificationState.status}
          </div>
          {verificationState.bridgeConnected && (
            <div className="status-badge status-connected">Bridge Connected</div>
          )}
          {verificationState.requestId && (
            <div className="status-info">
              <strong>Request ID:</strong> {verificationState.requestId}
            </div>
          )}
          {verificationState.url && (
            <div className="status-info">
              <strong>Verification URL</strong>
              <div className="qr-code-section" style={{ marginTop: '1rem' }}>
                <div className="qr-code-container">
                  <QRCode value={verificationState.url} size={256} />
                </div>
                <small className="muted" style={{ display: 'block', marginTop: '0.75rem', textAlign: 'center' }}>
                  Scan this QR code with the ZKPassport app
                </small>
              </div>
            </div>
          )}
          {verificationState.error && (
            <div className="status-error">
              <strong>Error:</strong> {verificationState.error}
            </div>
          )}
          {verificationState.verified && (
            <div className="status-success">
              <strong>✓ Verification Successful</strong>
              {verificationState.uniqueIdentifier && (
                <div>
                  <strong>Unique Identifier:</strong> {verificationState.uniqueIdentifier}
                </div>
              )}
              {selectedPolicy && (
                <div style={{ marginTop: '1rem' }}>
                  <strong>Policy Verified:</strong> {selectedPolicy.label} (ID: {selectedPolicy.policy_id})
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {verificationState.proofs.length > 0 && (
        <section className="card">
          <header>
            <h3>Generated Proofs ({verificationState.proofs.length})</h3>
          </header>
          <div className="proofs-list">
            {verificationState.proofs.map((proof, index) => (
              <div key={index} className="proof-item">
                <div className="proof-header">
                  <strong>Proof {(proof.index ?? index) + 1} of {proof.total ?? verificationState.proofs.length}</strong>
                  <span className="proof-name">{proof.name}</span>
                </div>
                <div className="proof-details">
                  <div><strong>Version:</strong> {proof.version}</div>
                  {proof.vkeyHash && <div><strong>VKey Hash:</strong> {proof.vkeyHash.substring(0, 20)}...</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {verificationState.result && (
        <section className="card">
          <header>
            <h3>Query Result</h3>
          </header>
          <details>
            <summary>View Query Result</summary>
            <pre>{JSON.stringify(verificationState.result, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}

