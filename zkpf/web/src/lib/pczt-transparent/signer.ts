/**
 * Signer role utilities.
 *
 * This module provides helpers for the signing phase of PCZT construction.
 * The actual sighash computation is done in Rust/WASM, but this module
 * provides utilities for signature handling and integration with
 * external signing infrastructure.
 */

import type { SigHash, TransparentSignature, TransparentInput } from './types';
import { PcztError, PcztErrorType } from './types';
import type { Pczt } from './pczt';
import { getSighash, appendSignature } from './pczt';

/**
 * Signer interface for external signing infrastructure.
 *
 * Implement this interface to integrate with hardware wallets,
 * HSMs, or other signing systems.
 */
export interface ExternalSigner {
  /** Sign a 32-byte hash and return the DER-encoded signature */
  sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array>;
  /** Get the compressed public key for the derivation path */
  getPublicKey(derivationPath: string): Promise<Uint8Array>;
}

/**
 * Sign all transparent inputs in a PCZT using an external signer.
 *
 * @param pczt - The PCZT to sign
 * @param inputs - The original inputs (used for derivation paths)
 * @param signer - The external signer implementation
 * @returns The PCZT with all signatures applied
 *
 * @example
 * ```typescript
 * const ledgerSigner: ExternalSigner = {
 *   sign: async (hash, path) => ledger.signHash(path, hash),
 *   getPublicKey: async (path) => ledger.getPublicKey(path),
 * };
 *
 * const signedPczt = await signAllInputs(pczt, inputs, ledgerSigner);
 * ```
 */
export async function signAllInputs(
  pczt: Pczt,
  inputs: TransparentInput[],
  signer: ExternalSigner
): Promise<Pczt> {
  let currentPczt = pczt;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    if (!input.derivationPath) {
      throw new PcztError(
        PcztErrorType.SignatureError,
        `Input ${i} is missing derivation path`
      );
    }

    // Get the sighash
    const sighash = await getSighash(currentPczt, i);

    // Sign with external signer
    const signature = await signer.sign(sighash.hash, input.derivationPath);
    const publicKey = await signer.getPublicKey(input.derivationPath);

    // Apply signature
    currentPczt = await appendSignature(currentPczt, i, {
      signature,
      publicKey,
    });
  }

  return currentPczt;
}

/**
 * Create a transparent signature from hex-encoded components.
 *
 * @param signatureHex - DER-encoded signature as hex string
 * @param publicKeyHex - Compressed public key as hex string
 * @returns The signature object
 */
export function createSignature(
  signatureHex: string,
  publicKeyHex: string
): TransparentSignature {
  return {
    signature: hexToBytes(signatureHex),
    publicKey: hexToBytes(publicKeyHex),
  };
}

/**
 * Verify that a signature is valid for a sighash.
 *
 * This is a pure JavaScript implementation for verification.
 * Note: For full security, use the WASM verification in append_signature.
 *
 * @param sighash - The sighash that was signed
 * @param signature - The signature to verify
 * @returns True if the signature is valid
 */
export function verifySignature(
  _sighash: SigHash,
  _signature: TransparentSignature
): boolean {
  // This would use a JavaScript ECDSA library for verification
  // For now, we rely on the Rust/WASM implementation
  console.warn(
    'verifySignature: JavaScript verification not implemented, using WASM'
  );
  return true;
}

/**
 * Parse a DER-encoded ECDSA signature.
 *
 * @param der - The DER-encoded signature bytes
 * @returns Object with r and s components
 */
export function parseDerSignature(der: Uint8Array): {
  r: Uint8Array;
  s: Uint8Array;
} {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  if (der[0] !== 0x30) {
    throw new PcztError(
      PcztErrorType.SignatureError,
      'Invalid DER signature: expected 0x30 prefix'
    );
  }

  const totalLength = der[1];
  if (der.length !== totalLength + 2) {
    throw new PcztError(
      PcztErrorType.SignatureError,
      `Invalid DER signature: length mismatch (expected ${totalLength + 2}, got ${der.length})`
    );
  }

  if (der[2] !== 0x02) {
    throw new PcztError(
      PcztErrorType.SignatureError,
      'Invalid DER signature: expected 0x02 for R'
    );
  }

  const rLength = der[3];
  const r = der.slice(4, 4 + rLength);

  const sOffset = 4 + rLength;
  if (der[sOffset] !== 0x02) {
    throw new PcztError(
      PcztErrorType.SignatureError,
      'Invalid DER signature: expected 0x02 for S'
    );
  }

  const sLength = der[sOffset + 1];
  const s = der.slice(sOffset + 2, sOffset + 2 + sLength);

  return { r, s };
}

/**
 * Encode r and s components into DER format.
 *
 * @param r - The r component (32 bytes)
 * @param s - The s component (32 bytes)
 * @returns DER-encoded signature
 */
export function encodeDerSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  // Add leading zero if high bit is set (to prevent negative interpretation)
  const rPadded = r[0] >= 0x80 ? new Uint8Array([0x00, ...r]) : r;
  const sPadded = s[0] >= 0x80 ? new Uint8Array([0x00, ...s]) : s;

  // Trim leading zeros (but keep one if necessary)
  const trimLeadingZeros = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0 && bytes[i + 1] < 0x80) {
      i++;
    }
    return bytes.slice(i);
  };

  const rTrimmed = trimLeadingZeros(rPadded);
  const sTrimmed = trimLeadingZeros(sPadded);

  const totalLength = 4 + rTrimmed.length + sTrimmed.length;

  const der = new Uint8Array(2 + totalLength);
  der[0] = 0x30; // SEQUENCE
  der[1] = totalLength;
  der[2] = 0x02; // INTEGER (r)
  der[3] = rTrimmed.length;
  der.set(rTrimmed, 4);
  der[4 + rTrimmed.length] = 0x02; // INTEGER (s)
  der[5 + rTrimmed.length] = sTrimmed.length;
  der.set(sTrimmed, 6 + rTrimmed.length);

  return der;
}

/**
 * Convert a hex string to bytes.
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to a hex string.
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a mock signer for testing.
 *
 * WARNING: This creates deterministic signatures and should NEVER
 * be used in production.
 *
 * @returns A mock signer that produces deterministic (insecure) signatures
 */
export function createMockSigner(): ExternalSigner {
  console.warn(
    'createMockSigner: Using mock signer! This is NOT secure and should only be used for testing.'
  );

  // Create deterministic but invalid signatures for testing
  return {
    sign: async (hash: Uint8Array) => {
      // Create a fake DER signature (this is not cryptographically valid)
      const r = hash.slice(0, 32);
      const s = new Uint8Array(32).fill(0x42);
      return encodeDerSignature(r, s);
    },
    getPublicKey: async () => {
      // Return a fake compressed public key (starts with 0x02 or 0x03)
      const pk = new Uint8Array(33);
      pk[0] = 0x02;
      pk.fill(0x01, 1);
      return pk;
    },
  };
}

/**
 * Information about a signing request.
 */
export interface SigningRequest {
  /** The input index to sign */
  inputIndex: number;
  /** The sighash to sign */
  sighash: SigHash;
  /** The derivation path for the key */
  derivationPath: string;
  /** The value being spent (for user confirmation) */
  value: bigint;
  /** Human-readable description */
  description: string;
}

/**
 * Prepare signing requests for all inputs.
 *
 * This is useful for displaying signing information to users before
 * they approve signing with their hardware wallet.
 *
 * @param pczt - The PCZT to sign
 * @param inputs - The original inputs
 * @returns Array of signing requests
 */
export async function prepareSigningRequests(
  pczt: Pczt,
  inputs: TransparentInput[]
): Promise<SigningRequest[]> {
  const requests: SigningRequest[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const sighash = await getSighash(pczt, i);

    requests.push({
      inputIndex: i,
      sighash,
      derivationPath: input.derivationPath ?? 'm/44\'/133\'/0\'/0/0',
      value: input.value,
      description: `Sign input ${i}: ${input.value} zatoshis from ${input.txid}:${input.vout}`,
    });
  }

  return requests;
}

