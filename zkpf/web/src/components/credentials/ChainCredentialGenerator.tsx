/**
 * ChainCredentialGenerator - Generate real proof-of-funds credentials
 * 
 * Connects to actual chain wallets and the ZKPF prover system
 * to generate verifiable credentials.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWebZjsContext } from '../../context/WebzjsContext';
import type { Credential } from './CredentialCard';

interface Chain {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: 'live' | 'beta' | 'soon';
}

interface ChainCredentialGeneratorProps {
  chains: readonly Chain[];
  onCredentialGenerated: (credential: Credential) => void;
}

type GeneratorStep = 'select-chain' | 'configure' | 'connect' | 'generate' | 'complete';

const CHAIN_CONFIGS: Record<string, {
  currencies: { code: string; name: string; decimals: number; currencyCodeInt: number }[];
  description: string;
  requiresWallet: boolean;
}> = {
  zcash: {
    // Use Zcash Orchard currency code (999001) for non-custodial shielded proofs
    currencies: [{ code: 'ZEC', name: 'Zcash', decimals: 8, currencyCodeInt: 999001 }],
    description: 'Generate shielded proof-of-funds from Zcash Orchard pool. Privacy-preserving ZK proofs.',
    requiresWallet: true,
  },
  mina: {
    currencies: [{ code: 'MINA', name: 'Mina', decimals: 9, currencyCodeInt: 1296649793 }],
    description: 'Recursive SNARK proofs from Mina Protocol. Lightweight and composable.',
    requiresWallet: true,
  },
  starknet: {
    currencies: [
      { code: 'ETH', name: 'Ethereum', decimals: 18, currencyCodeInt: 4543560 },
      { code: 'USDC', name: 'USD Coin', decimals: 6, currencyCodeInt: 1431520323 },
      { code: 'STRK', name: 'Starknet', decimals: 18, currencyCodeInt: 1398031947 },
    ],
    description: 'STARK proofs from Starknet L2. Scalable and efficient verification.',
    requiresWallet: true,
  },
  near: {
    currencies: [
      { code: 'NEAR', name: 'NEAR', decimals: 24, currencyCodeInt: 1312902994 },
      { code: 'USDC', name: 'USD Coin', decimals: 6, currencyCodeInt: 1431520323 },
    ],
    description: 'TEE-backed attestations from NEAR Protocol. Fast and secure.',
    requiresWallet: true,
  },
};

export const ChainCredentialGenerator: React.FC<ChainCredentialGeneratorProps> = ({
  chains,
  onCredentialGenerated: _onCredentialGenerated,
}) => {
  const navigate = useNavigate();
  const { state: walletState } = useWebZjsContext();
  const [step, setStep] = useState<GeneratorStep>('select-chain');
  const [selectedChain, setSelectedChain] = useState<Chain | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [threshold, setThreshold] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [thresholdType, setThresholdType] = useState<'gte' | 'exact'>('gte');
  const [label, setLabel] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [validityDays, setValidityDays] = useState(7);

  // Check if Zcash wallet is connected
  const hasZcashWallet = walletState.activeAccount != null;
  const zcashBalance = useMemo(() => {
    if (!walletState.summary || walletState.activeAccount == null) return null;
    const report = walletState.summary.account_balances.find(
      ([accountId]) => accountId === walletState.activeAccount
    );
    if (!report) return null;
    return report[1].orchard_balance + report[1].sapling_balance;
  }, [walletState.summary, walletState.activeAccount]);

  const handleSelectChain = useCallback((chain: Chain) => {
    setSelectedChain(chain);
    const config = CHAIN_CONFIGS[chain.id];
    if (config?.currencies.length) {
      setSelectedCurrency(config.currencies[0].code);
    }
    setError(null);
    
    // For Zcash, check if wallet is connected
    if (chain.id === 'zcash' && hasZcashWallet && zcashBalance !== null) {
      setStep('configure');
    } else if (chain.id === 'zcash') {
      setStep('connect');
    } else {
      setStep('configure');
    }
  }, [hasZcashWallet, zcashBalance]);

  const handleConfigure = useCallback(() => {
    if (!threshold || parseFloat(threshold) < 0) {
      setError('Please enter a valid threshold');
      return;
    }
    
    // For Zcash with connected wallet, validate against balance
    if (selectedChain?.id === 'zcash' && zcashBalance !== null) {
      const thresholdSats = parseFloat(threshold) * 100_000_000;
      if (thresholdType === 'gte' && thresholdSats > zcashBalance) {
        setError(`Your balance (${(zcashBalance / 100_000_000).toFixed(8)} ZEC) is below the threshold`);
        return;
      }
    }
    
    setError(null);
    setStep('generate');
  }, [threshold, thresholdType, selectedChain, zcashBalance]);

  const handleGoToWallet = useCallback(() => {
    // Navigate to wallet to set up Zcash
    navigate('/wallet');
  }, [navigate]);

  const handleGenerate = useCallback(async () => {
    if (!selectedChain) return;
    
    setIsGenerating(true);
    setError(null);

    try {
      if (selectedChain.id === 'zcash') {
        // For Zcash, navigate to the proof builder with the policy configured
        const thresholdSats = Math.floor(parseFloat(threshold) * 100_000_000);
        const currencyConfig = CHAIN_CONFIGS.zcash.currencies[0];
        
        // Create a custom policy for the proof builder
        // Use ZCASH_ORCHARD rail for non-custodial shielded Zcash proofs
        // Use a unique scope ID based on timestamp to avoid nullifier collisions.
        const customPolicy = {
          policy_id: Date.now(), // Unique ID
          threshold_raw: thresholdSats,
          required_currency_code: currencyConfig.currencyCodeInt,
          verifier_scope_id: 271828182 + Math.floor(Math.random() * 1000000), // Euler's number base + random
          category: 'ZCASH_ORCHARD' as const,
          rail_id: 'ZCASH_ORCHARD',
          label: label || `Prove ≥ ${threshold} ZEC`,
        };

        // Store the request for the proof builder
        sessionStorage.setItem('credentials-pending-proof', JSON.stringify({
          chain: selectedChain.id,
          chainIcon: selectedChain.icon,
          threshold: thresholdSats,
          currency: selectedCurrency,
          thresholdType,
          label,
          counterparty,
          validityDays,
          customPolicy,
        }));

        // Navigate to proof builder
        navigate('/build', {
          state: {
            customPolicy,
            fromWallet: true,
            walletBalance: zcashBalance,
          },
        });
        return;
      }

      // For other chains, show that they need wallet integration
      setError(`${selectedChain.name} wallet integration coming soon. Please use the Zcash wallet for now.`);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate credential');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedChain, threshold, selectedCurrency, thresholdType, label, counterparty, validityDays, navigate, zcashBalance]);

  const handleBack = useCallback(() => {
    switch (step) {
      case 'configure':
        setStep('select-chain');
        setSelectedChain(null);
        break;
      case 'connect':
        setStep('select-chain');
        setSelectedChain(null);
        break;
      case 'generate':
        if (selectedChain?.id === 'zcash' && hasZcashWallet) {
          setStep('configure');
        } else {
          setStep('connect');
        }
        break;
      default:
        break;
    }
    setError(null);
  }, [step, selectedChain, hasZcashWallet]);

  const chainConfig = selectedChain ? CHAIN_CONFIGS[selectedChain.id] : null;

  return (
    <div className="credential-generator">
      {/* Progress Steps */}
      <div className="generator-steps">
        <div className={`generator-step ${step === 'select-chain' ? 'active' : ['configure', 'connect', 'generate', 'complete'].includes(step) ? 'complete' : ''}`}>
          <span className="step-number">1</span>
          <span className="step-label">Select Chain</span>
        </div>
        <div className="step-connector" />
        <div className={`generator-step ${step === 'configure' ? 'active' : ['connect', 'generate', 'complete'].includes(step) ? 'complete' : ''}`}>
          <span className="step-number">2</span>
          <span className="step-label">Configure</span>
        </div>
        <div className="step-connector" />
        <div className={`generator-step ${step === 'connect' ? 'active' : ['generate', 'complete'].includes(step) ? 'complete' : ''}`}>
          <span className="step-number">3</span>
          <span className="step-label">Connect</span>
        </div>
        <div className="step-connector" />
        <div className={`generator-step ${step === 'generate' || step === 'complete' ? 'active' : ''}`}>
          <span className="step-number">4</span>
          <span className="step-label">Generate</span>
        </div>
      </div>

      {/* Step Content */}
      <div className="generator-content">
        {step === 'select-chain' && (
          <div className="step-select-chain">
            <h3>Select Source Chain</h3>
            <p className="step-description">
              Choose the blockchain where your funds are held. The proof will verify your balance without revealing exact amounts or addresses.
            </p>
            <div className="chain-selection-grid">
              {chains.map(chain => (
                <button
                  key={chain.id}
                  className="chain-select-card"
                  onClick={() => handleSelectChain(chain)}
                  style={{ '--chain-color': chain.color } as React.CSSProperties}
                  disabled={chain.status === 'soon'}
                >
                  <span className="chain-select-icon">{chain.icon}</span>
                  <span className="chain-select-name">{chain.name}</span>
                  {chain.status === 'beta' && <span className="chain-select-badge">Beta</span>}
                  {chain.status === 'soon' && <span className="chain-select-badge soon">Coming Soon</span>}
                  {chain.id === 'zcash' && hasZcashWallet && (
                    <span className="chain-select-connected">✓ Wallet Connected</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'connect' && selectedChain && (
          <div className="step-connect">
            <button className="back-button" onClick={handleBack}>
              ← Back
            </button>
            <div className="connect-header">
              <span className="chain-icon-large" style={{ color: selectedChain.color }}>
                {selectedChain.icon}
              </span>
              <h3>Connect {selectedChain.name} Wallet</h3>
            </div>
            <p className="step-description">
              Connect your wallet to prove your balance. No funds will be moved or spent.
            </p>

            <div className="connect-options">
              {selectedChain.id === 'zcash' && (
                <button className="connect-option" onClick={handleGoToWallet}>
                  <span className="connect-option-icon">🔒</span>
                  <div>
                    <span className="connect-option-label">ZKPF Web Wallet</span>
                    <span className="connect-option-desc">Set up your in-browser Zcash wallet first</span>
                  </div>
                  <span className="connect-arrow">→</span>
                </button>
              )}
              {selectedChain.id === 'mina' && (
                <div className="connect-coming-soon">
                  <span className="connect-option-icon">🦊</span>
                  <div>
                    <span className="connect-option-label">Auro Wallet</span>
                    <span className="connect-option-desc">Mina wallet integration coming soon</span>
                  </div>
                </div>
              )}
              {selectedChain.id === 'starknet' && (
                <div className="connect-coming-soon">
                  <span className="connect-option-icon">🅰️</span>
                  <div>
                    <span className="connect-option-label">Argent X / Braavos</span>
                    <span className="connect-option-desc">Starknet wallet integration coming soon</span>
                  </div>
                </div>
              )}
              {selectedChain.id === 'near' && (
                <div className="connect-coming-soon">
                  <span className="connect-option-icon">◈</span>
                  <div>
                    <span className="connect-option-label">NEAR Wallet</span>
                    <span className="connect-option-desc">NEAR wallet integration coming soon</span>
                  </div>
                </div>
              )}
            </div>

            <div className="connect-security-note">
              <span className="security-icon">🔒</span>
              <p>
                <strong>Your keys stay with you.</strong> We only request view access to generate the proof. 
                No signing transactions, no spending authority.
              </p>
            </div>
          </div>
        )}

        {step === 'configure' && selectedChain && chainConfig && (
          <div className="step-configure">
            <button className="back-button" onClick={handleBack}>
              ← Back
            </button>
            <div className="configure-header">
              <span className="chain-icon-large" style={{ color: selectedChain.color }}>
                {selectedChain.icon}
              </span>
              <div>
                <h3>Configure {selectedChain.name} Credential</h3>
                <p className="step-description">{chainConfig.description}</p>
              </div>
            </div>

            {/* Show current balance for Zcash */}
            {selectedChain.id === 'zcash' && zcashBalance !== null && (
              <div className="current-balance-card">
                <span className="balance-label">Your Shielded Balance</span>
                <span className="balance-value">
                  {(zcashBalance / 100_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ZEC
                </span>
              </div>
            )}

            <div className="configure-form">
              <div className="form-group">
                <label>Currency</label>
                <select 
                  value={selectedCurrency} 
                  onChange={e => setSelectedCurrency(e.target.value)}
                  className="form-select"
                >
                  {chainConfig.currencies.map(curr => (
                    <option key={curr.code} value={curr.code}>
                      {curr.name} ({curr.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Proof Type</label>
                <div className="proof-type-options">
                  <button
                    className={`proof-type-btn ${thresholdType === 'gte' ? 'active' : ''}`}
                    onClick={() => setThresholdType('gte')}
                  >
                    <span className="proof-type-icon">≥</span>
                    <div>
                      <span className="proof-type-label">At Least</span>
                      <span className="proof-type-desc">Prove balance is above threshold</span>
                    </div>
                  </button>
                  <button
                    className={`proof-type-btn ${thresholdType === 'exact' ? 'active' : ''}`}
                    onClick={() => setThresholdType('exact')}
                  >
                    <span className="proof-type-icon">=</span>
                    <div>
                      <span className="proof-type-label">Exact</span>
                      <span className="proof-type-desc">Prove exact balance amount</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Threshold Amount</label>
                <div className="input-with-suffix">
                  <input
                    type="number"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.00000001"
                    className="form-input"
                  />
                  <span className="input-suffix">{selectedCurrency}</span>
                </div>
                <p className="form-hint">
                  The proof will verify your balance {thresholdType === 'gte' ? 'meets or exceeds' : 'equals'} this amount.
                </p>
              </div>

              <div className="form-group">
                <label>Validity Period</label>
                <select 
                  value={validityDays} 
                  onChange={e => setValidityDays(parseInt(e.target.value))}
                  className="form-select"
                >
                  <option value={1}>1 day</option>
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </div>

              <div className="form-divider" />

              <div className="form-group">
                <label>Label (optional)</label>
                <input
                  type="text"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g., Q4 2024 Treasury Proof"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label>Counterparty (optional)</label>
                <input
                  type="text"
                  value={counterparty}
                  onChange={e => setCounterparty(e.target.value)}
                  placeholder="e.g., Prime Broker XYZ"
                  className="form-input"
                />
              </div>

              {error && <div className="form-error">{error}</div>}

              <button className="primary-button" onClick={handleConfigure}>
                Continue to Generate Proof
              </button>
            </div>
          </div>
        )}

        {step === 'generate' && selectedChain && (
          <div className="step-generate">
            <button className="back-button" onClick={handleBack}>
              ← Back
            </button>
            <div className="generate-header">
              <span className="chain-icon-large" style={{ color: selectedChain.color }}>
                {selectedChain.icon}
              </span>
              <h3>Generate {selectedChain.name} Proof</h3>
            </div>

            <div className="generate-ready">
              <div className="generate-summary">
                <div className="summary-row">
                  <span>Chain</span>
                  <span>{selectedChain.name}</span>
                </div>
                <div className="summary-row">
                  <span>Proving</span>
                  <span>{thresholdType === 'gte' ? '≥' : '='} {threshold} {selectedCurrency}</span>
                </div>
                <div className="summary-row">
                  <span>Valid for</span>
                  <span>{validityDays} days</span>
                </div>
                {label && (
                  <div className="summary-row">
                    <span>Label</span>
                    <span>{label}</span>
                  </div>
                )}
                {zcashBalance !== null && selectedChain.id === 'zcash' && (
                  <div className="summary-row summary-row-balance">
                    <span>Your Balance</span>
                    <span>{(zcashBalance / 100_000_000).toFixed(8)} ZEC</span>
                  </div>
                )}
              </div>
              
              {error && <div className="form-error">{error}</div>}
              
              <button 
                className="primary-button large" 
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <span className="spinner"></span>
                    Preparing...
                  </>
                ) : (
                  'Generate Zero-Knowledge Proof'
                )}
              </button>
              
              <p className="generate-note">
                You'll be redirected to the Proof Builder to generate the cryptographic proof.
                This runs entirely in your browser and may take 30-60 seconds.
              </p>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="step-complete">
            <div className="complete-icon">✓</div>
            <h3>Credential Generated!</h3>
            <p>Your proof-of-funds credential has been created and verified.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChainCredentialGenerator;
