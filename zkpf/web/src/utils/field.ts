export const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

export function normalizeField(value: bigint): bigint {
  const mod = value % FIELD_MODULUS;
  return mod >= 0n ? mod : mod + FIELD_MODULUS;
}

export function bigIntToLittleEndianBytes(value: bigint, byteLength = 32): Uint8Array {
  let temp = normalizeField(value);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('hex input must have an even length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }
  return value;
}

export function littleEndianHexFromField(value: bigint): string {
  return bytesToHex(bigIntToLittleEndianBytes(value));
}

export function numberArrayFromBytes(bytes: Uint8Array): number[] {
  return Array.from(bytes, (b) => Number(b));
}

