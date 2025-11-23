import { useState, useCallback } from 'react';
import { ZKPassport, type ProofResult, type QueryResult } from '@zkpassport/sdk';
import QRCode from 'react-qr-code';

// Import country constants - these should be available in the SDK
import * as ZKPassportSDK from '@zkpassport/sdk';

const EU_COUNTRIES = (ZKPassportSDK as any).EU_COUNTRIES || [];
const EEA_COUNTRIES = (ZKPassportSDK as any).EEA_COUNTRIES || [];
const SCHENGEN_COUNTRIES = (ZKPassportSDK as any).SCHENGEN_COUNTRIES || [];
const SANCTIONED_COUNTRIES = (ZKPassportSDK as any).SANCTIONED_COUNTRIES || [];

type VerificationStatus = 'idle' | 'requesting' | 'request-received' | 'generating-proof' | 'proof-generated' | 'verified' | 'rejected' | 'error';
type TabType = 'basic' | 'verification' | 'advanced' | 'example';

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

const DISCLOSURE_USE_CASES = [
  { 
    key: 'discloseNationality', 
    label: 'Nationality', 
    appName: 'Nationality Verification',
    purpose: 'Verify user nationality for eligibility checks',
    inputLabel: 'What nationality?',
    inputPlaceholder: 'e.g., USA, GBR, FRA',
    inputType: 'text'
  },
  { 
    key: 'discloseBirthdate', 
    label: 'Age', 
    appName: 'Age Verification',
    purpose: 'Verify user age for age-related services',
    inputLabel: 'What age?',
    inputPlaceholder: 'e.g., 25',
    inputType: 'number'
  },
  { 
    key: 'discloseFullname', 
    label: 'Full Name', 
    appName: 'Full Name Verification',
    purpose: 'Verify user full name for identity confirmation',
    inputLabel: 'What full name?',
    inputPlaceholder: 'e.g., John Doe',
    inputType: 'text'
  },
  { 
    key: 'discloseFirstname', 
    label: 'First Name', 
    appName: 'First Name Verification',
    purpose: 'Verify user first name for personalized services',
    inputLabel: 'What first name?',
    inputPlaceholder: 'e.g., John',
    inputType: 'text'
  },
  { 
    key: 'discloseLastname', 
    label: 'Last Name', 
    appName: 'Last Name Verification',
    purpose: 'Verify user last name for account verification',
    inputLabel: 'What last name?',
    inputPlaceholder: 'e.g., Doe',
    inputType: 'text'
  },
  { 
    key: 'discloseExpiryDate', 
    label: 'Expiry Date', 
    appName: 'Document Expiry Verification',
    purpose: 'Verify document expiry date for validity checks',
    inputLabel: 'What expiry date?',
    inputPlaceholder: 'YYYY-MM-DD',
    inputType: 'date'
  },
  { 
    key: 'discloseDocumentNumber', 
    label: 'Document Number', 
    appName: 'Document Number Verification',
    purpose: 'Verify document number for record keeping',
    inputLabel: 'What document number?',
    inputPlaceholder: 'e.g., AB123456',
    inputType: 'text'
  },
  { 
    key: 'discloseDocumentType', 
    label: 'Document Type', 
    appName: 'Document Type Verification',
    purpose: 'Verify document type for compliance checks',
    inputLabel: 'What document type?',
    inputPlaceholder: 'e.g., passport, driver_license',
    inputType: 'text'
  },
  { 
    key: 'discloseIssuingCountry', 
    label: 'Issuing Country', 
    appName: 'Issuing Country Verification',
    purpose: 'Verify document issuing country for validation',
    inputLabel: 'What issuing country?',
    inputPlaceholder: 'e.g., USA, GBR',
    inputType: 'text'
  },
  { 
    key: 'discloseGender', 
    label: 'Gender', 
    appName: 'Gender Verification',
    purpose: 'Verify user gender for demographic purposes',
    inputLabel: 'What gender?',
    inputPlaceholder: 'e.g., M, F, Other',
    inputType: 'text'
  },
];

export function ZKPassportPage() {
  const [zkPassport] = useState(() => new ZKPassport('zkpf.dev'));
  const [activeTab, setActiveTab] = useState<TabType>('basic');
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

  // Request configuration
  const [requestConfig, setRequestConfig] = useState({
    name: 'ZKPF - Zero-Knowledge Proof of Funds',
    logo: '',
    purpose: 'Verify user identity and eligibility',
    scope: '',
    validity: 7 * 24 * 60 * 60, // 7 days in seconds
    devMode: false,
  });

  const [useCaseInputs, setUseCaseInputs] = useState<Record<string, string>>({});
  const [queryConfig, setQueryConfig] = useState({
    // Disclosure fields
    discloseNationality: false,
    discloseBirthdate: false,
    discloseFullname: false,
    discloseFirstname: false,
    discloseLastname: false,
    discloseExpiryDate: false,
    discloseDocumentNumber: false,
    discloseDocumentType: false,
    discloseIssuingCountry: false,
    discloseGender: false,
    // Age/Birthdate verification (simplified)
    ageMin: '',
    ageMax: '',
    birthdateMin: '',
    birthdateMax: '',
    // Expiry date verification
    expiryDateMin: '',
    expiryDateMax: '',
    // In/Out checks
    nationalityIn: '',
    nationalityOut: '',
    issuingCountryIn: '',
    issuingCountryOut: '',
    // Equality checks
    eqField: '',
    eqValue: '',
    // Binding
    bindUserAddress: '',
    bindChain: '',
    bindCustomData: '',
  });

  const buildQuery = useCallback(async () => {
    try {
      const builder = await zkPassport.request({
        name: requestConfig.name,
        logo: requestConfig.logo,
        purpose: requestConfig.purpose,
        scope: requestConfig.scope || undefined,
        validity: requestConfig.validity || undefined,
        devMode: requestConfig.devMode,
      });

      let query = builder;

      // Disclosure fields with equality checks based on input values
      if (queryConfig.discloseNationality) {
        query = query.disclose('nationality');
        if (useCaseInputs.discloseNationality) {
          query = query.eq('nationality', useCaseInputs.discloseNationality as any);
        }
      }
      if (queryConfig.discloseBirthdate) {
        query = query.disclose('birthdate');
        // If age input is provided, verify the user is at least that age
        if (useCaseInputs.discloseBirthdate) {
          const age = parseInt(useCaseInputs.discloseBirthdate);
          if (!isNaN(age) && age > 0) {
            // Calculate the maximum birthdate (earliest date) for someone to be at least 'age' years old
            // If someone is 25 years old, they must have been born on or before (today - 25 years)
            const today = new Date();
            const maxBirthYear = today.getFullYear() - age;
            // Use the same month and day, but subtract the age years
            const maxBirthdate = new Date(maxBirthYear, today.getMonth(), today.getDate());
            // Verify birthdate is on or before this date (user is at least 'age' years old)
            query = query.lte('birthdate', maxBirthdate);
          }
        }
      }
      if (queryConfig.discloseFullname) {
        query = query.disclose('fullname');
        if (useCaseInputs.discloseFullname) {
          query = query.eq('fullname', useCaseInputs.discloseFullname);
        }
      }
      if (queryConfig.discloseFirstname) {
        query = query.disclose('firstname');
        if (useCaseInputs.discloseFirstname) {
          query = query.eq('firstname', useCaseInputs.discloseFirstname);
        }
      }
      if (queryConfig.discloseLastname) {
        query = query.disclose('lastname');
        if (useCaseInputs.discloseLastname) {
          query = query.eq('lastname', useCaseInputs.discloseLastname);
        }
      }
      if (queryConfig.discloseExpiryDate) {
        query = query.disclose('expiry_date');
        if (useCaseInputs.discloseExpiryDate) {
          query = query.eq('expiry_date', new Date(useCaseInputs.discloseExpiryDate));
        }
      }
      if (queryConfig.discloseDocumentNumber) {
        query = query.disclose('document_number');
        if (useCaseInputs.discloseDocumentNumber) {
          query = query.eq('document_number', useCaseInputs.discloseDocumentNumber);
        }
      }
      if (queryConfig.discloseDocumentType) {
        query = query.disclose('document_type');
        if (useCaseInputs.discloseDocumentType) {
          query = query.eq('document_type', useCaseInputs.discloseDocumentType as any);
        }
      }
      if (queryConfig.discloseIssuingCountry) {
        query = query.disclose('issuing_country');
        if (useCaseInputs.discloseIssuingCountry) {
          query = query.eq('issuing_country', useCaseInputs.discloseIssuingCountry as any);
        }
      }
      if (queryConfig.discloseGender) {
        query = query.disclose('gender');
        if (useCaseInputs.discloseGender) {
          query = query.eq('gender', useCaseInputs.discloseGender as any);
        }
      }

      // Age verification (simplified)
      if (queryConfig.ageMin && queryConfig.ageMax) {
        query = query.range('age', parseInt(queryConfig.ageMin), parseInt(queryConfig.ageMax));
      } else {
        if (queryConfig.ageMin) query = query.gte('age', parseInt(queryConfig.ageMin));
        if (queryConfig.ageMax) query = query.lte('age', parseInt(queryConfig.ageMax));
      }

      // Birthdate verification (simplified)
      if (queryConfig.birthdateMin && queryConfig.birthdateMax) {
        query = query.range('birthdate', new Date(queryConfig.birthdateMin), new Date(queryConfig.birthdateMax));
      } else {
        if (queryConfig.birthdateMin) query = query.gte('birthdate', new Date(queryConfig.birthdateMin));
        if (queryConfig.birthdateMax) query = query.lte('birthdate', new Date(queryConfig.birthdateMax));
      }

      // Expiry date verification
      if (queryConfig.expiryDateMin) query = query.gte('expiry_date', new Date(queryConfig.expiryDateMin));
      if (queryConfig.expiryDateMax) query = query.lte('expiry_date', new Date(queryConfig.expiryDateMax));

      // In/Out checks
      if (queryConfig.nationalityIn) {
        const countries = queryConfig.nationalityIn.split(',').map(c => c.trim()) as any[];
        query = query.in('nationality', countries);
      }
      if (queryConfig.nationalityOut) {
        const countries = queryConfig.nationalityOut.split(',').map(c => c.trim()) as any[];
        query = query.out('nationality', countries);
      }
      if (queryConfig.issuingCountryIn) {
        const countries = queryConfig.issuingCountryIn.split(',').map(c => c.trim()) as any[];
        query = query.in('issuing_country', countries);
      }
      if (queryConfig.issuingCountryOut) {
        const countries = queryConfig.issuingCountryOut.split(',').map(c => c.trim()) as any[];
        query = query.out('issuing_country', countries);
      }

      // Equality checks
      if (queryConfig.eqField && queryConfig.eqValue) {
        query = query.eq(queryConfig.eqField as any, queryConfig.eqValue);
      }

      // Binding
      if (queryConfig.bindUserAddress) {
        const address = queryConfig.bindUserAddress.startsWith('0x') 
          ? queryConfig.bindUserAddress as `0x${string}`
          : `0x${queryConfig.bindUserAddress}` as `0x${string}`;
        query = query.bind('user_address', address);
      }
      if (queryConfig.bindChain) {
        query = query.bind('chain', queryConfig.bindChain as 'ethereum' | 'ethereum_sepolia');
      }
      if (queryConfig.bindCustomData) query = query.bind('custom_data', queryConfig.bindCustomData);

      return query;
    } catch (error) {
      setVerificationState(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to build query',
      }));
      return null;
    }
  }, [zkPassport, requestConfig, queryConfig, useCaseInputs]);

  const startVerification = useCallback(async () => {
    try {
      setVerificationState(prev => ({ ...prev, status: 'requesting', error: null, proofs: [] }));
      
      const query = await buildQuery();
      if (!query) return;

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
  }, [buildQuery]);

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

  const clearAllRequests = useCallback(() => {
    zkPassport.clearAllRequests();
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
  }, [zkPassport]);

  // Quick Example: Simple age verification
  const startQuickExample = useCallback(async () => {
    try {
      setVerificationState(prev => ({ ...prev, status: 'requesting', error: null, proofs: [] }));
      
      // Build your query to verify the user is over 18
      const builder = await zkPassport.request({
        name: requestConfig.name,
        logo: requestConfig.logo,
        purpose: requestConfig.purpose,
        scope: requestConfig.scope || undefined,
        validity: requestConfig.validity || undefined,
        devMode: requestConfig.devMode,
      });

      const {
        url,
        requestId,
        onRequestReceived,
        onGeneratingProof,
        onProofGenerated,
        onResult,
        onReject,
        onError,
      } = builder
        // Verify the user's age is greater than or equal to 18
        .gte('age', 18)
        // Finalize the query
        .done();

      setVerificationState(prev => ({
        ...prev,
        status: 'requesting',
        requestId,
        url,
        bridgeConnected: false,
      }));

      // Set up event handlers
      onRequestReceived(() => {
        console.log('Request received');
        setVerificationState(prev => ({ ...prev, status: 'request-received' }));
      });

      onGeneratingProof(() => {
        console.log('Generating proof');
        setVerificationState(prev => ({ ...prev, status: 'generating-proof' }));
      });

      onProofGenerated((proof: ProofResult) => {
        console.log('Proof generated', proof);
        console.log('Verification key hash', proof.vkeyHash);
        console.log('Version', proof.version);
        console.log('Name', proof.name);
        setVerificationState(prev => ({
          ...prev,
          status: 'proof-generated',
          proofs: [...prev.proofs, proof],
        }));
      });

      onResult(({
        uniqueIdentifier,
        verified,
        result,
      }: {
        uniqueIdentifier: string | undefined;
        verified: boolean;
        result: QueryResult;
      }) => {
        console.log('=== Verification Results ===');
        
        // Access the verification results
        if (result.age?.gte) {
          console.log('age over 18', result.age.gte.result);
          console.log('age over', result.age.gte.expected);
        }

        // Verify proof validity
        console.log('proofs are valid', verified);

        // Get unique identifier
        console.log('unique identifier', uniqueIdentifier);

        setVerificationState(prev => ({
          ...prev,
          status: verified ? 'verified' : 'error',
          uniqueIdentifier,
          verified,
          result,
          error: verified ? null : 'Verification failed - check console for details',
        }));
      });

      onReject(() => {
        console.log('Request rejected');
        setVerificationState(prev => ({ ...prev, status: 'rejected' }));
      });

      onError((error: string) => {
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
        error: error instanceof Error ? error.message : 'Failed to start quick example',
      }));
    }
  }, [zkPassport, requestConfig]);

  const getStatusIcon = () => {
    switch (verificationState.status) {
      case 'verified': return '✓';
      case 'error': case 'rejected': return '✗';
      case 'requesting': case 'generating-proof': return '⟳';
      default: return '';
    }
  };

  const getStatusColor = () => {
    switch (verificationState.status) {
      case 'verified': return 'status-success';
      case 'error': case 'rejected': return 'status-error';
      case 'requesting': case 'generating-proof': return 'status-info';
      default: return 'status-info';
    }
  };

  return (
    <div className="zkpassport-page">
      {/* Hero Section */}
      <section className="card zkpassport-hero">
        <header>
          <p className="eyebrow">ZKPassport Integration</p>
          <h2>Zero-Knowledge Identity Verification</h2>
          <p className="muted">
            Verify user identity and eligibility without exposing sensitive information. Configure your verification requirements below.
          </p>
        </header>
      </section>

      {/* Tab Navigation */}
      <div className="zkpassport-tabs">
        <button
          className={`zkpassport-tab ${activeTab === 'basic' ? 'active' : ''}`}
          onClick={() => setActiveTab('basic')}
        >
          <span>Basic Setup</span>
        </button>
        <button
          className={`zkpassport-tab hidden-field ${activeTab === 'verification' ? 'active' : ''}`}
          onClick={() => setActiveTab('verification')}
        >
          <span>Verification Rules</span>
        </button>
        <button
          className={`zkpassport-tab hidden-field ${activeTab === 'advanced' ? 'active' : ''}`}
          onClick={() => setActiveTab('advanced')}
        >
          <span>Advanced</span>
        </button>
        <button
          className={`zkpassport-tab ${activeTab === 'example' ? 'active' : ''}`}
          onClick={() => setActiveTab('example')}
        >
          <span>Quick Example</span>
        </button>
      </div>

      {/* Basic Setup Tab */}
      {activeTab === 'basic' && (
        <div className="zkpassport-tab-content">
          {/* Request Configuration */}
          <section className="card zkpassport-section hidden-field">
            <header>
              <h3>Request Configuration</h3>
              <p className="muted small">Configure the basic details for your verification request</p>
            </header>
            <div className="form-grid-compact">
              <div className="form-group hidden-field">
                <label>
                  Application Name
                </label>
                <input
                  type="text"
                  value={requestConfig.name}
                  onChange={(e) => setRequestConfig(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Your app name"
                />
              </div>
              <div className="form-group hidden-field">
                <label>
                  Purpose
                </label>
                <textarea
                  value={requestConfig.purpose}
                  onChange={(e) => setRequestConfig(prev => ({ ...prev, purpose: e.target.value }))}
                  placeholder="Why are you requesting verification?"
                  rows={3}
                />
              </div>
              <div className="form-group hidden-field">
                <label>
                  Validity Period
                </label>
                <div className="validity-input-group">
                  <input
                    type="number"
                    value={requestConfig.validity}
                    onChange={(e) => setRequestConfig(prev => ({ ...prev, validity: parseInt(e.target.value) || 0 }))}
                    placeholder="604800"
                  />
                  <span className="validity-hint">seconds (7 days = 604800)</span>
                </div>
              </div>
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={requestConfig.devMode}
                    onChange={(e) => setRequestConfig(prev => ({ ...prev, devMode: e.target.checked }))}
                  />
                  <span>Dev Mode</span>
                  <span className="checkbox-hint">Accept mock proofs for testing</span>
                </label>
              </div>
            </div>
          </section>

          {/* Disclosure Use Cases */}
          <section className="card zkpassport-section">
            <header>
              <h3>Disclosure Use Cases</h3>
              <p className="muted small">Select use cases to automatically configure disclosure fields, app name, and purpose</p>
            </header>
            <div className="use-case-grid">
              {DISCLOSURE_USE_CASES.map(({ key, label, appName, purpose, inputLabel, inputPlaceholder, inputType }) => {
                const isSelected = queryConfig[key as keyof typeof queryConfig] as boolean;
                const inputValue = useCaseInputs[key] || '';
                return (
                  <div
                    key={key}
                    className={`use-case-card-wrapper ${isSelected ? 'selected' : ''}`}
                  >
                    <button
                      type="button"
                      className={`use-case-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        // Toggle the disclosure field
                        const newValue = !isSelected;
                        setQueryConfig(prev => ({ ...prev, [key]: newValue }));
                        
                        // Auto-configure app name and purpose when selected
                        if (newValue) {
                          setRequestConfig(prev => ({
                            ...prev,
                            name: appName,
                            purpose: purpose,
                          }));
                        } else {
                          // Clear input when deselected
                          setUseCaseInputs(prev => {
                            const next = { ...prev };
                            delete next[key];
                            return next;
                          });
                        }
                      }}
                    >
                      <div className="use-case-header">
                        <div className="use-case-checkbox">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            readOnly
                          />
                        </div>
                        <div className="use-case-title">{label}</div>
                      </div>
                      {isSelected && (
                        <div className="use-case-details">
                          <div className="use-case-app-name">{appName}</div>
                          <div className="use-case-purpose">{purpose}</div>
                        </div>
                      )}
                    </button>
                    {isSelected && (
                      <div className="use-case-input-wrapper">
                        <label className="use-case-input-label">{inputLabel}</label>
                        <input
                          type={inputType}
                          value={inputValue}
                          onChange={(e) => {
                            e.stopPropagation();
                            setUseCaseInputs(prev => ({ ...prev, [key]: e.target.value }));
                          }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder={inputPlaceholder}
                          className="use-case-input"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Verification Rules Tab */}
      {activeTab === 'verification' && (
        <div className="zkpassport-tab-content">
          {/* Age Verification */}
          <section className="card zkpassport-section">
            <header>
              <h3>Age Verification</h3>
              <p className="muted small">Set minimum and/or maximum age requirements</p>
            </header>
            <div className="range-input-group">
              <div className="range-input">
                <label>Minimum Age</label>
                <input
                  type="number"
                  value={queryConfig.ageMin}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, ageMin: e.target.value }))}
                  placeholder="18"
                  min="0"
                />
              </div>
              <div className="range-separator">to</div>
              <div className="range-input">
                <label>Maximum Age</label>
                <input
                  type="number"
                  value={queryConfig.ageMax}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, ageMax: e.target.value }))}
                  placeholder="65"
                  min="0"
                />
              </div>
            </div>
          </section>

          {/* Birthdate Verification */}
          <section className="card zkpassport-section">
            <header>
              <h3>Birthdate Verification</h3>
              <p className="muted small">Set date range for birthdate verification</p>
            </header>
            <div className="range-input-group">
              <div className="range-input">
                <label>Birthdate From</label>
                <input
                  type="date"
                  value={queryConfig.birthdateMin}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, birthdateMin: e.target.value }))}
                />
              </div>
              <div className="range-separator">to</div>
              <div className="range-input">
                <label>Birthdate To</label>
                <input
                  type="date"
                  value={queryConfig.birthdateMax}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, birthdateMax: e.target.value }))}
                />
              </div>
            </div>
          </section>

          {/* Expiry Date Verification */}
          <section className="card zkpassport-section">
            <header>
              <h3>Document Expiry</h3>
              <p className="muted small">Verify document is valid within a date range</p>
            </header>
            <div className="range-input-group">
              <div className="range-input">
                <label>Valid From</label>
                <input
                  type="date"
                  value={queryConfig.expiryDateMin}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, expiryDateMin: e.target.value }))}
                />
              </div>
              <div className="range-separator">to</div>
              <div className="range-input">
                <label>Valid To</label>
                <input
                  type="date"
                  value={queryConfig.expiryDateMax}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, expiryDateMax: e.target.value }))}
                />
              </div>
            </div>
          </section>

          {/* Nationality Checks */}
          <section className="card zkpassport-section">
            <header>
              <h3>Nationality & Country Checks</h3>
              <p className="muted small">Allow or restrict specific countries</p>
            </header>
            <div className="form-grid-compact">
              <div className="form-group">
                <label>
                  Allowed Nationalities
                </label>
                <input
                  type="text"
                  value={queryConfig.nationalityIn}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, nationalityIn: e.target.value }))}
                  placeholder="USA, GBR, FRA (comma-separated)"
                />
                <div className="preset-buttons">
                  <button
                    type="button"
                    onClick={() => setQueryConfig(prev => ({ ...prev, nationalityIn: (EU_COUNTRIES as string[]).join(', ') }))}
                    className="preset-btn"
                  >
                    EU Countries
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueryConfig(prev => ({ ...prev, nationalityIn: (EEA_COUNTRIES as string[]).join(', ') }))}
                    className="preset-btn"
                  >
                    EEA Countries
                  </button>
                  <button
                    type="button"
                    onClick={() => setQueryConfig(prev => ({ ...prev, nationalityIn: (SCHENGEN_COUNTRIES as string[]).join(', ') }))}
                    className="preset-btn"
                  >
                    Schengen
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>
                  Restricted Nationalities
                </label>
                <input
                  type="text"
                  value={queryConfig.nationalityOut}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, nationalityOut: e.target.value }))}
                  placeholder="RUS, IRN (comma-separated)"
                />
                <div className="preset-buttons">
                  <button
                    type="button"
                    onClick={() => setQueryConfig(prev => ({ ...prev, nationalityOut: (SANCTIONED_COUNTRIES as string[]).join(', ') }))}
                    className="preset-btn"
                  >
                    Sanctioned Countries
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Quick Example Tab */}
      {activeTab === 'example' && (
        <div className="zkpassport-tab-content">
          <section className="card zkpassport-section">
            <header>
              <h3>Quick Example</h3>
              <p className="muted small">
                Simple example: verify that the user is over 18 years old.
              </p>
            </header>
            <div className="example-code-block">
              <pre className="code-preview">
{`const {
  url,
  requestId,
  onRequestReceived,
  onGeneratingProof,
  onProofGenerated,
  onResult,
  onReject,
  onError,
} = queryBuilder
  .gte("age", 18)
  .done();`}
              </pre>
            </div>
            <div className="example-actions">
              <button
                onClick={startQuickExample}
                disabled={verificationState.status === 'requesting' || verificationState.status === 'generating-proof'}
                className="primary-button verify-button-large"
              >
                {verificationState.status === 'idle' ? (
                  <span>Run Quick Example</span>
                ) : (
                  <>
                    <span className="spinner-small">⟳</span>
                    <span>Verification in Progress...</span>
                  </>
                )}
              </button>
            </div>
            {verificationState.url && (
              <div className="qr-code-section">
                <h4>Scan QR Code or Click Link</h4>
                <div className="qr-code-container">
                  <QRCode value={verificationState.url} size={256} />
                </div>
                <div className="qr-link hidden-field">
                  <a href={verificationState.url} target="_blank" rel="noopener noreferrer" className="qr-link-button">
                    Verify with ZKPassport
                  </a>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="zkpassport-tab-content">
          {/* Equality Checks */}
          <section className="card zkpassport-section">
            <header>
              <h3>Equality Checks</h3>
              <p className="muted small">Require exact matches for specific fields</p>
            </header>
            <div className="form-grid-compact">
              <div className="form-group">
                <label>Field</label>
                <select
                  value={queryConfig.eqField}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, eqField: e.target.value }))}
                >
                  <option value="">Select field</option>
                  <option value="document_type">Document Type</option>
                  <option value="issuing_country">Issuing Country</option>
                  <option value="nationality">Nationality</option>
                  <option value="gender">Gender</option>
                </select>
              </div>
              <div className="form-group">
                <label>Value</label>
                <input
                  type="text"
                  value={queryConfig.eqValue}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, eqValue: e.target.value }))}
                  placeholder="passport, USA, M, etc."
                />
              </div>
            </div>
          </section>

          {/* Proof Binding */}
          <section className="card zkpassport-section">
            <header>
              <h3>Proof Binding</h3>
              <p className="muted small">Bind additional data to the proof (max 500 bytes total)</p>
            </header>
            <div className="form-grid-compact">
              <div className="form-group">
                <label>
                  User Address
                </label>
                <input
                  type="text"
                  value={queryConfig.bindUserAddress}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, bindUserAddress: e.target.value }))}
                  placeholder="0x..."
                />
              </div>
              <div className="form-group">
                <label>
                  Chain
                </label>
                <select
                  value={queryConfig.bindChain}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, bindChain: e.target.value }))}
                >
                  <option value="">None</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="ethereum_sepolia">Ethereum Sepolia</option>
                </select>
              </div>
              <div className="form-group">
                <label>
                  Custom Data
                </label>
                <input
                  type="text"
                  value={queryConfig.bindCustomData}
                  onChange={(e) => setQueryConfig(prev => ({ ...prev, bindCustomData: e.target.value }))}
                  placeholder="Custom data (ASCII text)"
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Verification Controls */}
      <section className="card zkpassport-actions">
        <div className="verification-controls">
          <button
            onClick={startVerification}
            disabled={verificationState.status === 'requesting' || verificationState.status === 'generating-proof'}
            className="primary-button verify-button-large"
          >
            {verificationState.status === 'idle' ? (
              <span>Start Verification</span>
            ) : (
              <>
                <span className="spinner-small">⟳</span>
                <span>Verification in Progress...</span>
              </>
            )}
          </button>
          {verificationState.requestId && (
            <div className="secondary-actions">
              <button onClick={cancelRequest} className="secondary-button">
                Cancel Request
              </button>
              <button onClick={clearAllRequests} className="secondary-button">
                Clear All
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Status Display */}
      {verificationState.status !== 'idle' && (
        <section className={`card zkpassport-status ${getStatusColor()}`}>
          <div className="status-header">
            <div className="status-icon-large">{getStatusIcon()}</div>
            <div className="status-content">
              <h3>Verification Status</h3>
              <div className={`status-badge status-${verificationState.status}`}>
                {verificationState.status}
              </div>
            </div>
          </div>
          {verificationState.bridgeConnected && (
            <div className="status-info">
              <span className="status-dot connected"></span>
              Bridge Connected
            </div>
          )}
          {verificationState.requestId && (
            <div className="status-info">
              <strong>Request ID:</strong> {verificationState.requestId}
            </div>
          )}
          {verificationState.url && (
            <div className="status-info hidden-field">
              <strong>Verification URL:</strong>{' '}
              <a href={verificationState.url} target="_blank" rel="noopener noreferrer">
                {verificationState.url}
              </a>
            </div>
          )}
          {verificationState.error && (
            <div className="status-error">
              <strong>Error:</strong> {verificationState.error}
            </div>
          )}
          {verificationState.verified && (
            <div className="status-success">
              <strong>Verification Successful</strong>
              {verificationState.uniqueIdentifier && (
                <div>
                  <strong>Unique Identifier:</strong> {verificationState.uniqueIdentifier}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Proofs Display */}
      {verificationState.proofs.length > 0 && (
        <section className="card zkpassport-section">
          <header>
            <h3>Generated Proofs ({verificationState.proofs.length})</h3>
          </header>
          <div className="proofs-list">
            {verificationState.proofs.map((proof, index) => (
              <details key={index} className="proof-item">
                <summary>
                  <strong>Proof {(proof.index ?? index) + 1} of {proof.total ?? verificationState.proofs.length}</strong>
                  <span className="proof-name">{proof.name}</span>
                </summary>
                <div className="proof-details">
                  <div><strong>Version:</strong> {proof.version}</div>
                  {proof.vkeyHash && <div><strong>VKey Hash:</strong> {proof.vkeyHash.substring(0, 20)}...</div>}
                  {proof.proof && <div><strong>Proof:</strong> {proof.proof.substring(0, 50)}...</div>}
                </div>
                <pre>{JSON.stringify(proof, null, 2)}</pre>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Query Result Display */}
      {verificationState.result && (
        <section className="card zkpassport-section">
          <header>
            <h3>Verification Results</h3>
            <p className="muted small">Detailed results from the verification query</p>
          </header>
          <div className="result-details">
            {verificationState.result.age?.gte && (
              <div className="result-item">
                <strong>Age ≥ 18:</strong>
                <span className={verificationState.result.age.gte.result ? 'result-success' : 'result-error'}>
                  {verificationState.result.age.gte.result ? 'Verified' : 'Failed'}
                </span>
                <div className="result-meta">
                  Expected: ≥ {verificationState.result.age.gte.expected}
                </div>
              </div>
            )}
          </div>
          <details className="result-json">
            <summary>View Full JSON Result</summary>
            <pre>{JSON.stringify(verificationState.result, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  );
}
