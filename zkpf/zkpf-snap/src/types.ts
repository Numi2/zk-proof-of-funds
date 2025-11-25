import type { Json } from '@metamask/snaps-sdk';

/**
 * Policy definition from zkpf backend
 */
export interface PolicyDefinition {
  policy_id: number;
  verifier_scope_id: number;
  threshold_raw: number;
  required_currency_code: number;
  category?: string | null;
  rail_id?: string | null;
  label?: string | null;
  options?: Record<string, unknown> | null;
}

/**
 * Funding source types
 */
export type FundingSourceType = 'ethereum' | 'zcash';

/**
 * Ethereum funding source
 */
export interface EthereumFundingSource {
  type: 'ethereum';
  address: string;
  chainId: string;
  balanceWei?: string;
}

/**
 * Zcash funding source
 */
export interface ZcashFundingSource {
  type: 'zcash';
  ufvk: string;
  network: 'main' | 'test';
  snapshotHeight?: number;
  balanceZats?: number;
}

export type FundingSource = EthereumFundingSource | ZcashFundingSource;

/**
 * Holder binding - result of signing attestation with MetaMask
 */
export interface HolderBinding {
  signature: string;
  holderTag: string;
  signerAddress: string;
  message: string;
}

/**
 * Complete proof request ready to be sent to backend
 */
export interface ProofRequest {
  policy: PolicyDefinition;
  fundingSources: FundingSource[];
  holderBinding: HolderBinding;
  timestamp: number;
}

/**
 * Snap state persisted across sessions
 */
export interface SnapState extends Record<string, Json> {
  selectedPolicyId: number | null;
  fundingSources: Json[];
  lastProofTimestamp: number | null;
}

/**
 * RPC request parameters
 */
export interface CreateProofParams {
  policyId: number;
  fundingSources: FundingSource[];
}

export interface SelectPolicyParams {
  policyId: number;
}

export interface AddFundingSourceParams {
  source: FundingSource;
}

export interface BindHolderParams {
  policyId: number;
  fundingSourcesHash: string;
}

/**
 * Currency metadata for display
 */
export interface CurrencyMeta {
  code: string;
  label: string;
  decimals: number;
}

/**
 * Currency code mappings (ISO 4217 and custom codes)
 */
export const CURRENCY_META: Record<number, CurrencyMeta> = {
  840: { code: 'USD', label: 'United States Dollar', decimals: 2 },
  978: { code: 'EUR', label: 'Euro', decimals: 2 },
  999001: { code: 'ZEC', label: 'Zcash (Orchard)', decimals: 8 },
  5915971: { code: 'ZEC', label: 'Zashi (custodial)', decimals: 8 },
};

/**
 * Category labels for display
 */
export const CATEGORY_LABELS: Record<string, string> = {
  FIAT: 'Fiat proof',
  ONCHAIN: 'On-chain proof',
  ZCASH_ORCHARD: 'Zcash Orchard PoF',
  ZASHI: 'Zashi provider session',
};

/**
 * Rail labels for display
 */
export const RAIL_LABELS: Record<string, string> = {
  CUSTODIAL_ATTESTATION: 'Custodial attestation',
  ONCHAIN_WALLET: 'On-chain wallet',
  ZCASH_ORCHARD: 'Zcash Orchard rail',
};

