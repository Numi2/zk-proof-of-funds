// Types for URI-Encapsulated Payments

/**
 * A parsed URI payment
 */
export interface UriPayment {
  /** Amount in zatoshis */
  amountZats: number;
  /** Amount formatted as ZEC string */
  amountZec: string;
  /** Optional payment description */
  description?: string;
  /** Payment key (32 bytes as hex) */
  keyHex: string;
  /** Whether this is testnet */
  isTestnet: boolean;
  /** Full URI string */
  uri: string;
  /** Payment index if derived from seed */
  paymentIndex?: number;
}

/**
 * Status of a URI payment
 */
export type PaymentState = 
  | 'creating'
  | 'pending'
  | 'unconfirmed'
  | 'ready'
  | 'finalizing'
  | 'finalized'
  | 'cancelled'
  | 'invalid';

export interface UriPaymentStatus {
  state: PaymentState;
  confirmations?: number;
  canFinalize: boolean;
  isFinalized: boolean;
  error?: string;
  txid?: string;
}

/**
 * A sent URI payment (from sender's perspective)
 */
export interface SentUriPayment {
  id: string;
  payment: UriPayment;
  createdAt: number;
  state: 'pending' | 'awaiting_finalization' | 'finalized' | 'cancelled';
  txid?: string;
  recipientNote?: string;
}

/**
 * A received URI payment (from recipient's perspective)
 */
export interface ReceivedUriPayment {
  id: string;
  payment: UriPayment;
  receivedAt: number;
  state: 'checking' | 'pending' | 'ready' | 'finalizing' | 'finalized' | 'invalid';
  finalizationTxid?: string;
  error?: string;
}

/**
 * Configuration for URI payment creation
 */
export interface CreateUriPaymentConfig {
  /** Amount in zatoshis */
  amountZats: number;
  /** Optional description */
  description?: string;
  /** Whether to use testnet */
  isTestnet?: boolean;
  /** Account ID to send from */
  accountId: number;
}

/**
 * Result of creating a URI payment
 */
export interface CreateUriPaymentResult {
  payment: UriPayment;
  txid: string;
  shareableMessage: string;
}

