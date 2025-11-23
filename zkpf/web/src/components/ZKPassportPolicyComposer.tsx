import { useCallback, useState } from 'react';
import type { ZKPassportPolicyClient } from '../api/zkpassport-policies';
import { ZKPassportPolicyError } from '../api/zkpassport-policies';
import type { ZKPassportPolicyQuery, ZKPassportPolicyComposeRequest } from '../types/zkpassport';

interface Props {
  client: ZKPassportPolicyClient;
  onComposed?: (policyId: number) => void;
}

const USE_CASES = [
  'Age Verification',
  'Nationality',
  'Residency',
  'Personhood',
  'KYC',
  'Client-Server',
  'Private FaceMatch',
];

export function ZKPassportPolicyComposer({ client, onComposed }: Props) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [purpose, setPurpose] = useState('');
  const [scope, setScope] = useState('');
  const [validity, setValidity] = useState('604800'); // 7 days default
  const [devMode, setDevMode] = useState(false);
  const [selectedUseCases, setSelectedUseCases] = useState<string[]>([]);

  // Disclosure fields
  const [discloseFields, setDiscloseFields] = useState<Record<string, boolean>>({});

  // Age verification
  const [ageGte, setAgeGte] = useState('');
  const [ageLt, setAgeLt] = useState('');
  const [ageLte, setAgeLte] = useState('');
  const [ageRangeStart, setAgeRangeStart] = useState('');
  const [ageRangeEnd, setAgeRangeEnd] = useState('');

  // Birthdate verification
  const [birthdateGte, setBirthdateGte] = useState('');
  const [birthdateLt, setBirthdateLt] = useState('');
  const [birthdateLte, setBirthdateLte] = useState('');
  const [birthdateRangeStart, setBirthdateRangeStart] = useState('');
  const [birthdateRangeEnd, setBirthdateRangeEnd] = useState('');

  // Expiry date verification
  const [expiryDateGte, setExpiryDateGte] = useState('');
  const [expiryDateLt, setExpiryDateLt] = useState('');
  const [expiryDateLte, setExpiryDateLte] = useState('');
  const [expiryDateRangeStart, setExpiryDateRangeStart] = useState('');
  const [expiryDateRangeEnd, setExpiryDateRangeEnd] = useState('');

  // Nationality/Issuing country checks
  const [nationalityIn, setNationalityIn] = useState('');
  const [nationalityOut, setNationalityOut] = useState('');
  const [issuingCountryIn, setIssuingCountryIn] = useState('');
  const [issuingCountryOut, setIssuingCountryOut] = useState('');

  // Equality checks
  const [eqField, setEqField] = useState('');
  const [eqValue, setEqValue] = useState('');

  // Binding
  const [bindUserAddress, setBindUserAddress] = useState('');
  const [bindChain, setBindChain] = useState<'ethereum' | 'ethereum_sepolia' | ''>('');
  const [bindCustomData, setBindCustomData] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleDiscloseField = useCallback((field: string) => {
    setDiscloseFields(prev => ({ ...prev, [field]: !prev[field] }));
  }, []);

  const toggleUseCase = useCallback((useCase: string) => {
    setSelectedUseCases(prev => 
      prev.includes(useCase) 
        ? prev.filter(uc => uc !== useCase)
        : [...prev, useCase]
    );
  }, []);

  const buildQuery = useCallback((): ZKPassportPolicyQuery => {
    const query: ZKPassportPolicyQuery = {};

    // Disclosure fields
    if (discloseFields.nationality) query.discloseNationality = true;
    if (discloseFields.birthdate) query.discloseBirthdate = true;
    if (discloseFields.fullname) query.discloseFullname = true;
    if (discloseFields.firstname) query.discloseFirstname = true;
    if (discloseFields.lastname) query.discloseLastname = true;
    if (discloseFields.expiry_date) query.discloseExpiryDate = true;
    if (discloseFields.document_number) query.discloseDocumentNumber = true;
    if (discloseFields.document_type) query.discloseDocumentType = true;
    if (discloseFields.issuing_country) query.discloseIssuingCountry = true;
    if (discloseFields.gender) query.discloseGender = true;

    // Age verification
    if (ageGte) query.ageGte = parseInt(ageGte);
    if (ageLt) query.ageLt = parseInt(ageLt);
    if (ageLte) query.ageLte = parseInt(ageLte);
    if (ageRangeStart && ageRangeEnd) {
      query.ageRange = [parseInt(ageRangeStart), parseInt(ageRangeEnd)];
    }

    // Birthdate verification
    if (birthdateGte) query.birthdateGte = birthdateGte;
    if (birthdateLt) query.birthdateLt = birthdateLt;
    if (birthdateLte) query.birthdateLte = birthdateLte;
    if (birthdateRangeStart && birthdateRangeEnd) {
      query.birthdateRange = [birthdateRangeStart, birthdateRangeEnd];
    }

    // Expiry date verification
    if (expiryDateGte) query.expiryDateGte = expiryDateGte;
    if (expiryDateLt) query.expiryDateLt = expiryDateLt;
    if (expiryDateLte) query.expiryDateLte = expiryDateLte;
    if (expiryDateRangeStart && expiryDateRangeEnd) {
      query.expiryDateRange = [expiryDateRangeStart, expiryDateRangeEnd];
    }

    // Nationality checks
    if (nationalityIn) {
      query.nationalityIn = nationalityIn.split(',').map(c => c.trim()).filter(Boolean);
    }
    if (nationalityOut) {
      query.nationalityOut = nationalityOut.split(',').map(c => c.trim()).filter(Boolean);
    }

    // Issuing country checks
    if (issuingCountryIn) {
      query.issuingCountryIn = issuingCountryIn.split(',').map(c => c.trim()).filter(Boolean);
    }
    if (issuingCountryOut) {
      query.issuingCountryOut = issuingCountryOut.split(',').map(c => c.trim()).filter(Boolean);
    }

    // Equality checks
    if (eqField && eqValue) {
      query.eqChecks = [{ field: eqField, value: eqValue }];
    }

    // Binding
    if (bindUserAddress) query.bindUserAddress = bindUserAddress;
    if (bindChain) query.bindChain = bindChain as 'ethereum' | 'ethereum_sepolia';
    if (bindCustomData) query.bindCustomData = bindCustomData;

    return query;
  }, [
    discloseFields, ageGte, ageLt, ageLte, ageRangeStart, ageRangeEnd,
    birthdateGte, birthdateLt, birthdateLte, birthdateRangeStart, birthdateRangeEnd,
    expiryDateGte, expiryDateLt, expiryDateLte, expiryDateRangeStart, expiryDateRangeEnd,
    nationalityIn, nationalityOut, issuingCountryIn, issuingCountryOut,
    eqField, eqValue, bindUserAddress, bindChain, bindCustomData,
  ]);

  const handleSubmit: React.FormEventHandler = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!label.trim()) {
      setError('Label is required');
      return;
    }

    if (!purpose.trim()) {
      setError('Purpose is required');
      return;
    }

    const query = buildQuery();
    if (Object.keys(query).length === 0) {
      setError('At least one query requirement must be specified');
      return;
    }

    try {
      setLoading(true);
      const request: ZKPassportPolicyComposeRequest = {
        label: label.trim(),
        description: description.trim() || undefined,
        purpose: purpose.trim(),
        scope: scope.trim() || undefined,
        validity: validity ? parseInt(validity) : undefined,
        devMode,
        query,
        useCases: selectedUseCases.length > 0 ? selectedUseCases : undefined,
      };

      const response = await client.composePolicy(request);
      setLoading(false);

      if (response.created) {
        setSuccess(response.summary);
        // Reset form
        setLabel('');
        setDescription('');
        setPurpose('');
        setScope('');
        setValidity('604800');
        setDevMode(false);
        setSelectedUseCases([]);
        setDiscloseFields({});
        setAgeGte('');
        setAgeLt('');
        setAgeLte('');
        setAgeRangeStart('');
        setAgeRangeEnd('');
        setBirthdateGte('');
        setBirthdateLt('');
        setBirthdateLte('');
        setBirthdateRangeStart('');
        setBirthdateRangeEnd('');
        setExpiryDateGte('');
        setExpiryDateLt('');
        setExpiryDateLte('');
        setExpiryDateRangeStart('');
        setExpiryDateRangeEnd('');
        setNationalityIn('');
        setNationalityOut('');
        setIssuingCountryIn('');
        setIssuingCountryOut('');
        setEqField('');
        setEqValue('');
        setBindUserAddress('');
        setBindChain('');
        setBindCustomData('');
      } else {
        setSuccess(response.summary);
      }

      onComposed?.(response.policy.policy_id);
    } catch (err) {
      setLoading(false);
      if (err instanceof ZKPassportPolicyError) {
        setError(err.message);
      } else {
        setError((err as Error).message ?? 'Unknown error');
      }
    }
  };

  return (
    <section className="policy-composer">
      <header className="policy-composer-header">
        <h4>Compose a ZKPassport Policy</h4>
        <p className="muted small">
          Create a policy that defines what identity information users must prove using ZKPassport.
        </p>
      </header>
      <form className="policy-composer-grid" onSubmit={handleSubmit}>
        <label className="field">
          <span>Policy Label *</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., Age Verification (18+)"
            required
          />
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description of this policy"
            rows={2}
          />
        </label>

        <label className="field">
          <span>Purpose *</span>
          <textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Why are you requesting verification?"
            rows={2}
            required
          />
        </label>

        <label className="field">
          <span>Scope (optional)</span>
          <input
            type="text"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Scope for unique identifier"
          />
        </label>

        <label className="field">
          <span>Validity (seconds)</span>
          <input
            type="number"
            value={validity}
            onChange={(e) => setValidity(e.target.value)}
            placeholder="604800 (7 days)"
          />
        </label>

        <label className="field">
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => setDevMode(e.target.checked)}
          />
          <span>Dev Mode (accept mock proofs)</span>
        </label>

        <div className="field">
          <span>Use Cases</span>
          <div className="checkbox-grid">
            {USE_CASES.map(useCase => (
              <label key={useCase}>
                <input
                  type="checkbox"
                  checked={selectedUseCases.includes(useCase)}
                  onChange={() => toggleUseCase(useCase)}
                />
                {useCase}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Disclosure Fields</span>
          <div className="checkbox-grid">
            {[
              { key: 'nationality', label: 'Nationality' },
              { key: 'birthdate', label: 'Birthdate' },
              { key: 'fullname', label: 'Full Name' },
              { key: 'firstname', label: 'First Name' },
              { key: 'lastname', label: 'Last Name' },
              { key: 'expiry_date', label: 'Expiry Date' },
              { key: 'document_number', label: 'Document Number' },
              { key: 'document_type', label: 'Document Type' },
              { key: 'issuing_country', label: 'Issuing Country' },
              { key: 'gender', label: 'Gender' },
            ].map(({ key, label }) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={discloseFields[key] || false}
                  onChange={() => toggleDiscloseField(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Age Verification</span>
          <div className="form-grid">
            <input
              type="number"
              placeholder="Age ≥"
              value={ageGte}
              onChange={(e) => setAgeGte(e.target.value)}
            />
            <input
              type="number"
              placeholder="Age <"
              value={ageLt}
              onChange={(e) => setAgeLt(e.target.value)}
            />
            <input
              type="number"
              placeholder="Age ≤"
              value={ageLte}
              onChange={(e) => setAgeLte(e.target.value)}
            />
            <input
              type="number"
              placeholder="Range start"
              value={ageRangeStart}
              onChange={(e) => setAgeRangeStart(e.target.value)}
            />
            <input
              type="number"
              placeholder="Range end"
              value={ageRangeEnd}
              onChange={(e) => setAgeRangeEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span>Birthdate Verification</span>
          <div className="form-grid">
            <input
              type="date"
              placeholder="Birthdate ≥"
              value={birthdateGte}
              onChange={(e) => setBirthdateGte(e.target.value)}
            />
            <input
              type="date"
              placeholder="Birthdate <"
              value={birthdateLt}
              onChange={(e) => setBirthdateLt(e.target.value)}
            />
            <input
              type="date"
              placeholder="Birthdate ≤"
              value={birthdateLte}
              onChange={(e) => setBirthdateLte(e.target.value)}
            />
            <input
              type="date"
              placeholder="Range start"
              value={birthdateRangeStart}
              onChange={(e) => setBirthdateRangeStart(e.target.value)}
            />
            <input
              type="date"
              placeholder="Range end"
              value={birthdateRangeEnd}
              onChange={(e) => setBirthdateRangeEnd(e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <span>Nationality Checks</span>
          <input
            type="text"
            placeholder="Nationality In (comma-separated)"
            value={nationalityIn}
            onChange={(e) => setNationalityIn(e.target.value)}
          />
          <input
            type="text"
            placeholder="Nationality Out (comma-separated)"
            value={nationalityOut}
            onChange={(e) => setNationalityOut(e.target.value)}
          />
        </div>

        <div className="field">
          <span>Binding</span>
          <input
            type="text"
            placeholder="User Address (0x...)"
            value={bindUserAddress}
            onChange={(e) => setBindUserAddress(e.target.value)}
          />
          <select
            value={bindChain}
            onChange={(e) => setBindChain(e.target.value as 'ethereum' | 'ethereum_sepolia' | '')}
          >
            <option value="">No chain binding</option>
            <option value="ethereum">Ethereum</option>
            <option value="ethereum_sepolia">Ethereum Sepolia</option>
          </select>
          <input
            type="text"
            placeholder="Custom Data"
            value={bindCustomData}
            onChange={(e) => setBindCustomData(e.target.value)}
          />
        </div>

        <div className="policy-composer-actions">
          <button type="submit" className="tiny-button" disabled={loading}>
            {loading ? 'Creating…' : 'Create Policy'}
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

