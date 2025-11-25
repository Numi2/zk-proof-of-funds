import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Compute keccak256 hash of the signature to create holder_tag.
 * The holder_tag = keccak256(signature) provides anonymity while allowing
 * verifiers to confirm "this bundle was bound to the same MetaMask identity"
 * without learning the actual wallet address.
 */
export function computeHolderTag(signature: string): string {
  // Strip 0x prefix if present and convert to bytes
  const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature;
  const sigBytes = hexToBytes(cleanSig);
  
  // Compute keccak256 hash
  const hashBytes = keccak_256(sigBytes);
  
  // Return as 0x-prefixed hex string
  return `0x${bytesToHex(hashBytes)}`;
}

/**
 * Compute keccak256 hash of the funding sources for the binding message.
 * This creates a deterministic fingerprint of the funding sources without
 * revealing the actual contents.
 */
export function hashFundingSources(sources: unknown[]): string {
  const json = JSON.stringify(sources);
  const jsonBytes = new TextEncoder().encode(json);
  const hashBytes = keccak_256(jsonBytes);
  return bytesToHex(hashBytes);
}

/**
 * Convert a hex string to a Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  
  if (!/^[0-9a-fA-F]*$/.test(cleanHex)) {
    throw new Error('Invalid hex string');
  }
  
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  
  return bytes;
}

/**
 * Convert a Uint8Array to a hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
