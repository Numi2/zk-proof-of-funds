/**
 * Transaction proposal helpers.
 *
 * This module provides utilities for constructing transaction proposals
 * and validating inputs before calling propose_transaction.
 */

import type { TransparentInput, PaymentRequest, Payment } from './types';
import { Network, PcztError, PcztErrorType, isTransparentAddress, isOrchardAddress } from './types';

/**
 * ZIP 317 fee calculation constants.
 */
export const ZIP317 = {
  /** Base fee in zatoshis */
  BASE_FEE: 10_000n,
  /** Marginal fee per logical action in zatoshis */
  MARGINAL_FEE: 5_000n,
  /** Grace actions that don't incur marginal fee */
  GRACE_ACTIONS: 2,
} as const;

/**
 * Estimate the transaction fee using ZIP 317 rules.
 *
 * @param inputs - The transparent inputs to spend
 * @param request - The payment request
 * @returns The estimated fee in zatoshis
 */
export function estimateFee(
  inputs: TransparentInput[],
  request: PaymentRequest
): bigint {
  const transparentInputCount = inputs.length;
  const transparentOutputCount = request.payments.filter((p) =>
    isTransparentAddress(p.address)
  ).length;
  const orchardOutputCount = request.payments.filter((p) =>
    isOrchardAddress(p.address)
  ).length;

  // Logical actions for fee calculation
  // Orchard outputs count as 2 actions each (one for the action, one for the proof)
  const logicalActions = Math.max(
    transparentInputCount,
    transparentOutputCount + orchardOutputCount * 2
  );

  const fee =
    ZIP317.BASE_FEE +
    ZIP317.MARGINAL_FEE *
      BigInt(Math.max(0, logicalActions - ZIP317.GRACE_ACTIONS));

  return fee;
}

/**
 * Validate that inputs have sufficient funds for the transaction.
 *
 * @param inputs - The transparent inputs
 * @param request - The payment request
 * @param fee - The fee (optional, will be estimated if not provided)
 * @throws PcztError if funds are insufficient
 */
export function validateSufficientFunds(
  inputs: TransparentInput[],
  request: PaymentRequest,
  fee?: bigint
): void {
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0n);
  const totalOutput = request.payments.reduce((sum, p) => sum + p.amount, 0n);
  const estimatedFee = fee ?? estimateFee(inputs, request);

  const required = totalOutput + estimatedFee;

  if (totalInput < required) {
    throw new PcztError(
      PcztErrorType.InsufficientFunds,
      `Insufficient funds: available ${totalInput} zatoshis, required ${required} zatoshis`,
      { available: totalInput, required }
    );
  }
}

/**
 * Calculate the change amount for a transaction.
 *
 * @param inputs - The transparent inputs
 * @param request - The payment request
 * @param fee - The fee (optional, will be estimated if not provided)
 * @returns The change amount in zatoshis
 */
export function calculateChange(
  inputs: TransparentInput[],
  request: PaymentRequest,
  fee?: bigint
): bigint {
  const totalInput = inputs.reduce((sum, input) => sum + input.value, 0n);
  const totalOutput = request.payments.reduce((sum, p) => sum + p.amount, 0n);
  const estimatedFee = fee ?? estimateFee(inputs, request);

  return totalInput - totalOutput - estimatedFee;
}

/**
 * Validate a transparent input.
 *
 * @param input - The input to validate
 * @throws PcztError if the input is invalid
 */
export function validateTransparentInput(input: TransparentInput): void {
  // Validate txid is 64 hex characters (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(input.txid)) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid txid: must be 64 hex characters, got ${input.txid.length}`
    );
  }

  // Validate vout is non-negative
  if (input.vout < 0) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid vout: must be non-negative, got ${input.vout}`
    );
  }

  // Validate value is positive
  if (input.value <= 0n) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid value: must be positive, got ${input.value}`
    );
  }

  // Validate scriptPubKey is hex
  if (!/^[0-9a-fA-F]*$/.test(input.scriptPubKey)) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Invalid scriptPubKey: must be hex encoded'
    );
  }

  // Validate public key if provided (33 bytes compressed)
  if (input.publicKey && !/^[0-9a-fA-F]{66}$/.test(input.publicKey)) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid publicKey: must be 66 hex characters (33 bytes compressed)`
    );
  }
}

/**
 * Validate a payment.
 *
 * @param payment - The payment to validate
 * @param network - The network for address validation
 * @throws PcztError if the payment is invalid
 */
export function validatePayment(payment: Payment, network: Network): void {
  // Validate address format
  if (!isTransparentAddress(payment.address) && !isOrchardAddress(payment.address)) {
    throw new PcztError(
      PcztErrorType.InvalidAddress,
      `Address must be transparent or unified with Orchard: ${payment.address}`
    );
  }

  // Check network prefix
  const isMainnet = network === Network.Mainnet;
  const hasMainnetPrefix =
    payment.address.startsWith('t1') || payment.address.startsWith('u1');
  const hasTestnetPrefix =
    payment.address.startsWith('tm') || payment.address.startsWith('utest');

  if (isMainnet && hasTestnetPrefix) {
    throw new PcztError(
      PcztErrorType.InvalidAddress,
      `Testnet address cannot be used on mainnet: ${payment.address}`
    );
  }

  if (!isMainnet && hasMainnetPrefix) {
    throw new PcztError(
      PcztErrorType.InvalidAddress,
      `Mainnet address cannot be used on testnet: ${payment.address}`
    );
  }

  // Validate amount
  if (payment.amount <= 0n) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid payment amount: must be positive, got ${payment.amount}`
    );
  }

  // Validate memo (only for shielded outputs)
  if (payment.memo && isTransparentAddress(payment.address)) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Memos can only be attached to shielded outputs'
    );
  }

  // Validate memo length (max 512 bytes)
  if (payment.memo && payment.memo.length > 512) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Memo too long: max 512 bytes, got ${payment.memo.length}`
    );
  }
}

/**
 * Parse a ZIP 321 payment URI into a payment request.
 *
 * @param uri - The ZIP 321 URI (e.g., "zcash:u1...?amount=1.5&memo=Hello")
 * @returns The parsed payment request
 * @throws PcztError if the URI is invalid
 *
 * @example
 * ```typescript
 * const request = parseZip321Uri('zcash:u1abc123?amount=1.5&memo=Thanks!');
 * console.log(request.payments[0].amount); // 150000000n (1.5 ZEC in zatoshis)
 * ```
 */
export function parseZip321Uri(uri: string): PaymentRequest {
  if (!uri.startsWith('zcash:')) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Invalid ZIP 321 URI: must start with "zcash:"'
    );
  }

  const payments: Payment[] = [];

  // Simple single-recipient URI: zcash:address?amount=X&memo=Y
  const [addressPart, queryPart] = uri.slice(6).split('?');

  if (!addressPart) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Invalid ZIP 321 URI: missing address'
    );
  }

  const params = new URLSearchParams(queryPart || '');
  const amountStr = params.get('amount');

  if (!amountStr) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Invalid ZIP 321 URI: missing amount'
    );
  }

  const amountZec = parseFloat(amountStr);
  if (isNaN(amountZec) || amountZec <= 0) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Invalid ZIP 321 URI: invalid amount "${amountStr}"`
    );
  }

  const amountZatoshis = BigInt(Math.round(amountZec * 100_000_000));

  const payment: Payment = {
    address: addressPart,
    amount: amountZatoshis,
  };

  const memo = params.get('memo');
  if (memo) {
    payment.memo = decodeURIComponent(memo);
  }

  const label = params.get('label');
  if (label) {
    payment.label = decodeURIComponent(label);
  }

  const message = params.get('message');
  if (message) {
    payment.message = decodeURIComponent(message);
  }

  payments.push(payment);

  return { payments };
}

/**
 * Generate a ZIP 321 payment URI from a payment request.
 *
 * @param request - The payment request
 * @returns The ZIP 321 URI string
 *
 * @example
 * ```typescript
 * const uri = generateZip321Uri({
 *   payments: [
 *     { address: 'u1...', amount: 150000000n, memo: 'Thanks!' },
 *   ],
 * });
 * console.log(uri); // "zcash:u1...?amount=1.5&memo=Thanks!"
 * ```
 */
export function generateZip321Uri(request: PaymentRequest): string {
  if (request.payments.length === 0) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Cannot generate URI: no payments'
    );
  }

  // For now, only support single-recipient URIs
  if (request.payments.length > 1) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      'Multi-recipient URIs not yet supported'
    );
  }

  const payment = request.payments[0];
  const amountZec = Number(payment.amount) / 100_000_000;

  let uri = `zcash:${payment.address}?amount=${amountZec}`;

  if (payment.memo) {
    uri += `&memo=${encodeURIComponent(payment.memo)}`;
  }

  if (payment.label) {
    uri += `&label=${encodeURIComponent(payment.label)}`;
  }

  if (payment.message) {
    uri += `&message=${encodeURIComponent(payment.message)}`;
  }

  return uri;
}

