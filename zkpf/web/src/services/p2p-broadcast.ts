/**
 * P2P Offer Broadcast Service
 * 
 * Uses multiple methods for reliable offer syncing across all visitors:
 * 1. Supabase Realtime (primary - most reliable)
 * 2. Gun.js P2P network (when relay servers are available)
 * 3. BroadcastChannel API (for same-browser tabs - instant)
 * 4. Shared IndexedDB with polling (for cross-device sync)
 */

import type { P2POffer, P2PUserProfile, TradingMethod } from '../types/p2p';
import { supabaseSync, isSupabaseConfigured } from './p2p-supabase';

// Vercel API endpoint for offer syncing
const VERCEL_API_BASE = '/api/p2p';
const API_POLL_INTERVAL = 5000; // Poll every 5 seconds for real-time feel

// Gun.js CDN is loaded in index.html for simplicity
declare const Gun: any;

// Public Gun relay servers - using more reliable ones
const GUN_PEERS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://gun-us.herokuapp.com/gun', 
  'https://gun-eu.herokuapp.com/gun',
  // Additional relays for redundancy
  'https://gun-matrix.herokuapp.com/gun',
  'https://gundb-relay-1.herokuapp.com/gun',
  'https://peer.wallie.io/gun',
];

// Namespace for our data
const GUN_NAMESPACE = 'zkpf-p2p-marketplace-v2';
const BROADCAST_CHANNEL_NAME = 'zkpf-p2p-offers';
const IDB_DB_NAME = 'zkpf-p2p-broadcast';
const IDB_STORE_NAME = 'offers';

// Polling interval for fallback sync (30 seconds)
const POLL_INTERVAL = 30000;

// Compact offer format for efficient storage/syncing
interface BroadcastOffer {
  id: string;
  type: 'buy' | 'sell';
  zec: number;
  value: string;
  currency: string;
  desc?: string;
  methods: string;
  city?: string;
  country?: string;
  notes?: string;
  created: number;
  expires?: number;
  maker: {
    name?: string;
    trades: number;
    rate: number;
    addr: string;
  };
  active: boolean;
  // Timestamp for sync ordering
  updatedAt: number;
}

// Method code mapping
const METHOD_TO_CODE: Record<TradingMethod, string> = {
  'face_to_face': 'f',
  'bank_transfer': 'b',
  'mobile_payment': 'm',
  'crypto': 'c',
  'gift_card': 'g',
  'goods': 'o',
  'services': 's',
  'other': 'x',
};

const CODE_TO_METHOD: Record<string, TradingMethod> = {
  'f': 'face_to_face',
  'b': 'bank_transfer',
  'm': 'mobile_payment',
  'c': 'crypto',
  'g': 'gift_card',
  'o': 'goods',
  's': 'services',
  'x': 'other',
};

/**
 * Convert P2POffer to compact broadcast format
 */
function toBroadcastFormat(offer: P2POffer): BroadcastOffer {
  // Defensive: handle missing makerProfile
  const makerProfile = offer.makerProfile ?? {
    displayName: undefined,
    totalTrades: 0,
    successRate: 0,
  };
  
  return {
    id: offer.offerId,
    type: offer.offerType,
    zec: offer.zecAmount ?? 0,
    value: offer.exchangeValue ?? '0',
    currency: offer.exchangeCurrency ?? 'USD',
    desc: offer.exchangeDescription?.slice(0, 200),
    methods: (offer.tradingMethods ?? ['other']).map(m => METHOD_TO_CODE[m] || 'x').join(','),
    city: offer.location?.city,
    country: offer.location?.country,
    notes: offer.notes?.slice(0, 300),
    created: offer.createdAt ?? Date.now(),
    expires: offer.expiresAt,
    maker: {
      name: makerProfile.displayName?.slice(0, 50),
      trades: makerProfile.totalTrades ?? 0,
      rate: makerProfile.successRate ?? 0,
      addr: (offer.maker ?? 'unknown').slice(0, 20),
    },
    active: offer.status === 'active',
    updatedAt: Date.now(),
  };
}

/**
 * Convert broadcast format back to P2POffer
 */
function fromBroadcastFormat(data: BroadcastOffer): P2POffer {
  // Defensive: handle missing or malformed maker data
  const maker = data.maker || { addr: 'unknown', name: undefined, trades: 0, rate: 0 };
  const makerAddr = maker.addr || 'unknown';
  const makerTrades = maker.trades ?? 0;
  const makerRate = maker.rate ?? 0;
  
  const makerProfile: P2PUserProfile = {
    address: makerAddr,
    displayName: maker.name,
    totalTrades: makerTrades,
    successfulTrades: Math.floor(makerTrades * (makerRate / 100)),
    totalVolumeZec: 0,
    successRate: makerRate,
    registeredAt: data.created || Date.now(),
    lastActiveAt: data.created || Date.now(),
    isVerified: false,
  };

  // Defensive: ensure tradingMethods is always an array with at least one item
  const methodsStr = typeof data.methods === 'string' ? data.methods : '';
  const parsedMethods = methodsStr.split(',').filter(Boolean).map(c => CODE_TO_METHOD[c] || 'other');
  const tradingMethods: TradingMethod[] = parsedMethods.length > 0 ? parsedMethods : ['other'];

  return {
    offerId: data.id || `offer-${Date.now()}`,
    maker: makerAddr,
    makerProfile,
    offerType: data.type || 'sell',
    zecAmount: data.zec || 0,
    exchangeValue: data.value || '0',
    exchangeCurrency: data.currency || 'USD',
    exchangeDescription: data.desc,
    tradingMethods,
    location: data.city ? { city: data.city, country: data.country } : undefined,
    notes: data.notes || '',
    status: data.active ? 'active' : 'cancelled',
    createdAt: data.created || Date.now(),
    expiresAt: data.expires,
    completedTrades: 0,
    shieldedAddressCommitment: '',
    isBroadcast: true,
  };
}

/**
 * IndexedDB helper for persistent cross-tab storage
 */
class OfferIndexedDB {
  private db: IDBDatabase | null = null;
  private dbReady: Promise<boolean>;

  constructor() {
    this.dbReady = this.initDB();
  }

  private initDB(): Promise<boolean> {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(false);
        return;
      }

      const request = indexedDB.open(IDB_DB_NAME, 1);
      
      request.onerror = () => {
        console.warn('[P2P IDB] Failed to open database');
        resolve(false);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  async saveOffer(offer: BroadcastOffer): Promise<void> {
    await this.dbReady;
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.put(offer);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async getAllOffers(): Promise<BroadcastOffer[]> {
    await this.dbReady;
    if (!this.db) return [];

    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  async deleteOffer(id: string): Promise<void> {
    await this.dbReady;
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db!.transaction(IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}

/**
 * P2P Broadcast Service - Multi-method syncing
 */
class P2PBroadcastService {
  private gun: any = null;
  private gunOffers: any = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private idb: OfferIndexedDB;
  private listeners: Set<(offers: P2POffer[]) => void> = new Set();
  private localOffers: Map<string, P2POffer> = new Map();
  private initialized = false;
  private connectionStatus: 'connecting' | 'connected' | 'disconnected' = 'disconnected';
  private statusListeners: Set<(status: string) => void> = new Set();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private _apiPollInterval: ReturnType<typeof setInterval> | null = null;
  private gunConnected = false;
  private apiConnected = false;

  constructor() {
    this.idb = new OfferIndexedDB();
  }

  /**
   * Initialize all sync methods
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    this.connectionStatus = 'connecting';
    this.notifyStatusListeners();

    // Initialize all sync methods in parallel
    await Promise.all([
      this.initVercelApi(),      // Primary - Vercel API with polling
      this.initSupabase(),       // Secondary - Supabase if configured
      this.initBroadcastChannel(), // Instant same-browser sync
      this.initGun(),            // P2P fallback
      this.loadFromIDB(),        // Local persistence
    ]);

    this.initialized = true;
    
    // Start IDB polling as fallback (only if no real-time sync is working)
    if (!isSupabaseConfigured() && !this.apiConnected) {
      this.startPolling();
    }

    // Set connected if any method is working
    this.connectionStatus = 'connected';
    this.notifyStatusListeners();

    console.log('[P2P Broadcast] Initialized with multiple sync methods');
    return true;
  }

  /**
   * Initialize Supabase for reliable real-time sync
   */
  private async initSupabase(): Promise<void> {
    if (!isSupabaseConfigured()) {
      console.log('[P2P Broadcast] Supabase not configured, using fallback methods');
      return;
    }

    try {
      // Subscribe to Supabase updates
      supabaseSync.subscribe((offers) => {
        for (const offer of offers) {
          this.localOffers.set(offer.offerId, offer);
        }
        this.notifyListeners();
      });

      console.log('[P2P Broadcast] Supabase sync initialized');
    } catch (e) {
      console.warn('[P2P Broadcast] Supabase init failed:', e);
    }
  }

  /**
   * Initialize Vercel API polling for reliable sync
   */
  private async initVercelApi(): Promise<void> {
    try {
      // Initial fetch
      await this.fetchFromApi();
      
      // Start polling
      this._apiPollInterval = setInterval(() => {
        this.fetchFromApi();
      }, API_POLL_INTERVAL);

      this.apiConnected = true;
      console.log('[P2P Broadcast] Vercel API sync initialized');
    } catch (e) {
      console.warn('[P2P Broadcast] Vercel API init failed:', e);
    }
  }

  /**
   * Fetch offers from Vercel API
   */
  private async fetchFromApi(): Promise<void> {
    try {
      const response = await fetch(`${VERCEL_API_BASE}/offers`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.offers && Array.isArray(data.offers)) {
        const now = Date.now();
        for (const stored of data.offers) {
          try {
            const offer = fromBroadcastFormat(stored);
            if (offer.expiresAt && offer.expiresAt < now) continue;
            if (offer.status !== 'active') continue;
            
            this.localOffers.set(offer.offerId, offer);
          } catch (e) {
            // Invalid data
          }
        }
        this.notifyListeners();
      }
    } catch (e) {
      // API not available or error
    }
  }

  /**
   * Save offer to Vercel API
   */
  private async saveToApi(offer: P2POffer): Promise<boolean> {
    try {
      const response = await fetch(`${VERCEL_API_BASE}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBroadcastFormat(offer)),
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Remove offer from Vercel API
   */
  private async removeFromApi(offerId: string): Promise<boolean> {
    try {
      const response = await fetch(`${VERCEL_API_BASE}/offers?id=${offerId}`, {
        method: 'DELETE',
      });
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  /**
   * Initialize BroadcastChannel for instant same-browser sync
   */
  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return;

    try {
      this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      
      this.broadcastChannel.onmessage = (event) => {
        const { type, offer } = event.data;
        
        if (type === 'offer_added' && offer) {
          const p2pOffer = fromBroadcastFormat(offer);
          this.localOffers.set(offer.id, p2pOffer);
          this.notifyListeners();
        } else if (type === 'offer_removed' && offer?.id) {
          this.localOffers.delete(offer.id);
          this.notifyListeners();
        } else if (type === 'sync_request') {
          // Another tab is asking for our offers
          this.broadcastAllOffers();
        }
      };

      // Request offers from other tabs
      this.broadcastChannel.postMessage({ type: 'sync_request' });
      
      console.log('[P2P Broadcast] BroadcastChannel initialized');
    } catch (e) {
      console.warn('[P2P Broadcast] BroadcastChannel failed:', e);
    }
  }

  /**
   * Broadcast all current offers to other tabs
   */
  private broadcastAllOffers(): void {
    if (!this.broadcastChannel) return;
    
    for (const [, offer] of this.localOffers) {
      this.broadcastChannel.postMessage({
        type: 'offer_added',
        offer: toBroadcastFormat(offer),
      });
    }
  }

  /**
   * Initialize Gun.js for P2P sync
   */
  private async initGun(): Promise<void> {
    if (typeof Gun === 'undefined') {
      console.warn('[P2P Broadcast] Gun.js not loaded');
      return;
    }

    try {
      this.gun = Gun({
        peers: GUN_PEERS,
        localStorage: true,
        radisk: true,
      });

      this.gunOffers = this.gun.get(GUN_NAMESPACE);

      // Subscribe to Gun offers
      this.gunOffers.map().on((data: any, key: string) => {
        if (!data || !key) return;
        
        try {
          const broadcastOffer = typeof data === 'string' ? JSON.parse(data) : data;
          
          if (broadcastOffer && broadcastOffer.id) {
            const offer = fromBroadcastFormat(broadcastOffer);
            
            if (offer.expiresAt && offer.expiresAt < Date.now()) {
              this.localOffers.delete(key);
            } else if (offer.status === 'active') {
              this.localOffers.set(key, offer);
              // Also save to IDB for persistence
              this.idb.saveOffer(broadcastOffer);
            } else {
              this.localOffers.delete(key);
            }
            
            this.notifyListeners();
          }
        } catch (e) {
          // Invalid data
        }
      });

      // Track Gun connection status
      this.gun.on('hi', () => {
        console.log('[P2P Broadcast] Gun connected to peer');
        this.gunConnected = true;
      });

      this.gun.on('bye', () => {
        console.log('[P2P Broadcast] Gun peer disconnected');
      });

      console.log('[P2P Broadcast] Gun.js initialized with', GUN_PEERS.length, 'peers');
    } catch (e) {
      console.warn('[P2P Broadcast] Gun.js init failed:', e);
    }
  }

  /**
   * Load offers from IndexedDB
   */
  private async loadFromIDB(): Promise<void> {
    try {
      const offers = await this.idb.getAllOffers();
      const now = Date.now();
      
      for (const offer of offers) {
        // Skip expired offers
        if (offer.expires && offer.expires < now) continue;
        if (!offer.active) continue;
        
        const p2pOffer = fromBroadcastFormat(offer);
        this.localOffers.set(offer.id, p2pOffer);
      }
      
      this.notifyListeners();
      console.log('[P2P Broadcast] Loaded', offers.length, 'offers from IDB');
    } catch (e) {
      console.warn('[P2P Broadcast] IDB load failed:', e);
    }
  }

  /**
   * Start polling for sync
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      this.loadFromIDB();
    }, POLL_INTERVAL);
  }

  /**
   * Broadcast an offer to all channels
   */
  async broadcastOffer(offer: P2POffer): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const broadcastData = toBroadcastFormat(offer);
      const key = offer.offerId;

      // Store locally
      this.localOffers.set(key, { ...offer, isBroadcast: true });

      // Save to IndexedDB (persistent)
      await this.idb.saveOffer(broadcastData);

      // Save to Vercel API (primary cross-device sync)
      this.saveToApi(offer).catch(console.error);

      // Save to Supabase (secondary reliable cross-device sync)
      if (isSupabaseConfigured()) {
        supabaseSync.saveOffer(offer).catch(console.error);
      }

      // Broadcast to other tabs (instant)
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: 'offer_added',
          offer: broadcastData,
        });
      }

      // Broadcast via Gun.js (P2P)
      if (this.gunOffers) {
        this.gunOffers.get(key).put(JSON.stringify(broadcastData));
      }

      this.notifyListeners();
      console.log('[P2P Broadcast] Broadcasted offer:', key);
      return true;
    } catch (error) {
      console.error('[P2P Broadcast] Failed to broadcast:', error);
      return false;
    }
  }

  /**
   * Remove an offer from all channels
   */
  async removeOffer(offerId: string): Promise<boolean> {
    try {
      const existingOffer = this.localOffers.get(offerId);
      
      // Remove from local map
      this.localOffers.delete(offerId);

      // Remove from IndexedDB
      await this.idb.deleteOffer(offerId);

      // Remove from Vercel API
      this.removeFromApi(offerId).catch(console.error);

      // Remove from Supabase
      if (isSupabaseConfigured()) {
        supabaseSync.removeOffer(offerId).catch(console.error);
      }

      // Broadcast removal to other tabs
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: 'offer_removed',
          offer: { id: offerId },
        });
      }

      // Mark inactive in Gun.js
      if (this.gunOffers && existingOffer) {
        const broadcastData = toBroadcastFormat({ ...existingOffer, status: 'cancelled' });
        this.gunOffers.get(offerId).put(JSON.stringify(broadcastData));
      }

      this.notifyListeners();
      console.log('[P2P Broadcast] Removed offer:', offerId);
      return true;
    } catch (error) {
      console.error('[P2P Broadcast] Failed to remove:', error);
      return false;
    }
  }

  /**
   * Get all currently known offers
   */
  getOffers(): P2POffer[] {
    const now = Date.now();
    return Array.from(this.localOffers.values())
      .filter(o => o.status === 'active')
      .filter(o => !o.expiresAt || o.expiresAt > now);
  }

  /**
   * Subscribe to offer updates
   */
  subscribe(callback: (offers: P2POffer[]) => void): () => void {
    this.listeners.add(callback);
    
    if (!this.initialized) {
      // Initialize in background, don't block the subscription
      this.initialize().catch((error) => {
        console.warn('[P2P Broadcast] Background initialization failed:', error);
      });
    }

    // Call with current offers (may be empty if not initialized yet)
    try {
      callback(this.getOffers());
    } catch (error) {
      console.warn('[P2P Broadcast] Callback error during subscribe:', error);
    }

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Subscribe to connection status changes
   */
  subscribeStatus(callback: (status: string) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.connectionStatus);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Get current connection status
   */
  getStatus(): string {
    return this.connectionStatus;
  }

  /**
   * Get count of sync methods active
   */
  getPeerCount(): number {
    let count = 1; // IndexedDB always works
    if (this.broadcastChannel) count++;
    if (this.gunConnected) count++;
    if (this._apiPollInterval) count++; // API polling is active
    return count;
  }

  private notifyListeners(): void {
    const offers = this.getOffers();
    this.listeners.forEach(cb => {
      try {
        cb(offers);
      } catch (error) {
        console.warn('[P2P Broadcast] Listener callback error:', error);
      }
    });
  }

  private notifyStatusListeners(): void {
    this.statusListeners.forEach(cb => cb(this.connectionStatus));
  }
}

// Singleton instance
export const p2pBroadcast = new P2PBroadcastService();

// Lazy initialization - only initialize when first used, not on module load
// This prevents errors during navigation when the module is imported
let initPromise: Promise<boolean> | null = null;

/**
 * Safely initialize the broadcast service
 * This is called lazily on first use rather than on module load
 */
export function ensureBroadcastInitialized(): Promise<boolean> {
  if (initPromise) return initPromise;
  
  if (typeof window === 'undefined') {
    return Promise.resolve(false);
  }
  
  initPromise = p2pBroadcast.initialize().catch((error) => {
    console.warn('[P2P Broadcast] Initialization failed, service will work in degraded mode:', error);
    return false;
  });
  
  return initPromise;
}

// Auto-initialize on page load, but don't block on it and handle errors gracefully
if (typeof window !== 'undefined') {
  const initBroadcast = () => {
    // Use setTimeout to ensure this runs after React has mounted
    // and to prevent blocking the main thread during navigation
    setTimeout(() => {
      ensureBroadcastInitialized().catch(() => {
        // Silently handle - errors are logged inside ensureBroadcastInitialized
      });
    }, 100);
  };
  
  if (document.readyState === 'complete') {
    initBroadcast();
  } else {
    window.addEventListener('load', initBroadcast);
  }
}

export default p2pBroadcast;

