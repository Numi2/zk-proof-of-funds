import type { ByteArray, VerifierPublicInputs } from '../types/zkpf';

export function toUint8Array(bytes: ByteArray | Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
}

export function bytesToHex(bytes: ByteArray | Uint8Array, group = 4): string {
  const arr = toUint8Array(bytes);
  const hex = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  if (!group) {
    return `0x${hex}`;
  }
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += group * 2) {
    chunks.push(hex.slice(i, i + group * 2));
  }
  return `0x${chunks.join(' ')}`.trim();
}

export function bytesToBase64(bytes: ByteArray | Uint8Array): string {
  const arr = toUint8Array(bytes);
  let binary = '';
  arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function downloadBytes(bytes: ByteArray, filename: string) {
  const arr = toUint8Array(bytes);
  const buffer = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buffer).set(arr);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

export function publicInputsToBytes(inputs: VerifierPublicInputs): ByteArray {
  const json = JSON.stringify(inputs);
  return Array.from(new TextEncoder().encode(json));
}

export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const thresh = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let idx = 0;
  while (size >= thresh && idx < units.length - 1) {
    size /= thresh;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[idx]}`;
}

export function formatEpoch(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return '–';
  }
  const date = new Date(epoch * 1000);
  return `${date.toISOString()} (${epoch})`;
}

export function truncateMiddle(value: string, max = 32): string {
  if (value.length <= max) {
    return value;
  }
  const half = Math.floor((max - 3) / 2);
  return `${value.slice(0, half)}...${value.slice(-half)}`;
}

