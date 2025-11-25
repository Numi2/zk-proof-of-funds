import type { PolicyDefinition, CurrencyMeta } from '../types';
import { CURRENCY_META, CATEGORY_LABELS, RAIL_LABELS } from '../types';

/**
 * Get currency metadata for a currency code
 */
export function getCurrencyMeta(code: number): CurrencyMeta {
  return CURRENCY_META[code] ?? {
    code: String(code),
    label: `Currency ${code}`,
    decimals: 0,
  };
}

/**
 * Format a policy threshold for display
 */
export function formatPolicyThreshold(policy: PolicyDefinition): string {
  const currency = getCurrencyMeta(policy.required_currency_code);
  const divisor = currency.decimals > 0 ? 10 ** currency.decimals : 1;
  const numeric = divisor === 0 ? policy.threshold_raw : policy.threshold_raw / divisor;
  
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency.decimals > 4 ? 4 : currency.decimals,
  });
  
  return `${formatter.format(numeric)} ${currency.code}`;
}

/**
 * Get display name for a policy
 */
export function policyDisplayName(policy: PolicyDefinition): string {
  const label = policy.label?.trim();
  if (label) {
    return label;
  }
  return `Policy #${policy.policy_id}`;
}

/**
 * Get category label for display
 */
export function policyCategoryLabel(policy: PolicyDefinition): string {
  const category = policy.category?.toUpperCase() ?? '';
  return CATEGORY_LABELS[category] ?? 'Custom policy';
}

/**
 * Get rail label for display
 */
export function policyRailLabel(policy: PolicyDefinition): string {
  const rail = policy.rail_id?.toUpperCase() ?? '';
  return RAIL_LABELS[rail] ?? 'Verifier rail';
}

/**
 * Get a short summary of the policy
 */
export function policyShortSummary(policy: PolicyDefinition): string {
  const threshold = formatPolicyThreshold(policy);
  return `≥ ${threshold}`;
}

/**
 * Get a full narrative description of the policy
 */
export function policyNarrative(policy: PolicyDefinition): string {
  const displayName = policyDisplayName(policy);
  const threshold = formatPolicyThreshold(policy);
  const scope = `scope ${policy.verifier_scope_id}`;
  const rail = policyRailLabel(policy);
  return `${displayName} enforces ≥ ${threshold} for ${scope} via ${rail}.`;
}

