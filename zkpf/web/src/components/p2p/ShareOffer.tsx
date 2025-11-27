/**
 * ShareOffer Component
 * 
 * Modal to share P2P offers via link, QR code, or text.
 * Enables offers to be communicated to others without a backend.
 */

import { useState, useEffect, useCallback } from 'react';
import type { P2POffer } from '../../types/p2p';
import {
  getShareableUrl,
  formatOfferAsText,
  generateOfferQRCode,
  copyToClipboard,
  shareOffer,
} from '../../utils/p2p-share';
import './ShareOffer.css';

interface ShareOfferProps {
  offer: P2POffer;
  isOpen: boolean;
  onClose: () => void;
}

type ShareTab = 'link' | 'qr' | 'text';

export function ShareOffer({ offer, isOpen, onClose }: ShareOfferProps) {
  const [activeTab, setActiveTab] = useState<ShareTab>('link');
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [shareText, setShareText] = useState('');
  
  // Generate shareable content
  useEffect(() => {
    if (isOpen && offer) {
      setShareUrl(getShareableUrl(offer));
      setShareText(formatOfferAsText(offer));
      generateOfferQRCode(offer).then(setQrCodeUrl);
    }
  }, [isOpen, offer]);
  
  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);
  
  const handleCopyLink = useCallback(async () => {
    const success = await copyToClipboard(shareUrl);
    if (success) setCopied(true);
  }, [shareUrl]);
  
  const handleCopyText = useCallback(async () => {
    const success = await copyToClipboard(shareText);
    if (success) setCopied(true);
  }, [shareText]);
  
  const handleNativeShare = useCallback(async () => {
    await shareOffer(offer);
  }, [offer]);
  
  const handleDownloadQR = useCallback(() => {
    if (!qrCodeUrl) return;
    
    const link = document.createElement('a');
    link.href = qrCodeUrl;
    link.download = `zec-offer-${offer.offerId.slice(0, 8)}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [qrCodeUrl, offer.offerId]);
  
  if (!isOpen) return null;
  
  const isSelling = offer.offerType === 'sell';
  const hasNativeShare = typeof navigator.share === 'function';
  
  // Defensive: handle potentially missing values
  const zecAmount = offer.zecAmount ?? 0;
  const exchangeValue = offer.exchangeValue ?? '0';
  const exchangeCurrency = offer.exchangeCurrency ?? 'USD';
  
  return (
    <div className="share-overlay" onClick={onClose}>
      <div className="share-modal" onClick={e => e.stopPropagation()}>
        <button className="share-close" onClick={onClose}>×</button>
        
        <div className="share-header">
          <span className="share-icon">📤</span>
          <h2>Share Offer</h2>
          <p className="share-subtitle">
            {isSelling ? 'Selling' : 'Buying'} {zecAmount} ZEC for {exchangeValue} {exchangeCurrency}
          </p>
        </div>
        
        {/* Native share button (mobile) */}
        {hasNativeShare && (
          <button className="share-native-btn" onClick={handleNativeShare}>
            <span>📱</span>
            Share via...
          </button>
        )}
        
        {/* Tab navigation */}
        <div className="share-tabs">
          <button 
            className={`share-tab ${activeTab === 'link' ? 'active' : ''}`}
            onClick={() => setActiveTab('link')}
          >
            🔗 Link
          </button>
          <button 
            className={`share-tab ${activeTab === 'qr' ? 'active' : ''}`}
            onClick={() => setActiveTab('qr')}
          >
            📱 QR Code
          </button>
          <button 
            className={`share-tab ${activeTab === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTab('text')}
          >
            📝 Text
          </button>
        </div>
        
        {/* Tab content */}
        <div className="share-content">
          {/* Link tab */}
          {activeTab === 'link' && (
            <div className="share-link-section">
              <p className="share-description">
                Copy this link to share your offer. Anyone with the link can view the offer details.
              </p>
              <div className="share-link-box">
                <input 
                  type="text" 
                  value={shareUrl} 
                  readOnly 
                  className="share-link-input"
                />
                <button 
                  className={`share-copy-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopyLink}
                >
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
              
              <div className="share-social">
                <p className="share-social-label">Share on:</p>
                <div className="share-social-buttons">
                  <a 
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Check out my ZEC offer: ${isSelling ? 'Selling' : 'Buying'} ${zecAmount} ZEC`)}&url=${encodeURIComponent(shareUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="share-social-btn twitter"
                  >
                    𝕏
                  </a>
                  <a 
                    href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`ZEC P2P: ${isSelling ? 'Selling' : 'Buying'} ${zecAmount} ZEC`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="share-social-btn telegram"
                  >
                    ✈️
                  </a>
                  <a 
                    href={`https://wa.me/?text=${encodeURIComponent(`${isSelling ? 'Selling' : 'Buying'} ${zecAmount} ZEC for ${exchangeValue} ${exchangeCurrency}\n\n${shareUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="share-social-btn whatsapp"
                  >
                    💬
                  </a>
                  <a 
                    href={`mailto:?subject=${encodeURIComponent(`ZEC P2P Offer`)}&body=${encodeURIComponent(shareText)}`}
                    className="share-social-btn email"
                  >
                    ✉️
                  </a>
                </div>
              </div>
            </div>
          )}
          
          {/* QR Code tab */}
          {activeTab === 'qr' && (
            <div className="share-qr-section">
              <p className="share-description">
                Scan this QR code to view the offer on another device.
              </p>
              <div className="share-qr-container">
                {qrCodeUrl ? (
                  <img 
                    src={qrCodeUrl} 
                    alt="Offer QR Code" 
                    className="share-qr-image"
                  />
                ) : (
                  <div className="share-qr-loading">
                    <div className="loader"></div>
                    <p>Generating QR code...</p>
                  </div>
                )}
              </div>
              {qrCodeUrl && (
                <button className="share-download-btn" onClick={handleDownloadQR}>
                  ⬇️ Download QR Code
                </button>
              )}
            </div>
          )}
          
          {/* Text tab */}
          {activeTab === 'text' && (
            <div className="share-text-section">
              <p className="share-description">
                Copy this text to share on forums, chats, or anywhere you communicate.
              </p>
              <div className="share-text-box">
                <textarea 
                  value={shareText}
                  readOnly
                  className="share-text-area"
                  rows={10}
                />
              </div>
              <button 
                className={`share-copy-btn full ${copied ? 'copied' : ''}`}
                onClick={handleCopyText}
              >
                {copied ? '✓ Copied!' : 'Copy Text'}
              </button>
            </div>
          )}
        </div>
        
        <div className="share-footer">
          <p className="share-privacy-note">
            🔒 Offer data is encoded in the link. No server required.
          </p>
        </div>
      </div>
    </div>
  );
}

// Simple share button component
interface ShareButtonProps {
  offer: P2POffer;
  size?: 'small' | 'medium' | 'large';
  variant?: 'icon' | 'button';
}

export function ShareButton({ offer, size = 'medium', variant = 'button' }: ShareButtonProps) {
  const [showModal, setShowModal] = useState(false);
  
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  }, []);
  
  if (variant === 'icon') {
    return (
      <>
        <button 
          className={`share-icon-btn share-icon-${size}`}
          onClick={handleClick}
          title="Share offer"
        >
          📤
        </button>
        <ShareOffer 
          offer={offer} 
          isOpen={showModal} 
          onClose={() => setShowModal(false)} 
        />
      </>
    );
  }
  
  return (
    <>
      <button 
        className={`share-btn share-btn-${size}`}
        onClick={handleClick}
      >
        📤 Share
      </button>
      <ShareOffer 
        offer={offer} 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
      />
    </>
  );
}

export default ShareOffer;

