/**
 * useP2PMarketplace Hook
 * 
 * Manages P2P marketplace state for human-friendly trading.
 * Trade ZEC for anything - fiat, crypto, goods, services.
 * 
 * Now with P2P broadcast support - offers are shared across all visitors
 * using Gun.js decentralized database.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type {
  P2POffer,
  P2PTrade,
  P2PUserProfile,
  P2PMessage,
  CreateOfferParams,
  OfferFilters,
  OfferSortBy,
  SortDirection,
  MarketplaceStats,
  TradeStatus,
  TradingMethod,
  PaymentMethod,
} from '../types/p2p';
import { decodeOffer } from '../utils/p2p-share';
import { p2pBroadcast } from '../services/p2p-broadcast';
import { chatService } from '../services/chat';

// API base for P2P backend (when available)
const API_BASE = import.meta.env.VITE_P2P_API_BASE || '/api/p2p';

// LocalStorage keys for persistent state
const STORAGE_KEYS = {
  offers: 'p2p_offers',
  importedOffers: 'p2p_imported_offers',
  myProfile: 'p2p_my_profile',
  myTrades: 'p2p_my_trades',
};

// Helper to safely get/set localStorage
function getStoredJson<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
}

function setStoredJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors
  }
}

// Trade initiation params - supports both ZEC and zatoshi formats
export interface InitiateTradeParams {
  offerId: string;
  // Amount - support both formats
  zecAmount?: number;
  zecAmountZatoshi?: number;
  buyerShieldedCommitment: string;
  tradingMethod?: TradingMethod;
  paymentMethod?: PaymentMethod;
  useEscrow?: boolean;
  meetingDetails?: string;
}

interface UseP2PMarketplaceReturn {
  // Offers
  offers: P2POffer[];
  filteredOffers: P2POffer[];
  selectedOffer: P2POffer | null;
  loadingOffers: boolean;
  
  // Trades
  activeTrade: P2PTrade | null;
  myTrades: P2PTrade[];
  loadingTrade: boolean;
  
  // User
  myProfile: P2PUserProfile | null;
  isRegistered: boolean;
  
  // Stats
  stats: MarketplaceStats | null;
  
  // Broadcast status
  broadcastStatus: 'connecting' | 'connected' | 'disconnected';
  broadcastPeerCount: number;
  
  // Filters
  filters: OfferFilters;
  sortBy: OfferSortBy;
  sortDirection: SortDirection;
  
  // Actions
  fetchOffers: () => Promise<void>;
  fetchOffer: (offerId: string) => Promise<P2POffer | null>;
  createOffer: (params: CreateOfferParams) => Promise<string>;
  cancelOffer: (offerId: string) => Promise<void>;
  importOffer: (offer: P2POffer) => void;
  importOfferFromUrl: (url: string) => P2POffer | null;
  broadcastOffer: (offer: P2POffer) => Promise<boolean>;
  
  initiateTrade: (params: InitiateTradeParams, currentProfile?: P2PUserProfile | null) => Promise<string>;
  depositEscrow: (tradeId: string, escrowCommitment: string) => Promise<void>;
  markPaymentSent: (tradeId: string) => Promise<void>;
  markFiatSent: (tradeId: string, paymentReference: string) => Promise<void>;
  confirmPaymentReceived: (tradeId: string) => Promise<void>;
  confirmFiatReceived: (tradeId: string) => Promise<void>;
  cancelTrade: (tradeId: string) => Promise<void>;
  openDispute: (tradeId: string, reason: string) => Promise<void>;
  
  sendMessage: (tradeId: string, content: string) => Promise<void>;
  
  setFilters: (filters: OfferFilters) => void;
  setSortBy: (sortBy: OfferSortBy) => void;
  setSortDirection: (direction: SortDirection) => void;
  selectOffer: (offer: P2POffer | null) => void;
  
  registerUser: (displayName?: string) => Promise<P2PUserProfile>;
  
  // Error handling
  error: string | null;
  clearError: () => void;
}

export function useP2PMarketplace(): UseP2PMarketplaceReturn {
  // Offers state - load from localStorage on init
  const [localOffers, setLocalOffersState] = useState<P2POffer[]>(() => 
    getStoredJson<P2POffer[]>(STORAGE_KEYS.offers, [])
  );
  const [broadcastOffers, setBroadcastOffers] = useState<P2POffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<P2POffer | null>(null);
  const [loadingOffers, setLoadingOffers] = useState(false);
  
  // Broadcast connection status
  const [broadcastStatus, setBroadcastStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [broadcastPeerCount, setBroadcastPeerCount] = useState(0);
  
  // Trades state - load from localStorage on init
  const [activeTrade, setActiveTrade] = useState<P2PTrade | null>(null);
  const [myTrades, setMyTradesState] = useState<P2PTrade[]>(() =>
    getStoredJson<P2PTrade[]>(STORAGE_KEYS.myTrades, [])
  );
  const [loadingTrade, setLoadingTrade] = useState(false);
  
  // User state - load from localStorage on init
  const [myProfile, setMyProfileState] = useState<P2PUserProfile | null>(() =>
    getStoredJson<P2PUserProfile | null>(STORAGE_KEYS.myProfile, null)
  );
  
  // Merge local and broadcast offers, deduplicating by offerId
  const offers = useMemo(() => {
    const offerMap = new Map<string, P2POffer>();
    
    // Add broadcast offers first
    broadcastOffers.forEach(o => offerMap.set(o.offerId, o));
    
    // Local offers take precedence
    localOffers.forEach(o => offerMap.set(o.offerId, o));
    
    return Array.from(offerMap.values());
  }, [localOffers, broadcastOffers]);
  
  // Wrapper functions that persist to localStorage
  const setOffers = useCallback((updater: P2POffer[] | ((prev: P2POffer[]) => P2POffer[])) => {
    setLocalOffersState(prev => {
      const newOffers = typeof updater === 'function' ? updater(prev) : updater;
      setStoredJson(STORAGE_KEYS.offers, newOffers);
      return newOffers;
    });
  }, []);
  
  const setMyTrades = useCallback((updater: P2PTrade[] | ((prev: P2PTrade[]) => P2PTrade[])) => {
    setMyTradesState(prev => {
      const newTrades = typeof updater === 'function' ? updater(prev) : updater;
      setStoredJson(STORAGE_KEYS.myTrades, newTrades);
      return newTrades;
    });
  }, []);
  
  const setMyProfile = useCallback((profile: P2PUserProfile | null) => {
    setMyProfileState(profile);
    setStoredJson(STORAGE_KEYS.myProfile, profile);
  }, []);
  
  // Stats
  const [stats, setStats] = useState<MarketplaceStats | null>(null);
  
  // Filters
  const [filters, setFilters] = useState<OfferFilters>({});
  const [sortBy, setSortBy] = useState<OfferSortBy>('recent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  // Error
  const [error, setError] = useState<string | null>(null);
  
  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Computed: filtered and sorted offers
  const filteredOffers = useMemo(() => {
    let result = [...offers];
    
    // Apply filters
    if (filters.offerType) {
      result = result.filter(o => o.offerType === filters.offerType);
    }
    if (filters.currency) {
      const q = filters.currency.toLowerCase();
      result = result.filter(o => 
        o.exchangeCurrency.toLowerCase().includes(q)
      );
    }
    if (filters.tradingMethods && filters.tradingMethods.length > 0) {
      result = result.filter(o => 
        o.tradingMethods && filters.tradingMethods!.some(m => o.tradingMethods?.includes(m))
      );
    }
    if (filters.location) {
      const q = filters.location.toLowerCase();
      result = result.filter(o => 
        o.location?.city?.toLowerCase().includes(q) ||
        o.location?.country?.toLowerCase().includes(q) ||
        o.location?.area?.toLowerCase().includes(q)
      );
    }
    if (filters.minZec) {
      result = result.filter(o => o.zecAmount >= filters.minZec!);
    }
    if (filters.maxZec) {
      result = result.filter(o => o.zecAmount <= filters.maxZec!);
    }
    
    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'amount':
          comparison = (a.zecAmount ?? 0) - (b.zecAmount ?? 0);
          break;
        case 'reputation':
          // Defensive: handle missing makerProfile
          const aRate = a.makerProfile?.successRate ?? 0;
          const bRate = b.makerProfile?.successRate ?? 0;
          comparison = bRate - aRate;
          break;
        case 'recent':
        default:
          comparison = (b.createdAt ?? 0) - (a.createdAt ?? 0);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    return result;
  }, [offers, filters, sortBy, sortDirection]);
  
  // Clear error
  const clearError = useCallback(() => setError(null), []);
  
  // Fetch offers from backend
  const fetchOffers = useCallback(async () => {
    setLoadingOffers(true);
    setError(null);
    
    try {
      // Try to fetch from backend API
      const response = await fetch(`${API_BASE}/offers`);
      
      if (response.ok) {
        const data = await response.json();
        const apiOffers = data.offers || [];
        // Merge API offers with local offers (local offers take precedence)
        setOffers(prev => {
          const localOfferIds = new Set(prev.map(o => o.offerId));
          const newApiOffers = apiOffers.filter((o: P2POffer) => !localOfferIds.has(o.offerId));
          return [...prev, ...newApiOffers];
        });
        setStats(data.stats || null);
      } else {
        // No backend available - keep existing local offers
        setStats(null);
      }
    } catch {
      // Backend not available - keep existing local offers (no error, this is expected)
      setStats(null);
    } finally {
      setLoadingOffers(false);
    }
  }, [setOffers]);
  
  // Fetch single offer
  const fetchOffer = useCallback(async (offerId: string): Promise<P2POffer | null> => {
    try {
      // First check local state
      const localOffer = offers.find(o => o.offerId === offerId);
      if (localOffer) {
        setSelectedOffer(localOffer);
        return localOffer;
      }
      
      // Try to fetch from backend
      const response = await fetch(`${API_BASE}/offers/${offerId}`);
      if (response.ok) {
        const offer = await response.json();
        setSelectedOffer(offer);
        return offer;
      }
      
      return null;
    } catch {
      return null;
    }
  }, [offers]);
  
  // Create offer
  const createOffer = useCallback(async (params: CreateOfferParams): Promise<string> => {
    setError(null);
    
    try {
      // In production, this would submit to blockchain/backend
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const offerId = `offer-${Date.now()}`;
      
      // Create chat channel for this offer immediately so anyone can join
      // This enables bidding/discussion even before a trade is initiated
      let chatTicket: string | undefined;
      try {
        const nickname = myProfile?.displayName || (myProfile?.address ?? '').slice(0, 8) || 'maker';
        const { ticket } = await chatService.createOfferChannel(offerId, nickname);
        chatTicket = ticket;
        console.log('[P2P] Created chat channel for offer:', offerId);
      } catch (chatErr) {
        console.warn('[P2P] Chat channel creation failed (chat may not be available):', chatErr);
        // Continue without chat - offer can still be created
      }
      
      // Create new offer with chat ticket embedded
      const newOffer: P2POffer = {
        offerId,
        maker: myProfile?.address || '0x0000...0000',
        makerProfile: myProfile || {
          address: '0x0000...0000',
          totalTrades: 0,
          successfulTrades: 0,
          totalVolumeZec: 0,
          successRate: 0,
          registeredAt: Date.now(),
          lastActiveAt: Date.now(),
          isVerified: false,
        },
        offerType: params.offerType,
        zecAmount: params.zecAmount,
        exchangeValue: params.exchangeValue,
        exchangeCurrency: params.exchangeCurrency,
        exchangeDescription: params.exchangeDescription,
        minTradeZec: params.minTradeZec,
        maxTradeZec: params.maxTradeZec,
        tradingMethods: params.tradingMethods,
        location: params.location,
        notes: params.notes,
        status: 'active',
        createdAt: Date.now(),
        expiresAt: params.expiresAt,
        completedTrades: 0,
        shieldedAddressCommitment: params.shieldedAddressCommitment,
        chatTicket, // Embed chat ticket so anyone viewing can auto-join
      };
      
      setOffers(prev => [newOffer, ...prev]);
      
      // Auto-broadcast the new offer to the P2P network (includes chatTicket)
      p2pBroadcast.broadcastOffer(newOffer).catch(console.error);
      
      return offerId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create offer';
      setError(message);
      throw new Error(message);
    }
  }, [myProfile, setOffers]);
  
  // Cancel offer
  const cancelOffer = useCallback(async (offerId: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      setOffers(prev => prev.filter(o => o.offerId !== offerId));
      
      // Also remove from broadcast network
      p2pBroadcast.removeOffer(offerId).catch(console.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel offer');
    }
  }, [setOffers]);
  
  // Import a shared offer into local storage
  const importOffer = useCallback((offer: P2POffer): void => {
    setOffers(prev => {
      // Check if already exists
      if (prev.some(o => o.offerId === offer.offerId)) {
        return prev;
      }
      // Mark as imported and add to list
      return [{ ...offer, isImported: true } as P2POffer, ...prev];
    });
  }, [setOffers]);
  
  // Import offer from a shared URL
  const importOfferFromUrl = useCallback((url: string): P2POffer | null => {
    try {
      // Extract the share param from the URL
      const urlObj = new URL(url);
      const shareData = urlObj.searchParams.get('share');
      if (!shareData) return null;
      
      const offer = decodeOffer(shareData);
      if (offer) {
        importOffer(offer);
        return offer;
      }
      return null;
    } catch (e) {
      console.error('Failed to import offer from URL:', e);
      return null;
    }
  }, [importOffer]);
  
  // Initiate trade
  const initiateTrade = useCallback(async (
    params: InitiateTradeParams,
    currentProfile?: P2PUserProfile | null
  ): Promise<string> => {
    setLoadingTrade(true);
    setError(null);
    
    try {
      const offer = offers.find(o => o.offerId === params.offerId);
      if (!offer) throw new Error('Offer not found');
      
      const userProfile = currentProfile ?? myProfile;
      if (!userProfile) {
        throw new Error('Please set up your profile first');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const tradeId = `trade-${Date.now()}`;
      
      // Handle both zecAmount and zecAmountZatoshi formats
      const zecAmount = params.zecAmount ?? (params.zecAmountZatoshi ? params.zecAmountZatoshi / 100_000_000 : offer.zecAmount);
      const zecAmountZatoshi = params.zecAmountZatoshi ?? Math.floor(zecAmount * 100_000_000);
      
      // Determine trading method from either field
      const tradingMethod = params.tradingMethod ?? (params.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'mobile_payment');
      
      const newTrade: P2PTrade = {
        tradeId,
        offerId: params.offerId,
        offer,
        seller: offer.offerType === 'sell' ? offer.maker : userProfile.address,
        sellerProfile: offer.offerType === 'sell' ? offer.makerProfile : userProfile,
        buyer: offer.offerType === 'sell' ? userProfile.address : offer.maker,
        buyerProfile: offer.offerType === 'sell' ? userProfile : offer.makerProfile,
        zecAmount,
        zecAmountZatoshi,
        exchangeValue: offer.exchangeValue,
        exchangeCurrency: offer.exchangeCurrency,
        fiatAmountCents: offer.fiatAmountCents,
        fiatCurrency: offer.fiatCurrency || offer.exchangeCurrency,
        tradingMethod,
        paymentMethod: params.paymentMethod,
        meetingDetails: params.meetingDetails,
        buyerShieldedCommitment: params.buyerShieldedCommitment,
        useEscrow: params.useEscrow ?? true,
        status: (params.useEscrow ?? true) ? 'pending' : 'escrow_locked',
        createdAt: Date.now(),
        expiresAt: Date.now() + (offer.paymentWindow ?? 30) * 60 * 1000,
        messages: [],
      };
      
      setActiveTrade(newTrade);
      setMyTrades(prev => [newTrade, ...prev]);
      
      // Update offer status
      setOffers(prev => prev.map(o => 
        o.offerId === params.offerId 
          ? { ...o, status: 'in_trade' as const }
          : o
      ));
      
      return tradeId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start trade';
      setError(message);
      throw new Error(message);
    } finally {
      setLoadingTrade(false);
    }
  }, [offers, myProfile, setMyTrades, setOffers]);
  
  // Deposit ZEC to escrow
  const depositEscrow = useCallback(async (tradeId: string, escrowCommitment: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        return {
          ...prev,
          status: 'escrow_locked' as TradeStatus,
          escrowCommitment,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deposit escrow');
    }
  }, []);
  
  // Mark payment sent
  const markPaymentSent = useCallback(async (tradeId: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        return {
          ...prev,
          status: 'payment_sent' as TradeStatus,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark payment sent');
    }
  }, []);
  
  // Mark fiat sent (with payment reference)
  const markFiatSent = useCallback(async (tradeId: string, paymentReference: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        return {
          ...prev,
          status: 'fiat_sent' as TradeStatus,
          paymentReference,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark fiat sent');
    }
  }, []);
  
  // Confirm payment received
  const confirmPaymentReceived = useCallback(async (tradeId: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      let tradeOfferId: string | null = null;
      let tradeZecAmount = 0;
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        tradeOfferId = prev.offerId;
        tradeZecAmount = prev.zecAmount;
        return {
          ...prev,
          status: 'completed' as TradeStatus,
          completedAt: Date.now(),
        };
      });
      
      // Update offer
      if (tradeOfferId) {
        setOffers(prev => prev.map(o => 
          o.offerId === tradeOfferId 
            ? { 
                ...o, 
                status: 'active' as const,
                zecAmount: o.zecAmount - tradeZecAmount,
                completedTrades: o.completedTrades + 1,
              }
            : o
        ));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm payment');
    }
  }, [setOffers]);
  
  // Confirm fiat received (releases ZEC to buyer)
  const confirmFiatReceived = useCallback(async (tradeId: string): Promise<void> => {
    // Alias for confirmPaymentReceived
    await confirmPaymentReceived(tradeId);
  }, [confirmPaymentReceived]);
  
  // Cancel trade
  const cancelTrade = useCallback(async (tradeId: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (activeTrade && activeTrade.tradeId === tradeId) {
        setOffers(prev => prev.map(o => 
          o.offerId === activeTrade.offerId 
            ? { ...o, status: 'active' as const }
            : o
        ));
      }
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        return { ...prev, status: 'cancelled' as TradeStatus };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel trade');
    }
  }, [activeTrade, setOffers]);
  
  // Open dispute
  const openDispute = useCallback(async (tradeId: string, reason: string): Promise<void> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setActiveTrade(prev => {
        if (!prev || prev.tradeId !== tradeId) return prev;
        return {
          ...prev,
          status: 'disputed' as TradeStatus,
          disputeReason: reason,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open dispute');
    }
  }, []);
  
  // Send message
  const sendMessage = useCallback(async (tradeId: string, content: string): Promise<void> => {
    if (!myProfile) return;
    
    const newMessage: P2PMessage = {
      messageId: `msg-${Date.now()}`,
      tradeId,
      sender: myProfile.address,
      content,
      timestamp: Date.now(),
      encrypted: false,
    };
    
    setActiveTrade(prev => {
      if (!prev || prev.tradeId !== tradeId) return prev;
      return {
        ...prev,
        messages: [...prev.messages, newMessage],
      };
    });
  }, [myProfile]);
  
  // Register user
  const registerUser = useCallback(async (displayName?: string): Promise<P2PUserProfile> => {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const newProfile: P2PUserProfile = {
        address: `0x${Math.random().toString(16).slice(2, 10)}...${Math.random().toString(16).slice(2, 6)}`,
        displayName,
        totalTrades: 0,
        successfulTrades: 0,
        totalVolumeZec: 0,
        successRate: 0,
        registeredAt: Date.now(),
        lastActiveAt: Date.now(),
        isVerified: false,
      };
      
      setMyProfile(newProfile);
      return newProfile;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register');
      throw err;
    }
  }, [setMyProfile]);
  
  // Select offer
  const selectOffer = useCallback((offer: P2POffer | null) => {
    setSelectedOffer(offer);
  }, []);
  
  // Initial fetch
  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);
  
  // Subscribe to P2P broadcast network
  useEffect(() => {
    let isMounted = true;
    
    // Subscribe to offers from the broadcast network
    const unsubscribeOffers = p2pBroadcast.subscribe((offers) => {
      // Only update state if component is still mounted
      if (isMounted) {
        setBroadcastOffers(offers);
      }
    });
    
    // Subscribe to connection status
    const unsubscribeStatus = p2pBroadcast.subscribeStatus((status) => {
      // Only update state if component is still mounted
      if (isMounted) {
        setBroadcastStatus(status as 'connecting' | 'connected' | 'disconnected');
      }
    });
    
    // Get peer count
    if (isMounted) {
      setBroadcastPeerCount(p2pBroadcast.getPeerCount());
    }
    
    return () => {
      isMounted = false;
      unsubscribeOffers();
      unsubscribeStatus();
    };
  }, []);
  
  // Broadcast an offer to the P2P network
  const broadcastOfferToNetwork = useCallback(async (offer: P2POffer): Promise<boolean> => {
    return p2pBroadcast.broadcastOffer(offer);
  }, []);
  
  // Poll for trade updates
  useEffect(() => {
    if (activeTrade && !['completed', 'released', 'refunded', 'cancelled'].includes(activeTrade.status)) {
      pollRef.current = setInterval(() => {
        // In production, would poll for trade status updates
        console.log('Polling trade status:', activeTrade.tradeId);
      }, 10000);
    }
    
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeTrade]);
  
  return {
    // Offers
    offers,
    filteredOffers,
    selectedOffer,
    loadingOffers,
    
    // Trades
    activeTrade,
    myTrades,
    loadingTrade,
    
    // User
    myProfile,
    isRegistered: myProfile !== null,
    
    // Stats
    stats,
    
    // Broadcast status
    broadcastStatus,
    broadcastPeerCount,
    
    // Filters
    filters,
    sortBy,
    sortDirection,
    
    // Actions
    fetchOffers,
    fetchOffer,
    createOffer,
    cancelOffer,
    importOffer,
    importOfferFromUrl,
    broadcastOffer: broadcastOfferToNetwork,
    initiateTrade,
    depositEscrow,
    markPaymentSent,
    markFiatSent,
    confirmPaymentReceived,
    confirmFiatReceived,
    cancelTrade,
    openDispute,
    sendMessage,
    setFilters,
    setSortBy,
    setSortDirection,
    selectOffer,
    registerUser,
    
    // Error
    error,
    clearError,
  };
}
