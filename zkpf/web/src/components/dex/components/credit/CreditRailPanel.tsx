import React, { useState } from 'react';
import { useZKPFCredit } from '../../context/ZKPFCreditContext';
import { ZkpfClient, detectDefaultBase } from '../../../../api/zkpf';
import type { ProofBundle, PolicyDefinition } from '../../../../types/zkpf';
import toast from 'react-hot-toast';
import './CreditRailPanel.css';

export function CreditRailPanel() {
  const { creditInfo, isLoading, verifyProof, refreshCredit, clearCredit } = useZKPFCredit();
  const [client] = useState(() => new ZkpfClient(detectDefaultBase()));
  const [policies, setPolicies] = useState<PolicyDefinition[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyDefinition | null>(null);
  const [proofBundle, setProofBundle] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState(false);

  React.useEffect(() => {
    async function loadPolicies() {
      try {
        const loadedPolicies = await client.getPolicies();
        setPolicies(loadedPolicies);
        if (loadedPolicies.length > 0) {
          setSelectedPolicy(loadedPolicies[0]);
        }
      } catch (err) {
        console.error('Failed to load policies:', err);
        toast.error('Failed to load verification policies');
      }
    }
    loadPolicies();
  }, [client]);

  const handleVerify = async () => {
    if (!selectedPolicy || !proofBundle.trim()) {
      toast.error('Please select a policy and paste a proof bundle');
      return;
    }

    setIsVerifying(true);
    try {
      const bundle = JSON.parse(proofBundle) as ProofBundle;
      const success = await verifyProof(bundle, selectedPolicy);
      
      if (success) {
        // Store for future use
        localStorage.setItem('zkpf-dex-proof-bundle', proofBundle);
        localStorage.setItem('zkpf-dex-policy', JSON.stringify(selectedPolicy));
        setProofBundle('');
      }
    } catch (err) {
      toast.error('Invalid proof bundle format');
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleClear = () => {
    clearCredit();
    setProofBundle('');
    toast.success('Credit cleared');
  };

  return (
    <div className="dex-credit-rail-panel">
      <div className="dex-credit-rail-header">
        <h3>ZK Proof-of-Funds Credit</h3>
        {creditInfo && (
          <button className="dex-clear-button" onClick={handleClear}>
            Clear
          </button>
        )}
      </div>

      {creditInfo && creditInfo.proofValid ? (
        <div className="dex-credit-status">
          <div className="dex-credit-status-item">
            <span className="dex-credit-label">Tier:</span>
            <span className="dex-credit-value">{creditInfo.tier}</span>
          </div>
          <div className="dex-credit-status-item">
            <span className="dex-credit-label">Available Credit:</span>
            <span className="dex-credit-value dex-profit-text">
              ${creditInfo.availableCredit.toLocaleString()}
            </span>
          </div>
          <div className="dex-credit-status-item">
            <span className="dex-credit-label">Max Credit:</span>
            <span className="dex-credit-value">
              ${creditInfo.maxCredit.toLocaleString()}
            </span>
          </div>
          {creditInfo.lastVerified && (
            <div className="dex-credit-status-item">
              <span className="dex-credit-label">Verified:</span>
              <span className="dex-credit-value">
                {creditInfo.lastVerified.toLocaleString()}
              </span>
            </div>
          )}
          <button className="dex-refresh-button" onClick={refreshCredit}>
            Refresh Credit
          </button>
        </div>
      ) : (
        <div className="dex-credit-setup">
          <div className="dex-form-group">
            <label>Verification Policy</label>
            <select
              value={selectedPolicy?.policy_id || ''}
              onChange={(e) => {
                const policy = policies.find(p => p.policy_id === Number(e.target.value));
                setSelectedPolicy(policy || null);
              }}
              className="dex-select"
            >
              {policies.map(policy => (
                <option key={policy.policy_id} value={policy.policy_id}>
                  {(policy as any).name || policy.policy_id} (Threshold: {policy.threshold_raw / 1e8})
                </option>
              ))}
            </select>
          </div>

          <div className="dex-form-group">
            <label>Proof Bundle (JSON)</label>
            <textarea
              value={proofBundle}
              onChange={(e) => setProofBundle(e.target.value)}
              placeholder="Paste your proof bundle JSON here..."
              className="dex-textarea"
              rows={8}
            />
          </div>

          <button
            className="dex-verify-button"
            onClick={handleVerify}
            disabled={isVerifying || isLoading || !selectedPolicy || !proofBundle.trim()}
          >
            {isVerifying ? 'Verifying...' : 'Verify Proof & Enable Credit'}
          </button>

          <p className="dex-credit-help">
            Generate a proof bundle using the main app's proof builder, then paste it here to enable credit for trading.
          </p>
        </div>
      )}
    </div>
  );
}

