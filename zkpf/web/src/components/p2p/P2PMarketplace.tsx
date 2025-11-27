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
import './P2PMarketplace.css';

// ============ Offer Card ============
function OfferCard({ offer, onSelect }: { offer: P2POffer; onSelect: (offer: P2POffer) => void }) {
  const isSelling = offer.offerType === 'sell';
  const badge = getReputationBadge(offer.makerProfile);
  const isOnline = Date.now() - offer.makerProfile.lastActiveAt < 300000;
  
  // Find primary trading method
  const primaryMethod = offer.tradingMethods[0];
  const methodInfo = TRADING_METHOD_INFO[primaryMethod];
  
  return (
    <article className="offer-card" onClick={() => onSelect(offer)}>
      <div className="offer-card-top">
        <div className="offer-user">
          <div className={`user-avatar ${isOnline ? 'online' : ''}`}>
            {offer.makerProfile.displayName?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="user-info">
            <span className="user-name">
              {offer.makerProfile.displayName || 'Anonymous'}
              {offer.makerProfile.isVerified && <span className="verified">✓</span>}
            </span>
            <span className="user-meta">
              {offer.makerProfile.totalTrades} trades · {timeAgo(offer.makerProfile.lastActiveAt)}
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
          {offer.tradingMethods.length > 1 && (
            <span className="method-more">+{offer.tradingMethods.length - 1}</span>
          )}
        </div>
        
        {offer.location?.city && (
          <span className="offer-location">
            📍 {offer.location.city}{offer.location.country ? `, ${offer.location.country}` : ''}
          </span>
        )}
        
        <button className={`offer-action ${isSelling ? 'buy' : 'sell'}`}>
          {isSelling ? 'Buy ZEC' : 'Sell ZEC'}
        </button>
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
            <span className="option-desc">Get cash, crypto, goods, or services for your ZEC</span>
          </button>
          
          <button 
            className="quick-option buy"
            onClick={() => onNavigateToCreate('buy')}
          >
            <span className="option-icon">📥</span>
            <span className="option-title">Buy ZEC</span>
            <span className="option-desc">Offer cash, crypto, goods, or services for ZEC</span>
          </button>
        </div>
        
        <div className="quick-examples">
          <p className="examples-title">People trade ZEC for:</p>
          <div className="example-tags">
            <span>USD 💵</span>
            <span>EUR 💶</span>
            <span>Bitcoin ₿</span>
            <span>Gift cards 🎁</span>
            <span>Cash in person 🤝</span>
            <span>Freelance work ⚡</span>
            <span>Local currency 🌍</span>
          </div>
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
    stats,
    sortBy,
    setSortBy,
    selectOffer,
  } = useP2PMarketplace();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'sell' | 'buy'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<TradingMethod[]>([]);
  
  // Filter offers
  const displayOffers = useMemo(() => {
    let offers = filteredOffers;
    
    // Tab filter
    if (activeTab !== 'all') {
      offers = offers.filter(o => o.offerType === activeTab);
    }
    
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      offers = offers.filter(o => 
        o.exchangeCurrency.toLowerCase().includes(q) ||
        o.exchangeDescription?.toLowerCase().includes(q) ||
        o.makerProfile.displayName?.toLowerCase().includes(q) ||
        o.location?.city?.toLowerCase().includes(q) ||
        o.location?.country?.toLowerCase().includes(q) ||
        o.notes.toLowerCase().includes(q)
      );
    }
    
    // Method filter
    if (selectedMethods.length > 0) {
      offers = offers.filter(o => 
        o.tradingMethods.some(m => selectedMethods.includes(m))
      );
    }
    
    return offers;
  }, [filteredOffers, activeTab, searchQuery, selectedMethods]);
  
  const handleOfferSelect = useCallback((offer: P2POffer) => {
    selectOffer(offer);
    navigate(`/p2p/offer/${offer.offerId}`);
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
          </div>
          
          <button 
            className="create-btn"
            onClick={() => setShowCreateModal(true)}
          >
            <span>+</span>
            Post an Offer
          </button>
        </div>
        
        <div className="header-stats">
          <div className="stat">
            <span className="stat-value">{stats?.totalActiveOffers ?? displayOffers.length}</span>
            <span className="stat-label">Active offers</span>
          </div>
          <div className="stat">
            <span className="stat-value">{stats?.tradersOnline ?? 0}</span>
            <span className="stat-label">Traders online</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatZecFromZec(stats?.totalVolumeZec ?? 0, 0)}</span>
            <span className="stat-label">ZEC traded</span>
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
              />
            ))}
          </div>
        )}
      </div>
      
      {/* How it works - simpler */}
      <section className="how-section">
        <h2>Simple, trust-based trading</h2>
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
            <span className="how-icon">✅</span>
            <h3>Done</h3>
            <p>Complete the trade. Build reputation. Help grow the community.</p>
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
    </div>
  );
}

export default P2PMarketplace;
