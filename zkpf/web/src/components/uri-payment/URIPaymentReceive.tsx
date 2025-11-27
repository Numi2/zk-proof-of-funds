import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import {
  isPaymentUri,
  parsePaymentUri,
  formatZecDisplay,
  getStatusText,
  getStatusColor,
  saveReceivedPayments,
  loadReceivedPayments,
} from './utils';
import type { UriPayment, UriPaymentStatus, ReceivedUriPayment } from './types';
import './URIPayment.css';

type ReceiveStep = 'input' | 'verify' | 'finalize' | 'result';

export function URIPaymentReceive() {
  const { state } = useWebZjsContext();
  
  const [step, setStep] = useState<ReceiveStep>('input');
  const [uriInput, setUriInput] = useState('');
  const [parsedPayment, setParsedPayment] = useState<UriPayment | null>(null);
  const [status, setStatus] = useState<UriPaymentStatus | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalizationResult, setFinalizationResult] = useState<{
    success: boolean;
    txid?: string;
    error?: string;
  } | null>(null);

  // Check URL hash for incoming payment URI on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes('amount=') && hash.includes('key=')) {
      // Reconstruct the full URI from the current URL
      const fullUri = window.location.href;
      if (isPaymentUri(fullUri)) {
        setUriInput(fullUri);
        // Clear the hash to prevent re-processing
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, []);

  const isValidUri = useMemo(() => {
    return isPaymentUri(uriInput);
  }, [uriInput]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (isPaymentUri(text)) {
        setUriInput(text);
      } else {
        setError('Clipboard does not contain a valid Zcash payment URI');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      setError('Failed to read clipboard');
      setTimeout(() => setError(null), 3000);
    }
  }, []);

  const handleVerify = useCallback(async () => {
    setIsVerifying(true);
    setError(null);
    
    try {
      // Parse the URI
      const payment = parsePaymentUri(uriInput);
      if (!payment) {
        throw new Error('Invalid payment URI format');
      }
      
      setParsedPayment(payment);
      
      // Set initial status to checking
      setStatus({
        state: 'pending',
        canFinalize: false,
        isFinalized: false,
      });
      
      setStep('verify');
      
      // In a full implementation, we would:
      // 1. Derive the payment address from the key
      // 2. Query the blockchain for notes at that address
      // 3. Verify the amount matches
      // 4. Check confirmation count
      
      // Simulate verification
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // For demo, assume payment is ready
      setStatus({
        state: 'ready',
        confirmations: 12,
        canFinalize: true,
        isFinalized: false,
      });
      
      // Save to received payments
      const receivedPayments = loadReceivedPayments();
      const existing = receivedPayments.find(p => p.payment.uri === payment.uri);
      if (!existing) {
        const newPayment: ReceivedUriPayment = {
          id: crypto.randomUUID(),
          payment,
          receivedAt: Date.now(),
          state: 'ready',
        };
        receivedPayments.unshift(newPayment);
        saveReceivedPayments(receivedPayments);
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify payment');
      setStatus({
        state: 'invalid',
        canFinalize: false,
        isFinalized: false,
        error: err instanceof Error ? err.message : 'Verification failed',
      });
    } finally {
      setIsVerifying(false);
    }
  }, [uriInput]);

  const handleFinalize = useCallback(async () => {
    if (!parsedPayment || !status?.canFinalize) return;
    
    setIsFinalizing(true);
    setError(null);
    setStep('finalize');
    
    try {
      // In a full implementation, we would:
      // 1. Derive the spending key from the payment key
      // 2. Create a transaction spending the notes to our own address
      // 3. Include the fee from the payment amount
      // 4. Broadcast the transaction
      
      // Simulate finalization
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // For demo, assume success
      const mockTxid = '0x' + Array(64).fill(0).map(() => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      
      setFinalizationResult({
        success: true,
        txid: mockTxid,
      });
      
      // Update received payments
      const receivedPayments = loadReceivedPayments() as ReceivedUriPayment[];
      const idx = receivedPayments.findIndex(p => p.payment.uri === parsedPayment.uri);
      if (idx >= 0) {
        receivedPayments[idx].state = 'finalized';
        receivedPayments[idx].finalizationTxid = mockTxid;
        saveReceivedPayments(receivedPayments);
      }
      
      setStep('result');
      
    } catch (err) {
      setFinalizationResult({
        success: false,
        error: err instanceof Error ? err.message : 'Finalization failed',
      });
      setStep('result');
    } finally {
      setIsFinalizing(false);
    }
  }, [parsedPayment, status]);

  const handleReset = useCallback(() => {
    setStep('input');
    setUriInput('');
    setParsedPayment(null);
    setStatus(null);
    setError(null);
    setFinalizationResult(null);
  }, []);

  if (!state.webWallet) {
    return (
      <div className="card uri-payment-card">
        <p className="eyebrow">Receive via URI</p>
        <h3>Connect wallet first</h3>
        <p className="muted">
          Connect your Zcash wallet to receive URI-encapsulated payments.
        </p>
      </div>
    );
  }

  return (
    <div className="uri-payment-receive">
      <div className="card uri-payment-card">
        <header className="uri-payment-header">
          <div className="uri-payment-icon">📥</div>
          <div>
            <p className="eyebrow">URI-Encapsulated Payment</p>
            <h3>Receive Payment</h3>
          </div>
        </header>

        {step === 'input' && (
          <div className="uri-payment-form">
            <p className="muted">
              Paste a payment URI you received via message to claim the funds.
            </p>

            <div className="field">
              <label>Payment URI</label>
              <textarea
                value={uriInput}
                onChange={(e) => setUriInput(e.target.value)}
                placeholder="https://pay.withzcash.com:65536/v1#amount=...&key=..."
                rows={4}
                className={uriInput && !isValidUri ? 'error-input' : ''}
              />
              {uriInput && !isValidUri && (
                <p className="error small">Not a valid Zcash payment URI</p>
              )}
            </div>

            <div className="uri-payment-actions">
              <button onClick={handlePaste} className="ghost">
                📋 Paste from Clipboard
              </button>
              <button 
                onClick={handleVerify} 
                disabled={!isValidUri || isVerifying}
              >
                {isVerifying ? 'Verifying...' : 'Verify Payment'}
              </button>
            </div>

            {error && <p className="error">{error}</p>}
          </div>
        )}

        {step === 'verify' && parsedPayment && status && (
          <div className="uri-payment-verify">
            <div className="uri-verify-amount">
              <span className="uri-amount-value large">
                {formatZecDisplay(parsedPayment.amountZats)} ZEC
              </span>
              {parsedPayment.description && (
                <span className="uri-description muted">
                  {parsedPayment.description}
                </span>
              )}
            </div>

            <div className={`uri-status-badge ${getStatusColor(status.state)}`}>
              {getStatusText(status)}
            </div>

            {status.state === 'pending' && (
              <div className="uri-loading">
                <div className="uri-spinner"></div>
                <p className="muted small">Checking blockchain for payment...</p>
              </div>
            )}

            {status.state === 'ready' && (
              <div className="uri-ready-info">
                <p className="success">
                  ✓ Payment verified with {status.confirmations} confirmations
                </p>
                <p className="muted small">
                  Click "Finalize" to transfer the funds to your wallet.
                </p>
              </div>
            )}

            {status.state === 'invalid' && (
              <div className="uri-invalid-info">
                <p className="error">
                  ✕ {status.error || 'Payment cannot be claimed'}
                </p>
              </div>
            )}

            <div className="uri-payment-info-box">
              <p className="small">
                <strong>ℹ️ Note:</strong> The network fee (0.00001 ZEC) will be 
                deducted from the payment amount during finalization.
              </p>
            </div>

            <div className="uri-payment-actions">
              <button className="ghost" onClick={handleReset}>
                Cancel
              </button>
              <button 
                onClick={handleFinalize}
                disabled={!status.canFinalize || isFinalizing}
              >
                {isFinalizing ? 'Finalizing...' : 'Finalize Payment'}
              </button>
            </div>
          </div>
        )}

        {step === 'finalize' && (
          <div className="uri-payment-finalizing">
            <div className="uri-loading large">
              <div className="uri-spinner large"></div>
              <h4>Finalizing Payment</h4>
              <p className="muted">
                Creating transaction to transfer funds to your wallet...
              </p>
            </div>
            <p className="muted small">
              This may take a minute. Please don't close this page.
            </p>
          </div>
        )}

        {step === 'result' && finalizationResult && (
          <div className="uri-payment-result">
            {finalizationResult.success ? (
              <div className="uri-result-success">
                <div className="uri-success-icon large">✓</div>
                <h4>Payment Received!</h4>
                <p className="muted">
                  The funds have been transferred to your wallet.
                </p>
                {parsedPayment && (
                  <div className="uri-result-amount">
                    <span className="large">
                      +{formatZecDisplay(parsedPayment.amountZats)} ZEC
                    </span>
                  </div>
                )}
                {finalizationResult.txid && (
                  <div className="uri-result-txid">
                    <span className="muted small">Transaction ID:</span>
                    <code className="small">{finalizationResult.txid}</code>
                  </div>
                )}
              </div>
            ) : (
              <div className="uri-result-error">
                <div className="uri-error-icon large">✕</div>
                <h4>Finalization Failed</h4>
                <p className="error">{finalizationResult.error}</p>
                <p className="muted small">
                  The payment may have been cancelled or already claimed.
                </p>
              </div>
            )}

            <div className="uri-payment-actions">
              <button onClick={handleReset}>
                {finalizationResult.success ? 'Receive Another' : 'Try Again'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

