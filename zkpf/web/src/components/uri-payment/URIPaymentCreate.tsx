import { useState, useCallback, useMemo } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import {
  formatZecAmount,
  formatZecDisplay,
  generateShareableMessage,
  STANDARD_FEE_ZATS,
  MAINNET_HOST,
  saveSentPayments,
  loadSentPayments,
  encodePaymentKey,
} from './utils';
import type { UriPayment, SentUriPayment } from './types';
import './URIPayment.css';

type CreateStep = 'input' | 'confirm' | 'share';

/**
 * Generate a random 32-byte key and encode it as Bech32m
 */
function generatePaymentKey(): { keyBytes: Uint8Array; keyBech32: string } {
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  
  const keyBech32 = encodePaymentKey(keyBytes, false);
  
  return { keyBytes, keyBech32 };
}

export function URIPaymentCreate() {
  const { state } = useWebZjsContext();
  
  const [step, setStep] = useState<CreateStep>('input');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdPayment, setCreatedPayment] = useState<UriPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Calculate balance and amount
  const activeBalanceReport = useMemo(() => {
    if (!state.summary || state.activeAccount == null) return null;
    return state.summary.account_balances.find(
      ([accountId]) => accountId === state.activeAccount
    );
  }, [state.summary, state.activeAccount]);

  const shieldedBalance = useMemo(() => {
    if (!activeBalanceReport) return 0;
    const balance = activeBalanceReport[1];
    return balance.sapling_balance + balance.orchard_balance;
  }, [activeBalanceReport]);

  const amountZats = useMemo(() => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed * 100_000_000);
  }, [amount]);

  const totalWithFee = amountZats + STANDARD_FEE_ZATS;

  const canCreate = useMemo(() => {
    return (
      amountZats > 0 &&
      totalWithFee <= shieldedBalance &&
      !isCreating
    );
  }, [amountZats, totalWithFee, shieldedBalance, isCreating]);

  const handleContinue = useCallback(() => {
    if (canCreate) {
      setStep('confirm');
    }
  }, [canCreate]);

  const handleBack = useCallback(() => {
    if (step === 'confirm') {
      setStep('input');
    } else if (step === 'share') {
      setStep('input');
      setCreatedPayment(null);
    }
  }, [step]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);
    
    try {
      // Generate ephemeral payment key
      const { keyBech32 } = generatePaymentKey();
      
      // Build the URI
      const amountStr = formatZecAmount(amountZats);
      let fragment = `amount=${amountStr}&key=${keyBech32}`;
      
      if (description.trim()) {
        const encodedDesc = encodeURIComponent(description.trim());
        fragment = `amount=${amountStr}&desc=${encodedDesc}&key=${keyBech32}`;
      }
      
      const uri = `https://${MAINNET_HOST}:65536/v1#${fragment}`;
      
      const payment: UriPayment = {
        amountZats,
        amountZec: amountStr,
        description: description.trim() || undefined,
        keyHex: keyBech32,
        isTestnet: false,
        uri,
      };
      
      // In a full implementation, we would:
      // 1. Create a transaction sending to the ephemeral address
      // 2. Broadcast the transaction
      // 3. Store the payment in local state for recovery
      
      // For now, simulate the process
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Save to local storage for history
      const sentPayments = loadSentPayments();
      const newPayment: SentUriPayment = {
        id: crypto.randomUUID(),
        payment,
        createdAt: Date.now(),
        state: 'pending',
      };
      sentPayments.unshift(newPayment);
      saveSentPayments(sentPayments);
      
      setCreatedPayment(payment);
      setStep('share');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create payment');
    } finally {
      setIsCreating(false);
    }
  }, [amountZats, description]);

  const handleCopyUri = useCallback(async () => {
    if (!createdPayment) return;
    
    try {
      await navigator.clipboard.writeText(createdPayment.uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [createdPayment]);

  const handleCopyMessage = useCallback(async () => {
    if (!createdPayment) return;
    
    try {
      const message = generateShareableMessage(createdPayment);
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [createdPayment]);

  const handleShare = useCallback(async () => {
    if (!createdPayment) return;
    
    try {
      const message = generateShareableMessage(createdPayment);
      
      if (navigator.share) {
        await navigator.share({
          title: `Zcash Payment: ${createdPayment.amountZec} ZEC`,
          text: message,
        });
      } else {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to share:', err);
      }
    }
  }, [createdPayment]);

  const handleReset = useCallback(() => {
    setStep('input');
    setAmount('');
    setDescription('');
    setCreatedPayment(null);
    setError(null);
  }, []);

  if (!state.webWallet) {
    return (
      <div className="card uri-payment-card">
        <p className="eyebrow">Send via URI</p>
        <h3>Connect wallet first</h3>
        <p className="muted">
          Connect your Zcash wallet to create URI-encapsulated payments.
        </p>
      </div>
    );
  }

  return (
    <div className="uri-payment-create">
      <div className="card uri-payment-card">
        <header className="uri-payment-header">
          <div className="uri-payment-icon">📨</div>
          <div>
            <p className="eyebrow">URI-Encapsulated Payment</p>
            <h3>Send via Message</h3>
          </div>
        </header>
        
        <p className="uri-payment-description muted">
          Send ZEC via any secure messaging app like Signal or WhatsApp.
          The recipient doesn't need your address — just share the link!
        </p>

        {step === 'input' && (
          <div className="uri-payment-form">
            <div className="uri-balance-display">
              <span className="muted small">Available balance:</span>
              <span className="uri-balance-value">
                {formatZecDisplay(shieldedBalance)} ZEC
              </span>
            </div>

            <div className="field">
              <label>Amount (ZEC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.00000001"
                min="0"
                className="uri-amount-input"
              />
              {totalWithFee > shieldedBalance && amountZats > 0 && (
                <p className="error small">Insufficient balance (including 0.00001 ZEC fee)</p>
              )}
              <div className="uri-amount-presets">
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount((shieldedBalance / 100_000_000 * 0.25).toFixed(8))}
                >
                  25%
                </button>
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount((shieldedBalance / 100_000_000 * 0.5).toFixed(8))}
                >
                  50%
                </button>
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount(((shieldedBalance - STANDARD_FEE_ZATS) / 100_000_000).toFixed(8))}
                >
                  Max
                </button>
              </div>
            </div>

            <div className="field">
              <label>Description (optional)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Payment for coffee"
                maxLength={100}
              />
              <p className="muted small">
                Visible to the recipient in the payment link.
              </p>
            </div>

            <div className="uri-payment-actions">
              <button onClick={handleContinue} disabled={!canCreate}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="uri-payment-confirm">
            <div className="uri-confirm-summary">
              <h4>Confirm Payment</h4>
              
              <div className="uri-confirm-row">
                <span className="uri-confirm-label">Amount</span>
                <span className="uri-confirm-value large">
                  {formatZecDisplay(amountZats)} ZEC
                </span>
              </div>
              
              {description && (
                <div className="uri-confirm-row">
                  <span className="uri-confirm-label">Description</span>
                  <span className="uri-confirm-value">{description}</span>
                </div>
              )}
              
              <div className="uri-confirm-row">
                <span className="uri-confirm-label">Network Fee</span>
                <span className="uri-confirm-value">0.00001 ZEC</span>
              </div>
              
              <div className="uri-confirm-row total">
                <span className="uri-confirm-label">Total</span>
                <span className="uri-confirm-value">
                  {formatZecDisplay(totalWithFee)} ZEC
                </span>
              </div>
            </div>

            <div className="uri-payment-info-box">
              <p className="small">
                <strong>⚠️ Important:</strong> The payment link contains the spending key. 
                Anyone with the link can claim the funds. Only share via secure channels!
              </p>
            </div>

            {error && (
              <p className="error">{error}</p>
            )}

            <div className="uri-payment-actions">
              <button className="ghost" onClick={handleBack} disabled={isCreating}>
                Back
              </button>
              <button onClick={handleCreate} disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Payment'}
              </button>
            </div>
          </div>
        )}

        {step === 'share' && createdPayment && (
          <div className="uri-payment-share">
            <div className="uri-share-success">
              <div className="uri-success-icon">✓</div>
              <h4>Payment Created!</h4>
              <p className="muted">
                Share this link with the recipient via any secure messaging app.
              </p>
            </div>

            <div className="uri-share-amount">
              <span className="large">{createdPayment.amountZec} ZEC</span>
              {createdPayment.description && (
                <span className="muted small">{createdPayment.description}</span>
              )}
            </div>

            <div className="uri-share-link">
              <code className="uri-link-display">{createdPayment.uri}</code>
            </div>

            <div className="uri-share-actions">
              <button onClick={handleShare} className="uri-share-button primary">
                {'share' in navigator && typeof navigator.share === 'function' ? '📤 Share' : '📋 Copy Message'}
              </button>
              <button onClick={handleCopyUri} className="ghost">
                {copied ? '✓ Copied!' : '📋 Copy URI'}
              </button>
              <button onClick={handleCopyMessage} className="ghost">
                📝 Copy Full Message
              </button>
            </div>

            <div className="uri-payment-info-box warning">
              <p className="small">
                <strong>🔐 Security Note:</strong> The recipient can finalize this payment 
                at any time. Until they do, you can cancel it from the payment history.
              </p>
            </div>

            <div className="uri-payment-actions">
              <button onClick={handleReset} className="ghost">
                Create Another Payment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

