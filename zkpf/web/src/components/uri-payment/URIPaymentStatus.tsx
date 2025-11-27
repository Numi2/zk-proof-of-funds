import { useState, useEffect } from 'react';
import { formatZecDisplay, getStatusText, getStatusColor } from './utils';
import type { UriPayment, UriPaymentStatus as PaymentStatus } from './types';
import './URIPayment.css';

interface URIPaymentStatusProps {
  payment: UriPayment;
  onFinalize?: () => void;
  onCancel?: () => void;
  isSender?: boolean;
}

export function URIPaymentStatus({ 
  payment, 
  onFinalize, 
  onCancel,
  isSender = false 
}: URIPaymentStatusProps) {
  const [status, setStatus] = useState<PaymentStatus>({
    state: 'pending',
    canFinalize: false,
    isFinalized: false,
  });
  const [isChecking, setIsChecking] = useState(true);

  // Poll for status updates
  useEffect(() => {
    const checkStatus = async () => {
      setIsChecking(true);
      
      try {
        // In a full implementation, we would:
        // 1. Derive the address from the payment key
        // 2. Query the blockchain for notes
        // 3. Check if notes are spent (finalized)
        // 4. Count confirmations
        
        // Simulate status check
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // For demo, assume status based on time elapsed
        // In reality, this would come from blockchain queries
        setStatus({
          state: 'ready',
          confirmations: 12,
          canFinalize: !isSender,
          isFinalized: false,
        });
        
      } catch (err) {
        console.error('Status check failed:', err);
      } finally {
        setIsChecking(false);
      }
    };

    checkStatus();
    
    // Poll every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [payment, isSender]);

  return (
    <div className="uri-payment-status-card">
      <div className="uri-status-header">
        <div className="uri-status-amount">
          <span className={isSender ? 'outgoing' : 'incoming'}>
            {isSender ? '−' : '+'}{formatZecDisplay(payment.amountZats)} ZEC
          </span>
        </div>
        {payment.description && (
          <span className="uri-status-description muted small">
            {payment.description}
          </span>
        )}
      </div>

      <div className={`uri-status-badge ${getStatusColor(status.state)}`}>
        {isChecking ? (
          <>
            <span className="uri-mini-spinner"></span>
            Checking...
          </>
        ) : (
          getStatusText(status)
        )}
      </div>

      {status.confirmations !== undefined && status.confirmations > 0 && (
        <div className="uri-status-confirmations">
          <span className="muted small">
            {status.confirmations} confirmation{status.confirmations !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      <div className="uri-status-actions">
        {!isSender && status.canFinalize && onFinalize && (
          <button onClick={onFinalize} className="small">
            Finalize
          </button>
        )}
        {isSender && !status.isFinalized && status.state !== 'cancelled' && onCancel && (
          <button onClick={onCancel} className="ghost small">
            Cancel Payment
          </button>
        )}
      </div>
    </div>
  );
}

