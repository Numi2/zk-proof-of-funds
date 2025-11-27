import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ZKPassport, type ProofResult, type QueryResult } from '@zkpassport/sdk';
import QRCode from 'react-qr-code';
import { ZKPassportProgress, type VerificationStage } from './ZKPassportProgress';
import { COUNTRY_GROUPS } from '../config/zkpassport-templates';

// Import country constants - these should be available in the SDK
import * as ZKPassportSDK from '@zkpassport/sdk';

const SANCTIONED_COUNTRIES = (ZKPassportSDK as any).SANCTIONED_COUNTRIES || COUNTRY_GROUPS.SANCTIONED;

type VerificationStatus = 'idle' | 'requesting' | 'request-received' | 'generating-proof' | 'proof-generated' | 'verified' | 'rejected' | 'error';

interface VerificationState {
  status: VerificationStatus;
  requestId: string | null;
  url: string | null;
  proofs: ProofResult[];
  result: QueryResult | null;
  uniqueIdentifier: string | undefined;
  verified: boolean;
  error: string | null;
  bridgeConnected: boolean;
}

// Pre-built verification scenarios - one click to start
interface VerificationScenario {
  id: string;
  icon: string;
  title: string;
  description: string;
  color: string;
  buildQuery: (builder: any) => any;
}

const VERIFICATION_SCENARIOS: VerificationScenario[] = [
  {
    id: 'not-sanctioned',
    icon: '✓',
    title: 'Not Sanctioned',
    description: 'Pass sanctions check',
    color: '#34d399',
    buildQuery: (builder) => builder.out('nationality', SANCTIONED_COUNTRIES),
  },
  {
    id: 'personhood',
    icon: '👤',
    title: 'Personhood',
    description: 'Prove you\'re human',
    color: '#a78bfa',
    buildQuery: (builder) => builder.gte('age', 13),
  },
  {
    id: 'basic-kyc',
    icon: '📋',
    title: 'Basic KYC',
    description: 'Name + nationality',
    color: '#38bdf8',
    buildQuery: (builder) => builder
      .disclose('firstname')
      .disclose('lastname')
      .disclose('nationality')
      .gte('age', 18),
  },
];

export function ZKPassportPage() {
  const [zkPassport] = useState(() => new ZKPassport('zkpf.dev'));
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>({
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
  
  // For history tracking
  const verificationStartTime = useRef<number | null>(null);

  // Download verification proofs
  const downloadProofs = useCallback(() => {
    if (verificationState.proofs.length === 0) return;
    
    const scenario = VERIFICATION_SCENARIOS.find(s => s.id === selectedScenario);
    const proofData = {
      timestamp: new Date().toISOString(),
      requestId: verificationState.requestId,
      scenario: scenario?.title || 'Unknown',
      uniqueIdentifier: verificationState.uniqueIdentifier,
      verified: verificationState.verified,
      proofs: verificationState.proofs,
      result: verificationState.result,
    };
    
    const blob = new Blob([JSON.stringify(proofData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zkpassport-proof-${verificationState.requestId || 'unknown'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [verificationState, selectedScenario]);

  // Start verification with selected scenario - single click flow
  const startScenarioVerification = useCallback(async (scenarioId: string) => {
    const scenario = VERIFICATION_SCENARIOS.find(s => s.id === scenarioId);
    if (!scenario) return;

    try {
      verificationStartTime.current = Date.now();
      setSelectedScenario(scenarioId);
      setVerificationState(prev => ({ ...prev, status: 'requesting', error: null, proofs: [] }));
      
      const builder = await zkPassport.request({
        name: `ZKPF - ${scenario.title}`,
        logo: '/zkpf.png',
        purpose: scenario.description,
        devMode,
      });

      const query = scenario.buildQuery(builder);
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
        console.log('Request received');
        setVerificationState(prev => ({ ...prev, status: 'request-received' }));
      });

      result.onBridgeConnect(() => {
        setVerificationState(prev => ({ ...prev, bridgeConnected: true }));
      });

      result.onGeneratingProof(() => {
        console.log('Generating proof');
        setVerificationState(prev => ({ ...prev, status: 'generating-proof' }));
      });

      result.onProofGenerated((proof: ProofResult) => {
        console.log('Proof generated', proof);
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
        console.log('=== Verification Results ===');
        console.log('proofs are valid', response.verified);
        console.log('unique identifier', response.uniqueIdentifier);

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
        console.log('Request rejected');
        setVerificationState(prev => ({ ...prev, status: 'rejected' }));
      });

      result.onError((error: string) => {
        console.error('Error:', error);
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
  }, [zkPassport, devMode]);

  const resetVerification = useCallback(() => {
    if (verificationState.requestId) {
      zkPassport.cancelRequest(verificationState.requestId);
    }
    zkPassport.clearAllRequests();
    setSelectedScenario(null);
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
  }, [zkPassport, verificationState.requestId]);

  const isVerifying = verificationState.status !== 'idle' && 
    verificationState.status !== 'verified' && 
    verificationState.status !== 'error' && 
    verificationState.status !== 'rejected';

  return (
    <div className="zkpassport-page">
      {/* Scenario Selection - Main UI when idle */}
      {verificationState.status === 'idle' && (
        <>
          <section className="scenario-hero">
            <h2>What do you need to verify?</h2>
            <p className="muted">Click any card to instantly start verification</p>
          </section>

          <div className="scenario-grid">
            {VERIFICATION_SCENARIOS.map((scenario) => (
              <button
                key={scenario.id}
                className="scenario-card"
                onClick={() => startScenarioVerification(scenario.id)}
                style={{ '--scenario-color': scenario.color } as React.CSSProperties}
              >
                <span className="scenario-icon">{scenario.icon}</span>
                <span className="scenario-title">{scenario.title}</span>
                <span className="scenario-desc">{scenario.description}</span>
              </button>
            ))}
          </div>

          <div className="dev-mode-toggle">
            <label className="dev-mode-label">
              <input
                type="checkbox"
                checked={devMode}
                onChange={(e) => setDevMode(e.target.checked)}
              />
              <span>Dev Mode</span>
              <span className="dev-mode-hint">Accept mock proofs for testing</span>
            </label>
          </div>
        </>
      )}

      {/* Active Verification UI */}
      {verificationState.status !== 'idle' && (
        <>
          {/* Progress Component */}
          <ZKPassportProgress
            currentStage={verificationState.status as VerificationStage}
            proofCount={verificationState.proofs.length}
            error={verificationState.error}
          />

          {/* QR Code Section - shown during verification */}
          {verificationState.url && isVerifying && (
            <section className="card verification-qr-card">
              <div className="qr-code-section">
                <h4>th ZKPassport</h4>
                <div className="qr-code-container">
                  <QRCode value={verificationState.url} size={280} />
                </div>
                <a 
                  href={verificationState.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="qr-link-button"
                >
                  Open in ZKPassport App →
                </a>
              </div>
            </section>
          )}

          {/* Success State */}
          {verificationState.verified && (
            <section className="card verification-success-card">
              <div className="success-content">
                <span className="success-icon-big">✓</span>
                <h3>Verified!</h3>
                <p className="muted">
                  {VERIFICATION_SCENARIOS.find(s => s.id === selectedScenario)?.title || 'Verification'} passed successfully
                </p>
                {verificationState.uniqueIdentifier && (
                  <div className="unique-id">
                    <span className="unique-id-label">Unique Identifier</span>
                    <code>{verificationState.uniqueIdentifier}</code>
                  </div>
                )}
                <div className="success-actions">
                  <button onClick={downloadProofs} className="secondary-button">
                    📥 Download Proof
                  </button>
                  <button onClick={resetVerification} className="primary-button">
                    Verify Something Else
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Error/Rejected State */}
          {(verificationState.status === 'error' || verificationState.status === 'rejected') && (
            <section className="card verification-error-card">
              <div className="error-content">
                <span className="error-icon-big">✗</span>
                <h3>{verificationState.status === 'rejected' ? 'Rejected' : 'Verification Failed'}</h3>
                <p className="muted">
                  {verificationState.error || 'The verification request was rejected'}
                </p>
                <button onClick={resetVerification} className="primary-button">
                  Try Again
                </button>
              </div>
            </section>
          )}

          {/* Cancel button during active verification */}
          {isVerifying && (
            <div className="cancel-action">
              <button onClick={resetVerification} className="cancel-button">
                Cancel Verification
              </button>
            </div>
          )}

          {/* Result Details (collapsible) */}
          {verificationState.result && (
            <details className="result-json card">
              <summary>View Full Verification Result</summary>
              <pre>{JSON.stringify(verificationState.result, null, 2)}</pre>
            </details>
          )}
        </>
      )}

      {/* Identity Bond Card Button */}
      <Link to="/bound-identity" className="identity-bond-card">
        <span className="identity-bond-icon">🔗</span>
        <span className="identity-bond-title">Identity Bond</span>
        <span className="identity-bond-desc">Create a bound identity proof</span>
      </Link>
    </div>
  );
}
