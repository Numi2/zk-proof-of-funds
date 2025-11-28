/**
 * P2P Marketplace - Human-friendly peer-to-peer trading
 * 
 * Trade ZEC for anything - fiat, crypto, goods, services.
 * Meet in person or online. Simple. Trust-based.
 */

import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useP2PMarketplace } from '../../hooks/useP2PMarketplace';
import {
  formatZecFromZec,
  formatExchangeValue,
  getReputationBadge,
  timeAgo,
  TRADING_METHOD_INFO,
  type P2POffer,
  type OfferType,
  type TradingMethod,
  type OfferSortBy,
} from '../../types/p2p';
import { ShareButton } from './ShareOffer';
import './P2PMarketplace.css';

// ============ Offer Card ============
function OfferCard({
  offer,
  onSelect,
  onStartTrade,
}: {
  offer: P2POffer;
  onSelect: (offer: P2POffer) => void;
  onStartTrade?: (offer: P2POffer) => void;
}) {
  const isSelling = offer.offerType === 'sell';
  
  // Defensive: create a default profile if makerProfile is missing
  const makerProfile = offer.makerProfile ?? {
    address: offer.maker || 'unknown',
    displayName: undefined,
    totalTrades: 0,
    successfulTrades: 0,
    totalVolumeZec: 0,
    successRate: 0,
    registeredAt: offer.createdAt || Date.now(),
    lastActiveAt: offer.createdAt || Date.now(),
    isVerified: false,
  };
  
  const badge = getReputationBadge(makerProfile);
  const isOnline = Date.now() - (makerProfile.lastActiveAt || 0) < 300000;
  
  // Find primary trading method
  const primaryMethod = offer.tradingMethods?.[0] || 'other';
  const methodInfo = TRADING_METHOD_INFO[primaryMethod] || TRADING_METHOD_INFO['other'];
  
  return (
    <article className="offer-card" onClick={() => onSelect(offer)}>
      <div className="offer-card-top">
        <div className="offer-user">
          <div className={`user-avatar ${isOnline ? 'online' : ''}`}>
            {makerProfile.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="user-info">
            <span className="user-name">
              {makerProfile.displayName || 'Anonymous'}
              {makerProfile.isVerified && <span className="verified">✓</span>}
            </span>
            <span className="user-meta">
              {makerProfile.totalTrades ?? 0} trades · {timeAgo(makerProfile.lastActiveAt || Date.now())}
            </span>
          </div>
        </div>
        <span className={`badge badge-${badge.color}`}>{badge.label}</span>
      </div>
      
      <div className="offer-card-main">
        <div className="offer-exchange">
          <div className="exchange-side zec">
            <span className="exchange-amount">{formatZecFromZec(offer.zecAmount)}</span>
            <span className="exchange-label">ZEC</span>
          </div>
          <div className="exchange-arrow">
            {isSelling ? '→' : '←'}
          </div>
          <div className="exchange-side other">
            <span className="exchange-amount">
              {formatExchangeValue(offer.exchangeValue, offer.exchangeCurrency)}
            </span>
            <span className="exchange-label">{offer.exchangeCurrency}</span>
          </div>
        </div>
        
        {offer.exchangeDescription && (
          <p className="offer-description">{offer.exchangeDescription}</p>
        )}
      </div>
      
      <div className="offer-card-bottom">
        <div className="offer-methods">
          <span className="method-primary" title={methodInfo.description}>
            {methodInfo.icon} {methodInfo.label}
          </span>
          {(offer.tradingMethods?.length ?? 0) > 1 && (
            <span className="method-more">+{(offer.tradingMethods?.length ?? 1) - 1}</span>
          )}
        </div>
        
        {offer.location?.city && (
          <span className="offer-location">
            📍 {offer.location.city}{offer.location.country ? `, ${offer.location.country}` : ''}
          </span>
        )}
        
        <div className="offer-card-actions">
          <ShareButton offer={offer} variant="icon" size="small" />
          <button
            className={`offer-action ${isSelling ? 'buy' : 'sell'}`}
            onClick={(e) => {
              // Don’t double-trigger the card click; this button is the
              // one-click “Start trade + open chat” CTA. It navigates to
              // the offer detail view with query params that auto-open
              // the trade modal and pre-fill an amount.
              e.stopPropagation();
              if (onStartTrade) {
                onStartTrade(offer);
              } else {
                onSelect(offer);
              }
            }}
          >
            {isSelling ? 'Inspect' : 'Inspect'}
          </button>
        </div>
      </div>
    </article>
  );
}

// ============ Quick Create Modal ============
function QuickCreateModal({ 
  isOpen, 
  onClose, 
  onNavigateToCreate 
}: { 
  isOpen: boolean; 
  onClose: () => void;
  onNavigateToCreate: (type: OfferType) => void;
}) {
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal quick-create-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>What would you like to do?</h2>
        
        <div className="quick-options">
          <button 
            className="quick-option sell"
            onClick={() => onNavigateToCreate('sell')}
          >
            <span className="option-icon">📤</span>
            <span className="option-title">Sell ZEC</span>

          </button>
          
          <button 
            className="quick-option buy"
            onClick={() => onNavigateToCreate('buy')}
          >
            <span className="option-icon">📥</span>
            <span className="option-title">Buy ZEC</span>

          </button>
        </div>
        
        
      </div>
    </div>
  );
}

// ============ Import Offer Modal ============
function ImportOfferModal({ 
  isOpen, 
  onClose, 
  onImport 
}: { 
  isOpen: boolean; 
  onClose: () => void;
  onImport: (url: string) => boolean;
}) {
  const [importUrl, setImportUrl] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  
  const handleImport = () => {
    setImportError(null);
    setImportSuccess(false);
    
    if (!importUrl.trim()) {
      setImportError('Please paste a share link');
      return;
    }
    
    const success = onImport(importUrl.trim());
    if (success) {
      setImportSuccess(true);
      setImportUrl('');
      setTimeout(() => {
        onClose();
        setImportSuccess(false);
      }, 1500);
    } else {
      setImportError('Invalid share link. Make sure you copied the full URL.');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>📥 Import an Offer</h2>
        <p className="import-subtitle">
          Paste a shared offer link to view and trade with it
        </p>
        
        <div className="import-input-group">
          <input
            type="text"
            value={importUrl}
            onChange={(e) => {
              setImportUrl(e.target.value);
              setImportError(null);
            }}
            placeholder="Paste offer link here (e.g., https://...?share=...)"
            className="import-input"
          />
        </div>
        
        {importError && (
          <div className="import-error">
            <span>⚠️</span> {importError}
          </div>
        )}
        
        {importSuccess && (
          <div className="import-success">
            <span>✓</span> Offer imported successfully!
          </div>
        )}
        
        <button 
          className="import-btn"
          onClick={handleImport}
          disabled={!importUrl.trim()}
        >
          Import Offer
        </button>
        
        <div className="import-help">
          <p>
            <strong>How it works:</strong> When someone shares an offer with you, 
            they'll give you a link. Paste that link here to view and respond to their offer.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============ Main Marketplace ============
export function P2PMarketplace() {
  const navigate = useNavigate();
  const {
    filteredOffers,
    loadingOffers,
    sortBy,
    setSortBy,
    selectOffer,
    importOfferFromUrl,
    broadcastStatus,
  } = useP2PMarketplace();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'sell' | 'buy'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<TradingMethod[]>([]);
  
  // Filter offers
  const displayOffers = useMemo(() => {
    let offers = filteredOffers;
    
    // Filter out 0 ZEC offers
    offers = offers.filter(o => o.zecAmount > 0);
    
    // Tab filter
    if (activeTab !== 'all') {
      offers = offers.filter(o => o.offerType === activeTab);
    }
    
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      offers = offers.filter(o => 
        o.exchangeCurrency?.toLowerCase().includes(q) ||
        o.exchangeDescription?.toLowerCase().includes(q) ||
        o.makerProfile?.displayName?.toLowerCase().includes(q) ||
        o.location?.city?.toLowerCase().includes(q) ||
        o.location?.country?.toLowerCase().includes(q) ||
        o.notes?.toLowerCase().includes(q)
      );
    }
    
    // Method filter
    if (selectedMethods.length > 0) {
      offers = offers.filter(o => 
        o.tradingMethods?.some(m => selectedMethods.includes(m))
      );
    }
    
    return offers;
  }, [filteredOffers, activeTab, searchQuery, selectedMethods]);
  
  const handleOfferSelect = useCallback((offer: P2POffer) => {
    selectOffer(offer);
    navigate(`/p2p/offer/${offer.offerId}`);
  }, [selectOffer, navigate]);

  const handleStartTrade = useCallback((offer: P2POffer) => {
    selectOffer(offer);
    // Pre-fill the trade amount with a sensible default: use the minimum
    // if specified, otherwise the full offer amount.
    const defaultAmount = offer.minTradeZec ?? (offer.minTradeZatoshi ? offer.minTradeZatoshi / 100_000_000 : offer.zecAmount);
    const amountParam = Number.isFinite(defaultAmount) ? `&amount=${encodeURIComponent(String(defaultAmount))}` : '';
    navigate(`/p2p/offer/${offer.offerId}?trade=1${amountParam}`);
  }, [selectOffer, navigate]);
  
  const handleCreateOffer = useCallback((type: OfferType) => {
    setShowCreateModal(false);
    navigate(`/p2p/create?type=${type}`);
  }, [navigate]);
  
  const toggleMethod = (method: TradingMethod) => {
    setSelectedMethods(prev => 
      prev.includes(method) 
        ? prev.filter(m => m !== method)
        : [...prev, method]
    );
  };
  
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedMethods([]);
    setActiveTab('all');
  };
  
  const hasFilters = searchQuery || selectedMethods.length > 0 || activeTab !== 'all';
  
  // Handle importing an offer from URL
  const handleImportOffer = useCallback((url: string): boolean => {
    const offer = importOfferFromUrl(url);
    if (offer) {
      // Navigate to the imported offer
      setTimeout(() => {
        navigate(`/p2p/offer/${offer.offerId}`);
      }, 1500);
      return true;
    }
    return false;
  }, [importOfferFromUrl, navigate]);
  
  return (
    <div className="p2p-page">
      {/* Header */}
      <header className="p2p-header">
        <div className="header-content">
          <div className="header-text">
            <h1>Trade ZEC</h1>
            <p>
              Exchange ZEC for cash, crypto, goods, or services. 
              Meet in person or trade online. Your terms, your choice.
            </p>
            {/* Broadcast status indicator */}
            <div className={`broadcast-status ${broadcastStatus}`}>
              <span className="status-dot" />
              <span className="status-text">
                {broadcastStatus === 'connected' && 'Live · Offers synced globally'}
                {broadcastStatus === 'connecting' && 'Connecting to peers...'}
                {broadcastStatus === 'disconnected' && 'Offline · Local only'}
              </span>
            </div>
          </div>
          
          <div className="header-actions">
            <button 
              className="import-btn-header"
              onClick={() => setShowImportModal(true)}
            >
              <span>📥</span>
              Import Offer
            </button>
            <button 
              className="create-btn"
              onClick={() => setShowCreateModal(true)}
            >
              <span>+</span>
              Post an Offer
            </button>
          </div>
        </div>
      </header>
      
      {/* Search & Filters */}
      <div className="filters-bar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by currency, location, or keyword..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>
        
        <div className="filter-tabs">
          <button 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All
          </button>
          <button 
            className={`tab ${activeTab === 'sell' ? 'active' : ''}`}
            onClick={() => setActiveTab('sell')}
          >
            Buy ZEC
          </button>
          <button 
            className={`tab ${activeTab === 'buy' ? 'active' : ''}`}
            onClick={() => setActiveTab('buy')}
          >
            Sell ZEC
          </button>
        </div>
      </div>
      
      {/* Method Filters */}
      <div className="method-filters">
        <span className="filter-label">How to trade:</span>
        <div className="method-chips">
          {Object.entries(TRADING_METHOD_INFO).map(([method, info]) => (
            <button
              key={method}
              className={`method-chip ${selectedMethods.includes(method as TradingMethod) ? 'active' : ''}`}
              onClick={() => toggleMethod(method as TradingMethod)}
            >
              {info.icon} {info.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button className="clear-filters" onClick={clearFilters}>
            Clear all
          </button>
        )}
      </div>
      
      {/* Results */}
      <div className="offers-section">
        <div className="offers-header">
          <span className="offers-count">
            {displayOffers.length} offer{displayOffers.length !== 1 ? 's' : ''}
          </span>
          <select 
            className="sort-select"
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as OfferSortBy)}
          >
            <option value="recent">Most recent</option>
            <option value="amount">Highest amount</option>
            <option value="reputation">Best reputation</option>
          </select>
        </div>
        
        {loadingOffers ? (
          <div className="loading-state">
            <div className="loader" />
            <p>Finding offers...</p>
          </div>
        ) : displayOffers.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">🌍</span>
            <h3>No offers found</h3>
            <p>
              {hasFilters 
                ? 'Try different filters or create your own offer'
                : 'Be the first to post an offer!'}
            </p>
            <button 
              className="create-btn secondary"
              onClick={() => setShowCreateModal(true)}
            >
              Create Offer
            </button>
          </div>
        ) : (
          <div className="offers-grid">
            {displayOffers.map(offer => (
              <OfferCard 
                key={offer.offerId} 
                offer={offer}
                onSelect={handleOfferSelect}
                onStartTrade={handleStartTrade}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* How it works - simpler */}
      <section className="how-section">
        <h2>Marketplace</h2>
        <div className="how-grid">
          <div className="how-item">
            <span className="how-icon">💬</span>
            <h3>Connect</h3>
            <p>Find someone trading what you need. Message them to agree on terms.</p>
          </div>
          <div className="how-item">
            <span className="how-icon">🤝</span>
            <h3>Trade</h3>
            <p>Exchange however works for both of you — in person, online, any method.</p>
          </div>
          <div className="how-item">
            <span className="how-icon"></span>
            <h3>Done</h3>
            <p>Complete the trade.</p>
          </div>
        </div>
        
        <div className="trust-note">
          <p>
            <strong>About trust:</strong> This is a human-to-human marketplace. 
            We show reputation scores, but ultimately you decide who to trade with. 
            Start small with new traders. Meet in public places for in-person trades.
          </p>
        </div>
      </section>
      
      {/* Traveler callout */}
      <section className="traveler-section">
        <div className="traveler-content">
          <span className="traveler-icon">✈️</span>
          <div>
            <h3>Traveling?</h3>
            <p>
              Need local currency in a new country? Find someone nearby to trade ZEC 
              for cash in person. No banks, no fees, just humans helping humans.
            </p>
          </div>
          <button 
            className="traveler-cta"
            onClick={() => {
              setSelectedMethods(['face_to_face']);
              setActiveTab('all');
            }}
          >
            Find local trades →
          </button>
        </div>
      </section>
      
      {/* Payment Links callout */}
      <section className="payment-links-section">
        <div className="payment-links-content">
          <span className="payment-links-icon">🔗</span>
          <div>
            <h3>Quick Payments</h3>
            <p>
              Need to send ZEC instantly? Generate a payment link that anyone can 
              claim with one click. Perfect for splitting bills or quick trades.
            </p>
          </div>
          <button 
            className="payment-links-cta"
            onClick={() => navigate('/wallet/uri-payment')}
          >
            Payment Links →
          </button>
        </div>
      </section>
      
      {/* Back to wallet */}
      <div className="nav-back">
        <button onClick={() => navigate('/wallet')}>
          ← Back to Wallet
        </button>
      </div>
      
      {/* Create Modal */}
      <QuickCreateModal 
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onNavigateToCreate={handleCreateOffer}
      />
      
      {/* Import Modal */}
      <ImportOfferModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImport={handleImportOffer}
      />
    </div>
  );
}

export default P2PMarketplace;
