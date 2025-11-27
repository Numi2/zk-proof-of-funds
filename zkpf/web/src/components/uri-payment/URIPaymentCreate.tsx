import { useState, useCallback, useMemo } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import {
  formatZecAmount,
  formatZecDisplay,
  STANDARD_FEE_ZATS,
  MAINNET_HOST,
  saveSentPayments,
  loadSentPayments,
  encodePaymentKey,
} from './utils';
import type { UriPayment, SentUriPayment } from './types';
import './URIPayment.css';

type CreateStep = 'input' | 'link';

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
  const [memo, setMemo] = useState('');
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

  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    
    setIsCreating(true);
    setError(null);
    
    try {
      const { keyBech32 } = generatePaymentKey();
      const amountStr = formatZecAmount(amountZats);
      
      let fragment = `amount=${amountStr}&key=${keyBech32}`;
      if (memo.trim()) {
        fragment = `amount=${amountStr}&desc=${encodeURIComponent(memo.trim())}&key=${keyBech32}`;
      }
      
      const uri = `https://${MAINNET_HOST}:65536/v1#${fragment}`;
      
      const payment: UriPayment = {
        amountZats,
        amountZec: amountStr,
        description: memo.trim() || undefined,
        keyHex: keyBech32,
        isTestnet: false,
        uri,
      };
      
      await new Promise(resolve => setTimeout(resolve, 800));
      
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
      setStep('link');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link');
    } finally {
      setIsCreating(false);
    }
  }, [amountZats, memo, canCreate]);

  const handleCopy = useCallback(async () => {
    if (!createdPayment) return;
    
    try {
      await navigator.clipboard.writeText(createdPayment.uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [createdPayment]);

  const handleReset = useCallback(() => {
    setStep('input');
    setAmount('');
    setMemo('');
    setCreatedPayment(null);
    setError(null);
    setCopied(false);
  }, []);

  if (!state.webWallet) {
    return (
      <div className="link-create-empty">
        <div className="link-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            <path d="M9 12h6m-3-3v6" />
          </svg>
        </div>
        <p>Connect your wallet to create payment links</p>
      </div>
    );
  }

  return (
    <div className="link-create">
      {step === 'input' && (
        <>
          <div className="link-amount-section">
            <label className="link-label">Amount</label>
            <div className="link-amount-wrap">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.00000001"
                min="0"
                className="link-amount-input"
                autoFocus
              />
              <span className="link-amount-currency">ZEC</span>
            </div>
            {totalWithFee > shieldedBalance && amountZats > 0 && (
              <p className="link-error">Exceeds available balance</p>
            )}
            <div className="link-balance">
              <span>Available:</span>
              <span className="link-balance-val">{formatZecDisplay(shieldedBalance)} ZEC</span>
            </div>
          </div>

          <div className="link-memo-section">
            <label className="link-label">Memo <span className="link-optional">(optional)</span></label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="What's this for?"
              maxLength={80}
              className="link-memo-input"
            />
          </div>

          {error && <p className="link-error">{error}</p>}

          <button 
            className="link-create-btn"
            onClick={handleCreate} 
            disabled={!canCreate}
          >
            {isCreating ? (
              <span className="link-btn-loading">
                <span className="link-spinner" />
                Generating...
              </span>
            ) : (
              'Generate Link'
            )}
          </button>

          <p className="link-fee-note">
            Network fee: 0.00001 ZEC
          </p>
        </>
      )}

      {step === 'link' && createdPayment && (
        <div className="link-result">
          <div className="link-result-header">
            <div className="link-check">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </div>
            <div className="link-result-amount">
              <span className="link-result-zec">{createdPayment.amountZec}</span>
              <span className="link-result-unit">ZEC</span>
            </div>
            {createdPayment.description && (
              <p className="link-result-memo">{createdPayment.description}</p>
            )}
          </div>

          <div className="link-box">
            <div className="link-box-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>Payment Link</span>
            </div>
            <code className="link-box-url">{createdPayment.uri}</code>
            <button 
              className={`link-copy-btn ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  Copied
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Link
                </>
              )}
            </button>
          </div>

          <div className="link-warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span>Anyone with this link can claim the funds</span>
          </div>

          <button className="link-new-btn" onClick={handleReset}>
            Create Another
          </button>
        </div>
      )}

      <style>{`
        .link-create {
          animation: linkFadeIn 0.25s ease;
        }

        @keyframes linkFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .link-create-empty {
          text-align: center;
          padding: 3rem 1.5rem;
          color: rgba(255, 255, 255, 0.4);
        }

        .link-empty-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 1rem;
          color: rgba(255, 255, 255, 0.2);
        }

        .link-empty-icon svg {
          width: 100%;
          height: 100%;
        }

        .link-label {
          display: block;
          font-size: 0.8rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.6);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .link-optional {
          text-transform: none;
          letter-spacing: normal;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.35);
        }

        .link-amount-section {
          margin-bottom: 1.5rem;
        }

        .link-amount-wrap {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 1rem 1.25rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          transition: border-color 0.15s ease;
        }

        .link-amount-wrap:focus-within {
          border-color: rgba(99, 102, 241, 0.5);
        }

        .link-amount-input {
          flex: 1;
          background: transparent;
          border: none;
          font-size: 2rem;
          font-weight: 600;
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          color: #fff;
          outline: none;
          min-width: 0;
        }

        .link-amount-input::placeholder {
          color: rgba(255, 255, 255, 0.2);
        }

        .link-amount-input::-webkit-inner-spin-button,
        .link-amount-input::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        .link-amount-currency {
          font-size: 1rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.4);
          padding: 0.35rem 0.65rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
        }

        .link-balance {
          display: flex;
          justify-content: space-between;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 0.65rem;
          padding: 0 0.25rem;
        }

        .link-balance-val {
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          color: rgba(255, 255, 255, 0.55);
        }

        .link-memo-section {
          margin-bottom: 1.75rem;
        }

        .link-memo-input {
          width: 100%;
          padding: 0.85rem 1rem;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          font-size: 0.95rem;
          color: #fff;
          outline: none;
          transition: border-color 0.15s ease;
        }

        .link-memo-input:focus {
          border-color: rgba(99, 102, 241, 0.5);
        }

        .link-memo-input::placeholder {
          color: rgba(255, 255, 255, 0.25);
        }

        .link-error {
          color: #f87171;
          font-size: 0.8rem;
          margin: 0.5rem 0 0 0.25rem;
        }

        .link-create-btn {
          width: 100%;
          padding: 1rem;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          border: none;
          border-radius: 10px;
          font-size: 1rem;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .link-create-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 20px rgba(99, 102, 241, 0.35);
        }

        .link-create-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .link-btn-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .link-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: linkSpin 0.7s linear infinite;
        }

        @keyframes linkSpin {
          to { transform: rotate(360deg); }
        }

        .link-fee-note {
          text-align: center;
          font-size: 0.75rem;
          color: rgba(255, 255, 255, 0.35);
          margin-top: 1rem;
        }

        /* Link Result */
        .link-result {
          animation: linkFadeIn 0.3s ease;
        }

        .link-result-header {
          text-align: center;
          margin-bottom: 1.75rem;
        }

        .link-check {
          width: 52px;
          height: 52px;
          margin: 0 auto 1rem;
          background: linear-gradient(135deg, #10b981, #059669);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        .link-check svg {
          width: 26px;
          height: 26px;
        }

        .link-result-amount {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 0.4rem;
        }

        .link-result-zec {
          font-size: 2.5rem;
          font-weight: 700;
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          color: #fff;
        }

        .link-result-unit {
          font-size: 1.1rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.5);
        }

        .link-result-memo {
          margin: 0.5rem 0 0;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.9rem;
        }

        .link-box {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 1rem;
          margin-bottom: 1rem;
        }

        .link-box-label {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.45);
          margin-bottom: 0.65rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .link-box-label svg {
          width: 14px;
          height: 14px;
        }

        .link-box-url {
          display: block;
          font-size: 0.75rem;
          font-family: 'JetBrains Mono', 'SF Mono', monospace;
          color: rgba(255, 255, 255, 0.7);
          word-break: break-all;
          line-height: 1.5;
          margin-bottom: 1rem;
          padding: 0.75rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          max-height: 100px;
          overflow-y: auto;
        }

        .link-copy-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          font-size: 0.9rem;
          font-weight: 500;
          color: #fff;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .link-copy-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .link-copy-btn.copied {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.3);
          color: #34d399;
        }

        .link-copy-btn svg {
          width: 16px;
          height: 16px;
        }

        .link-warning {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.75rem 1rem;
          background: rgba(251, 191, 36, 0.08);
          border: 1px solid rgba(251, 191, 36, 0.15);
          border-radius: 8px;
          font-size: 0.8rem;
          color: #fbbf24;
          margin-bottom: 1.5rem;
        }

        .link-warning svg {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        .link-new-btn {
          width: 100%;
          padding: 0.85rem 1rem;
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          font-size: 0.9rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .link-new-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
        }

        @media (max-width: 480px) {
          .link-amount-input {
            font-size: 1.75rem;
          }

          .link-result-zec {
            font-size: 2rem;
          }
        }
      `}</style>
    </div>
  );
}

