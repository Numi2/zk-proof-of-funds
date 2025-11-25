import type { PolicyDefinition } from '../types/zkpf';

export interface CurrencyMeta {
  code: string;
  label: string;
  decimals: number;
}

const CURRENCY_META: Record<number, CurrencyMeta> = {
  840: { code: 'USD', label: 'United States Dollar', decimals: 2 },
  978: { code: 'EUR', label: 'Euro', decimals: 2 },
  999001: { code: 'ZEC', label: 'Zcash (Orchard)', decimals: 8 },
  5915971: { code: 'ZEC', label: 'Zashi (custodial)', decimals: 8 },
  // Crypto assets
  1027: { code: 'ETH', label: 'Ethereum', decimals: 18 },
  22691: { code: 'STRK', label: 'Starknet Token', decimals: 18 },
  2001: { code: 'USDC', label: 'USD Coin', decimals: 6 },
  2002: { code: 'USDT', label: 'Tether USD', decimals: 6 },
  2003: { code: 'DAI', label: 'Dai Stablecoin', decimals: 18 },
};

const CATEGORY_LABELS: Record<string, string> = {
  FIAT: 'Fiat proof',
  ONCHAIN: 'On-chain proof',
  ZCASH_ORCHARD: 'Zcash Orchard PoF',
  ZASHI: 'Zashi provider session',
  STARKNET: 'Starknet L2 proof',
  STARKNET_DEFI: 'Starknet DeFi proof',
  AXELAR_INTERCHAIN: 'Interchain PoF (Axelar)',
  AXELAR_COSMOS: 'Cosmos broadcast PoF',
  AXELAR_L2: 'L2 broadcast PoF',
  AXELAR_CREDIT: 'Interchain credit line',
  MINA_HUB: 'Mina recursive hub',
  MINA_INSTITUTIONAL: 'Institutional cross-chain',
  MINA_AGGREGATED: 'Multi-chain aggregated',
  USDC: 'USDC stablecoin proof',
  USDC_STARKNET: 'USDC on Starknet',
};

const RAIL_LABELS: Record<string, string> = {
  CUSTODIAL_ATTESTATION: 'Custodial attestation',
  ONCHAIN_WALLET: 'On-chain wallet',
  ZCASH_ORCHARD: 'Zcash Orchard rail',
  STARKNET_L2: 'Starknet L2 rail',
  AXELAR_GMP: 'Axelar GMP rail',
  MINA_RECURSIVE: 'Mina recursive rail',
  PROVIDER_BALANCE_V2: 'Provider balance rail',
};

const numberFormatter = (maximumFractionDigits: number, minimumFractionDigits: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits,
  });

export function getCurrencyMeta(code: number): CurrencyMeta {
  return CURRENCY_META[code] ?? {
    code: String(code),
    label: `Currency ${code}`,
    decimals: 0,
  };
}

export function formatPolicyThreshold(policy: PolicyDefinition): {
  formatted: string;
  numeric: number;
  decimals: number;
  currency: CurrencyMeta;
  isExactZero: boolean;
} {
  const currency = getCurrencyMeta(policy.required_currency_code);
  const divisor = currency.decimals > 0 ? 10 ** currency.decimals : 1;
  const numeric = divisor === 0 ? policy.threshold_raw : policy.threshold_raw / divisor;
  const isExactZero = policy.threshold_raw === 0;
  const maxDigits = currency.decimals > 4 ? 4 : currency.decimals;
  const minDigits = numeric >= 1000 ? 0 : Math.min(2, maxDigits);
  const formatter = numberFormatter(maxDigits, minDigits);
  // For exact zero policies, show "= 0" instead of "≥ 0"
  const formatted = isExactZero
    ? `= 0 ${currency.code}`
    : `${formatter.format(numeric)} ${currency.code}`;
  return { formatted, numeric, decimals: currency.decimals, currency, isExactZero };
}

export function policyDisplayName(policy: PolicyDefinition): string {
  const label = policy.label?.trim();
  if (label) {
    return label;
  }
  return `Policy #${policy.policy_id}`;
}

export function policyCategoryLabel(policy: PolicyDefinition): string {
  const category = policy.category?.toUpperCase() ?? '';
  return CATEGORY_LABELS[category] ?? 'Custom policy';
}

export function policyRailLabel(policy: PolicyDefinition): string {
  const rail = policy.rail_id?.toUpperCase() ?? '';
  return RAIL_LABELS[rail] ?? 'Verifier rail';
}

export function policyShortSummary(policy: PolicyDefinition): string {
  const threshold = formatPolicyThreshold(policy).formatted;
  return `${threshold} · Scope ${policy.verifier_scope_id}`;
}

export function policyNarrative(policy: PolicyDefinition): string {
  const displayName = policyDisplayName(policy);
  const { formatted, isExactZero } = formatPolicyThreshold(policy);
  const scope = `scope ${policy.verifier_scope_id}`;
  const rail = policyRailLabel(policy);
  if (isExactZero) {
    return `${displayName} confirms exactly ${formatted} (empty wallet) for ${scope} via ${rail}.`;
  }
  return `${displayName} enforces ≥ ${formatted} for ${scope} via ${rail}.`;
}

export function matchesPolicyQuery(policy: PolicyDefinition, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const threshold = formatPolicyThreshold(policy).formatted.toLowerCase();
  return (
    policy.policy_id.toString().includes(normalized) ||
    policy.verifier_scope_id.toString().includes(normalized) ||
    (policy.label?.toLowerCase().includes(normalized) ?? false) ||
    threshold.includes(normalized)
  );
}

export function groupPoliciesByCategory(policies: PolicyDefinition[]): Record<string, PolicyDefinition[]> {
  return policies.reduce<Record<string, PolicyDefinition[]>>((acc, policy) => {
    const category = policy.category?.toUpperCase() || 'UNSPECIFIED';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(policy);
    return acc;
  }, {});
}

export function uniqueScopes(policies: PolicyDefinition[]): number {
  return new Set(policies.map((policy) => policy.verifier_scope_id)).size;
}
