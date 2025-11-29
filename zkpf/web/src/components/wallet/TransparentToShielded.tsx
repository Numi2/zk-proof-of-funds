/**
 * TransparentToShielded Component
 * 
 * Enables transparent-only wallets (like hardware wallets or legacy Zcash wallets)
 * to send transactions to shielded (Orchard) recipients using the PCZT flow.
 * 
 * Based on ZIP 374 PCZT (Partially Constructed Zcash Transaction) format.
 * 
 * Flow:
 * 1. User enters transparent UTXOs to spend
 * 2. User enters recipient (shielded address)
 * 3. PCZT is created (propose_transaction)
 * 4. User signs with external wallet (get_sighash → sign → append_signature)
 * 5. Proofs are generated (prove_transaction) 
 * 6. Transaction is finalized (finalize_and_extract)
 * 7. User broadcasts via external service
 */

import { useState, useCallback, useMemo } from 'react';
import {
  usePcztTransparent,
  Network,
} from '../../hooks/usePcztTransparent';
import type { TransparentInput, Payment } from '../../hooks/usePcztTransparent';
import './TransparentToShielded.css';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type Step = 'inputs' | 'outputs' | 'review' | 'sign' | 'prove' | 'complete';

interface InputFormData {
  txid: string;
  vout: string;
  value: string;
  scriptPubKey: string;
  derivationPath: string;
  publicKey: string;
}

const emptyInputForm: InputFormData = {
  txid: '',
  vout: '0',
  value: '',
  scriptPubKey: '',
  derivationPath: "m/44'/133'/0'/0/0",
  publicKey: '',
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export function TransparentToShielded() {
  const {
    state,
    initWasm,
    setNetwork,
    addInput,
    removeInput,
    setPaymentRequest,
    parsePaymentUri,
    propose,
    applySignature,
    prove,
    finalize,
    exportPczt,
    reset,
    zatoshisToZec,
    zecToZatoshis,
    isOrchardAddress,
    createPaymentRequest,
  } = usePcztTransparent();

  const [step, setStep] = useState<Step>('inputs');
  const [inputForm, setInputForm] = useState<InputFormData>(emptyInputForm);
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientAmount, setRecipientAmount] = useState('');
  const [recipientMemo, setRecipientMemo] = useState('');
  const [paymentUri, setPaymentUri] = useState('');
  const [useUriMode, setUseUriMode] = useState(false);
  const [signatureHex, setSignatureHex] = useState('');
  const [publicKeyHex, setPublicKeyHex] = useState('');
  const [currentSignIndex, setCurrentSignIndex] = useState(0);
  const [copiedSighash, setCopiedSighash] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────────
  // Computed
  // ─────────────────────────────────────────────────────────────────────────────

  const totalInputValue = useMemo(() => {
    return state.inputs.reduce((sum, input) => sum + input.value, 0n);
  }, [state.inputs]);

  const isValidInput = useMemo(() => {
    return (
      /^[0-9a-fA-F]{64}$/.test(inputForm.txid) &&
      parseInt(inputForm.vout) >= 0 &&
      parseFloat(inputForm.value) > 0 &&
      inputForm.scriptPubKey.length > 0
    );
  }, [inputForm]);

  const isValidRecipient = useMemo(() => {
    const amountZats = zecToZatoshis(parseFloat(recipientAmount) || 0);
    return (
      isOrchardAddress(recipientAddress) &&
      amountZats > 0n
    );
  }, [recipientAddress, recipientAmount, zecToZatoshis, isOrchardAddress]);

  const canProceedToReview = useMemo(() => {
    if (state.inputs.length === 0) return false;
    if (useUriMode) {
      return paymentUri.startsWith('zcash:');
    }
    return isValidRecipient;
  }, [state.inputs.length, useUriMode, paymentUri, isValidRecipient]);


  // ─────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────────

  const handleAddInput = useCallback(() => {
    if (!isValidInput) return;

    const input: TransparentInput = {
      txid: inputForm.txid,
      vout: parseInt(inputForm.vout),
      value: zecToZatoshis(parseFloat(inputForm.value)),
      scriptPubKey: inputForm.scriptPubKey,
      derivationPath: inputForm.derivationPath || undefined,
      publicKey: inputForm.publicKey || undefined,
    };

    addInput(input);
    setInputForm(emptyInputForm);
  }, [inputForm, isValidInput, addInput, zecToZatoshis]);

  const handleProceedToOutputs = useCallback(async () => {
    const ready = await initWasm();
    if (ready) {
      setStep('outputs');
    }
  }, [initWasm]);

  const handleProceedToReview = useCallback(() => {
    let request;
    
    if (useUriMode) {
      const parsed = parsePaymentUri(paymentUri);
      if (!parsed) return;
      request = parsed;
    } else {
      const amountZats = zecToZatoshis(parseFloat(recipientAmount));
      const payments: Payment[] = [{
        address: recipientAddress,
        amount: amountZats,
        memo: recipientMemo || undefined,
      }];
      request = createPaymentRequest(payments);
    }

    setPaymentRequest(request);
    setStep('review');
  }, [
    useUriMode,
    paymentUri,
    recipientAddress,
    recipientAmount,
    recipientMemo,
    parsePaymentUri,
    setPaymentRequest,
    zecToZatoshis,
    createPaymentRequest,
  ]);

  const handlePropose = useCallback(async () => {
    const success = await propose();
    if (success) {
      setCurrentSignIndex(0);
      setStep('sign');
    }
  }, [propose]);

  const handleCopySighash = useCallback(() => {
    if (state.sighashes[currentSignIndex]) {
      const hex = Array.from(state.sighashes[currentSignIndex].hash)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      navigator.clipboard.writeText(hex);
      setCopiedSighash(true);
      setTimeout(() => setCopiedSighash(false), 2000);
    }
  }, [state.sighashes, currentSignIndex]);

  const handleApplySignature = useCallback(async () => {
    if (!signatureHex || !publicKeyHex) return;

    const signature = {
      signature: hexToBytes(signatureHex),
      publicKey: hexToBytes(publicKeyHex),
    };

    const success = await applySignature(currentSignIndex, signature);
    if (success) {
      if (currentSignIndex < state.inputs.length - 1) {
        setCurrentSignIndex(i => i + 1);
        setSignatureHex('');
        setPublicKeyHex('');
      } else {
        // All inputs signed, proceed to proving
        setStep('prove');
      }
    }
  }, [signatureHex, publicKeyHex, applySignature, currentSignIndex, state.inputs.length]);

  const handleProve = useCallback(async () => {
    const success = await prove();
    if (success) {
      const tx = await finalize();
      if (tx) {
        setStep('complete');
      }
    }
  }, [prove, finalize]);

  const handleCopyTransaction = useCallback(() => {
    if (state.transaction) {
      navigator.clipboard.writeText(state.transaction.txid);
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    }
  }, [state.transaction]);

  const handleExportPczt = useCallback(() => {
    const bytes = exportPczt();
    if (bytes) {
      // Create a copy to ensure we have a proper ArrayBuffer
      const buffer = bytes.slice().buffer;
      const blob = new Blob([buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'transaction.pczt';
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [exportPczt]);

  const handleReset = useCallback(() => {
    reset();
    setStep('inputs');
    setInputForm(emptyInputForm);
    setRecipientAddress('');
    setRecipientAmount('');
    setRecipientMemo('');
    setPaymentUri('');
    setSignatureHex('');
    setPublicKeyHex('');
    setCurrentSignIndex(0);
  }, [reset]);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="transparent-to-shielded">
      {/* Header */}
      <div className="tts-header">
        <div className="tts-title">
          <span className="tts-icon">🔒</span>
          <h2>Send to Shielded</h2>
        </div>
        <p className="tts-subtitle">
          Create a transaction from transparent inputs to Orchard shielded addresses
        </p>
        <div className="tts-badge">
          <span className="badge-icon">📋</span>
          <span>PCZT (ZIP 374)</span>
        </div>
      </div>

      {/* Network Selector */}
      <div className="tts-network-selector">
        <label>Network:</label>
        <select
          value={state.network}
          onChange={(e) => setNetwork(e.target.value as Network)}
          disabled={state.step !== 'idle' && state.step !== 'input'}
        >
          <option value={Network.Mainnet}>Mainnet</option>
          <option value={Network.Testnet}>Testnet</option>
        </select>
      </div>

      {/* Progress Steps */}
      <div className="tts-progress">
        <ProgressStep active={step === 'inputs'} complete={step !== 'inputs'} label="1. Inputs" />
        <ProgressStep active={step === 'outputs'} complete={['review', 'sign', 'prove', 'complete'].includes(step)} label="2. Output" />
        <ProgressStep active={step === 'review'} complete={['sign', 'prove', 'complete'].includes(step)} label="3. Review" />
        <ProgressStep active={step === 'sign'} complete={['prove', 'complete'].includes(step)} label="4. Sign" />
        <ProgressStep active={step === 'prove'} complete={step === 'complete'} label="5. Prove" />
        <ProgressStep active={step === 'complete'} complete={false} label="6. Done" />
      </div>

      {/* Step: Inputs */}
      {step === 'inputs' && (
        <div className="tts-step tts-inputs-step">
          <h3>Add Transparent UTXOs</h3>
          <p className="tts-hint">
            Enter the transparent UTXOs you want to spend. You can find this information
            in your wallet or a block explorer.
          </p>

          {/* Input Form */}
          <div className="tts-input-form">
            <div className="tts-field">
              <label>Transaction ID (txid)</label>
              <input
                type="text"
                value={inputForm.txid}
                onChange={(e) => setInputForm(f => ({ ...f, txid: e.target.value }))}
                placeholder="64-character hex string"
                className="monospace"
              />
            </div>

            <div className="tts-field-row">
              <div className="tts-field">
                <label>Output Index (vout)</label>
                <input
                  type="number"
                  min="0"
                  value={inputForm.vout}
                  onChange={(e) => setInputForm(f => ({ ...f, vout: e.target.value }))}
                />
              </div>
              <div className="tts-field">
                <label>Value (ZEC)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputForm.value}
                  onChange={(e) => setInputForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="0.0"
                />
              </div>
            </div>

            <div className="tts-field">
              <label>Script PubKey (hex)</label>
              <input
                type="text"
                value={inputForm.scriptPubKey}
                onChange={(e) => setInputForm(f => ({ ...f, scriptPubKey: e.target.value }))}
                placeholder="e.g., 76a914...88ac"
                className="monospace"
              />
            </div>

            <details className="tts-advanced">
              <summary>Advanced: Signing Info</summary>
              <div className="tts-field">
                <label>BIP32 Derivation Path</label>
                <input
                  type="text"
                  value={inputForm.derivationPath}
                  onChange={(e) => setInputForm(f => ({ ...f, derivationPath: e.target.value }))}
                  placeholder="m/44'/133'/0'/0/0"
                />
              </div>
              <div className="tts-field">
                <label>Public Key (33 bytes hex)</label>
                <input
                  type="text"
                  value={inputForm.publicKey}
                  onChange={(e) => setInputForm(f => ({ ...f, publicKey: e.target.value }))}
                  placeholder="02 or 03 + 32 bytes"
                  className="monospace"
                />
              </div>
            </details>

            <button
              type="button"
              className="tts-button secondary"
              onClick={handleAddInput}
              disabled={!isValidInput}
            >
              + Add Input
            </button>
          </div>

          {/* Added Inputs */}
          {state.inputs.length > 0 && (
            <div className="tts-inputs-list">
              <h4>Added Inputs ({state.inputs.length})</h4>
              {state.inputs.map((input, idx) => (
                <div key={idx} className="tts-input-item">
                  <div className="input-info">
                    <code className="input-txid">{input.txid.slice(0, 12)}...:{input.vout}</code>
                    <span className="input-value">{zatoshisToZec(input.value)} ZEC</span>
                  </div>
                  <button
                    type="button"
                    className="input-remove"
                    onClick={() => removeInput(idx)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="tts-inputs-total">
                <span>Total:</span>
                <span className="total-value">{zatoshisToZec(totalInputValue)} ZEC</span>
              </div>
            </div>
          )}

          <div className="tts-actions">
            <button
              type="button"
              className="tts-button primary"
              onClick={handleProceedToOutputs}
              disabled={state.inputs.length === 0 || state.loading}
            >
              {state.loading ? 'Loading WASM...' : 'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Outputs */}
      {step === 'outputs' && (
        <div className="tts-step tts-outputs-step">
          <h3>Recipient</h3>
          
          <div className="tts-mode-toggle">
            <button
              type="button"
              className={`mode-button ${!useUriMode ? 'active' : ''}`}
              onClick={() => setUseUriMode(false)}
            >
              Manual Entry
            </button>
            <button
              type="button"
              className={`mode-button ${useUriMode ? 'active' : ''}`}
              onClick={() => setUseUriMode(true)}
            >
              Payment URI
            </button>
          </div>

          {useUriMode ? (
            <div className="tts-uri-input">
              <div className="tts-field">
                <label>ZIP 321 Payment URI</label>
                <textarea
                  value={paymentUri}
                  onChange={(e) => setPaymentUri(e.target.value)}
                  placeholder="zcash:u1...?amount=1.5&memo=Payment"
                  rows={3}
                />
              </div>
            </div>
          ) : (
            <div className="tts-manual-input">
              <div className="tts-field">
                <label>Recipient Address (Unified with Orchard)</label>
                <textarea
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="u1..."
                  rows={2}
                  className={recipientAddress && !isOrchardAddress(recipientAddress) ? 'error' : ''}
                />
                {recipientAddress && !isOrchardAddress(recipientAddress) && (
                  <p className="field-error">Address must be a Unified address with Orchard receiver (u1...)</p>
                )}
              </div>

              <div className="tts-field">
                <label>Amount (ZEC)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={recipientAmount}
                  onChange={(e) => setRecipientAmount(e.target.value)}
                  placeholder="0.0"
                />
              </div>

              <div className="tts-field">
                <label>Memo (optional)</label>
                <textarea
                  value={recipientMemo}
                  onChange={(e) => setRecipientMemo(e.target.value)}
                  placeholder="Encrypted memo for recipient"
                  rows={2}
                />
              </div>
            </div>
          )}

          <div className="tts-fee-info">
            <span>Estimated Fee:</span>
            <span className="fee-value">~0.0001 ZEC</span>
          </div>

          <div className="tts-actions">
            <button type="button" className="tts-button ghost" onClick={() => setStep('inputs')}>
              ← Back
            </button>
            <button
              type="button"
              className="tts-button primary"
              onClick={handleProceedToReview}
              disabled={!canProceedToReview}
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {step === 'review' && state.paymentRequest && (
        <div className="tts-step tts-review-step">
          <h3>Review Transaction</h3>

          <div className="tts-review-box">
            <div className="review-section">
              <h4>Spending</h4>
              <div className="review-value">{zatoshisToZec(totalInputValue)} ZEC</div>
              <div className="review-detail">{state.inputs.length} transparent input(s)</div>
            </div>

            <div className="review-arrow">↓</div>

            <div className="review-section">
              <h4>Sending</h4>
              {state.paymentRequest.payments.map((payment, idx) => (
                <div key={idx} className="review-payment">
                  <div className="review-value">{zatoshisToZec(payment.amount)} ZEC</div>
                  <div className="review-address">
                    <span className="shielded-badge">🔒 Shielded</span>
                    <code>{payment.address.slice(0, 16)}...{payment.address.slice(-8)}</code>
                  </div>
                  {payment.memo && (
                    <div className="review-memo">Memo: {payment.memo}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="review-section">
              <h4>Fee</h4>
              <div className="review-value">{zatoshisToZec(state.estimatedFee)} ZEC</div>
            </div>

            {state.changeAmount > 0n && (
              <div className="review-section">
                <h4>Change</h4>
                <div className="review-value">{zatoshisToZec(state.changeAmount)} ZEC</div>
                <div className="review-detail">Returned to your transparent address</div>
              </div>
            )}
          </div>

          <div className="tts-actions">
            <button type="button" className="tts-button ghost" onClick={() => setStep('outputs')}>
              ← Back
            </button>
            <button
              type="button"
              className="tts-button primary"
              onClick={handlePropose}
              disabled={state.loading}
            >
              {state.loading ? 'Creating PCZT...' : 'Create PCZT →'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Sign */}
      {step === 'sign' && state.sighashes.length > 0 && (
        <div className="tts-step tts-sign-step">
          <h3>Sign Input {currentSignIndex + 1} of {state.inputs.length}</h3>
          
          <p className="tts-hint">
            Copy the sighash below and sign it with your external wallet (hardware wallet, etc.).
            Then paste the signature and public key.
          </p>

          <div className="tts-sighash-box">
            <label>Sighash to Sign</label>
            <code className="sighash-value">
              {Array.from(state.sighashes[currentSignIndex].hash)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')}
            </code>
            <button type="button" className="copy-button" onClick={handleCopySighash}>
              {copiedSighash ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>

          <div className="tts-input-info">
            <span>Input:</span>
            <code>{state.inputs[currentSignIndex].txid.slice(0, 12)}...:{state.inputs[currentSignIndex].vout}</code>
            <span className="input-value">{zatoshisToZec(state.inputs[currentSignIndex].value)} ZEC</span>
          </div>

          <div className="tts-signature-form">
            <div className="tts-field">
              <label>DER Signature (hex)</label>
              <textarea
                value={signatureHex}
                onChange={(e) => setSignatureHex(e.target.value)}
                placeholder="3044022..."
                rows={2}
                className="monospace"
              />
            </div>

            <div className="tts-field">
              <label>Public Key (hex)</label>
              <input
                type="text"
                value={publicKeyHex}
                onChange={(e) => setPublicKeyHex(e.target.value)}
                placeholder="02 or 03 + 32 bytes"
                className="monospace"
              />
            </div>
          </div>

          <div className="tts-actions">
            <button type="button" className="tts-button ghost" onClick={handleExportPczt}>
              📤 Export PCZT
            </button>
            <button
              type="button"
              className="tts-button primary"
              onClick={handleApplySignature}
              disabled={!signatureHex || !publicKeyHex || state.loading}
            >
              {state.loading ? 'Applying...' : 'Apply Signature →'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Prove */}
      {step === 'prove' && (
        <div className="tts-step tts-prove-step">
          <h3>Generate Proof</h3>
          
          <p className="tts-hint">
            All inputs are signed. Now we need to generate zero-knowledge proofs for the
            shielded output(s). This may take a few seconds.
          </p>

          {state.proverProgress && (
            <div className="tts-prover-progress">
              <div className="progress-bar">
                <div 
                  className="progress-fill"
                  style={{ width: `${state.proverProgress.progress}%` }}
                />
              </div>
              <div className="progress-text">
                {state.proverProgress.phase === 'loading' && 'Loading proving key...'}
                {state.proverProgress.phase === 'preparing' && 'Preparing witness...'}
                {state.proverProgress.phase === 'proving' && 'Generating proof...'}
                {state.proverProgress.phase === 'verifying' && 'Verifying proof...'}
                {state.proverProgress.phase === 'complete' && 'Complete!'}
              </div>
            </div>
          )}

          <div className="tts-actions">
            <button
              type="button"
              className="tts-button primary"
              onClick={handleProve}
              disabled={state.loading}
            >
              {state.loading ? 'Proving...' : 'Generate Proof & Finalize'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Complete */}
      {step === 'complete' && state.transaction && (
        <div className="tts-step tts-complete-step">
          <div className="tts-success-icon">✅</div>
          <h3>Transaction Ready!</h3>
          
          <p className="tts-hint">
            Your transaction is ready to broadcast. Copy the transaction hex and submit it
            to a Zcash node or broadcast service.
          </p>

          <div className="tts-tx-box">
            <div className="tx-id">
              <label>Transaction ID</label>
              <code>{state.transaction.txid}</code>
              <button type="button" className="copy-button" onClick={handleCopyTransaction}>
                {copiedTx ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>

            <div className="tx-hex">
              <label>Raw Transaction ({state.transaction.bytes.length} bytes)</label>
              <textarea
                readOnly
                value={Array.from(state.transaction.bytes)
                  .map(b => b.toString(16).padStart(2, '0'))
                  .join('')}
                rows={4}
                className="monospace"
              />
            </div>
          </div>

          <div className="tts-broadcast-info">
            <h4>Broadcast Options</h4>
            <ul>
              <li>
                <a href="https://zcashblockexplorer.com/broadcast" target="_blank" rel="noopener noreferrer">
                  Zcash Block Explorer
                </a>
              </li>
              <li>
                Submit via <code>zcash-cli sendrawtransaction</code>
              </li>
              <li>
                Use your wallet's broadcast feature
              </li>
            </ul>
          </div>

          <div className="tts-actions">
            <button type="button" className="tts-button primary" onClick={handleReset}>
              Create Another Transaction
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {state.error && (
        <div className="tts-error">
          <span className="error-icon">⚠️</span>
          <span>{state.error}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

interface ProgressStepProps {
  active: boolean;
  complete: boolean;
  label: string;
}

function ProgressStep({ active, complete, label }: ProgressStepProps) {
  return (
    <div className={`progress-step ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}>
      <div className="step-dot">
        {complete && '✓'}
      </div>
      <span className="step-label">{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/, '').replace(/\s/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export default TransparentToShielded;

