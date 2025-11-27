import { useState, useEffect, useCallback } from 'react';
import {
  formatZecDisplay,
  loadSentPayments,
  loadReceivedPayments,
  saveSentPayments,
} from './utils';
import type { SentUriPayment, ReceivedUriPayment } from './types';
import './URIPayment.css';

type HistoryTab = 'sent' | 'received';

export function URIPaymentHistory() {
  const [activeTab, setActiveTab] = useState<HistoryTab>('sent');
  const [sentPayments, setSentPayments] = useState<SentUriPayment[]>([]);
  const [receivedPayments, setReceivedPayments] = useState<ReceivedUriPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load payments on mount
  useEffect(() => {
    setSentPayments(loadSentPayments() as SentUriPayment[]);
    setReceivedPayments(loadReceivedPayments() as ReceivedUriPayment[]);
    setIsLoading(false);
  }, []);

  const handleCancelPayment = useCallback(async (payment: SentUriPayment) => {
    if (!confirm('Are you sure you want to cancel this payment? The funds will be returned to your wallet.')) {
      return;
    }

    // In a full implementation, we would:
    // 1. Create a transaction spending the notes back to our own address
    // 2. Broadcast the transaction
    // 3. Update the payment state
    
    // For demo, just update local state
    const updated = sentPayments.map(p => 
      p.id === payment.id ? { ...p, state: 'cancelled' as const } : p
    );
    setSentPayments(updated);
    saveSentPayments(updated);
  }, [sentPayments]);

  const handleCopyUri = useCallback(async (uri: string) => {
    try {
      await navigator.clipboard.writeText(uri);
      // Could add toast notification here
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStateLabel = (state: string) => {
    switch (state) {
      case 'pending':
        return { text: 'Pending', class: 'status-pending' };
      case 'awaiting_finalization':
        return { text: 'Awaiting Claim', class: 'status-pending' };
      case 'ready':
        return { text: 'Ready', class: 'status-ready' };
      case 'finalizing':
        return { text: 'Finalizing', class: 'status-pending' };
      case 'finalized':
        return { text: 'Completed', class: 'status-success' };
      case 'cancelled':
        return { text: 'Cancelled', class: 'status-error' };
      case 'invalid':
        return { text: 'Invalid', class: 'status-error' };
      default:
        return { text: state, class: '' };
    }
  };

  if (isLoading) {
    return (
      <div className="card uri-payment-card">
        <p className="eyebrow">Payment History</p>
        <div className="uri-loading">
          <div className="uri-spinner"></div>
        </div>
      </div>
    );
  }

  const isEmpty = sentPayments.length === 0 && receivedPayments.length === 0;

  return (
    <div className="uri-payment-history">
      <div className="card uri-payment-card">
        <header className="uri-payment-header">
          <div className="uri-payment-icon">📋</div>
          <div>
            <p className="eyebrow">URI Payments</p>
            <h3>Payment History</h3>
          </div>
        </header>

        {isEmpty ? (
          <div className="uri-empty-state">
            <p className="muted">No URI payments yet.</p>
            <p className="muted small">
              Create a payment to send ZEC via a secure message link, 
              or paste a received payment URI to claim funds.
            </p>
          </div>
        ) : (
          <>
            <div className="uri-history-tabs">
              <button
                className={`uri-tab ${activeTab === 'sent' ? 'active' : ''}`}
                onClick={() => setActiveTab('sent')}
              >
                Sent ({sentPayments.length})
              </button>
              <button
                className={`uri-tab ${activeTab === 'received' ? 'active' : ''}`}
                onClick={() => setActiveTab('received')}
              >
                Received ({receivedPayments.length})
              </button>
            </div>

            <div className="uri-history-list">
              {activeTab === 'sent' && (
                <>
                  {sentPayments.length === 0 ? (
                    <p className="muted small center">No sent payments</p>
                  ) : (
                    sentPayments.map(payment => {
                      const stateLabel = getStateLabel(payment.state);
                      return (
                        <div key={payment.id} className="uri-history-item">
                          <div className="uri-history-main">
                            <div className="uri-history-amount outgoing">
                              −{formatZecDisplay(payment.payment.amountZats)} ZEC
                            </div>
                            <div className="uri-history-meta">
                              {payment.payment.description && (
                                <span className="uri-history-desc">
                                  {payment.payment.description}
                                </span>
                              )}
                              <span className="uri-history-date muted small">
                                {formatDate(payment.createdAt)}
                              </span>
                            </div>
                          </div>
                          <div className="uri-history-status">
                            <span className={`uri-status-pill ${stateLabel.class}`}>
                              {stateLabel.text}
                            </span>
                          </div>
                          <div className="uri-history-actions">
                            {payment.state !== 'cancelled' && payment.state !== 'finalized' && (
                              <>
                                <button 
                                  className="tiny-button ghost"
                                  onClick={() => handleCopyUri(payment.payment.uri)}
                                  title="Copy URI"
                                >
                                  📋
                                </button>
                                <button 
                                  className="tiny-button ghost danger"
                                  onClick={() => handleCancelPayment(payment)}
                                  title="Cancel payment"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {activeTab === 'received' && (
                <>
                  {receivedPayments.length === 0 ? (
                    <p className="muted small center">No received payments</p>
                  ) : (
                    receivedPayments.map(payment => {
                      const stateLabel = getStateLabel(payment.state);
                      return (
                        <div key={payment.id} className="uri-history-item">
                          <div className="uri-history-main">
                            <div className="uri-history-amount incoming">
                              +{formatZecDisplay(payment.payment.amountZats)} ZEC
                            </div>
                            <div className="uri-history-meta">
                              {payment.payment.description && (
                                <span className="uri-history-desc">
                                  {payment.payment.description}
                                </span>
                              )}
                              <span className="uri-history-date muted small">
                                {formatDate(payment.receivedAt)}
                              </span>
                            </div>
                          </div>
                          <div className="uri-history-status">
                            <span className={`uri-status-pill ${stateLabel.class}`}>
                              {stateLabel.text}
                            </span>
                          </div>
                          {payment.finalizationTxid && (
                            <div className="uri-history-txid">
                              <code className="tiny">
                                {payment.finalizationTxid.slice(0, 10)}...
                              </code>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

