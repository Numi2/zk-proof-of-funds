/**
 * Bound Identity Builder Component
 * 
 * Creates a cryptographic bond between ZKPassport identity proofs
 * and ZKPF funds proofs. This enables privacy-preserving KYC+PoF.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ZKPassport } from '@zkpassport/sdk';
import type { ProofResult, QueryResult } from '@zkpassport/sdk';
import QRCode from 'react-qr-code';
import type { ProofBundle } from '../types/zkpf';
import type { 
  BoundIdentityProof, 
  BoundIdentityPolicy,
} from '../types/bound-identity';
import type { ShareableProofBundle } from '../utils/shareable-proof';
import { 
  createBoundIdentityProof, 
  deriveHolderSecretSeed,
  createBoundIdentityUrl,
  saveBoundIdentityProof,
} from '../utils/bound-identity';
import { getCurrencyMeta } from '../utils/policy';

// ============================================================================
// Types
// ============================================================================

interface Props {
  /** Pre-loaded ZKPassport proof (if coming from ZKPassport flow) */
  zkpassportProof?: ShareableProofBundle | null;
  /** Pre-loaded ZKPF bundle (if coming from proof builder) */
  zkpfBundle?: ProofBundle | null;
  /** Callback when bound proof is created */
  onBoundProofCreated?: (proof: BoundIdentityProof) => void;
}

type BuildStep = 'intro' | 'identity' | 'funds' | 'review' | 'binding' | 'complete';

interface IdentityVerificationState {
  status: 'idle' | 'requesting' | 'request-received' | 'generating-proof' | 'proof-generated' | 'complete' | 'error';
  proofs: ProofResult[];
  queryResult?: QueryResult;
  uniqueIdentifier?: string;
  error?: string;
  requestId?: string;
  url?: string;
}

// ============================================================================
// Pre-built Bond Policies
// ============================================================================

const BOND_POLICIES: BoundIdentityPolicy[] = [
  {
    policyId: 1001,
    label: 'DeFi KYC Bond',
    description: 'Prove you are an adult with funds for DeFi access',
    purpose: 'Privacy-preserving KYC for DeFi protocols',
    scope: 'bound-identity:defi-kyc',
    validity: 86400 * 30, // 30 days
    identityQuery: {
      ageGte: 18,
    },
    fundsPolicy: {
      thresholdRaw: 1000000000, // 10 ZEC
      currencyCode: 5915971, // ZEC
      railId: 'CUSTODIAL_ATTESTATION',
      scopeId: 314159265,
    },
    useCases: ['DeFi Access', 'Age Verification', 'Funds Proof'],
  },
  {
    policyId: 1002,
    label: 'Accredited Investor Bond',
    description: 'Prove nationality and substantial funds for security token access',
    purpose: 'Accredited investor verification for security tokens',
    scope: 'bound-identity:accredited-investor',
    validity: 86400 * 90, // 90 days
    identityQuery: {
      ageGte: 21,
      nationalityIn: ['USA', 'CAN', 'GBR', 'DEU', 'FRA', 'CHE', 'SGP', 'JPN', 'AUS'],
    },
    fundsPolicy: {
      thresholdRaw: 100000000000, // 1000 ZEC (~$40k)
      currencyCode: 5915971,
      railId: 'CUSTODIAL_ATTESTATION',
      scopeId: 314159265,
    },
    useCases: ['Accredited Investor', 'Security Tokens', 'High Net Worth'],
  },
  {
    policyId: 1003,
    label: 'Privacy-Preserving Credit Check',
    description: 'Prove identity and collateral for credit applications',
    purpose: 'Credit verification without revealing full identity',
    scope: 'bound-identity:credit-check',
    validity: 86400 * 7, // 7 days
    identityQuery: {
      ageGte: 18,
      discloseNationality: true,
    },
    fundsPolicy: {
      thresholdRaw: 10000000000, // 100 ZEC
      currencyCode: 5915971,
      railId: 'CUSTODIAL_ATTESTATION',
      scopeId: 314159265,
    },
    useCases: ['Credit Check', 'Collateral Proof', 'Lending'],
  },
  {
    policyId: 1004,
    label: 'Shielded Escrow Participant',
    description: 'Verify identity and funds for escrow participation',
    purpose: 'Identity-bound escrow verification',
    scope: 'bound-identity:escrow-participant',
    validity: 86400 * 14, // 14 days
    identityQuery: {
      ageGte: 18,
      // Passport must be valid
    },
    fundsPolicy: {
      thresholdRaw: 0, // Any amount
      currencyCode: 5915971,
      railId: 'CUSTODIAL_ATTESTATION',
      scopeId: 314159265,
    },
    useCases: ['Escrow', 'P2P Trading', 'OTC Deals'],
  },
  {
    policyId: 1005,
    label: 'Zcash Orchard Identity Bond',
    description: 'Bond identity with shielded Orchard pool funds',
    purpose: 'Privacy-preserving identity + shielded funds',
    scope: 'bound-identity:general',
    validity: 86400 * 30,
    identityQuery: {
      ageGte: 18,
    },
    fundsPolicy: {
      thresholdRaw: 1000000000, // 10 ZEC
      currencyCode: 999001, // Orchard ZEC
      railId: 'ZCASH_ORCHARD',
      scopeId: 300,
    },
    useCases: ['Shielded Funds', 'Orchard Pool', 'Maximum Privacy'],
  },
];

// ============================================================================
// Component
// ============================================================================

export function BoundIdentityBuilder({
  zkpassportProof: initialZkpassportProof,
  zkpfBundle: initialZkpfBundle,
  onBoundProofCreated,
}: Props) {
  const navigate = useNavigate();
  
  // State
  const [step, setStep] = useState<BuildStep>('intro');
  const [selectedPolicy, setSelectedPolicy] = useState<BoundIdentityPolicy | null>(null);
  const [zkpassportProof, setZkpassportProof] = useState<ShareableProofBundle | null>(
    initialZkpassportProof ?? null
  );
  const [zkpfBundle, setZkpfBundle] = useState<ProofBundle | null>(
    initialZkpfBundle ?? null
  );
  const [boundProof, setBoundProof] = useState<BoundIdentityProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  // ZKPassport state
  const [zkPassport] = useState(() => new ZKPassport('zkpf.dev'));
  const [identityState, setIdentityState] = useState<IdentityVerificationState>({
    status: 'idle',
    proofs: [],
  });
  
  // Detect if we have wallet viewing key available
  const hasWalletViewingKey = useMemo(() => {
    try {
      return !!localStorage.getItem('zkpf-zcash-ufvk');
    } catch {
      return false;
    }
  }, []);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RESTORE STATE FROM SESSION STORAGE
  // This is critical for the user flow: when they navigate to /build to create
  // a proof and then return, we need to restore their progress!
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    try {
      // Check if we have a bundle that was returned from the proof builder
      const returnedBundleJson = sessionStorage.getItem('bound-identity-returned-bundle');
      if (returnedBundleJson) {
        const returnedBundle = JSON.parse(returnedBundleJson) as ProofBundle;
        setZkpfBundle(returnedBundle);
        sessionStorage.removeItem('bound-identity-returned-bundle');
      }
      
      // Restore saved policy if we don't already have one
      if (!selectedPolicy) {
        const savedPolicyJson = sessionStorage.getItem('bound-identity-policy');
        if (savedPolicyJson) {
          const savedPolicy = JSON.parse(savedPolicyJson) as BoundIdentityPolicy;
          setSelectedPolicy(savedPolicy);
        }
      }
      
      // Restore saved zkpassport proof if we don't already have one
      if (!zkpassportProof) {
        const savedZkpassportJson = sessionStorage.getItem('bound-identity-zkpassport');
        if (savedZkpassportJson && savedZkpassportJson !== 'null') {
          const savedZkpassport = JSON.parse(savedZkpassportJson) as ShareableProofBundle;
          setZkpassportProof(savedZkpassport);
        }
      }
    } catch (err) {
      console.warn('Failed to restore bound identity state:', err);
    }
  }, []);
  
  // Auto-advance to the right step based on what proofs we have
  useEffect(() => {
    // Only auto-advance if we have data and are still at intro
    const hasIdentity = zkpassportProof || initialZkpassportProof;
    const hasFunds = zkpfBundle || initialZkpfBundle;
    
    if (hasIdentity && hasFunds && step === 'intro') {
      setStep('review');
    } else if (hasIdentity && !hasFunds && step === 'intro') {
      setStep('funds');
    } else if (!hasIdentity && hasFunds && step === 'intro') {
      setStep('identity');
    } else if (selectedPolicy && !hasIdentity && step === 'intro') {
      // User returned from proof builder but still needs identity
      setStep('identity');
    } else if (selectedPolicy && hasIdentity && !hasFunds) {
      // User has policy and identity, needs funds
      setStep('funds');
    }
  }, [initialZkpassportProof, initialZkpfBundle, zkpassportProof, zkpfBundle, selectedPolicy, step]);
  
  // Start ZKPassport verification
  const startIdentityVerification = useCallback(async () => {
    if (!selectedPolicy) {
      setError('Please select a bond policy first');
      return;
    }
    
    try {
      setIdentityState(prev => ({ ...prev, status: 'requesting', error: undefined }));
      
      const builder = await zkPassport.request({
        name: 'ZKPF Bound Identity',
        logo: '/zkpf.png',
        purpose: selectedPolicy.purpose,
        devMode: selectedPolicy.devMode,
      });
      
      // Build query from policy
      let query = builder;
      const q = selectedPolicy.identityQuery;
      
      if (q.ageGte) query = query.gte('age', q.ageGte);
      if (q.ageLt) query = query.lt('age', q.ageLt);
      // Cast to any to handle ZKPassport SDK's strict country type literals
      if (q.nationalityIn) query = query.in('nationality', q.nationalityIn as any);
      if (q.nationalityOut) query = query.out('nationality', q.nationalityOut as any);
      if (q.discloseNationality) query = query.disclose('nationality');
      if (q.discloseBirthdate) query = query.disclose('birthdate');
      if (q.discloseFullname) query = query.disclose('fullname');
      
      const result = query.done();
      
      setIdentityState(prev => ({
        ...prev,
        requestId: result.requestId,
        url: result.url,
      }));
      
      // Set up event handlers
      result.onRequestReceived(() => {
        setIdentityState(prev => ({ ...prev, status: 'request-received' }));
      });
      
      result.onGeneratingProof(() => {
        setIdentityState(prev => ({ ...prev, status: 'generating-proof' }));
      });
      
      result.onProofGenerated((proof: ProofResult) => {
        setIdentityState(prev => ({
          ...prev,
          status: 'proof-generated',
          proofs: [...prev.proofs, proof],
        }));
      });
      
      result.onResult((response: {
        uniqueIdentifier: string | undefined;
        verified: boolean;
        result: QueryResult;
      }) => {
        if (response.verified) {
          // Create shareable proof bundle
          const shareableProof: ShareableProofBundle = {
            version: 1,
            proofId: `zkp_${Date.now().toString(36)}`,
            timestamp: Date.now(),
            policy: {
              id: selectedPolicy.policyId,
              label: selectedPolicy.label,
              purpose: selectedPolicy.purpose,
              scope: selectedPolicy.scope,
              validity: selectedPolicy.validity,
              devMode: selectedPolicy.devMode,
              query: selectedPolicy.identityQuery,
            },
            proofs: identityState.proofs.map(p => ({
              name: p.name || 'unknown',
              version: p.version || '1.0.0',
              proof: p.proof || '',
              publicInputs: (p as any).publicInputs,
              vkeyHash: p.vkeyHash || '',
              index: p.index ?? 0,
              total: p.total ?? 1,
            })),
            queryResult: response.result,
            uniqueIdentifier: response.uniqueIdentifier,
            requestId: identityState.requestId || '',
          };
          
          setZkpassportProof(shareableProof);
          setIdentityState(prev => ({
            ...prev,
            status: 'complete',
            queryResult: response.result,
            uniqueIdentifier: response.uniqueIdentifier,
          }));
          
          // Auto-advance to next step
          setStep('funds');
        } else {
          setIdentityState(prev => ({
            ...prev,
            status: 'error',
            error: 'Identity verification failed',
          }));
        }
      });
      
    } catch (err) {
      setIdentityState(prev => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start verification',
      }));
    }
  }, [selectedPolicy, zkPassport, identityState.proofs, identityState.requestId]);
  
  // Handle ZKPF bundle from file upload
  const handleBundleUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const bundle = JSON.parse(content) as ProofBundle;
        
        // Validate bundle structure
        if (!bundle.proof || !bundle.public_inputs) {
          throw new Error('Invalid bundle structure');
        }
        
        setZkpfBundle(bundle);
        setStep('review');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse bundle');
      }
    };
    reader.readAsText(file);
  }, []);
  
  // Navigate to build proof
  const navigateToBuildProof = useCallback(() => {
    // Store current state so we can return
    sessionStorage.setItem('bound-identity-policy', JSON.stringify(selectedPolicy));
    sessionStorage.setItem('bound-identity-zkpassport', JSON.stringify(zkpassportProof));
    // Set a flag so the proof builder knows to return here
    sessionStorage.setItem('bound-identity-return-pending', 'true');
    navigate('/build', { state: { returnTo: '/bound-identity', fromBoundIdentity: true } });
  }, [selectedPolicy, zkpassportProof, navigate]);
  
  // Navigate to wallet to connect
  const navigateToWallet = useCallback(() => {
    // Store current state
    sessionStorage.setItem('bound-identity-policy', JSON.stringify(selectedPolicy));
    sessionStorage.setItem('bound-identity-zkpassport', JSON.stringify(zkpassportProof));
    sessionStorage.setItem('bound-identity-return-pending', 'true');
    navigate('/wallet');
  }, [selectedPolicy, zkpassportProof, navigate]);
  
  // Create the bound proof
  const createBoundProof = useCallback(async () => {
    if (!selectedPolicy || !zkpassportProof || !zkpfBundle) {
      setError('Missing required proofs');
      return;
    }
    
    setIsCreating(true);
    setError(null);
    setStep('binding');
    
    try {
      // Get wallet viewing key for binding derivation
      const ufvk = localStorage.getItem('zkpf-zcash-ufvk') || '';
      const uniqueId = zkpassportProof.uniqueIdentifier || zkpassportProof.proofId;
      
      // Derive holder secret seed
      const holderSecretSeed = deriveHolderSecretSeed(
        uniqueId,
        ufvk,
        selectedPolicy.scope
      );
      
      // Create the bound proof
      const result = createBoundIdentityProof({
        policy: selectedPolicy,
        zkpassportProof,
        zkpfBundle,
        holderSecretSeed,
      });
      
      if (!result.success || !result.boundProof) {
        throw new Error(result.error || 'Failed to create bound proof');
      }
      
      setBoundProof(result.boundProof);
      
      // Save to local storage
      saveBoundIdentityProof(result.boundProof);
      
      // Generate share URL
      const url = createBoundIdentityUrl(result.boundProof);
      setShareUrl(url);
      
      // Notify parent
      onBoundProofCreated?.(result.boundProof);
      
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create bound proof');
      setStep('review');
    } finally {
      setIsCreating(false);
    }
  }, [selectedPolicy, zkpassportProof, zkpfBundle, onBoundProofCreated]);
  
  // Copy share URL
  const copyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);
  
  // Download bound proof
  const downloadBoundProof = useCallback(() => {
    if (!boundProof) return;
    
    const blob = new Blob([JSON.stringify(boundProof, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bound-identity-${boundProof.bondId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [boundProof]);
  
  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case 'intro':
        return (
          <div className="bound-identity-intro">
            <div className="intro-hero">
              <div className="intro-icon">🔐</div>
              <h2>Bound Identity Proof</h2>
              <p className="intro-subtitle">
                Create a cryptographic bond between your identity and your funds.
                Prove who you are <em>and</em> what you control—without revealing either.
              </p>
            </div>
            
            <div className="intro-features">
              <div className="intro-feature">
                <span className="feature-icon">🛡️</span>
                <div>
                  <strong>Privacy-Preserving KYC</strong>
                  <p>Verify identity requirements without exposing passport details</p>
                </div>
              </div>
              <div className="intro-feature">
                <span className="feature-icon">💰</span>
                <div>
                  <strong>Proof of Funds</strong>
                  <p>Prove you meet balance thresholds without revealing amounts</p>
                </div>
              </div>
              <div className="intro-feature">
                <span className="feature-icon">🔗</span>
                <div>
                  <strong>Cryptographic Bond</strong>
                  <p>Both proofs are tied to the same person via zero-knowledge</p>
                </div>
              </div>
            </div>
            
            <h3>Select a Bond Policy</h3>
            <div className="policy-grid">
              {BOND_POLICIES.map(policy => (
                <button
                  key={policy.policyId}
                  type="button"
                  className={`policy-card ${selectedPolicy?.policyId === policy.policyId ? 'selected' : ''}`}
                  onClick={() => setSelectedPolicy(policy)}
                >
                  <div className="policy-card-header">
                    <span className="policy-label">{policy.label}</span>
                    <span className="policy-validity">
                      Valid {Math.round(policy.validity / 86400)} days
                    </span>
                  </div>
                  <p className="policy-description">{policy.description}</p>
                  <div className="policy-requirements">
                    <div className="requirement">
                      <span className="req-icon">👤</span>
                      <span>
                        Age ≥ {policy.identityQuery.ageGte || 18}
                        {policy.identityQuery.nationalityIn && 
                          ` • ${policy.identityQuery.nationalityIn.length} countries`}
                      </span>
                    </div>
                    <div className="requirement">
                      <span className="req-icon">💎</span>
                      <span>
                        {getCurrencyMeta(policy.fundsPolicy.currencyCode).code} ≥{' '}
                        {(policy.fundsPolicy.thresholdRaw / 100_000_000).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="policy-tags">
                    {policy.useCases?.map(uc => (
                      <span key={uc} className="policy-tag">{uc}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
            
            <div className="intro-actions">
              <button
                type="button"
                className="primary-action"
                disabled={!selectedPolicy}
                onClick={() => setStep('identity')}
              >
                {selectedPolicy ? 'Continue with selected policy' : 'Select a policy to continue'}
              </button>
            </div>
          </div>
        );
        
      case 'identity':
        return (
          <div className="bound-identity-step">
            <div className="step-header">
              <span className="step-number">1</span>
              <div>
                <h3>Verify Your Identity</h3>
                <p className="muted">
                  Use ZKPassport to prove identity requirements without revealing your passport
                </p>
              </div>
            </div>
            
            {zkpassportProof ? (
              <div className="proof-loaded">
                <div className="proof-loaded-icon">✓</div>
                <div className="proof-loaded-content">
                  <strong>Identity Verified</strong>
                  <p>
                    {zkpassportProof.uniqueIdentifier 
                      ? `ID: ${zkpassportProof.uniqueIdentifier.slice(0, 12)}...`
                      : 'Identity proof loaded'}
                  </p>
                </div>
                <button
                  type="button"
                  className="tiny-button ghost"
                  onClick={() => {
                    setZkpassportProof(null);
                    setIdentityState({ status: 'idle', proofs: [] });
                  }}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="identity-verification">
                {identityState.status === 'idle' && (
                  <div className="verification-prompt">
                    <p>
                      Scan the QR code with your ZKPassport-enabled device to verify:
                    </p>
                    <ul className="requirements-list">
                      <li>Age ≥ {selectedPolicy?.identityQuery.ageGte || 18}</li>
                      {selectedPolicy?.identityQuery.nationalityIn && (
                        <li>Nationality: {selectedPolicy.identityQuery.nationalityIn.join(', ')}</li>
                      )}
                      {selectedPolicy?.identityQuery.discloseNationality && (
                        <li>Disclose nationality</li>
                      )}
                    </ul>
                    <button
                      type="button"
                      className="verify-button"
                      onClick={startIdentityVerification}
                    >
                      Start Identity Verification
                    </button>
                  </div>
                )}
                
                {(identityState.status === 'requesting' || identityState.status === 'request-received') && (
                  <div className="verification-waiting">
                    {identityState.url && (
                      <>
                        <div className="qr-container">
                          <div className="qr-code-wrapper">
                            <QRCode value={identityState.url} size={200} level="M" />
                          </div>
                        </div>
                        <div className="qr-actions">
                          <a 
                            href={identityState.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="tiny-button"
                          >
                            Open in ZKPassport App →
                          </a>
                        </div>
                      </>
                    )}
                    <div className="waiting-status">
                      <span className="spinner small"></span>
                      <span>Waiting for ZKPassport verification...</span>
                    </div>
                    <p className="muted small">
                      Scan the QR code with your ZKPassport-enabled device, or tap the button above if you have the app installed.
                    </p>
                    
                    {/* Help text for users who don't have the app */}
                    <details className="verification-help">
                      <summary>Don't have ZKPassport?</summary>
                      <div className="verification-help-content">
                        <p>
                          ZKPassport is a mobile app that lets you prove facts about your identity 
                          (like your age or nationality) without revealing your passport details.
                        </p>
                        <p>
                          <strong>To get started:</strong>
                        </p>
                        <ol>
                          <li>Download the ZKPassport app from your app store</li>
                          <li>Scan your passport's NFC chip</li>
                          <li>Return here and scan this QR code</li>
                        </ol>
                        <p className="muted small">
                          Your passport data stays on your device and is never shared.
                        </p>
                      </div>
                    </details>
                  </div>
                )}
                
                {identityState.status === 'generating-proof' && (
                  <div className="verification-generating">
                    <span className="spinner"></span>
                    <p>Generating identity proof...</p>
                    <p className="muted small">This may take a moment</p>
                  </div>
                )}
                
                {identityState.status === 'error' && (
                  <div className="verification-error">
                    <span className="error-icon">⚠️</span>
                    <p>{identityState.error}</p>
                    <button
                      type="button"
                      className="tiny-button"
                      onClick={() => setIdentityState({ status: 'idle', proofs: [] })}
                    >
                      Try Again
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="step-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setStep('intro')}
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!zkpassportProof}
                onClick={() => setStep('funds')}
              >
                Continue →
              </button>
            </div>
          </div>
        );
        
      case 'funds':
        return (
          <div className="bound-identity-step">
            <div className="step-header">
              <span className="step-number">2</span>
              <div>
                <h3>Prove Your Funds</h3>
                <p className="muted">
                  Generate or upload a ZKPF proof showing you meet the balance threshold
                </p>
              </div>
            </div>
            
            {zkpfBundle ? (
              <div className="proof-loaded">
                <div className="proof-loaded-icon">✓</div>
                <div className="proof-loaded-content">
                  <strong>Funds Proof Loaded</strong>
                  <p>
                    Policy {zkpfBundle.public_inputs.policy_id} •{' '}
                    {getCurrencyMeta(zkpfBundle.public_inputs.required_currency_code).code} ≥{' '}
                    {(zkpfBundle.public_inputs.threshold_raw / 100_000_000).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  className="tiny-button ghost"
                  onClick={() => setZkpfBundle(null)}
                >
                  Clear
                </button>
              </div>
            ) : (
              <div className="funds-options">
                {/* Show wallet help banner if no wallet connected */}
                {!hasWalletViewingKey && (
                  <div className="wallet-help-banner">
                    <div className="wallet-help-icon">💡</div>
                    <div className="wallet-help-content">
                      <strong>No wallet connected</strong>
                      <p>To build a proof, you first need to connect your Zcash wallet.</p>
                      <button
                        type="button"
                        className="wallet-help-button"
                        onClick={navigateToWallet}
                      >
                        Connect Wallet →
                      </button>
                    </div>
                  </div>
                )}
                
                <div className={`funds-option ${!hasWalletViewingKey ? 'disabled' : ''}`}>
                  <div className="option-icon">🏗️</div>
                  <div className="option-content">
                    <strong>Build New Proof</strong>
                    <p>Generate a fresh proof from your connected wallet</p>
                    {hasWalletViewingKey && (
                      <p className="option-hint success">✓ Wallet connected</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="tiny-button primary"
                    onClick={navigateToBuildProof}
                    disabled={!hasWalletViewingKey}
                  >
                    Build Proof
                  </button>
                </div>
                
                <div className="option-divider">or</div>
                
                <div className="funds-option">
                  <div className="option-icon">📁</div>
                  <div className="option-content">
                    <strong>Upload Existing Proof</strong>
                    <p>Use a proof bundle JSON file you already have</p>
                    <p className="option-hint">Accepts .json proof bundle files</p>
                  </div>
                  <label className="tiny-button file-upload-button">
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={handleBundleUpload}
                      style={{ display: 'none' }}
                    />
                    Choose File
                  </label>
                </div>
                
                {/* Quick help section */}
                <details className="funds-help-section">
                  <summary>Need help? What is a proof bundle?</summary>
                  <div className="funds-help-content">
                    <p>
                      A <strong>proof bundle</strong> is a cryptographic certificate that proves you control 
                      funds meeting a certain threshold—without revealing your actual balance or wallet address.
                    </p>
                    <p>You can generate one by:</p>
                    <ol>
                      <li>Connecting your Zcash wallet (seed phrase or MetaMask Snap)</li>
                      <li>Syncing your wallet to see your balance</li>
                      <li>Clicking "Build Proof" to generate the cryptographic proof</li>
                    </ol>
                    <p className="muted small">
                      The proof is generated locally in your browser using zero-knowledge cryptography. 
                      Your private keys never leave your device.
                    </p>
                  </div>
                </details>
              </div>
            )}
            
            <div className="step-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setStep('identity')}
              >
                ← Back
              </button>
              <button
                type="button"
                disabled={!zkpfBundle}
                onClick={() => setStep('review')}
              >
                Continue →
              </button>
            </div>
          </div>
        );
        
      case 'review':
        return (
          <div className="bound-identity-step">
            <div className="step-header">
              <span className="step-number">3</span>
              <div>
                <h3>Review & Create Bond</h3>
                <p className="muted">
                  Verify both proofs before creating the cryptographic bond
                </p>
              </div>
            </div>
            
            <div className="review-cards">
              <div className="review-card">
                <div className="review-card-header">
                  <span className="review-card-icon">👤</span>
                  <strong>Identity Proof</strong>
                  {zkpassportProof ? (
                    <span className="status-badge success">✓ Loaded</span>
                  ) : (
                    <span className="status-badge warning">Missing</span>
                  )}
                </div>
                {zkpassportProof && (
                  <div className="review-card-details">
                    <div className="detail-row">
                      <span className="detail-label">Proof ID</span>
                      <span className="detail-value mono">
                        {zkpassportProof.proofId.slice(0, 16)}...
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Unique ID</span>
                      <span className="detail-value mono">
                        {zkpassportProof.uniqueIdentifier?.slice(0, 16) || 'N/A'}...
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Proofs</span>
                      <span className="detail-value">
                        {zkpassportProof.proofs.length} proof(s)
                      </span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="review-card">
                <div className="review-card-header">
                  <span className="review-card-icon">💰</span>
                  <strong>Funds Proof</strong>
                  {zkpfBundle ? (
                    <span className="status-badge success">✓ Loaded</span>
                  ) : (
                    <span className="status-badge warning">Missing</span>
                  )}
                </div>
                {zkpfBundle && (
                  <div className="review-card-details">
                    <div className="detail-row">
                      <span className="detail-label">Policy ID</span>
                      <span className="detail-value mono">
                        {zkpfBundle.public_inputs.policy_id}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Threshold</span>
                      <span className="detail-value">
                        ≥ {(zkpfBundle.public_inputs.threshold_raw / 100_000_000).toLocaleString()}{' '}
                        {getCurrencyMeta(zkpfBundle.public_inputs.required_currency_code).code}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Rail</span>
                      <span className="detail-value">
                        {zkpfBundle.rail_id || 'Custodial'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {selectedPolicy && (
              <div className="bond-summary">
                <h4>Bond Policy: {selectedPolicy.label}</h4>
                <p className="muted small">{selectedPolicy.purpose}</p>
                <div className="bond-validity">
                  Valid for {Math.round(selectedPolicy.validity / 86400)} days after creation
                </div>
              </div>
            )}
            
            {error && (
              <div className="error-message-detailed">
                <div className="error-header">
                  <span className="error-icon">⚠️</span>
                  <strong>Something went wrong</strong>
                </div>
                <p className="error-description">{error}</p>
                <div className="error-actions">
                  <button
                    type="button"
                    className="tiny-button ghost"
                    onClick={() => setError(null)}
                  >
                    Dismiss
                  </button>
                  {error.includes('proof') && (
                    <button
                      type="button"
                      className="tiny-button"
                      onClick={() => setStep('funds')}
                    >
                      Re-upload proof
                    </button>
                  )}
                </div>
              </div>
            )}
            
            {/* Missing data warnings */}
            {!zkpassportProof && (
              <div className="warning-message">
                <span className="warning-icon">💡</span>
                <div className="warning-content">
                  <strong>Identity proof missing</strong>
                  <p>Go back to Step 1 to verify your identity with ZKPassport.</p>
                  <button
                    type="button"
                    className="tiny-button"
                    onClick={() => setStep('identity')}
                  >
                    Verify Identity
                  </button>
                </div>
              </div>
            )}
            
            {!zkpfBundle && (
              <div className="warning-message">
                <span className="warning-icon">💡</span>
                <div className="warning-content">
                  <strong>Funds proof missing</strong>
                  <p>Go back to Step 2 to build or upload a proof of funds.</p>
                  <button
                    type="button"
                    className="tiny-button"
                    onClick={() => setStep('funds')}
                  >
                    Add Funds Proof
                  </button>
                </div>
              </div>
            )}
            
            <div className="step-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setStep('funds')}
              >
                ← Back
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={!zkpassportProof || !zkpfBundle || isCreating}
                onClick={createBoundProof}
              >
                {isCreating ? (
                  <>
                    <span className="spinner small"></span>
                    Creating Bond...
                  </>
                ) : (
                  '🔗 Create Bound Identity Proof'
                )}
              </button>
            </div>
          </div>
        );
        
      case 'binding':
        return (
          <div className="bound-identity-step binding-step">
            <div className="binding-animation">
              <div className="binding-circle identity-circle">
                <span>👤</span>
              </div>
              <div className="binding-line">
                <span className="binding-particles">🔗</span>
              </div>
              <div className="binding-circle funds-circle">
                <span>💰</span>
              </div>
            </div>
            <h3>Creating Cryptographic Bond</h3>
            <p className="muted">
              Deriving holder binding and composing proofs...
            </p>
            <div className="binding-steps">
              <div className="binding-step-item complete">
                <span className="binding-step-check">✓</span>
                <span>Deriving identity commitment</span>
              </div>
              <div className="binding-step-item complete">
                <span className="binding-step-check">✓</span>
                <span>Deriving funds commitment</span>
              </div>
              <div className="binding-step-item active">
                <span className="spinner tiny"></span>
                <span>Computing holder binding</span>
              </div>
              <div className="binding-step-item">
                <span className="binding-step-dot">○</span>
                <span>Generating nullifier</span>
              </div>
            </div>
          </div>
        );
        
      case 'complete':
        return (
          <div className="bound-identity-step complete-step">
            <div className="complete-icon">🎉</div>
            <h3>Bound Identity Proof Created!</h3>
            <p className="muted">
              Your identity and funds are now cryptographically bonded.
            </p>
            
            {boundProof && (
              <div className="bond-result">
                <div className="bond-result-row">
                  <span className="result-label">Bond ID</span>
                  <span className="result-value mono">{boundProof.bondId}</span>
                </div>
                <div className="bond-result-row">
                  <span className="result-label">Valid Until</span>
                  <span className="result-value">
                    {new Date(boundProof.metadata.validUntil * 1000).toLocaleDateString()}
                  </span>
                </div>
                <div className="bond-result-row">
                  <span className="result-label">Scope</span>
                  <span className="result-value mono">{boundProof.metadata.scope}</span>
                </div>
              </div>
            )}
            
            {shareUrl && (
              <div className="share-section">
                <h4>Share Your Bond</h4>
                <div className="share-url-container">
                  <input
                    type="text"
                    readOnly
                    value={shareUrl}
                    className="share-url-input"
                  />
                  <button
                    type="button"
                    className="tiny-button"
                    onClick={copyShareUrl}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
            )}
            
            <div className="complete-actions">
              <button
                type="button"
                className="primary-action"
                onClick={downloadBoundProof}
              >
                📥 Download Bound Proof
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setBoundProof(null);
                  setZkpassportProof(null);
                  setZkpfBundle(null);
                  setSelectedPolicy(null);
                  setStep('intro');
                }}
              >
                Create Another
              </button>
            </div>
          </div>
        );
    }
  };
  
  return (
    <section className="bound-identity-builder card">
      <header>
        <p className="eyebrow">Identity + Funds</p>
        <h2>Bound Identity Proof Builder</h2>
      </header>
      
      {/* Progress indicator */}
      {step !== 'intro' && step !== 'complete' && (
        <div className="build-progress">
          <div className={`progress-step ${step === 'identity' ? 'active' : zkpassportProof ? 'complete' : ''}`}>
            <span className="progress-dot">1</span>
            <span className="progress-label">Identity</span>
          </div>
          <div className="progress-line"></div>
          <div className={`progress-step ${step === 'funds' ? 'active' : zkpfBundle ? 'complete' : ''}`}>
            <span className="progress-dot">2</span>
            <span className="progress-label">Funds</span>
          </div>
          <div className="progress-line"></div>
          <div className={`progress-step ${step === 'review' || step === 'binding' ? 'active' : ''}`}>
            <span className="progress-dot">3</span>
            <span className="progress-label">Bond</span>
          </div>
        </div>
      )}
      
      {renderStepContent()}
    </section>
  );
}

export default BoundIdentityBuilder;

