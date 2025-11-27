/**
 * P2P Offer Sync via Supabase Realtime
 * 
 * Uses Supabase for reliable real-time offer syncing across all users.
 * This is a fallback/primary method when P2P relays aren't available.
 * 
 * Setup:
 * 1. Create a free Supabase project at https://supabase.com
 * 2. Create a table called 'p2p_offers' with the schema below
 * 3. Add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env
 * 
 * Table Schema (run in Supabase SQL editor):
 * 
 * CREATE TABLE p2p_offers (
 *   id TEXT PRIMARY KEY,
 *   offer_data JSONB NOT NULL,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW(),
 *   expires_at TIMESTAMPTZ,
 *   is_active BOOLEAN DEFAULT true
 * );
 * 
 * -- Enable realtime
 * ALTER PUBLICATION supabase_realtime ADD TABLE p2p_offers;
 * 
 * -- Enable RLS but allow all operations for now
 * ALTER TABLE p2p_offers ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "Allow all" ON p2p_offers FOR ALL USING (true);
 */

import type { P2POffer, P2PUserProfile, TradingMethod } from '../types/p2p';

// Supabase config from environment
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Check if Supabase is configured
export const isSupabaseConfigured = () => {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
};

// Compact offer format
interface StoredOffer {
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
}

// Method mappings
const METHOD_TO_CODE: Record<TradingMethod, string> = {
  'face_to_face': 'f', 'bank_transfer': 'b', 'mobile_payment': 'm',
  'crypto': 'c', 'gift_card': 'g', 'goods': 'o', 'services': 's', 'other': 'x',
};

const CODE_TO_METHOD: Record<string, TradingMethod> = {
  'f': 'face_to_face', 'b': 'bank_transfer', 'm': 'mobile_payment',
  'c': 'crypto', 'g': 'gift_card', 'o': 'goods', 's': 'services', 'x': 'other',
};

function toStoredFormat(offer: P2POffer): StoredOffer {
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
  };
}

function fromStoredFormat(data: StoredOffer): P2POffer {
  // Defensive: handle missing or malformed maker data
  const maker = data.maker ?? { addr: 'unknown', name: undefined, trades: 0, rate: 0 };
  const makerAddr = maker.addr ?? 'unknown';
  const makerTrades = maker.trades ?? 0;
  const makerRate = maker.rate ?? 0;
  const createdAt = data.created ?? Date.now();
  
  const makerProfile: P2PUserProfile = {
    address: makerAddr,
    displayName: maker.name,
    totalTrades: makerTrades,
    successfulTrades: Math.floor(makerTrades * (makerRate / 100)),
    totalVolumeZec: 0,
    successRate: makerRate,
    registeredAt: createdAt,
    lastActiveAt: createdAt,
    isVerified: false,
  };

  // Defensive: ensure tradingMethods is always an array with at least one item
  const methodsStr = data.methods ?? '';
  const parsedMethods: TradingMethod[] = methodsStr.split(',').filter(Boolean).map(c => CODE_TO_METHOD[c] || 'other');
  const tradingMethods: TradingMethod[] = parsedMethods.length > 0 ? parsedMethods : ['other'];

  return {
    offerId: data.id ?? `offer-${Date.now()}`,
    maker: makerAddr,
    makerProfile,
    offerType: data.type ?? 'sell',
    zecAmount: data.zec ?? 0,
    exchangeValue: data.value ?? '0',
    exchangeCurrency: data.currency ?? 'USD',
    exchangeDescription: data.desc,
    tradingMethods,
    location: data.city ? { city: data.city, country: data.country } : undefined,
    notes: data.notes || '',
    status: 'active',
    createdAt,
    expiresAt: data.expires,
    completedTrades: 0,
    shieldedAddressCommitment: '',
    isBroadcast: true,
  };
}

/**
 * Simple Supabase REST client (no SDK needed)
 */
class SupabaseSync {
  private baseUrl: string;
  private apiKey: string;
  private listeners: Set<(offers: P2POffer[]) => void> = new Set();
  private offers: Map<string, P2POffer> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;

  constructor() {
    this.baseUrl = SUPABASE_URL || '';
    this.apiKey = SUPABASE_ANON_KEY || '';
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.apiKey);
  }

  private getHeaders(): Record<string, string> {
    return {
      'apikey': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  /**
   * Fetch all active offers
   */
  async fetchOffers(): Promise<P2POffer[]> {
    if (!this.isConfigured()) return [];

    try {
      const response = await fetch(
        `${this.baseUrl}/rest/v1/p2p_offers?is_active=eq.true&select=*`,
        { headers: this.getHeaders() }
      );

      if (!response.ok) {
        console.warn('[Supabase] Fetch failed:', response.status);
        return [];
      }

      const rows = await response.json();
      const offers: P2POffer[] = [];

      for (const row of rows) {
        try {
          const offer = fromStoredFormat(row.offer_data);
          // Check expiry
          if (offer.expiresAt && offer.expiresAt < Date.now()) continue;
          offers.push(offer);
          this.offers.set(offer.offerId, offer);
        } catch (e) {
          // Invalid data
        }
      }

      this.notifyListeners();
      return offers;
    } catch (e) {
      console.warn('[Supabase] Fetch error:', e);
      return [];
    }
  }

  /**
   * Save an offer
   */
  async saveOffer(offer: P2POffer): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const storedOffer = toStoredFormat(offer);
      
      const response = await fetch(
        `${this.baseUrl}/rest/v1/p2p_offers`,
        {
          method: 'POST',
          headers: {
            ...this.getHeaders(),
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            id: offer.offerId,
            offer_data: storedOffer,
            expires_at: offer.expiresAt ? new Date(offer.expiresAt).toISOString() : null,
            is_active: true,
          }),
        }
      );

      if (!response.ok) {
        console.warn('[Supabase] Save failed:', response.status);
        return false;
      }

      this.offers.set(offer.offerId, { ...offer, isBroadcast: true });
      this.notifyListeners();
      console.log('[Supabase] Saved offer:', offer.offerId);
      return true;
    } catch (e) {
      console.warn('[Supabase] Save error:', e);
      return false;
    }
  }

  /**
   * Remove an offer
   */
  async removeOffer(offerId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const response = await fetch(
        `${this.baseUrl}/rest/v1/p2p_offers?id=eq.${offerId}`,
        {
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({ is_active: false }),
        }
      );

      if (!response.ok) {
        console.warn('[Supabase] Remove failed:', response.status);
        return false;
      }

      this.offers.delete(offerId);
      this.notifyListeners();
      console.log('[Supabase] Removed offer:', offerId);
      return true;
    } catch (e) {
      console.warn('[Supabase] Remove error:', e);
      return false;
    }
  }

  /**
   * Subscribe to realtime updates
   */
  subscribeRealtime(): void {
    if (!this.isConfigured()) return;
    if (this.eventSource) return;

    // For now, use polling as a reliable fallback
    // TODO: Implement Supabase Realtime WebSocket subscription
    this.startPolling();
  }

  /**
   * Start polling for updates
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    // Initial fetch
    this.fetchOffers();

    // Poll every 10 seconds
    this.pollInterval = setInterval(() => {
      this.fetchOffers();
    }, 10000);

    console.log('[Supabase] Started polling');
  }

  /**
   * Subscribe to offer updates
   */
  subscribe(callback: (offers: P2POffer[]) => void): () => void {
    this.listeners.add(callback);
    
    // Start realtime subscription if not already
    if (!this.pollInterval) {
      this.subscribeRealtime();
    }

    // Immediately call with current offers
    callback(this.getOffers());

    return () => {
      this.listeners.delete(callback);
    };
  }

  getOffers(): P2POffer[] {
    return Array.from(this.offers.values()).filter(o => 
      o.status === 'active' && (!o.expiresAt || o.expiresAt > Date.now())
    );
  }

  private notifyListeners(): void {
    const offers = this.getOffers();
    this.listeners.forEach(cb => cb(offers));
  }

  destroy(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Singleton
export const supabaseSync = new SupabaseSync();
export default supabaseSync;

