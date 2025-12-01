/**
 * React Components for x402 ZEC Payments
 * 
 * @author Numan Thabit
 * @license MIT
 * 
 * Drop-in components for handling ZEC payments in React applications.
 * 
 * @example
 * ```tsx
 * import { X402Provider } from '@numi2/x402-zec/react';
 * 
 * function App() {
 *   return (
 *     <X402Provider>
 *       <MyApp />
 *     </X402Provider>
 *   );
 * }
 * ```
 */

import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { PaymentRequirements, PaymentHandler } from './index';
import { X402Client, formatZec, generatePaymentUri, isExpired, getTimeRemaining } from './index';

// ============================================================================
// Context
// ============================================================================

interface X402ContextValue {
  client: X402Client | null;
  pendingPayment: PaymentRequirements | null;
  isPaymentModalOpen: boolean;
  submitPayment: (txid: string) => void;
  cancelPayment: () => void;
}

const X402Context = createContext<X402ContextValue | null>(null);

export function useX402() {
  const context = useContext(X402Context);
  if (!context) {
    throw new Error('useX402 must be used within an X402Provider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

interface X402ProviderProps {
  children: React.ReactNode;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
  PaymentModal?: React.ComponentType<PaymentModalProps>;
}

export function X402Provider({ 
  children, 
  baseUrl,
  customHeaders,
  PaymentModal = DefaultPaymentModal 
}: X402ProviderProps) {
  const [pendingPayment, setPendingPayment] = useState<PaymentRequirements | null>(null);
  const [resolvePayment, setResolvePayment] = useState<((txid: string | null) => void) | null>(null);
  const [client, setClient] = useState<X402Client | null>(null);

  useEffect(() => {
    const paymentHandler: PaymentHandler = async (requirements) => {
      return new Promise((resolve) => {
        setPendingPayment(requirements);
        setResolvePayment(() => resolve);
      });
    };

    const newClient = new X402Client({
      baseUrl,
      headers: customHeaders,
      onPaymentRequired: paymentHandler,
      onPaymentPending: (req, confirmations) => {
        console.log(`Payment pending: ${confirmations} confirmations`);
      },
    });

    setClient(newClient);
  }, [baseUrl, customHeaders]);

  const submitPayment = useCallback((txid: string) => {
    if (resolvePayment) {
      resolvePayment(txid);
      setPendingPayment(null);
      setResolvePayment(null);
    }
  }, [resolvePayment]);

  const cancelPayment = useCallback(() => {
    if (resolvePayment) {
      resolvePayment(null);
      setPendingPayment(null);
      setResolvePayment(null);
    }
  }, [resolvePayment]);

  return (
    <X402Context.Provider value={{
      client,
      pendingPayment,
      isPaymentModalOpen: pendingPayment !== null,
      submitPayment,
      cancelPayment,
    }}>
      {children}
      {pendingPayment && (
        <PaymentModal
          requirements={pendingPayment}
          onSubmit={submitPayment}
          onCancel={cancelPayment}
        />
      )}
    </X402Context.Provider>
  );
}

// ============================================================================
// Payment Modal
// ============================================================================

export interface PaymentModalProps {
  requirements: PaymentRequirements;
  onSubmit: (txid: string) => void;
  onCancel: () => void;
}

export function DefaultPaymentModal({ requirements, onSubmit, onCancel }: PaymentModalProps) {
  const [txid, setTxid] = useState('');
  const [timeLeft, setTimeLeft] = useState(getTimeRemaining(requirements));
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Update countdown
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = getTimeRemaining(requirements);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setError('Payment request expired. Please try again.');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [requirements]);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(requirements.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy address');
    }
  };

  const handleOpenWallet = () => {
    const uri = generatePaymentUri(requirements);
    window.location.href = uri;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate txid
    if (!/^[a-fA-F0-9]{64}$/.test(txid.trim())) {
      setError('Invalid transaction ID. It should be 64 hexadecimal characters.');
      return;
    }

    if (isExpired(requirements)) {
      setError('Payment request has expired.');
      return;
    }

    onSubmit(txid.trim().toLowerCase());
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="x402-modal-overlay" onClick={onCancel}>
      <div className="x402-modal" onClick={e => e.stopPropagation()}>
        <button className="x402-modal-close" onClick={onCancel} aria-label="Close">×</button>
        
        <h2 className="x402-modal-title">💰 Payment Required</h2>
        
        {requirements.description && (
          <p className="x402-modal-description">{requirements.description}</p>
        )}
        
        <div className="x402-amount">
          <span className="x402-amount-label">Amount:</span>
          <span className="x402-amount-value">{formatZec(requirements.amount_zatoshis)}</span>
        </div>

        <div className="x402-address-section">
          <label className="x402-label">Send to this Zcash address:</label>
          <div className="x402-address-container">
            <code className="x402-address">{requirements.address}</code>
            <button 
              className="x402-copy-btn" 
              onClick={handleCopyAddress}
              title="Copy address"
              type="button"
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
        </div>

        <div className="x402-actions">
          <button className="x402-btn x402-btn-primary" onClick={handleOpenWallet} type="button">
            🔗 Open Wallet App
          </button>
        </div>

        <div className="x402-divider">
          <span>After sending payment</span>
        </div>

        <form onSubmit={handleSubmit} className="x402-form">
          <label className="x402-label" htmlFor="x402-txid">
            Enter Transaction ID:
          </label>
          <input
            id="x402-txid"
            type="text"
            className="x402-input"
            value={txid}
            onChange={e => {
              setTxid(e.target.value);
              setError(null);
            }}
            placeholder="e.g. abc123def456..."
            autoComplete="off"
            spellCheck={false}
          />
          
          {error && <p className="x402-error" role="alert">{error}</p>}
          
          <button 
            type="submit" 
            className="x402-btn x402-btn-submit"
            disabled={!txid.trim() || timeLeft <= 0}
          >
            ✓ Verify Payment
          </button>
        </form>

        <div className="x402-footer">
          <span className={`x402-timer ${timeLeft < 60 ? 'x402-timer-urgent' : ''}`}>
            ⏱️ Expires in {formatTime(timeLeft)}
          </span>
          <span className="x402-network">
            {requirements.network === 'testnet' ? '⚠️ Testnet' : '🔒 Mainnet'}
          </span>
        </div>
      </div>

      <style>{`
        .x402-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          padding: 20px;
          backdrop-filter: blur(4px);
        }
        
        .x402-modal {
          background: linear-gradient(180deg, #1e1e2f 0%, #151520 100%);
          border-radius: 20px;
          padding: 32px;
          max-width: 480px;
          width: 100%;
          position: relative;
          color: #e8e8e8;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.1);
        }
        
        .x402-modal-close {
          position: absolute;
          top: 16px;
          right: 16px;
          background: rgba(255,255,255,0.05);
          border: none;
          color: #888;
          font-size: 22px;
          cursor: pointer;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.2s;
        }
        
        .x402-modal-close:hover {
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
        }
        
        .x402-modal-title {
          margin: 0 0 8px 0;
          font-size: 26px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
        }
        
        .x402-modal-description {
          margin: 0 0 24px 0;
          color: #999;
          font-size: 15px;
          line-height: 1.5;
        }
        
        .x402-amount {
          background: linear-gradient(135deg, rgba(247, 147, 26, 0.15), rgba(247, 147, 26, 0.05));
          border: 1px solid rgba(247, 147, 26, 0.3);
          border-radius: 14px;
          padding: 20px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        
        .x402-amount-label {
          color: #aaa;
          font-size: 14px;
          font-weight: 500;
        }
        
        .x402-amount-value {
          font-size: 32px;
          font-weight: 800;
          color: #f7931a;
          font-family: 'SF Mono', 'Fira Code', Monaco, monospace;
          letter-spacing: -1px;
        }
        
        .x402-label {
          display: block;
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 10px;
          font-weight: 600;
        }
        
        .x402-address-section {
          margin-bottom: 20px;
        }
        
        .x402-address-container {
          display: flex;
          gap: 10px;
        }
        
        .x402-address {
          flex: 1;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 14px;
          font-size: 11px;
          word-break: break-all;
          color: #4ecdc4;
          font-family: 'SF Mono', 'Fira Code', Monaco, monospace;
          line-height: 1.4;
        }
        
        .x402-copy-btn {
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 14px 18px;
          cursor: pointer;
          font-size: 18px;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        
        .x402-copy-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255,255,255,0.2);
        }
        
        .x402-actions {
          margin-bottom: 24px;
        }
        
        .x402-btn {
          width: 100%;
          padding: 16px 24px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
          letter-spacing: 0.3px;
        }
        
        .x402-btn-primary {
          background: linear-gradient(135deg, #f7931a, #e67d00);
          color: #fff;
          box-shadow: 0 4px 15px rgba(247, 147, 26, 0.3);
        }
        
        .x402-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(247, 147, 26, 0.4);
        }
        
        .x402-btn-submit {
          background: linear-gradient(135deg, #4ecdc4, #3ab5ad);
          color: #fff;
          margin-top: 16px;
          box-shadow: 0 4px 15px rgba(78, 205, 196, 0.25);
        }
        
        .x402-btn-submit:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(78, 205, 196, 0.35);
        }
        
        .x402-btn-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }
        
        .x402-divider {
          text-align: center;
          margin: 28px 0;
          position: relative;
        }
        
        .x402-divider::before {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
        }
        
        .x402-divider span {
          background: #1a1a28;
          padding: 0 20px;
          position: relative;
          color: #666;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 500;
        }
        
        .x402-form {
          margin-bottom: 20px;
        }
        
        .x402-input {
          width: 100%;
          padding: 16px 18px;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          color: #fff;
          font-size: 14px;
          font-family: 'SF Mono', 'Fira Code', Monaco, monospace;
          box-sizing: border-box;
          transition: all 0.2s;
        }
        
        .x402-input:focus {
          outline: none;
          border-color: #4ecdc4;
          box-shadow: 0 0 0 4px rgba(78, 205, 196, 0.15);
        }
        
        .x402-input::placeholder {
          color: #555;
        }
        
        .x402-error {
          color: #ff6b6b;
          font-size: 13px;
          margin: 10px 0 0 0;
          padding: 10px 12px;
          background: rgba(255, 107, 107, 0.1);
          border-radius: 8px;
          border: 1px solid rgba(255, 107, 107, 0.2);
        }
        
        .x402-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        
        .x402-timer {
          color: #888;
          font-size: 14px;
          font-family: 'SF Mono', 'Fira Code', Monaco, monospace;
          font-weight: 500;
        }
        
        .x402-timer-urgent {
          color: #ff6b6b;
          animation: x402-pulse 1s infinite;
        }
        
        .x402-network {
          font-size: 13px;
          color: #888;
        }
        
        @keyframes x402-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        @media (max-width: 480px) {
          .x402-modal {
            padding: 24px 20px;
            border-radius: 16px;
            margin: 10px;
          }
          
          .x402-modal-title {
            font-size: 22px;
          }
          
          .x402-amount-value {
            font-size: 26px;
          }
          
          .x402-address {
            font-size: 9px;
            padding: 12px;
          }
        }
      `}</style>
    </div>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for making x402-protected API calls
 */
export function useX402Fetch() {
  const { client } = useX402();
  
  const x402Fetch = useCallback(async (url: string, init?: RequestInit) => {
    if (!client) {
      throw new Error('X402 client not initialized');
    }
    return client.fetch(url, init);
  }, [client]);
  
  return x402Fetch;
}

/**
 * Hook for getting payment requirements without making a request
 */
export function usePaymentInfo(url: string) {
  const [requirements, setRequirements] = useState<PaymentRequirements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    let cancelled = false;
    
    async function fetchPaymentInfo() {
      try {
        setLoading(true);
        const response = await fetch(url, { method: 'HEAD' });
        
        if (cancelled) return;
        
        if (response.status === 402) {
          const jsonHeader = response.headers.get('X-Payment-Required');
          if (jsonHeader) {
            setRequirements(JSON.parse(jsonHeader));
          }
        }
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    
    fetchPaymentInfo();
    
    return () => {
      cancelled = true;
    };
  }, [url]);
  
  return { requirements, loading, error };
}

// Re-export utilities from main module
export { formatZec, generatePaymentUri, isExpired, getTimeRemaining, zatoshisToZec, zecToZatoshis } from './index';
export type { PaymentRequirements, PaymentProof, X402Error } from './index';

export default X402Provider;

