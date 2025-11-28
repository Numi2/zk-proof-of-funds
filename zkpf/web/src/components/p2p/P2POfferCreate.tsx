/**
 * P2P Offer Creation - Human-friendly offer creation
 * 
 * Trade ZEC for anything - fiat, crypto, goods, services.
 * Simple form, flexible currencies, trust-based.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useP2PMarketplace } from '../../hooks/useP2PMarketplace';
import { useWebZjsContext } from '../../context/WebzjsContext';
import {
  formatZecFromZec,
  TRADING_METHOD_INFO,
  COMMON_CURRENCIES,
  type OfferType,
  type TradingMethod,
  type CreateOfferParams,
  type P2POffer,
} from '../../types/p2p';
import './P2PMarketplace.css';

export function P2POfferCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { state: walletState } = useWebZjsContext();
  const { createOffer, offers, myProfile, registerUser, error, clearError } = useP2PMarketplace();
  
  // Get initial type from URL param
  const initialType = (searchParams.get('type') as OfferType) || 'sell';
  
  // Form state
  const [offerType, setOfferType] = useState<OfferType>(initialType);
  const [zecAmount, setZecAmount] = useState('');
  const [exchangeValue, setExchangeValue] = useState('');
  const [exchangeCurrency, setExchangeCurrency] = useState('USD');
  const [exchangeDescription, setExchangeDescription] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<TradingMethod[]>([]);
  const [location, setLocation] = useState({ city: '', country: '', area: '', meetingPoints: '' });
  const [notes, setNotes] = useState('');
  const [displayName, setDisplayName] = useState('');
  
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [createdOffer, setCreatedOffer] = useState<P2POffer | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  
  const zecAmountNum = parseFloat(zecAmount) || 0;
  
  // Check if currency is a known one or local/custom
  const knownCurrency = useMemo(() => {
    return COMMON_CURRENCIES.find(c => 
      c.code.toLowerCase() === exchangeCurrency.toLowerCase()
    );
  }, [exchangeCurrency]);
  
  const isLocalCurrency = !knownCurrency && exchangeCurrency.trim().length > 0;
  const effectiveCurrency = exchangeCurrency.trim().toUpperCase() || 'USD';
  
  // Get wallet balance
  const walletBalance = useMemo(() => {
    if (!walletState.summary || walletState.activeAccount == null) return 0;
    const accountBalance = walletState.summary.account_balances.find(
      ([id]) => id === walletState.activeAccount
    );
    if (!accountBalance) return 0;
    return (accountBalance[1].sapling_balance + accountBalance[1].orchard_balance) / 100_000_000;
  }, [walletState.summary, walletState.activeAccount]);
  
  // Check if face-to-face is selected
  const isFaceToFace = selectedMethods.includes('face_to_face');
  
  // Toggle trading method
  const toggleMethod = useCallback((method: TradingMethod) => {
    setSelectedMethods(prev => 
      prev.includes(method) 
        ? prev.filter(m => m !== method)
        : [...prev, method]
    );
  }, []);
  
  // Validate and submit
  const handleSubmit = useCallback(async () => {
    setFormError(null);
    
    // Validation
    if (!zecAmount || zecAmountNum <= 0) {
      setFormError('Enter how much ZEC you want to trade');
      return;
    }
    
    if (!exchangeValue.trim()) {
      setFormError('Enter what you want in exchange');
      return;
    }
    
    if (!effectiveCurrency) {
      setFormError('Select or enter a currency');
      return;
    }
    
    if (selectedMethods.length === 0) {
      setFormError('Select at least one trading method');
      return;
    }
    
    if (isFaceToFace && !location.city) {
      setFormError('Enter a city for face-to-face meetups');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Register user if needed
      let profile = myProfile;
      if (!profile) {
        profile = await registerUser(displayName || undefined);
      }
      
      // Create offer
      const params: CreateOfferParams = {
        offerType,
        zecAmount: zecAmountNum,
        exchangeValue: exchangeValue.trim(),
        exchangeCurrency: effectiveCurrency,
        exchangeDescription: exchangeDescription.trim() || undefined,
        tradingMethods: selectedMethods,
        location: isFaceToFace ? {
          city: location.city,
          country: location.country || undefined,
          area: location.area || undefined,
          meetingPoints: location.meetingPoints || undefined,
        } : undefined,
        notes: notes.trim(),
        shieldedAddressCommitment: `0x${Math.random().toString(16).slice(2)}`,
      };
      
      const offerId = await createOffer(params);
      
      // Find the created offer to show share modal
      // We need to wait a tick for the state to update
      setTimeout(() => {
        const newOffer = offers.find(o => o.offerId === offerId);
        if (newOffer) {
          setCreatedOffer(newOffer);
          setShowShareModal(true);
        } else {
          // If we can't find it, just navigate
          navigate(`/p2p/offer/${offerId}`);
        }
      }, 100);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create offer');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    zecAmount, zecAmountNum, exchangeValue, effectiveCurrency,
    selectedMethods, isFaceToFace, location, offerType, myProfile, registerUser,
    displayName, exchangeDescription, notes, createOffer, navigate, offers
  ]);
  
  // Quick amounts
  const quickAmounts = [0.5, 1, 2, 5, 10].filter(
    a => offerType !== 'sell' || a <= walletBalance
  );
  
  // Get currency symbol for display
  const currencySymbol = knownCurrency?.symbol || '';
  
  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  
  return (
    <div className="p2p-page create-page">
      <header className="create-header">
        <button className="back-link" onClick={() => navigate('/p2p')}>
          ← Back to marketplace
        </button>
        <h1>{offerType === 'sell' ? 'Sell ZEC' : 'Buy ZEC'}</h1>
        <p>
          {offerType === 'sell' 
            ? 'Set your price and let people know what you accept'
            : 'Post what you\'re offering to buy ZEC'}
        </p>
      </header>
      
      {/* Type Toggle */}
      <div className="type-toggle">
        <button 
          className={`type-btn ${offerType === 'sell' ? 'active' : ''}`}
          onClick={() => setOfferType('sell')}
        >
          <span>📤</span>
          Sell ZEC
        </button>
        <button 
          className={`type-btn ${offerType === 'buy' ? 'active' : ''}`}
          onClick={() => setOfferType('buy')}
        >
          <span>📥</span>
          Buy ZEC
        </button>
      </div>
      
      {/* Error */}
      {(formError || error) && (
        <div className="form-error-banner">
          <span>⚠️ {formError || error}</span>
          <button onClick={() => { setFormError(null); clearError(); }}>×</button>
        </div>
      )}
      
      <div className="create-form">
        {/* ZEC Amount */}
        <div className="form-section">
          <label className="section-label">
            How much ZEC do you want to {offerType === 'sell' ? 'sell' : 'buy'}?
          </label>
          
          {offerType === 'sell' && walletBalance > 0 && (
            <div className="balance-hint">
              Your balance: {formatZecFromZec(walletBalance)} ZEC
            </div>
          )}
          
          <div className="amount-input">
            <input
              type="number"
              value={zecAmount}
              onChange={(e) => setZecAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.1"
            />
            <span className="amount-suffix">ZEC</span>
          </div>
          
          <div className="quick-amounts">
            {quickAmounts.map(amt => (
              <button 
                key={amt}
                className={`quick-btn ${zecAmountNum === amt ? 'active' : ''}`}
                onClick={() => setZecAmount(String(amt))}
              >
                {amt} ZEC
              </button>
            ))}
            {offerType === 'sell' && walletBalance > 0 && (
              <button 
                className="quick-btn max"
                onClick={() => setZecAmount(String(walletBalance))}
              >
                Max
              </button>
            )}
          </div>
        </div>
        
        {/* Exchange Value */}
        <div className="form-section">
          <label className="section-label">
            in exchange for?
          </label>
          
          <div className="exchange-input-group">
            <div className="exchange-value-input">
              {currencySymbol && <span className="currency-prefix">{currencySymbol}</span>}
              <input
                type="text"
                value={exchangeValue}
                onChange={(e) => setExchangeValue(e.target.value)}
                placeholder="Amount or description"
              />
            </div>
            
            <input 
              type="text"
              className="currency-input"
              value={exchangeCurrency}
              onChange={(e) => setExchangeCurrency(e.target.value.toUpperCase())}
              placeholder="USD"
              maxLength={12}
            />
          </div>
          
          {isLocalCurrency && (
            <div className="local-currency-hint">
              🌍 <span>"{effectiveCurrency}" will be listed as local currency</span>
            </div>
          )}
          
          {/* Optional description */}
          <div className="description-input">
            <input
              type="text"
              value={exchangeDescription}
              onChange={(e) => setExchangeDescription(e.target.value)}
              placeholder="Optional: Add details about what you're offering/accepting"
            />
          </div>
        </div>
        
        {/* Trading Methods */}
        <div className="form-section">
          <label className="section-label">
            How do you want to trade?
          </label>
          
          <div className="selected-methods">
            {selectedMethods.map(method => {
              const info = TRADING_METHOD_INFO[method];
              return (
                <span key={method} className="method-tag">
                  {info.icon} {info.label}
                  <button 
                    className="method-tag-remove"
                    onClick={() => toggleMethod(method)}
                  >×</button>
                </span>
              );
            })}
            <button 
              className="add-method-btn"
              onClick={() => setShowMethodPicker(!showMethodPicker)}
            >
              + Add {selectedMethods.length > 0 ? 'more' : 'method'}
            </button>
          </div>
          
          {showMethodPicker && (
            <div className="method-picker">
              {Object.entries(TRADING_METHOD_INFO)
                .filter(([method]) => !selectedMethods.includes(method as TradingMethod))
                .map(([method, info]) => (
                  <button
                    key={method}
                    className="method-picker-option"
                    onClick={() => {
                      toggleMethod(method as TradingMethod);
                      // Auto-close if this was the last option
                      if (Object.keys(TRADING_METHOD_INFO).length - selectedMethods.length <= 1) {
                        setShowMethodPicker(false);
                      }
                    }}
                  >
                    <span className="method-icon">{info.icon}</span>
                    <span className="method-name">{info.label}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        
        {/* Location (for F2F) */}
        {isFaceToFace && (
          <div className="form-section location-section">
            <label className="section-label">
              📍 Where can you meet?
            </label>
            
            <div className="location-grid">
              <input
                type="text"
                value={location.city}
                onChange={(e) => setLocation(prev => ({ ...prev, city: e.target.value }))}
                placeholder="City *"
                className="location-city"
              />
              <input
                type="text"
                value={location.country}
                onChange={(e) => setLocation(prev => ({ ...prev, country: e.target.value }))}
                placeholder="Country"
                className="location-country"
              />
            </div>
            
            <input
              type="text"
              value={location.area}
              onChange={(e) => setLocation(prev => ({ ...prev, area: e.target.value }))}
              placeholder="Neighborhood or area (optional)"
              className="location-area"
            />
            
            <input
              type="text"
              value={location.meetingPoints}
              onChange={(e) => setLocation(prev => ({ ...prev, meetingPoints: e.target.value }))}
              placeholder="Suggested meeting spots (optional)"
              className="location-spots"
            />
          </div>
        )}
        
        {/* Notes */}
        <div className="form-section">
          <label className="section-label">
            Anything else people should know?
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes, requirements, or instructions..."
            rows={3}
          />
        </div>
        
        {/* Display Name (if not registered) */}
        {!myProfile && (
          <div className="form-section">
            <label className="section-label">
              What should people call you?
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name (optional)"
              className="name-input"
            />
          </div>
        )}
        
        {/* Submit */}
        <div className="form-actions">
          <button className="cancel-btn" onClick={() => navigate('/p2p')}>
            Cancel
          </button>
          <button 
            className="submit-btn"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Post Offer'}
          </button>
        </div>
      </div>
      
      {/* Trust note */}
      <div className="trust-footer">
        <p>
          <strong>Remember:</strong> This is a trust-based marketplace. 
          Start with small trades when dealing with new people. 
          Meet in public places for face-to-face trades.
        </p>
      </div>
      
      {/* Success & Share Modal */}
      {showShareModal && createdOffer && (
        <div className="modal-overlay">
          <div className="modal success-modal">
            <div className="success-header">
              <span className="success-icon">🎉</span>
              <h2>Offer Created!</h2>
              <p>Your offer is live. Share it so people can find it!</p>
            </div>
            
            <div className="success-offer-preview">
              <div className="preview-type">
                {createdOffer.offerType === 'sell' ? '📤 Selling' : '📥 Buying'}
              </div>
              <div className="preview-amounts">
                <span className="preview-zec">{formatZecFromZec(createdOffer.zecAmount)} ZEC</span>
                <span className="preview-arrow">⇄</span>
                <span className="preview-fiat">{createdOffer.exchangeValue} {createdOffer.exchangeCurrency}</span>
              </div>
            </div>
            
            <div className="success-actions">
              <button 
                className="share-now-btn"
                onClick={() => {
                  // Keep the success modal showing and open share modal
                  setShowShareModal(false);
                  // Navigate to the offer detail where they can share
                  navigate(`/p2p/offer/${createdOffer.offerId}`);
                }}
              >
                📤 Share Now
              </button>
              <button 
                className="skip-btn"
                onClick={() => {
                  setShowShareModal(false);
                  navigate(`/p2p/offer/${createdOffer.offerId}`);
                }}
              >
                View Offer →
              </button>
            </div>
            
            <div className="success-tip">
              <p>
                <strong>💡 Tip:</strong> Without sharing, only you can see this offer. 
                Share the link on social media, forums, or directly with potential traders.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default P2POfferCreate;
