/**
 * P2P Marketplace Types
 * 
 * Human-friendly peer-to-peer trading for Zcash.
 * Trade ZEC for anything - fiat, crypto, goods, services.
 * Meet in person or online. Assume trust, let people decide.
 */

export type OfferType = 'sell' | 'buy';

export type OfferStatus = 'active' | 'in_trade' | 'completed' | 'cancelled';

export type TradeStatus = 
  | 'pending'
  | 'escrow_locked'
  | 'fiat_sent'        // Alias for payment_sent
  | 'payment_sent'
  | 'completed'
  | 'disputed'
  | 'cancelled'
  | 'released'
  | 'refunded';

// Payment methods for fiat trades (compatible naming)
export type PaymentMethod = 
  | 'bank_transfer'
  | 'sepa'
  | 'ach'
  | 'wise'
  | 'revolut'
  | 'paypal'
  | 'venmo'
  | 'cashapp'
  | 'zelle'
  | 'cash'
  | 'crypto'
  | 'other';

// Payment method UI labels and icons
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank Transfer',
  sepa: 'SEPA Transfer',
  ach: 'ACH Transfer',
  wise: 'Wise',
  revolut: 'Revolut',
  paypal: 'PayPal',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  zelle: 'Zelle',
  cash: 'Cash (In Person)',
  crypto: 'Other Crypto',
  other: 'Other',
};

export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  bank_transfer: '🏦',
  sepa: '🇪🇺',
  ach: '🇺🇸',
  wise: '💸',
  revolut: '💳',
  paypal: '🅿️',
  venmo: '💵',
  cashapp: '💲',
  zelle: '⚡',
  cash: '💵',
  crypto: '₿',
  other: '📋',
};

// Trading methods - how will you exchange?
export type TradingMethod = 
  | 'face_to_face'     // Meet in person
  | 'bank_transfer'    // Traditional bank
  | 'mobile_payment'   // Venmo, CashApp, Zelle, etc.
  | 'crypto'           // Other crypto
  | 'gift_card'        // Gift cards
  | 'goods'            // Physical goods
  | 'services'         // Services/work
  | 'other';           // Custom method

export const TRADING_METHOD_INFO: Record<TradingMethod, { label: string; icon: string; description: string }> = {
  face_to_face: { 
    label: 'Face to Face', 
    icon: '🤝', 
    description: 'Meet in person to exchange'
  },
  bank_transfer: { 
    label: 'Bank Transfer', 
    icon: '🏦', 
    description: 'Wire or ACH transfer'
  },
  mobile_payment: { 
    label: 'Mobile Payment', 
    icon: '📱', 
    description: 'Venmo, CashApp, Zelle, PayPal...'
  },
  crypto: { 
    label: 'Crypto', 
    icon: '₿', 
    description: 'Trade for other cryptocurrencies'
  },
  gift_card: { 
    label: 'Gift Card', 
    icon: '🎁', 
    description: 'Amazon, Steam, etc.'
  },
  goods: { 
    label: 'Goods', 
    icon: '📦', 
    description: 'Trade ZEC for physical items'
  },
  services: { 
    label: 'Services', 
    icon: '⚡', 
    description: 'Trade ZEC for work or services'
  },
  other: { 
    label: 'Other', 
    icon: '✨', 
    description: 'Custom arrangement'
  },
};

// Common currencies for quick selection
export const COMMON_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'BTC', symbol: '₿', name: 'Bitcoin' },
  { code: 'ETH', symbol: 'Ξ', name: 'Ethereum' },
  { code: 'USDC', symbol: '$', name: 'USDC' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican Peso' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'THB', symbol: '฿', name: 'Thai Baht' },
  { code: 'VND', symbol: '₫', name: 'Vietnamese Dong' },
  { code: 'PHP', symbol: '₱', name: 'Philippine Peso' },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian Rupiah' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  { code: 'TWD', symbol: 'NT$', name: 'Taiwan Dollar' },
  { code: 'ARS', symbol: 'ARS$', name: 'Argentine Peso' },
  { code: 'CLP', symbol: 'CLP$', name: 'Chilean Peso' },
  { code: 'COP', symbol: 'COP$', name: 'Colombian Peso' },
  { code: 'PEN', symbol: 'S/', name: 'Peruvian Sol' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'TRY', symbol: '₺', name: 'Turkish Lira' },
  { code: 'RUB', symbol: '₽', name: 'Russian Ruble' },
  { code: 'PLN', symbol: 'zł', name: 'Polish Zloty' },
  { code: 'CZK', symbol: 'Kč', name: 'Czech Koruna' },
  { code: 'HUF', symbol: 'Ft', name: 'Hungarian Forint' },
  { code: 'SEK', symbol: 'kr', name: 'Swedish Krona' },
  { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone' },
  { code: 'DKK', symbol: 'kr', name: 'Danish Krone' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'ILS', symbol: '₪', name: 'Israeli Shekel' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
  { code: 'EGP', symbol: 'E£', name: 'Egyptian Pound' },
  { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
];

export interface P2POffer {
  offerId: string;
  maker: string;
  makerProfile: P2PUserProfile;
  offerType: OfferType;
  
  // ZEC amount - supports both ZEC and zatoshi formats
  zecAmount: number;                    // In ZEC (e.g., 1.5)
  zecAmountZatoshi?: number;            // In zatoshi (e.g., 150000000)
  
  // What you're trading for - completely flexible
  exchangeValue: string;                // e.g. "500", "0.01", "1"
  exchangeCurrency: string;             // e.g. "USD", "BTC", "Coffee", "Laptop"
  exchangeDescription?: string;         // Optional details
  
  // Fiat-specific properties (for structured fiat trades)
  fiatAmountCents?: number;             // Amount in cents
  fiatCurrency?: string;                // Currency code
  pricePerZecCents?: number;            // Price per ZEC in cents
  
  // Trade limits - supports both ZEC and zatoshi formats
  minTradeZec?: number;
  maxTradeZec?: number;
  minTradeZatoshi?: number;
  maxTradeZatoshi?: number;
  
  // How to trade
  tradingMethods: TradingMethod[];
  paymentMethods?: PaymentMethod[];     // Specific payment methods
  
  // Timing
  paymentWindow?: number;               // Payment window in minutes
  
  // Location (for face-to-face)
  location?: {
    city?: string;
    country?: string;
    area?: string;              // Neighborhood, district
    meetingPoints?: string;     // Suggested spots
  };
  
  // Terms & notes (freeform)
  notes: string;
  terms?: string;                       // Trade terms
  
  // Status
  status: OfferStatus;
  createdAt: number;
  expiresAt?: number;
  completedTrades: number;
  
  // Privacy
  shieldedAddressCommitment: string;
  
  // Broadcast metadata
  isBroadcast?: boolean;          // True if received from P2P broadcast network
  isImported?: boolean;           // True if imported via share link
}

export interface P2PTrade {
  tradeId: string;
  offerId: string;
  offer: P2POffer;
  
  seller: string;
  sellerProfile: P2PUserProfile;
  buyer: string;
  buyerProfile: P2PUserProfile;
  
  // Trade amounts - supports both ZEC and zatoshi formats
  zecAmount: number;                    // In ZEC
  zecAmountZatoshi?: number;            // In zatoshi
  exchangeValue: string;
  exchangeCurrency: string;
  
  // Fiat-specific properties
  fiatAmountCents?: number;             // Fiat amount in cents
  fiatCurrency?: string;                // Currency code
  
  // Method used
  tradingMethod: TradingMethod;
  paymentMethod?: PaymentMethod;        // Specific payment method
  
  // Payment details
  paymentInstructions?: string;         // Seller's payment instructions
  paymentReference?: string;            // Buyer's payment reference/txid
  
  // For face-to-face
  meetingDetails?: string;
  
  // Buyer's shielded address
  buyerShieldedCommitment: string;
  
  // Escrow (optional - trust-based system)
  useEscrow: boolean;
  escrowCommitment?: string;
  
  // Status & timing
  status: TradeStatus;
  createdAt: number;
  expiresAt?: number;                   // When trade expires
  completedAt?: number;
  
  // Dispute
  disputeReason?: string;               // Reason for dispute if any
  
  // Chat
  messages: P2PMessage[];
}

export interface P2PMessage {
  messageId: string;
  tradeId: string;
  sender: string;
  content: string;
  timestamp: number;
  encrypted: boolean;
}

export interface P2PUserProfile {
  address: string;
  displayName?: string;
  bio?: string;
  
  // Stats - supports both ZEC and zatoshi formats
  totalTrades: number;
  successfulTrades: number;
  totalVolumeZec: number;
  totalVolumeZatoshi?: number;          // In zatoshi
  
  // Computed
  successRate: number;
  
  // Dispute history
  disputesWon?: number;
  disputesLost?: number;
  
  // Performance
  avgTradeTimeMinutes?: number;
  
  // Registration
  registeredAt: number;
  lastActiveAt: number;
  
  // Verification (minimal - trust-based)
  isVerified: boolean;
}

// Offer creation
export interface CreateOfferParams {
  offerType: OfferType;
  zecAmount: number;
  exchangeValue: string;
  exchangeCurrency: string;
  exchangeDescription?: string;
  minTradeZec?: number;
  maxTradeZec?: number;
  tradingMethods: TradingMethod[];
  location?: {
    city?: string;
    country?: string;
    area?: string;
    meetingPoints?: string;
  };
  notes: string;
  expiresAt?: number;
  shieldedAddressCommitment: string;
}

// Filter/sort options
export interface OfferFilters {
  offerType?: OfferType;
  tradingMethods?: TradingMethod[];
  currency?: string;
  location?: string;
  minZec?: number;
  maxZec?: number;
}

export type OfferSortBy = 'recent' | 'amount' | 'reputation';
export type SortDirection = 'asc' | 'desc';

// Marketplace stats
export interface MarketplaceStats {
  totalActiveOffers: number;
  totalCompletedTrades: number;
  totalVolumeZec: number;
  tradersOnline: number;
}

// ============ Helper functions ============

export function zatoshiToZec(zatoshi: number | null | undefined): number {
  return (zatoshi ?? 0) / 100_000_000;
}

export function zecToZatoshi(zec: number | null | undefined): number {
  return Math.floor((zec ?? 0) * 100_000_000);
}

export function formatZec(zatoshi: number | null | undefined, decimals = 4): string {
  const safeZatoshi = zatoshi ?? 0;
  const maxDecimals = Math.max(0, decimals);
  const minDecimals = Math.min(2, maxDecimals);
  
  return zatoshiToZec(safeZatoshi).toLocaleString(undefined, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatZecFromZec(zec: number | null | undefined, decimals = 4): string {
  const safeZec = zec ?? 0;
  const maxDecimals = Math.max(0, decimals);
  const minDecimals = Math.min(2, maxDecimals);
  
  return safeZec.toLocaleString(undefined, {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
}

export function getCurrencySymbol(currency: string | null | undefined): string {
  if (!currency) return '';
  const found = COMMON_CURRENCIES.find(c => c.code.toLowerCase() === currency.toLowerCase());
  return found?.symbol || '';
}

export function formatExchangeValue(value: string | null | undefined, currency: string | null | undefined): string {
  const safeValue = value ?? '0';
  const safeCurrency = currency ?? '';
  const symbol = getCurrencySymbol(safeCurrency);
  const numValue = parseFloat(safeValue);
  
  if (isNaN(numValue)) return `${safeValue} ${safeCurrency}`;
  
  // For fiat-like currencies, format with 2 decimals
  const isFiat = COMMON_CURRENCIES.some(c => 
    c.code === safeCurrency && !['BTC', 'ETH'].includes(c.code)
  );
  
  if (isFiat) {
    return `${symbol}${numValue.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  
  // For crypto or custom, show as-is
  return symbol ? `${symbol}${safeValue}` : `${safeValue} ${safeCurrency}`;
}

export function getReputationBadge(profile: P2PUserProfile | null | undefined): { label: string; color: string } {
  // Defensive: handle missing or undefined profile
  if (!profile) return { label: 'New', color: 'neutral' };
  
  const trades = profile.totalTrades ?? 0;
  const rate = profile.successRate ?? 0;
  
  if (trades === 0) return { label: 'New', color: 'neutral' };
  if (trades < 5) return { label: 'Getting Started', color: 'neutral' };
  if (trades < 20 && rate >= 90) return { label: 'Active', color: 'good' };
  if (trades < 50 && rate >= 95) return { label: 'Trusted', color: 'great' };
  if (trades >= 50 && rate >= 98) return { label: 'Veteran', color: 'excellent' };
  if (rate < 80) return { label: 'Caution', color: 'warning' };
  return { label: 'Active', color: 'good' };
}

export function getTradeStatusInfo(status: TradeStatus): { label: string; color: string } {
  const info: Record<TradeStatus, { label: string; color: string }> = {
    pending: { label: 'Awaiting confirmation', color: 'amber' },
    escrow_locked: { label: 'ZEC secured', color: 'blue' },
    fiat_sent: { label: 'Fiat sent', color: 'purple' },
    payment_sent: { label: 'Payment sent', color: 'purple' },
    completed: { label: 'Complete', color: 'green' },
    disputed: { label: 'Disputed', color: 'red' },
    cancelled: { label: 'Cancelled', color: 'gray' },
    released: { label: 'ZEC released', color: 'green' },
    refunded: { label: 'Refunded', color: 'orange' },
  };
  return info[status];
}

// ============ Fiat helpers ============

export function formatFiat(cents: number | null | undefined, currency: string | null | undefined): string {
  const safeCents = cents ?? 0;
  const safeCurrency = currency ?? '';
  const amount = safeCents / 100;
  const symbol = getCurrencySymbol(safeCurrency);
  
  // Format based on currency type
  const isCrypto = ['BTC', 'ETH', 'USDC'].includes(safeCurrency);
  
  if (isCrypto) {
    return `${symbol}${amount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    })}`;
  }
  
  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPricePerZec(priceCents: number | null | undefined, currency: string | null | undefined): string {
  return `${formatFiat(priceCents, currency)} / ZEC`;
}

// ============ Trade status helpers ============

export function getTradeStatusLabel(status: TradeStatus): string {
  const labels: Record<TradeStatus, string> = {
    pending: 'Pending',
    escrow_locked: 'ZEC Locked',
    fiat_sent: 'Fiat Sent',
    payment_sent: 'Payment Sent',
    completed: 'Completed',
    disputed: 'Disputed',
    cancelled: 'Cancelled',
    released: 'Released',
    refunded: 'Refunded',
  };
  return labels[status] || status;
}

export function getTradeStatusColor(status: TradeStatus): string {
  const colors: Record<TradeStatus, string> = {
    pending: '#f59e0b',      // amber
    escrow_locked: '#3b82f6', // blue
    fiat_sent: '#a855f7',    // purple
    payment_sent: '#a855f7', // purple
    completed: '#22c55e',    // green
    disputed: '#ef4444',     // red
    cancelled: '#6b7280',    // gray
    released: '#22c55e',     // green
    refunded: '#f97316',     // orange
  };
  return colors[status] || '#6b7280';
}

// ============ Reputation helpers ============

export type ReputationTier = 'New' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';

export function getReputationTier(profile: P2PUserProfile | null | undefined): ReputationTier {
  // Defensive: handle missing or undefined profile
  if (!profile) return 'New';
  
  const trades = profile.totalTrades ?? 0;
  const rate = profile.successRate ?? 0;
  
  if (trades === 0) return 'New';
  if (trades < 5) return 'Bronze';
  if (trades < 20 && rate >= 90) return 'Silver';
  if (trades < 50 && rate >= 95) return 'Gold';
  if (trades >= 50 && rate >= 98) return 'Platinum';
  if (trades >= 100 && rate >= 99) return 'Diamond';
  return 'Bronze';
}

export function timeAgo(timestamp: number | null | undefined): string {
  const safeTimestamp = timestamp ?? Date.now();
  const seconds = Math.floor((Date.now() - safeTimestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  
  return new Date(safeTimestamp).toLocaleDateString();
}
