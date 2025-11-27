/**
 * P2P Offer Detail & Trade Flow
 * 
 * View offer details and manage the trade flow from start to completion.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useP2PMarketplace } from '../../hooks/useP2PMarketplace';
import { useWebZjsContext } from '../../context/WebzjsContext';
import {
  formatZecFromZec,
  formatFiat,
  formatPricePerZec,
  formatExchangeValue,
  getReputationTier,
  getTradeStatusLabel,
  getTradeStatusColor,
  zecToZatoshi,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_ICONS,
  TRADING_METHOD_INFO,
  type P2PTrade,
  type PaymentMethod,
} from '../../types/p2p';
import './P2PMarketplace.css';

// Trade Chat Component
function TradeChat({ 
  trade, 
  onSendMessage,
  myAddress,
}: { 
  trade: P2PTrade; 
  onSendMessage: (content: string) => void;
  myAddress: string;
}) {
  const [message, setMessage] = useState('');
  
  const handleSend = useCallback(() => {
    if (!message.trim()) return;
    onSendMessage(message.trim());
    setMessage('');
  }, [message, onSendMessage]);
  
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  
  return (
    <div className="trade-chat">
      <div className="chat-header">
        <h4>💬 Trade Chat</h4>
        <span className="chat-hint">Communicate securely with your trading partner</span>
      </div>
      
      <div className="chat-messages">
        {trade.messages.length === 0 ? (
          <div className="no-messages">
            <span className="no-msg-icon">💭</span>
            <p>No messages yet. Say hello to start the conversation!</p>
          </div>
        ) : (
          trade.messages.map(msg => (
            <div 
              key={msg.messageId}
              className={`chat-message ${msg.sender === myAddress ? 'mine' : 'theirs'}`}
            >
              <div className="msg-content">{msg.content}</div>
              <div className="msg-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="chat-input-area">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
          rows={2}
        />
        <button 
          className="send-btn" 
          onClick={handleSend}
          disabled={!message.trim()}
        >
          Send →
        </button>
      </div>
    </div>
  );
}

// Trade Flow Component
function TradeFlow({
  trade,
  isSeller,
  isBuyer,
  onDepositEscrow,
  onMarkFiatSent,
  onConfirmFiatReceived,
  onCancelTrade,
  onOpenDispute,
}: {
  trade: P2PTrade;
  isSeller: boolean;
  isBuyer: boolean;
  onDepositEscrow: () => void;
  onMarkFiatSent: (reference: string) => void;
  onConfirmFiatReceived: () => void;
  onCancelTrade: () => void;
  onOpenDispute: (reason: string) => void;
}) {
  const [paymentReference, setPaymentReference] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  const statusColor = getTradeStatusColor(trade.status);
  const statusLabel = getTradeStatusLabel(trade.status);
  
  // Time remaining
  const timeRemaining = useMemo(() => {
    if (!trade.expiresAt) return 'No limit';
    const diff = trade.expiresAt - Date.now();
    if (diff <= 0) return 'Expired';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [trade.expiresAt]);
  
  const handleAction = useCallback(async (action: () => void | Promise<void>) => {
    setActionLoading(true);
    try {
      await action();
    } finally {
      setActionLoading(false);
    }
  }, []);
  
  return (
    <div className="trade-flow">
      {/* Status Header */}
      <div className="trade-status-header" style={{ '--status-color': statusColor } as React.CSSProperties}>
        <div className="status-badge">
          <span className="status-dot"></span>
          {statusLabel}
        </div>
        {!['completed', 'released', 'refunded', 'cancelled'].includes(trade.status) && (
          <div className="time-remaining">
            <span className="time-icon">⏱️</span>
            {timeRemaining}
          </div>
        )}
      </div>
      
      {/* Trade Progress Steps */}
      <div className="trade-progress">
        <div className={`progress-step ${trade.status !== 'pending' ? 'completed' : 'active'}`}>
          <span className="step-icon">🤝</span>
          <span className="step-label">Trade Started</span>
        </div>
        <div className="progress-line"></div>
        <div className={`progress-step ${
          ['escrow_locked', 'fiat_sent', 'completed', 'released'].includes(trade.status) 
            ? 'completed' 
            : trade.status === 'pending' ? 'active' : ''
        }`}>
          <span className="step-icon">🔒</span>
          <span className="step-label">ZEC Locked</span>
        </div>
        <div className="progress-line"></div>
        <div className={`progress-step ${
          ['fiat_sent', 'completed', 'released'].includes(trade.status)
            ? 'completed'
            : trade.status === 'escrow_locked' ? 'active' : ''
        }`}>
          <span className="step-icon">💸</span>
          <span className="step-label">Fiat Sent</span>
        </div>
        <div className="progress-line"></div>
        <div className={`progress-step ${
          ['completed', 'released'].includes(trade.status) ? 'completed' : ''
        }`}>
          <span className="step-icon">✅</span>
          <span className="step-label">Complete</span>
        </div>
      </div>
      
      {/* Action Panel based on status */}
      <div className="trade-action-panel">
        {/* Pending - Seller needs to lock ZEC */}
        {trade.status === 'pending' && isSeller && (
          <div className="action-card seller">
            <h3>🔐 Lock ZEC</h3>
            <p>
              Lock <strong>{formatZecFromZec(trade.zecAmount)} ZEC</strong> securely 
              to proceed with the trade. The funds will be released when you confirm 
              receiving the payment.
            </p>
            <button 
              className="action-btn primary"
              onClick={() => handleAction(onDepositEscrow)}
              disabled={actionLoading}
            >
              {actionLoading ? 'Processing...' : 'Lock ZEC'}
            </button>
          </div>
        )}
        
        {trade.status === 'pending' && isBuyer && (
          <div className="action-card waiting">
            <h3>⏳ Waiting for Seller</h3>
            <p>
              The seller needs to lock the ZEC securely. Once they do, 
              you'll be able to send the fiat payment.
            </p>
            <div className="waiting-animation">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
          </div>
        )}
        
        {/* ZEC Locked - Buyer needs to send payment */}
        {trade.status === 'escrow_locked' && isBuyer && (
          <div className="action-card buyer">
            <h3>💳 Send Payment</h3>
            <div className="payment-details">
              <div className="detail-row">
                <span className="detail-label">Amount to send:</span>
                <span className="detail-value highlight">
                  {trade.fiatAmountCents 
                    ? formatFiat(trade.fiatAmountCents, trade.fiatCurrency || trade.exchangeCurrency)
                    : formatExchangeValue(trade.exchangeValue, trade.exchangeCurrency)
                  }
                </span>
              </div>
              {trade.paymentMethod && (
                <div className="detail-row">
                  <span className="detail-label">Payment method:</span>
                  <span className="detail-value">
                    {PAYMENT_METHOD_ICONS[trade.paymentMethod]} {PAYMENT_METHOD_LABELS[trade.paymentMethod]}
                  </span>
                </div>
              )}
              {!trade.paymentMethod && (
                <div className="detail-row">
                  <span className="detail-label">Trading method:</span>
                  <span className="detail-value">
                    {TRADING_METHOD_INFO[trade.tradingMethod]?.icon} {TRADING_METHOD_INFO[trade.tradingMethod]?.label}
                  </span>
                </div>
              )}
            </div>
            
            <div className="payment-instructions">
              <h4>📋 Payment Instructions</h4>
              <p>{trade.paymentInstructions || 'Contact the seller via chat for payment details.'}</p>
            </div>
            
            <div className="payment-reference-input">
              <label>Payment Reference / Transaction ID</label>
              <input 
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="Enter the payment reference or transaction ID"
              />
            </div>
            
            <button 
              className="action-btn primary"
              onClick={() => handleAction(() => onMarkFiatSent(paymentReference))}
              disabled={actionLoading || !paymentReference.trim()}
            >
              {actionLoading ? 'Processing...' : "I've Sent the Payment"}
            </button>
          </div>
        )}
        
        {trade.status === 'escrow_locked' && isSeller && (
          <div className="action-card waiting">
            <h3>⏳ Waiting for Payment</h3>
            <p>
              Buyer is preparing to send{' '}
              <strong>
                {trade.fiatAmountCents 
                  ? formatFiat(trade.fiatAmountCents, trade.fiatCurrency || trade.exchangeCurrency)
                  : formatExchangeValue(trade.exchangeValue, trade.exchangeCurrency)
                }
              </strong>
              {trade.paymentMethod && (
                <> via <strong>{PAYMENT_METHOD_LABELS[trade.paymentMethod]}</strong></>
              )}.
            </p>
            <p className="notice">
              Make sure to provide your payment details in the chat below.
            </p>
          </div>
        )}
        
        {/* Fiat Sent - Seller needs to confirm receipt */}
        {trade.status === 'fiat_sent' && isSeller && (
          <div className="action-card seller">
            <h3>🔍 Verify Payment Received</h3>
            <p>
              The buyer claims to have sent{' '}
              <strong>
                {trade.fiatAmountCents && trade.fiatCurrency
                  ? formatFiat(trade.fiatAmountCents, trade.fiatCurrency)
                  : formatExchangeValue(trade.exchangeValue, trade.exchangeCurrency)
                }
              </strong>.
              Please verify you received the payment before releasing the ZEC.
            </p>
            {trade.paymentReference && (
              <div className="payment-ref-display">
                <span className="ref-label">Payment Reference:</span>
                <code className="ref-value">{trade.paymentReference}</code>
              </div>
            )}
            <div className="action-buttons">
              <button 
                className="action-btn primary"
                onClick={() => handleAction(onConfirmFiatReceived)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Releasing...' : 'Confirm & Release ZEC'}
              </button>
              <button 
                className="action-btn secondary"
                onClick={() => setShowDispute(true)}
              >
                Open Dispute
              </button>
            </div>
          </div>
        )}
        
        {trade.status === 'fiat_sent' && isBuyer && (
          <div className="action-card waiting">
            <h3>⏳ Awaiting Confirmation</h3>
            <p>
              You've marked the payment as sent. Waiting for the seller to verify 
              and release the ZEC.
            </p>
            {trade.paymentReference && (
              <div className="payment-ref-display">
                <span className="ref-label">Your Payment Reference:</span>
                <code className="ref-value">{trade.paymentReference}</code>
              </div>
            )}
            <p className="notice warning">
              If the seller doesn't respond within the time limit, you can open a dispute.
            </p>
            <button 
              className="action-btn secondary"
              onClick={() => setShowDispute(true)}
            >
              Open Dispute
            </button>
          </div>
        )}
        
        {/* Completed */}
        {(trade.status === 'completed' || trade.status === 'released') && (
          <div className="action-card success">
            <span className="success-icon">🎉</span>
            <h3>Trade Completed!</h3>
            <p>
              {isBuyer 
                ? `You received ${formatZecFromZec(trade.zecAmount)} ZEC`
                : `You received ${trade.fiatAmountCents 
                    ? formatFiat(trade.fiatAmountCents, trade.fiatCurrency || trade.exchangeCurrency)
                    : formatExchangeValue(trade.exchangeValue, trade.exchangeCurrency)
                  }`
              }
            </p>
            <div className="completion-time">
              Completed at {new Date(trade.completedAt || Date.now()).toLocaleString()}
            </div>
          </div>
        )}
        
        {/* Disputed */}
        {trade.status === 'disputed' && (
          <div className="action-card dispute">
            <span className="dispute-icon">⚖️</span>
            <h3>Trade Under Dispute</h3>
            <p>
              This trade is being reviewed by our dispute resolution team.
              Resolution typically takes 24-72 hours.
            </p>
            {trade.disputeReason && (
              <div className="dispute-reason">
                <span className="reason-label">Reason:</span>
                <p>{trade.disputeReason}</p>
              </div>
            )}
          </div>
        )}
        
        {/* Cancelled */}
        {trade.status === 'cancelled' && (
          <div className="action-card cancelled">
            <span className="cancelled-icon">❌</span>
            <h3>Trade Cancelled</h3>
            <p>This trade has been cancelled. No funds were exchanged.</p>
          </div>
        )}
        
        {/* Refunded */}
        {trade.status === 'refunded' && (
          <div className="action-card refunded">
            <span className="refunded-icon">↩️</span>
            <h3>Trade Refunded</h3>
            <p>
              The locked ZEC has been returned to the seller following 
              dispute resolution.
            </p>
          </div>
        )}
      </div>
      
      {/* Dispute Modal */}
      {showDispute && (
        <div className="dispute-modal-overlay" onClick={() => setShowDispute(false)}>
          <div className="dispute-modal" onClick={e => e.stopPropagation()}>
            <h3>⚖️ Open Dispute</h3>
            <p>
              Please describe the issue you're experiencing. Our team will 
              review and resolve the dispute.
            </p>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Explain what happened and why you're opening this dispute..."
              rows={4}
            />
            <div className="modal-actions">
              <button 
                className="cancel-btn"
                onClick={() => setShowDispute(false)}
              >
                Cancel
              </button>
              <button 
                className="submit-dispute-btn"
                onClick={() => {
                  onOpenDispute(disputeReason);
                  setShowDispute(false);
                }}
                disabled={!disputeReason.trim()}
              >
                Submit Dispute
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Cancel Button (only in pending state) */}
      {trade.status === 'pending' && (
        <button 
          className="cancel-trade-btn"
          onClick={() => handleAction(onCancelTrade)}
          disabled={actionLoading}
        >
          Cancel Trade
        </button>
      )}
    </div>
  );
}

export function P2POfferDetail() {
  const { offerId } = useParams<{ offerId: string }>();
  const navigate = useNavigate();
  const { state: walletState } = useWebZjsContext();
  
  const {
    selectedOffer,
    fetchOffer,
    activeTrade,
    initiateTrade,
    depositEscrow,
    markFiatSent,
    confirmFiatReceived,
    cancelTrade,
    openDispute,
    sendMessage,
    myProfile,
    registerUser,
    error,
    clearError,
  } = useP2PMarketplace();
  
  const [loading, setLoading] = useState(true);
  const [tradeAmount, setTradeAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethod | null>(null);
  const [isInitiating, setIsInitiating] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  
  const isWalletConnected = walletState.activeAccount != null;
  const myAddress = myProfile?.address || '';
  
  // Fetch offer on mount
  useEffect(() => {
    if (offerId) {
      setLoading(true);
      fetchOffer(offerId).finally(() => setLoading(false));
    }
  }, [offerId, fetchOffer]);
  
  const offer = selectedOffer;
  
  // Determine user role in trade
  const isSeller = activeTrade?.seller === myAddress;
  const isBuyer = activeTrade?.buyer === myAddress;
  const isInTrade = activeTrade !== null && (isSeller || isBuyer);
  
  // Calculate trade amount
  const tradeAmountNum = parseFloat(tradeAmount) || 0;
  const tradeAmountZatoshi = Math.floor(tradeAmountNum * 100_000_000);
  const tradeFiatCents = offer && offer.pricePerZecCents
    ? Math.floor(tradeAmountNum * offer.pricePerZecCents)
    : 0;
  
  // Validate trade amount
  const minZatoshi = offer?.minTradeZatoshi ?? zecToZatoshi(offer?.minTradeZec ?? 0);
  const maxZatoshi = offer?.maxTradeZatoshi ?? zecToZatoshi(offer?.maxTradeZec ?? offer?.zecAmount ?? 0);
  const offerZatoshi = offer?.zecAmountZatoshi ?? zecToZatoshi(offer?.zecAmount ?? 0);
  const isValidTradeAmount = offer && tradeAmountZatoshi >= minZatoshi && 
    tradeAmountZatoshi <= maxZatoshi &&
    tradeAmountZatoshi <= offerZatoshi;
  
  // Handle initiating a trade
  const handleInitiateTrade = useCallback(async () => {
    if (!offer || !isValidTradeAmount) return;
    // Only require payment method if offer has payment methods defined
    if (offer.paymentMethods && offer.paymentMethods.length > 0 && !selectedPaymentMethod) return;
    
    if (!isWalletConnected) {
      navigate('/wallet');
      return;
    }
    
    setIsInitiating(true);
    
    try {
      // Register user if needed and get the profile to pass to initiateTrade
      // This avoids stale closure issues where myProfile would be null
      let profileToUse = myProfile;
      if (!profileToUse) {
        profileToUse = await registerUser();
      }
      
      await initiateTrade({
        offerId: offer.offerId,
        zecAmount: tradeAmountNum,
        buyerShieldedCommitment: `0x${Math.random().toString(16).slice(2)}`,
        ...(selectedPaymentMethod && { paymentMethod: selectedPaymentMethod }),
      }, profileToUse);
      
      setShowTradeModal(false);
    } catch (err) {
      console.error('Failed to initiate trade:', err);
    } finally {
      setIsInitiating(false);
    }
  }, [
    offer, 
    isValidTradeAmount, 
    selectedPaymentMethod, 
    isWalletConnected,
    myProfile,
    registerUser,
    initiateTrade,
    tradeAmountNum,
    navigate,
  ]);
  
  // Handler for locking ZEC
  const handleDepositEscrow = useCallback(async () => {
    if (!activeTrade) return;
    await depositEscrow(activeTrade.tradeId, `escrow-${Date.now()}`);
  }, [activeTrade, depositEscrow]);
  
  // Handler for marking fiat sent
  const handleMarkFiatSent = useCallback(async (reference: string) => {
    if (!activeTrade) return;
    await markFiatSent(activeTrade.tradeId, reference);
  }, [activeTrade, markFiatSent]);
  
  // Handler for confirming fiat received
  const handleConfirmFiatReceived = useCallback(async () => {
    if (!activeTrade) return;
    await confirmFiatReceived(activeTrade.tradeId);
  }, [activeTrade, confirmFiatReceived]);
  
  // Handler for canceling trade
  const handleCancelTrade = useCallback(async () => {
    if (!activeTrade) return;
    await cancelTrade(activeTrade.tradeId);
  }, [activeTrade, cancelTrade]);
  
  // Handler for opening dispute
  const handleOpenDispute = useCallback(async (reason: string) => {
    if (!activeTrade) return;
    await openDispute(activeTrade.tradeId, reason);
  }, [activeTrade, openDispute]);
  
  // Handler for sending chat message
  const handleSendMessage = useCallback((content: string) => {
    if (!activeTrade) return;
    sendMessage(activeTrade.tradeId, content);
  }, [activeTrade, sendMessage]);
  
  if (loading) {
    return (
      <div className="p2p-offer-detail loading">
        <div className="loader"></div>
        <p>Loading offer...</p>
      </div>
    );
  }
  
  if (!offer) {
    return (
      <div className="p2p-offer-detail not-found">
        <span className="not-found-icon">🔍</span>
        <h2>Offer Not Found</h2>
        <p>This offer may have been cancelled or completed.</p>
        <button onClick={() => navigate('/p2p')}>
          Browse Offers
        </button>
      </div>
    );
  }
  
  const tier = getReputationTier(offer.makerProfile);
  const isSelling = offer.offerType === 'sell';
  
  return (
    <div className="p2p-offer-detail">
      {/* Header */}
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/p2p')}>
          ← Back to Marketplace
        </button>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="p2p-error">
          <span className="error-icon">⚠️</span>
          <span>{error}</span>
          <button className="dismiss-error" onClick={clearError}>×</button>
        </div>
      )}
      
      {/* Active Trade View */}
      {isInTrade && activeTrade && (
        <div className="active-trade-section">
          <TradeFlow
            trade={activeTrade}
            isSeller={isSeller}
            isBuyer={isBuyer}
            onDepositEscrow={handleDepositEscrow}
            onMarkFiatSent={handleMarkFiatSent}
            onConfirmFiatReceived={handleConfirmFiatReceived}
            onCancelTrade={handleCancelTrade}
            onOpenDispute={handleOpenDispute}
          />
          
          <TradeChat
            trade={activeTrade}
            onSendMessage={handleSendMessage}
            myAddress={myAddress}
          />
        </div>
      )}
      
      {/* Offer Details (when not in active trade) */}
      {!isInTrade && (
        <div className="offer-detail-content">
          {/* Offer Card */}
          <div className="offer-detail-card">
            <div className="offer-detail-header">
              <div className={`offer-type-badge large ${isSelling ? 'sell' : 'buy'}`}>
                {isSelling ? '🛒 Selling ZEC' : '💸 Buying ZEC'}
              </div>
              <div className="offer-created">
                Posted {new Date(offer.createdAt).toLocaleDateString()}
              </div>
            </div>
            
            {/* Amounts */}
            <div className="offer-detail-amounts">
              <div className="amount-block zec">
                <span className="amount-label">Amount</span>
                <span className="amount-value">{formatZecFromZec(offer.zecAmount)}</span>
                <span className="amount-unit">ZEC</span>
              </div>
              <div className="amount-arrow">⇄</div>
              <div className="amount-block fiat">
                <span className="amount-label">For</span>
                <span className="amount-value">
                  {offer.fiatAmountCents 
                    ? formatFiat(offer.fiatAmountCents, offer.fiatCurrency || offer.exchangeCurrency)
                    : formatExchangeValue(offer.exchangeValue, offer.exchangeCurrency)
                  }
                </span>
                <span className="amount-unit">{offer.fiatCurrency || offer.exchangeCurrency}</span>
              </div>
            </div>
            
            {offer.pricePerZecCents && offer.fiatCurrency && (
              <div className="offer-price-highlight">
                <span className="price-label">Price:</span>
                <span className="price-value">{formatPricePerZec(offer.pricePerZecCents, offer.fiatCurrency)}</span>
              </div>
            )}
            
            {/* Details */}
            <div className="offer-detail-info">
              {(offer.minTradeZec || offer.minTradeZatoshi) && (
                <div className="info-row">
                  <span className="info-label">Trade limits</span>
                  <span className="info-value">
                    {formatZecFromZec(offer.minTradeZec ?? (offer.minTradeZatoshi ? offer.minTradeZatoshi / 100_000_000 : 0), 2)} - {formatZecFromZec(offer.maxTradeZec ?? (offer.maxTradeZatoshi ? offer.maxTradeZatoshi / 100_000_000 : offer.zecAmount), 2)} ZEC
                  </span>
                </div>
              )}
              {offer.paymentWindow && (
                <div className="info-row">
                  <span className="info-label">Payment window</span>
                  <span className="info-value">{offer.paymentWindow} minutes</span>
                </div>
              )}
              <div className="info-row">
                <span className="info-label">Completed trades</span>
                <span className="info-value">{offer.completedTrades}</span>
              </div>
            </div>
            
            {/* Trading Methods */}
            <div className="offer-payment-section">
              <h4>Trading Methods</h4>
              <div className="payment-methods-list">
                {offer.tradingMethods.map(tm => (
                  <span key={tm} className="payment-tag">
                    {TRADING_METHOD_INFO[tm]?.icon} {TRADING_METHOD_INFO[tm]?.label}
                  </span>
                ))}
              </div>
            </div>
            
            {/* Payment Methods (if any) */}
            {offer.paymentMethods && offer.paymentMethods.length > 0 && (
              <div className="offer-payment-section">
                <h4>Payment Methods</h4>
                <div className="payment-methods-list">
                  {offer.paymentMethods.map(pm => (
                    <span key={pm} className="payment-tag">
                      {PAYMENT_METHOD_ICONS[pm]} {PAYMENT_METHOD_LABELS[pm]}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Terms or Notes */}
            {(offer.terms || offer.notes) && (
              <div className="offer-terms-section">
                <h4>📝 Terms & Instructions</h4>
                <p>{offer.terms || offer.notes}</p>
              </div>
            )}
            
            {/* Trade Button */}
            {offer.status === 'active' && (
              <button 
                className={`start-trade-btn ${isSelling ? 'buy' : 'sell'}`}
                onClick={() => setShowTradeModal(true)}
              >
                {isSelling ? 'Buy from this offer' : 'Sell to this offer'}
              </button>
            )}
          </div>
          
          {/* Maker Profile */}
          <div className="maker-profile-card">
            <div className="maker-header">
              <div className="maker-avatar large">
                {offer.makerProfile.displayName?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="maker-identity">
                <h3>
                  {offer.makerProfile.displayName || offer.maker}
                  {offer.makerProfile.isVerified && <span className="verified-badge">✓</span>}
                </h3>
                <span className={`reputation-tier tier-${tier.toLowerCase()}`}>{tier}</span>
              </div>
            </div>
            
            <div className="maker-stats-grid">
              <div className="stat-item">
                <span className="stat-value">{offer.makerProfile.totalTrades}</span>
                <span className="stat-label">Trades</span>
              </div>
              <div className="stat-item success">
                <span className="stat-value">{offer.makerProfile.successRate}%</span>
                <span className="stat-label">Success</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{formatZecFromZec(offer.makerProfile.totalVolumeZec, 0)}</span>
                <span className="stat-label">Volume</span>
              </div>
            </div>
            
            <div className="maker-meta">
              <div className="meta-item">
                <span className="meta-label">Member since</span>
                <span className="meta-value">
                  {new Date(offer.makerProfile.registeredAt).toLocaleDateString()}
                </span>
              </div>
              {(offer.makerProfile.disputesWon !== undefined || offer.makerProfile.disputesLost !== undefined) && (
                <div className="meta-item">
                  <span className="meta-label">Disputes won/lost</span>
                  <span className="meta-value">
                    {offer.makerProfile.disputesWon ?? 0}/{offer.makerProfile.disputesLost ?? 0}
                  </span>
                </div>
              )}
              {offer.makerProfile.avgTradeTimeMinutes && (
                <div className="meta-item">
                  <span className="meta-label">Avg. trade time</span>
                  <span className="meta-value">{offer.makerProfile.avgTradeTimeMinutes} min</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Trade Modal */}
      {showTradeModal && offer && (
        <div className="trade-modal-overlay" onClick={() => setShowTradeModal(false)}>
          <div className="trade-modal" onClick={e => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowTradeModal(false)}>×</button>
            
            <h2>{isSelling ? 'Buy ZEC' : 'Sell ZEC'}</h2>
            <p className="modal-subtitle">
              {isSelling 
                ? `Trading with ${offer.makerProfile.displayName || 'Seller'}`
                : `Trading with ${offer.makerProfile.displayName || 'Buyer'}`
              }
            </p>
            
            <div className="trade-form">
              {/* Amount Input */}
              <div className="form-group">
                <label>Amount to trade</label>
                <div className="amount-input-wrapper">
                  <input
                    type="number"
                    value={tradeAmount}
                    onChange={(e) => setTradeAmount(e.target.value)}
                    placeholder="0.00"
                    min={offer.minTradeZec ?? (offer.minTradeZatoshi ? offer.minTradeZatoshi / 100_000_000 : 0)}
                    max={offer.maxTradeZec ?? (offer.maxTradeZatoshi ? offer.maxTradeZatoshi / 100_000_000 : offer.zecAmount)}
                    step="0.1"
                  />
                  <span className="input-suffix">ZEC</span>
                </div>
                <div className="amount-limits">
                  Limits: {formatZecFromZec(offer.minTradeZec ?? (offer.minTradeZatoshi ? offer.minTradeZatoshi / 100_000_000 : 0), 2)} - {formatZecFromZec(offer.maxTradeZec ?? (offer.maxTradeZatoshi ? offer.maxTradeZatoshi / 100_000_000 : offer.zecAmount), 2)} ZEC
                </div>
              </div>
              
              {/* Fiat Preview */}
              {tradeAmountNum > 0 && offer.fiatCurrency && (
                <div className="trade-preview">
                  <span className="preview-label">You {isSelling ? 'pay' : 'receive'}:</span>
                  <span className="preview-value">
                    {formatFiat(tradeFiatCents, offer.fiatCurrency)}
                  </span>
                </div>
              )}
              
              {/* Payment Method Selection */}
              {offer.paymentMethods && offer.paymentMethods.length > 0 && (
                <div className="form-group">
                  <label>Payment method</label>
                  <div className="payment-method-select">
                    {offer.paymentMethods.map(pm => (
                      <button
                        key={pm}
                        type="button"
                        className={`pm-option ${selectedPaymentMethod === pm ? 'selected' : ''}`}
                        onClick={() => setSelectedPaymentMethod(pm)}
                      >
                        {PAYMENT_METHOD_ICONS[pm]} {PAYMENT_METHOD_LABELS[pm]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Warning */}
              <div className="trade-warning">
                <span className="warning-icon">⚠️</span>
                <p>
                  Only trade if you understand the process. Never send payment 
                  before ZEC is locked. Report any issues immediately.
                </p>
              </div>
              
              {/* Submit */}
              <button
                className="submit-trade-btn"
                onClick={handleInitiateTrade}
                disabled={!isValidTradeAmount || (offer.paymentMethods && offer.paymentMethods.length > 0 && !selectedPaymentMethod) || isInitiating}
              >
                {isInitiating ? 'Starting trade...' : 'Start Trade'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default P2POfferDetail;

