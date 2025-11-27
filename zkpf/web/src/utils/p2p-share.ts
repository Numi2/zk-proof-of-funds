/**
 * P2P Offer Sharing Utilities
 * 
 * Encode/decode offers for shareable URLs so offers can be communicated
 * to others even without a centralized backend.
 */

import type { P2POffer, P2PUserProfile, TradingMethod } from '../types/p2p';

// Compact offer format for URL sharing
interface ShareableOffer {
  i: string;          // offerId
  t: 'b' | 's';       // type: buy/sell
  z: number;          // zecAmount
  v: string;          // exchangeValue
  c: string;          // exchangeCurrency
  d?: string;         // exchangeDescription
  m: string[];        // tradingMethods (first letter codes)
  l?: {               // location
    c?: string;       // city
    co?: string;      // country
  };
  n?: string;         // notes
  a: number;          // createdAt
  // Maker info
  mk: {
    n?: string;       // displayName
    t: number;        // totalTrades
    r: number;        // successRate
  };
}

// Method code mapping
const METHOD_CODES: Record<string, TradingMethod> = {
  'f': 'face_to_face',
  'b': 'bank_transfer',
  'm': 'mobile_payment',
  'c': 'crypto',
  'g': 'gift_card',
  'o': 'goods',
  's': 'services',
  'x': 'other',
};

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

/**
 * Encode an offer into a compact string for URL sharing
 */
export function encodeOffer(offer: P2POffer): string {
  // Defensive: handle potentially missing makerProfile
  const makerProfile = offer.makerProfile ?? {
    totalTrades: 0,
    successRate: 0,
    displayName: undefined,
  };
  
  const shareable: ShareableOffer = {
    i: offer.offerId || `offer-${Date.now()}`,
    t: offer.offerType === 'buy' ? 'b' : 's',
    z: offer.zecAmount ?? 0,
    v: offer.exchangeValue ?? '0',
    c: offer.exchangeCurrency ?? 'USD',
    m: (offer.tradingMethods ?? ['other']).map(m => METHOD_TO_CODE[m] || 'x'),
    a: offer.createdAt ?? Date.now(),
    mk: {
      t: makerProfile.totalTrades ?? 0,
      r: makerProfile.successRate ?? 0,
    },
  };
  
  // Optional fields
  if (offer.exchangeDescription) {
    shareable.d = offer.exchangeDescription.slice(0, 100);
  }
  if (offer.location?.city) {
    shareable.l = { c: offer.location.city };
    if (offer.location.country) {
      shareable.l.co = offer.location.country;
    }
  }
  if (offer.notes) {
    shareable.n = offer.notes.slice(0, 200);
  }
  if (makerProfile.displayName) {
    shareable.mk.n = makerProfile.displayName.slice(0, 30);
  }
  
  // Encode as base64url
  const json = JSON.stringify(shareable);
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode an offer from a URL-encoded string
 */
export function decodeOffer(encoded: string): P2POffer | null {
  try {
    // Decode from base64url
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const json = atob(padded + padding);
    const shareable: ShareableOffer = JSON.parse(json);
    
    // Defensive: extract maker info with defaults
    const mk = shareable.mk ?? { t: 0, r: 0 };
    const totalTrades = mk.t ?? 0;
    const successRate = mk.r ?? 0;
    const offerId = shareable.i || `decoded-${Date.now()}`;
    const createdAt = shareable.a ?? Date.now();
    
    // Reconstruct the offer
    const makerProfile: P2PUserProfile = {
      address: `shared-${offerId.slice(0, 8)}`,
      displayName: mk.n,
      totalTrades,
      successfulTrades: Math.floor(totalTrades * (successRate / 100)),
      totalVolumeZec: 0,
      successRate,
      registeredAt: createdAt,
      lastActiveAt: createdAt,
      isVerified: false,
    };
    
    const offer: P2POffer = {
      offerId,
      maker: makerProfile.address,
      makerProfile,
      offerType: shareable.t === 'b' ? 'buy' : 'sell',
      zecAmount: shareable.z ?? 0,
      exchangeValue: shareable.v ?? '0',
      exchangeCurrency: shareable.c ?? 'USD',
      exchangeDescription: shareable.d,
      tradingMethods: (shareable.m ?? ['x']).map(c => METHOD_CODES[c] || 'other'),
      location: shareable.l ? {
        city: shareable.l.c,
        country: shareable.l.co,
      } : undefined,
      notes: shareable.n || '',
      status: 'active',
      createdAt,
      completedTrades: 0,
      shieldedAddressCommitment: '',
    };
    
    return offer;
  } catch (e) {
    console.error('Failed to decode offer:', e);
    return null;
  }
}

/**
 * Generate a shareable URL for an offer
 */
export function getShareableUrl(offer: P2POffer): string {
  const encoded = encodeOffer(offer);
  const baseUrl = window.location.origin;
  return `${baseUrl}/p2p/offer/${offer.offerId}?share=${encoded}`;
}

/**
 * Extract encoded offer from URL search params
 */
export function getOfferFromUrl(searchParams: URLSearchParams): P2POffer | null {
  const encoded = searchParams.get('share');
  if (!encoded) return null;
  return decodeOffer(encoded);
}

/**
 * Format offer as shareable text
 */
export function formatOfferAsText(offer: P2POffer): string {
  const type = offer.offerType === 'sell' ? 'Selling' : 'Buying';
  const tradingMethods = offer.tradingMethods ?? ['other'];
  const methods = tradingMethods.map(m => {
    const codes: Record<TradingMethod, string> = {
      'face_to_face': '🤝 Face to Face',
      'bank_transfer': '🏦 Bank Transfer',
      'mobile_payment': '📱 Mobile Payment',
      'crypto': '₿ Crypto',
      'gift_card': '🎁 Gift Card',
      'goods': '📦 Goods',
      'services': '⚡ Services',
      'other': '✨ Other',
    };
    return codes[m] || '✨ Other';
  }).join(', ');
  
  // Defensive: handle potentially missing values
  const zecAmount = offer.zecAmount ?? 0;
  const exchangeValue = offer.exchangeValue ?? '0';
  const exchangeCurrency = offer.exchangeCurrency ?? 'USD';
  const makerProfile = offer.makerProfile ?? { displayName: undefined, totalTrades: 0, successRate: 0 };
  
  let text = `🔒 ZEC P2P Offer\n\n`;
  text += `${type === 'Selling' ? '📤' : '📥'} ${type} ${zecAmount} ZEC\n`;
  text += `💰 For: ${exchangeValue} ${exchangeCurrency}\n`;
  text += `📍 Methods: ${methods}\n`;
  
  if (offer.location?.city) {
    text += `📍 Location: ${offer.location.city}${offer.location.country ? `, ${offer.location.country}` : ''}\n`;
  }
  
  if (offer.notes) {
    text += `📝 Notes: ${offer.notes}\n`;
  }
  
  text += `\n👤 Trader: ${makerProfile.displayName || 'Anonymous'} (${makerProfile.totalTrades ?? 0} trades, ${makerProfile.successRate ?? 0}% success)\n`;
  text += `\n🔗 View offer: ${getShareableUrl(offer)}`;
  
  return text;
}

/**
 * Generate QR code data URL for an offer
 * Uses a simple QR code generation approach
 */
export async function generateOfferQRCode(offer: P2POffer): Promise<string> {
  const url = getShareableUrl(offer);
  
  // Use the QR Code API (free, no API key needed)
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}&margin=10`;
  
  return qrApiUrl;
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      document.body.removeChild(textarea);
      return false;
    }
  }
}

/**
 * Share via Web Share API if available
 */
export async function shareOffer(offer: P2POffer): Promise<boolean> {
  const text = formatOfferAsText(offer);
  const url = getShareableUrl(offer);
  const zecAmount = offer.zecAmount ?? 0;
  const title = `ZEC P2P: ${offer.offerType === 'sell' ? 'Selling' : 'Buying'} ${zecAmount} ZEC`;
  
  if (navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url,
      });
      return true;
    } catch (e) {
      // User cancelled or share failed
      if ((e as Error).name !== 'AbortError') {
        console.error('Share failed:', e);
      }
      return false;
    }
  }
  
  // Fallback: copy to clipboard
  return copyToClipboard(text);
}

