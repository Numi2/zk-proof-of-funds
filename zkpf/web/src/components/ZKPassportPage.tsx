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
  const [devMode, _setDevMode] = useState(false);
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

      {/* Privacy Guarantees */}
      <section className="privacy-guarantees">
        <header className="privacy-guarantees-header">
          <p className="eyebrow">Privacy Guarantees</p>
          <h2>What we never see, store, or transmit</h2>
        </header>
        <div className="privacy-grid">
          <div className="privacy-item privacy-item-never">
            <div className="privacy-icon">🚫</div>
            <h4>Never Stored</h4>
            <ul>
              <li>Passport names or numbers</li>
              <li>Wallet addresses or keys</li>
              <li>Exact balances or positions</li>
              <li>Transaction history</li>
              <li>Biometric data</li>
            </ul>
          </div>
          <div className="privacy-item privacy-item-only">
            <div className="privacy-icon">✓</div>
            <h4>Only Stored</h4>
            <ul>
              <li>Opaque personhood identifiers</li>
              <li>Hashed wallet binding IDs</li>
              <li>Proof validity timestamps</li>
              <li>Policy compliance flags</li>
              <li>Anonymous nullifiers</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Identity Bond Card - Enhanced CTA */}
      <div className="identity-bond-section">
        <div className="identity-bond-header">
          <h3>Next Step: Bound Identity</h3>
          <p className="muted">
            Combine your identity proof with a proof of funds to create a powerful privacy-preserving credential.
          </p>
        </div>
        <Link to="/bound-identity" className="identity-bond-card">
          <span className="identity-bond-icon">🔗</span>
          <div className="identity-bond-content">
            <span className="identity-bond-title">Create Identity Bond</span>
            <span className="identity-bond-desc">Prove identity + funds together for DeFi, KYC, or accredited investor verification</span>
          </div>
          <span className="identity-bond-arrow">→</span>
        </Link>
        
        {/* Quick info cards */}
        <div className="identity-bond-features">
          <div className="bond-feature">
            <span className="bond-feature-icon">🛡️</span>
            <span>Privacy-preserving KYC</span>
          </div>
          <div className="bond-feature">
            <span className="bond-feature-icon">💰</span>
            <span>Proof of funds</span>
          </div>
          <div className="bond-feature">
            <span className="bond-feature-icon">🔐</span>
            <span>Cryptographic binding</span>
          </div>
        </div>
      </div>

      {/* Related Products */}
      <section className="product-suite">
        <header className="product-suite-header">
          <p className="eyebrow">Explore More</p>
          <h2>Related privacy tools</h2>
        </header>
        <div className="product-grid">
          <Link 
            to="/credentials" 
            className="product-card"
            style={{ '--card-gradient': 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' } as React.CSSProperties}
          >
            <div className="product-card-icon">🔐</div>
            <div className="product-card-content">
              <h3 className="product-card-title">Cross-chain Credentials Hub</h3>
              <p className="product-card-subtitle">Zcash • Mina • Starknet • NEAR</p>
              <p className="product-card-description">Generate, manage, and share proof-of-funds credentials across multiple chains. Prove your funds exist without moving assets or revealing balances.</p>
              <ul className="product-card-features">
                <li>Multi-chain proofs</li>
                <li>One-click verification</li>
                <li>Shareable credentials</li>
              </ul>
            </div>
            <div className="product-card-arrow">→</div>
          </Link>
          <Link 
            to="/bound-identity" 
            className="product-card"
            style={{ '--card-gradient': 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' } as React.CSSProperties}
          >
            <div className="product-card-icon">🔗</div>
            <div className="product-card-content">
              <h3 className="product-card-title">Personhood-Wallet Binding</h3>
              <p className="product-card-subtitle">Bond funds to verified identity</p>
              <p className="product-card-description">Cryptographically bind your wallet to your verified personhood. Prove you control funds as a verified individual without revealing wallet addresses or balances.</p>
              <ul className="product-card-features">
                <li>Ed25519 signatures</li>
                <li>Challenge-response auth</li>
                <li>Multi-wallet support</li>
              </ul>
            </div>
            <div className="product-card-arrow">→</div>
          </Link>
          <Link 
            to="/p2p" 
            className="product-card"
            style={{ '--card-gradient': 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' } as React.CSSProperties}
          >
            <div className="product-card-icon">🤝</div>
            <div className="product-card-content">
              <h3 className="product-card-title">P2P Marketplace</h3>
              <p className="product-card-subtitle">Trade with verified counterparties</p>
              <p className="product-card-description">Peer-to-peer trading with proof-of-funds escrow. Both parties can verify each other's balances before committing, without revealing exact amounts.</p>
              <ul className="product-card-features">
                <li>ZK-verified escrow</li>
                <li>Reputation system</li>
                <li>Multi-asset support</li>
              </ul>
            </div>
            <div className="product-card-arrow">→</div>
          </Link>
        </div>
      </section>
    </div>
  );
}
