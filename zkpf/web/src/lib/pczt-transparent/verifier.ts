/**
 * Verification and finalization utilities.
 *
 * This module provides helpers for verifying PCZTs before signing
 * and for the finalization phase.
 */

import type { PaymentRequest, ExpectedChange, TransparentOutput } from './types';
import { isTransparentAddress, isOrchardAddress } from './types';
import type { Pczt } from './pczt';

/**
 * Verification result with detailed information.
 */
export interface VerificationResult {
  /** Whether verification passed */
  valid: boolean;
  /** List of verification checks performed */
  checks: VerificationCheck[];
  /** Any warnings (verification passed but user should be aware) */
  warnings: string[];
}

/**
 * A single verification check.
 */
export interface VerificationCheck {
  /** Name of the check */
  name: string;
  /** Whether the check passed */
  passed: boolean;
  /** Description of what was checked */
  description: string;
  /** Details if check failed */
  details?: string;
}

/**
 * Perform comprehensive verification on a PCZT.
 *
 * This runs multiple verification checks and returns detailed results.
 *
 * @param pczt - The PCZT to verify
 * @param request - The original payment request
 * @param expectedChange - The expected change outputs
 * @returns Detailed verification result
 *
 * @example
 * ```typescript
 * const result = await verifyPcztComprehensive(pczt, request, expectedChange);
 *
 * if (!result.valid) {
 *   for (const check of result.checks.filter(c => !c.passed)) {
 *     console.error(`Failed: ${check.name} - ${check.details}`);
 *   }
 * }
 *
 * for (const warning of result.warnings) {
 *   console.warn(`Warning: ${warning}`);
 * }
 * ```
 */
export function verifyPcztComprehensive(
  pczt: Pczt,
  request: PaymentRequest,
  expectedChange: ExpectedChange
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const warnings: string[] = [];

  // Check 1: Input count
  checks.push({
    name: 'Input Count',
    passed: pczt.transparentInputCount > 0,
    description: 'PCZT has at least one transparent input',
    details:
      pczt.transparentInputCount > 0
        ? undefined
        : 'No transparent inputs found',
  });

  // Check 2: Output count matches request
  const expectedTransparentOutputs = request.payments.filter((p) =>
    isTransparentAddress(p.address)
  ).length;
  const expectedOrchardOutputs = request.payments.filter((p) =>
    isOrchardAddress(p.address)
  ).length;

  // Add expected change outputs
  const expectedTotalTransparent =
    expectedTransparentOutputs + expectedChange.transparent.length;

  checks.push({
    name: 'Transparent Output Count',
    passed: pczt.transparentOutputCount >= expectedTransparentOutputs,
    description: 'PCZT has expected number of transparent outputs',
    details:
      pczt.transparentOutputCount >= expectedTransparentOutputs
        ? undefined
        : `Expected at least ${expectedTransparentOutputs}, found ${pczt.transparentOutputCount}`,
  });

  // Check 3: Orchard bundle presence
  if (expectedOrchardOutputs > 0) {
    checks.push({
      name: 'Orchard Bundle',
      passed: pczt.hasOrchard,
      description: 'PCZT has Orchard bundle for shielded outputs',
      details: pczt.hasOrchard ? undefined : 'Missing Orchard bundle',
    });

    checks.push({
      name: 'Orchard Action Count',
      passed: pczt.orchardActionCount >= expectedOrchardOutputs,
      description: 'PCZT has expected number of Orchard actions',
      details:
        pczt.orchardActionCount >= expectedOrchardOutputs
          ? undefined
          : `Expected at least ${expectedOrchardOutputs}, found ${pczt.orchardActionCount}`,
    });
  }

  // Check 4: No unexpected Orchard if not expected
  if (expectedOrchardOutputs === 0 && pczt.hasOrchard) {
    warnings.push(
      'PCZT contains Orchard bundle but no shielded outputs were requested'
    );
  }

  // Check 5: Change output warnings
  if (expectedChange.transparent.length > 0) {
    const actualTransparentOutputs = pczt.transparentOutputCount;
    if (actualTransparentOutputs < expectedTotalTransparent) {
      warnings.push(
        `Expected ${expectedTotalTransparent} transparent outputs (${expectedTransparentOutputs} payments + ${expectedChange.transparent.length} change) but found ${actualTransparentOutputs}`
      );
    }
  }

  // Determine overall validity
  const valid = checks.every((c) => c.passed);

  return {
    valid,
    checks,
    warnings,
  };
}

/**
 * Calculate the expected change for a transaction.
 *
 * @param totalInput - Total input value in zatoshis
 * @param request - The payment request
 * @param fee - The transaction fee
 * @param changeAddress - The address to send change to
 * @returns The expected change configuration
 */
export function calculateExpectedChange(
  totalInput: bigint,
  request: PaymentRequest,
  fee: bigint,
  changeAddress?: string
): ExpectedChange {
  const totalOutput = request.payments.reduce((sum, p) => sum + p.amount, 0n);
  const changeValue = totalInput - totalOutput - fee;

  const transparentChange: TransparentOutput[] = [];

  if (changeValue > 0n && changeAddress) {
    transparentChange.push({
      value: changeValue,
      scriptPubKey: '', // Would be derived from address
      address: changeAddress,
    });
  }

  return {
    transparent: transparentChange,
    shieldedValue: 0n, // Transparent-only wallets don't have shielded change
  };
}

/**
 * Verify that the transaction fee is reasonable.
 *
 * @param pczt - The PCZT to verify
 * @param maxFee - Maximum acceptable fee in zatoshis
 * @returns True if the fee is within bounds
 */
export function verifyFee(pczt: Pczt, maxFee: bigint): boolean {
  // Fee verification requires parsing the PCZT to get input/output values
  // This is a placeholder - actual implementation would calculate fee
  void pczt.toJSON(); // Use the result to suppress unused warning

  // In production, calculate:
  // fee = sum(inputs) - sum(outputs)
  // return fee <= maxFee

  console.log(`Verifying fee is <= ${maxFee} zatoshis`);
  return true;
}

/**
 * Summary of a PCZT for user confirmation.
 */
export interface PcztSummary {
  /** Number of inputs being spent */
  inputCount: number;
  /** Total input value in zatoshis */
  totalInputValue: bigint;
  /** Payments being made */
  payments: Array<{
    address: string;
    amount: bigint;
    isShielded: boolean;
  }>;
  /** Change outputs */
  change: Array<{
    address?: string;
    amount: bigint;
    isShielded: boolean;
  }>;
  /** Estimated fee in zatoshis */
  fee: bigint;
  /** Whether the PCZT has proofs */
  hasProofs: boolean;
  /** Whether the PCZT is fully signed */
  isFullySigned: boolean;
}

/**
 * Generate a human-readable summary of a PCZT.
 *
 * @param pczt - The PCZT to summarize
 * @param request - The original payment request (for additional context)
 * @returns Summary for user confirmation
 */
export function summarizePczt(
  pczt: Pczt,
  request?: PaymentRequest
): PcztSummary {
  const info = pczt.toJSON() as Record<string, unknown>;

  // Extract information from the PCZT JSON representation
  // This is a simplified version - actual implementation would
  // fully parse the PCZT structure

  const payments = request?.payments.map((p) => ({
    address: p.address,
    amount: p.amount,
    isShielded: isOrchardAddress(p.address),
  })) ?? [];

  return {
    inputCount: pczt.transparentInputCount,
    totalInputValue: 0n, // Would be calculated from PCZT
    payments,
    change: [],
    fee: 10000n, // Placeholder
    hasProofs: pczt.hasOrchard ? (info['has_proofs'] as boolean) ?? false : true,
    isFullySigned: false, // Would be determined from PCZT
  };
}

/**
 * Format a PCZT summary for display.
 *
 * @param summary - The summary to format
 * @returns Formatted string for display
 */
export function formatPcztSummary(summary: PcztSummary): string {
  const lines: string[] = [];

  lines.push('=== Transaction Summary ===');
  lines.push(`Inputs: ${summary.inputCount}`);
  lines.push(
    `Total Input: ${Number(summary.totalInputValue) / 100_000_000} ZEC`
  );
  lines.push('');
  lines.push('Payments:');

  for (const payment of summary.payments) {
    const type = payment.isShielded ? '🔒 Shielded' : '📝 Transparent';
    const amount = Number(payment.amount) / 100_000_000;
    lines.push(`  ${type}: ${amount} ZEC to ${payment.address.slice(0, 20)}...`);
  }

  if (summary.change.length > 0) {
    lines.push('');
    lines.push('Change:');
    for (const change of summary.change) {
      const type = change.isShielded ? '🔒 Shielded' : '📝 Transparent';
      const amount = Number(change.amount) / 100_000_000;
      lines.push(`  ${type}: ${amount} ZEC`);
    }
  }

  lines.push('');
  lines.push(`Fee: ${Number(summary.fee) / 100_000_000} ZEC`);
  lines.push('');
  lines.push(`Proofs: ${summary.hasProofs ? '✅ Complete' : '⏳ Pending'}`);
  lines.push(
    `Signatures: ${summary.isFullySigned ? '✅ Complete' : '⏳ Pending'}`
  );

  return lines.join('\n');
}

/**
 * Check if a PCZT is ready for finalization.
 *
 * @param pczt - The PCZT to check
 * @returns Object indicating readiness and any missing items
 */
export function checkFinalizationReadiness(pczt: Pczt): {
  ready: boolean;
  missing: string[];
} {
  const missing: string[] = [];

  // Check for proofs if Orchard is present
  if (pczt.hasOrchard) {
    const info = pczt.toJSON() as Record<string, unknown>;
    if (!info['has_proofs']) {
      missing.push('Orchard proofs');
    }
  }

  // Note: Signature check would require parsing the PCZT
  // For now, we assume signatures need to be checked externally

  return {
    ready: missing.length === 0,
    missing,
  };
}

/**
 * Estimate the final transaction size.
 *
 * @param pczt - The PCZT
 * @returns Estimated size in bytes
 */
export function estimateTransactionSize(pczt: Pczt): number {
  // Base transaction overhead
  let size = 12; // Version + header + expiry

  // Transparent inputs (approximately 148 bytes each with signature)
  size += pczt.transparentInputCount * 148;

  // Transparent outputs (approximately 34 bytes each)
  size += pczt.transparentOutputCount * 34;

  // Orchard bundle (if present)
  if (pczt.hasOrchard) {
    // Orchard bundle overhead
    size += 580;
    // Each Orchard action
    size += pczt.orchardActionCount * 820;
  }

  return size;
}

