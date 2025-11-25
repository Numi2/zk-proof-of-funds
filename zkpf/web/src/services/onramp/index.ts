/**
 * On-Ramp Service
 * 
 * Public API for USDC on-ramp functionality.
 * Provides a unified interface for integrating multiple on-ramp providers.
 */

// Types
export type {
  OnRampProvider,
  OnRampStatus,
  PaymentMethod,
  OnRampSession,
  OnRampQuote,
  StartOnRampRequest,
  StartOnRampResponse,
  GetQuoteRequest,
  GetQuoteResponse,
  OnRampWebhookPayload,
  OnRampConfig,
  ProviderCapabilities,
  OnRampEvent,
  OnRampEventHandler,
  OnRampProviderAdapter,
} from './types';

export {
  DEFAULT_ONRAMP_CONFIG,
  PROVIDER_CAPABILITIES,
} from './types';

// Hooks
export {
  useOnRamp,
  useOnRampSession,
  useUsdcBalance,
} from './hooks';

// Provider adapters
export {
  CoinbaseOnrampAdapter,
  createCoinbaseAdapter,
  validateCoinbaseWebhook,
  parseCoinbaseWebhook,
  type CoinbaseOnrampConfig,
  type CoinbaseWebhookEvent,
} from './providers/coinbase';

