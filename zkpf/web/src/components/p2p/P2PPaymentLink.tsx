/**
 * P2P Payment Link Component
 * 
 * Generate and share payment links from P2P trades.
 * Bridges P2P marketplace with URI payment functionality.
 */

import { useState, useCallback, useEffect } from 'react';
import type { P2POffer, P2PTrade } from '../../types/p2p';
import {
  createPaymentLinkForTrade,
  createPaymentLinkForOffer,
  createCustomPaymentLink,
  copyPaymentLink,
  sharePaymentLink,
  formatPaymentLinkMessage,
  type P2PPaymentLink,
} from '../../utils/p2p-payment-bridge';
import './P2PPaymentLink.css';

interface PaymentLinkGeneratorProps {
  trade?: P2PTrade;
  offer?: P2POffer;
  customAmount?: number;
  customDescription?: string;
  onClose?: () => void;
}

export function PaymentLinkGenerator({
  trade,
  offer,
  customAmount,
  customDescription,
  onClose,
}: PaymentLinkGeneratorProps) {
  const [paymentLink, setPaymentLink] = useState<P2PPaymentLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'link' | 'qr' | 'text'>('link');
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);

  // Generate the payment link on mount
  useEffect(() => {
    let link: P2PPaymentLink;
    
    if (trade) {
      link = createPaymentLinkForTrade(trade);
    } else if (offer) {
      link = createPaymentLinkForOffer(offer);
    } else if (customAmount) {
      link = createCustomPaymentLink(customAmount, customDescription);
    } else {
      return;
    }
    
    setPaymentLink(link);
    
    // Generate QR code URL
    const qrApi = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(link.uri)}&margin=10`;
    setQrCodeUrl(qrApi);
  }, [trade, offer, customAmount, customDescription]);

  const handleCopy = useCallback(async () => {
    if (!paymentLink) return;
    
    const success = await copyPaymentLink(paymentLink);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [paymentLink]);

  const handleShare = useCallback(async () => {
    if (!paymentLink) return;
    await sharePaymentLink(paymentLink);
  }, [paymentLink]);

  const handleDownloadQR = useCallback(() => {
    if (!qrCodeUrl || !paymentLink) return;
    
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `zec-payment-${paymentLink.amountZec}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [qrCodeUrl, paymentLink]);

  if (!paymentLink) {
    return (
      <div className="payment-link-loading">
        <div className="payment-link-spinner" />
        <p>Generating payment link...</p>
      </div>
    );
  }

  const hasNativeShare = typeof navigator.share === 'function';

  return (
    <div className="payment-link-modal">
      {onClose && (
        <button className="payment-link-close" onClick={onClose}>×</button>
      )}
      
      <div className="payment-link-header">
        <span className="payment-link-icon">🔗</span>
        <h2>Payment Link</h2>
        <div className="payment-link-amount">
          <span className="amount-value">{paymentLink.amountZec}</span>
          <span className="amount-unit">ZEC</span>
        </div>
        <p className="payment-link-desc">{paymentLink.description}</p>
      </div>

      {/* Native share button (mobile) */}
      {hasNativeShare && (
        <button className="payment-link-native-share" onClick={handleShare}>
          <span>📱</span>
          Share via...
        </button>
      )}

      {/* Tab navigation */}
      <div className="payment-link-tabs">
        <button 
          className={`payment-tab ${activeTab === 'link' ? 'active' : ''}`}
          onClick={() => setActiveTab('link')}
        >
          🔗 Link
        </button>
        <button 
          className={`payment-tab ${activeTab === 'qr' ? 'active' : ''}`}
          onClick={() => setActiveTab('qr')}
        >
          📱 QR Code
        </button>
        <button 
          className={`payment-tab ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          📝 Message
        </button>
      </div>

      <div className="payment-link-content">
        {/* Link tab */}
        {activeTab === 'link' && (
          <div className="payment-link-section">
            <p className="section-desc">
              Share this link. Anyone who clicks it can claim the ZEC.
            </p>
            <div className="payment-link-box">
              <input 
                type="text" 
                value={paymentLink.uri} 
                readOnly 
                className="payment-link-input"
              />
              <button 
                className={`payment-copy-btn ${copied ? 'copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
            
            <div className="payment-social-share">
              <p className="social-label">Share on:</p>
              <div className="social-buttons">
                <a 
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Sending ${paymentLink.amountZec} ZEC via payment link`)}&url=${encodeURIComponent(paymentLink.uri)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn twitter"
                >
                  𝕏
                </a>
                <a 
                  href={`https://t.me/share/url?url=${encodeURIComponent(paymentLink.uri)}&text=${encodeURIComponent(`ZEC Payment: ${paymentLink.amountZec} ZEC`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn telegram"
                >
                  ✈️
                </a>
                <a 
                  href={`https://wa.me/?text=${encodeURIComponent(formatPaymentLinkMessage(paymentLink))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-btn whatsapp"
                >
                  💬
                </a>
                <a 
                  href={`mailto:?subject=${encodeURIComponent(`ZEC Payment: ${paymentLink.amountZec} ZEC`)}&body=${encodeURIComponent(formatPaymentLinkMessage(paymentLink))}`}
                  className="social-btn email"
                >
                  ✉️
                </a>
              </div>
            </div>
          </div>
        )}

        {/* QR Code tab */}
        {activeTab === 'qr' && (
          <div className="payment-qr-section">
            <p className="section-desc">
              Scan this QR code to receive the payment.
            </p>
            <div className="payment-qr-container">
              {qrCodeUrl ? (
                <img 
                  src={qrCodeUrl} 
                  alt="Payment QR Code" 
                  className="payment-qr-image"
                />
              ) : (
                <div className="payment-qr-loading">
                  <div className="payment-link-spinner" />
                  <p>Generating QR code...</p>
                </div>
              )}
            </div>
            {qrCodeUrl && (
              <button className="payment-download-btn" onClick={handleDownloadQR}>
                ⬇️ Download QR Code
              </button>
            )}
          </div>
        )}

        {/* Message tab */}
        {activeTab === 'text' && (
          <div className="payment-text-section">
            <p className="section-desc">
              Copy this message to share on forums, chats, or anywhere.
            </p>
            <div className="payment-text-box">
              <textarea 
                value={formatPaymentLinkMessage(paymentLink)}
                readOnly
                className="payment-text-area"
                rows={8}
              />
            </div>
            <button 
              className={`payment-copy-btn full ${copied ? 'copied' : ''}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(formatPaymentLinkMessage(paymentLink));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2500);
                } catch {
                  // ignore
                }
              }}
            >
              {copied ? '✓ Copied!' : 'Copy Message'}
            </button>
          </div>
        )}
      </div>

      <div className="payment-link-warning">
        <span className="warning-icon">⚠️</span>
        <span>Anyone with this link can claim the funds. Share carefully!</span>
      </div>
    </div>
  );
}

// Button to trigger payment link generation
interface PaymentLinkButtonProps {
  trade?: P2PTrade;
  offer?: P2POffer;
  amount?: number;
  description?: string;
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'small' | 'medium' | 'large';
}

export function PaymentLinkButton({
  trade,
  offer,
  amount,
  description,
  variant = 'primary',
  size = 'medium',
}: PaymentLinkButtonProps) {
  const [showModal, setShowModal] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  }, []);

  if (variant === 'icon') {
    return (
      <>
        <button 
          className={`payment-link-icon-btn size-${size}`}
          onClick={handleClick}
          title="Generate Payment Link"
        >
          🔗
        </button>
        {showModal && (
          <div className="payment-link-overlay" onClick={() => setShowModal(false)}>
            <div onClick={e => e.stopPropagation()}>
              <PaymentLinkGenerator 
                trade={trade}
                offer={offer}
                customAmount={amount}
                customDescription={description}
                onClose={() => setShowModal(false)}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <button 
        className={`payment-link-btn variant-${variant} size-${size}`}
        onClick={handleClick}
      >
        🔗 {variant === 'secondary' ? 'Payment Link' : 'Generate Payment Link'}
      </button>
      {showModal && (
        <div className="payment-link-overlay" onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()}>
            <PaymentLinkGenerator 
              trade={trade}
              offer={offer}
              customAmount={amount}
              customDescription={description}
              onClose={() => setShowModal(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default PaymentLinkGenerator;

