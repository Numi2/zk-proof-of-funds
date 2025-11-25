import { computeHolderTag } from '../utils/crypto';
import { getHolderFingerprint, setHolderFingerprint } from '../utils/state';
import { showFingerprintDialog } from '../ui/dialogs';

/**
 * Get or create a persistent holder fingerprint.
 * 
 * This creates a unique, deterministic identifier for the holder based on
 * their MetaMask address. The fingerprint is derived from signing a
 * deterministic message and hashing the result.
 * 
 * The fingerprint allows verifiers to correlate multiple proofs from the
 * same holder without revealing the actual address.
 */
export async function getOrCreateHolderFingerprint(): Promise<string> {
  // Check if we already have a fingerprint
  const existingFingerprint = await getHolderFingerprint();
  if (existingFingerprint) {
    return existingFingerprint;
  }
  
  // Get the signer address
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  }) as string[];
  
  if (!accounts || accounts.length === 0) {
    throw new Error('No Ethereum accounts connected');
  }
  
  const signerAddress = accounts[0];
  if (!signerAddress) {
    throw new Error('No signer address available');
  }
  
  // Create a deterministic message for fingerprint generation
  const fingerprintMessage = [
    'zkpf Holder Fingerprint',
    '',
    'This signature creates a unique fingerprint for your MetaMask identity.',
    'It allows verifiers to correlate your proofs without revealing your address.',
    '',
    'This message is only signed once and stored locally.',
  ].join('\n');
  
  // Request signature
  const signature = await ethereum.request({
    method: 'personal_sign',
    params: [fingerprintMessage, signerAddress],
  }) as string;
  
  if (!signature) {
    throw new Error('Failed to obtain signature for fingerprint');
  }
  
  // Generate fingerprint from signature
  const fingerprint = computeHolderTag(signature);
  
  // Store for future use
  await setHolderFingerprint(fingerprint);
  
  return fingerprint;
}

/**
 * Show the holder fingerprint in a dialog
 */
export async function showHolderFingerprint(): Promise<string> {
  const fingerprint = await getOrCreateHolderFingerprint();
  await showFingerprintDialog(fingerprint);
  return fingerprint;
}

/**
 * Get the holder fingerprint without creating one if it doesn't exist
 */
export async function getExistingHolderFingerprint(): Promise<string | null> {
  return await getHolderFingerprint();
}

/**
 * Generate a short display version of the fingerprint
 */
export function shortenFingerprint(fingerprint: string): string {
  if (fingerprint.startsWith('0x')) {
    return `${fingerprint.slice(0, 10)}...${fingerprint.slice(-8)}`;
  }
  return `${fingerprint.slice(0, 8)}...${fingerprint.slice(-6)}`;
}

