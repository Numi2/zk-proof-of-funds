// Utility functions for URI-Encapsulated Payments

import type { UriPayment, PaymentState, UriPaymentStatus } from './types';

// Constants
export const MAINNET_HOST = 'pay.withzcash.com';
export const TESTNET_HOST = 'pay.testzcash.com';
export const MAINNET_KEY_HRP = 'zkey';
export const TESTNET_KEY_HRP = 'zkeytest';
export const STANDARD_FEE_ZATS = 1000; // 0.00001 ZEC

// ============================================================================
// Bech32m Encoding/Decoding (BIP-350 compliant)
// ============================================================================

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CHARSET_MAP: Record<string, number> = {};
for (let i = 0; i < BECH32_CHARSET.length; i++) {
  BECH32_CHARSET_MAP[BECH32_CHARSET[i]] = i;
}

// Bech32m constant (BIP-350)
const BECH32M_CONST = 0x2bc830a3;

/**
 * Bech32m polymod checksum calculation
 */
function bech32mPolymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GEN[i];
      }
    }
  }
  return chk;
}

/**
 * Expand HRP for checksum calculation
 */
function hrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) >> 5);
  }
  result.push(0);
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) & 31);
  }
  return result;
}

/**
 * Verify Bech32m checksum
 */
function verifyBech32mChecksum(hrp: string, data: number[]): boolean {
  return bech32mPolymod(hrpExpand(hrp).concat(data)) === BECH32M_CONST;
}

/**
 * Create Bech32m checksum
 */
function createBech32mChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32mPolymod(values) ^ BECH32M_CONST;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }
  return checksum;
}

/**
 * Convert between bit sizes
 */
function convertBits(data: number[] | Uint8Array, fromBits: number, toBits: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      return null;
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    return null;
  }

  return result;
}

/**
 * Encode bytes as Bech32m string
 */
export function bech32mEncode(hrp: string, data: Uint8Array): string {
  const data5bit = convertBits(data, 8, 5, true);
  if (data5bit === null) {
    throw new Error('Failed to convert data to 5-bit');
  }
  const checksum = createBech32mChecksum(hrp, data5bit);
  const combined = data5bit.concat(checksum);
  
  let result = hrp + '1';
  for (const d of combined) {
    result += BECH32_CHARSET[d];
  }
  return result;
}

/**
 * Decode Bech32m string to bytes
 * Returns { hrp, data } or null if invalid
 */
export function bech32mDecode(str: string): { hrp: string; data: Uint8Array } | null {
  // Check for mixed case
  const lower = str.toLowerCase();
  const upper = str.toUpperCase();
  if (str !== lower && str !== upper) {
    return null;
  }
  const bech = lower;

  // Find separator
  const sepPos = bech.lastIndexOf('1');
  if (sepPos < 1 || sepPos + 7 > bech.length || bech.length > 90) {
    return null;
  }

  const hrp = bech.slice(0, sepPos);
  const dataChars = bech.slice(sepPos + 1);

  // Validate HRP characters
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) {
      return null;
    }
  }

  // Decode data characters
  const data5bit: number[] = [];
  for (const char of dataChars) {
    const val = BECH32_CHARSET_MAP[char];
    if (val === undefined) {
      return null;
    }
    data5bit.push(val);
  }

  // Verify checksum
  if (!verifyBech32mChecksum(hrp, data5bit)) {
    return null;
  }

  // Remove checksum (last 6 chars)
  const payload = data5bit.slice(0, -6);

  // Convert from 5-bit to 8-bit
  const data8bit = convertBits(payload, 5, 8, false);
  if (data8bit === null) {
    return null;
  }

  return { hrp, data: new Uint8Array(data8bit) };
}

/**
 * Decode a payment key from Bech32m to bytes
 * Validates HRP matches expected network
 */
export function decodePaymentKey(encoded: string, isTestnet = false): Uint8Array | null {
  const result = bech32mDecode(encoded);
  if (!result) {
    return null;
  }

  const expectedHrp = isTestnet ? TESTNET_KEY_HRP : MAINNET_KEY_HRP;
  if (result.hrp !== expectedHrp) {
    // Also accept if HRP indicates other network
    if (result.hrp !== MAINNET_KEY_HRP && result.hrp !== TESTNET_KEY_HRP) {
      return null;
    }
  }

  // Payment keys should be 32 bytes
  if (result.data.length !== 32) {
    return null;
  }

  return result.data;
}

/**
 * Encode a payment key to Bech32m
 */
export function encodePaymentKey(keyBytes: Uint8Array, isTestnet = false): string {
  const hrp = isTestnet ? TESTNET_KEY_HRP : MAINNET_KEY_HRP;
  return bech32mEncode(hrp, keyBytes);
}

// ============================================================================
// URI Parsing
// ============================================================================

/**
 * Check if a string looks like a URI payment
 */
export function isPaymentUri(s: string): boolean {
  const trimmed = s.trim();
  return (
    (trimmed.startsWith('https://pay.withzcash.com') ||
      trimmed.startsWith('https://pay.testzcash.com')) &&
    trimmed.includes('#') &&
    trimmed.includes('amount=') &&
    trimmed.includes('key=')
  );
}

/**
 * Parse a URI payment string
 */
export function parsePaymentUri(uri: string): UriPayment | null {
  try {
    const trimmed = uri.trim();

    // Check scheme
    if (!trimmed.startsWith('https://')) {
      return null;
    }

    // Find fragment
    const fragmentStart = trimmed.indexOf('#');
    if (fragmentStart === -1) {
      return null;
    }

    const base = trimmed.slice(8, fragmentStart); // Skip "https://"
    const fragment = trimmed.slice(fragmentStart + 1);

    // Determine network
    const isTestnet = base.startsWith(TESTNET_HOST);
    if (!isTestnet && !base.startsWith(MAINNET_HOST)) {
      return null;
    }

    // Parse fragment parameters
    const params = new URLSearchParams(fragment);
    const amountStr = params.get('amount');
    const keyStr = params.get('key');
    const desc = params.get('desc');

    if (!amountStr || !keyStr) {
      return null;
    }

    // Parse amount
    const amountZats = parseZecAmount(amountStr);
    if (amountZats === null) {
      return null;
    }

    return {
      amountZats,
      amountZec: amountStr,
      description: desc || undefined,
      keyHex: keyStr, // Note: This is Bech32-encoded, not hex
      isTestnet,
      uri: trimmed,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a ZEC amount string to zatoshis
 */
export function parseZecAmount(amountStr: string): number | null {
  const trimmed = amountStr.trim();
  if (!trimmed) return null;

  const parts = trimmed.split('.');
  if (parts.length > 2) return null;

  const wholePart = parts[0] || '0';
  const fracPart = parts[1] || '';

  // Max 8 decimal places
  if (fracPart.length > 8) return null;

  const whole = parseInt(wholePart, 10);
  if (isNaN(whole)) return null;

  const wholeZats = whole * 100_000_000;

  let fracZats = 0;
  if (fracPart) {
    const padded = fracPart.padEnd(8, '0');
    fracZats = parseInt(padded.slice(0, 8), 10);
    if (isNaN(fracZats)) return null;
  }

  return wholeZats + fracZats;
}

/**
 * Format zatoshis as ZEC string
 */
export function formatZecAmount(zats: number): string {
  const whole = Math.floor(zats / 100_000_000);
  const frac = zats % 100_000_000;

  if (frac === 0) {
    return whole.toString();
  }

  const fracStr = frac.toString().padStart(8, '0');
  const trimmed = fracStr.replace(/0+$/, '');
  return `${whole}.${trimmed}`;
}

/**
 * Format zatoshis for display (with locale formatting)
 */
export function formatZecDisplay(zats: number): string {
  const zec = zats / 100_000_000;
  return zec.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

/**
 * Generate a random 32-byte key
 */
export function generateRandomKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generate a shareable message for a payment
 */
export function generateShareableMessage(payment: UriPayment): string {
  const desc = payment.description || 'Payment';
  return `This message contains a Zcash payment of ${payment.amountZec} ZEC for "${desc}".

Click the following link to view and receive the funds:

${payment.uri}

If you do not yet have a Zcash wallet, see: https://z.cash/wallets`;
}

/**
 * Generate a short display string
 */
export function formatPaymentShort(payment: UriPayment): string {
  const keyPreview =
    payment.keyHex.length > 12
      ? `${payment.keyHex.slice(0, 8)}...${payment.keyHex.slice(-4)}`
      : payment.keyHex;

  if (payment.description) {
    return `${payment.amountZec} ZEC - ${payment.description} (${keyPreview})`;
  }
  return `${payment.amountZec} ZEC (${keyPreview})`;
}

/**
 * Get user-friendly status text
 */
export function getStatusText(status: UriPaymentStatus): string {
  switch (status.state) {
    case 'creating':
      return 'Creating payment...';
    case 'pending':
      return 'Waiting for transaction to appear on chain';
    case 'unconfirmed':
      return `Transaction found (${status.confirmations ?? 0} confirmations)`;
    case 'ready':
      return `Ready to finalize (${status.confirmations ?? 0} confirmations)`;
    case 'finalizing':
      return 'Finalizing payment...';
    case 'finalized':
      return 'Payment finalized successfully';
    case 'cancelled':
      return 'Payment was cancelled';
    case 'invalid':
      return status.error || 'Payment is invalid';
    default:
      return 'Unknown status';
  }
}

/**
 * Get status color class
 */
export function getStatusColor(state: PaymentState): string {
  switch (state) {
    case 'creating':
    case 'pending':
    case 'unconfirmed':
    case 'finalizing':
      return 'status-pending';
    case 'ready':
      return 'status-ready';
    case 'finalized':
      return 'status-success';
    case 'cancelled':
    case 'invalid':
      return 'status-error';
    default:
      return '';
  }
}

/**
 * Storage key for sent payments
 */
export const SENT_PAYMENTS_KEY = 'zkpf-uri-sent-payments';

/**
 * Storage key for received payments
 */
export const RECEIVED_PAYMENTS_KEY = 'zkpf-uri-received-payments';

/**
 * Save sent payments to local storage
 */
export function saveSentPayments(payments: Array<{ id: string; payment: UriPayment; createdAt: number; state: string }>): void {
  try {
    localStorage.setItem(SENT_PAYMENTS_KEY, JSON.stringify(payments));
  } catch (e) {
    console.error('Failed to save sent payments:', e);
  }
}

/**
 * Load sent payments from local storage
 */
export function loadSentPayments(): Array<{ id: string; payment: UriPayment; createdAt: number; state: string }> {
  try {
    const data = localStorage.getItem(SENT_PAYMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load sent payments:', e);
    return [];
  }
}

/**
 * Save received payments to local storage
 */
export function saveReceivedPayments(payments: Array<{ id: string; payment: UriPayment; receivedAt: number; state: string }>): void {
  try {
    localStorage.setItem(RECEIVED_PAYMENTS_KEY, JSON.stringify(payments));
  } catch (e) {
    console.error('Failed to save received payments:', e);
  }
}

/**
 * Load received payments from local storage
 */
export function loadReceivedPayments(): Array<{ id: string; payment: UriPayment; receivedAt: number; state: string }> {
  try {
    const data = localStorage.getItem(RECEIVED_PAYMENTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load received payments:', e);
    return [];
  }
}

