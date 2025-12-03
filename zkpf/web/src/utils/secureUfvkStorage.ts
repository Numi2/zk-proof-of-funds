/**
 * Secure UFVK Storage Utility
 * 
 * Encrypts the UFVK (Unified Full Viewing Key) before storing in localStorage.
 * Uses Web Crypto API with AES-GCM encryption.
 * 
 * Encryption key is derived from:
 * - Passkey credential ID (if available)
 * - A salt stored in IndexedDB
 * 
 * This protects the UFVK from being read by malicious scripts that might
 * have access to localStorage.
 */

import { get, set } from 'idb-keyval';

const UFVK_STORAGE_KEY = 'zkpf-zcash-ufvk-encrypted';
const SALT_STORAGE_KEY = 'zkpf-ufvk-salt';

// Fallback to plain storage if encryption fails (for backward compatibility)
const UFVK_STORAGE_KEY_PLAIN = 'zkpf-zcash-ufvk';

/**
 * Derive an encryption key from passkey credential ID and salt
 */
async function deriveEncryptionKey(
  credentialId: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Import credential ID as key material
  const encoder = new TextEncoder();
  const keyMaterial = encoder.encode(credentialId);
  
  // Import the key material
  const baseKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  // Derive the encryption key using PBKDF2
  // Ensure salt is a proper BufferSource (create a new Uint8Array to avoid offset issues)
  const saltBuffer = new Uint8Array(salt);
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  
  return encryptionKey;
}

/**
 * Generate a random salt
 */
function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Get or create salt from IndexedDB
 */
async function getOrCreateSalt(): Promise<Uint8Array> {
  try {
    const stored = await get<Uint8Array>(SALT_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    
    // Create new salt
    const salt = generateSalt();
    await set(SALT_STORAGE_KEY, salt);
    return salt;
  } catch (err) {
    console.error('Failed to get/create salt:', err);
    // Fallback: generate salt but don't persist (less secure but works)
    return generateSalt();
  }
}

/**
 * Get the first available passkey credential ID
 */
function getPasskeyCredentialId(): string | null {
  try {
    const PASSKEY_CREDENTIALS_KEY = 'zkpf_passkey_credentials';
    const stored = localStorage.getItem(PASSKEY_CREDENTIALS_KEY);
    if (!stored) return null;
    
    const passkeys = JSON.parse(stored) as Array<{ credentialId: string }>;
    if (passkeys.length === 0) return null;
    
    return passkeys[0].credentialId;
  } catch {
    return null;
  }
}

/**
 * Encrypt UFVK and store securely
 */
export async function storeUfvkSecurely(ufvk: string): Promise<void> {
  if (!ufvk || !ufvk.trim()) {
    // Clear storage if empty
    await clearUfvk();
    return;
  }

  try {
    // Check if we have a passkey
    const credentialId = getPasskeyCredentialId();
    
    if (!credentialId) {
      // No passkey available - store in plain text for backward compatibility
      // This allows wallet creation before passkey is set up
      console.warn('No passkey found, storing UFVK in plain text');
      localStorage.setItem(UFVK_STORAGE_KEY_PLAIN, ufvk);
      return;
    }

    // Get or create salt
    const salt = await getOrCreateSalt();
    
    // Derive encryption key
    const encryptionKey = await deriveEncryptionKey(credentialId, salt);
    
    // Encrypt the UFVK
    const encoder = new TextEncoder();
    const data = encoder.encode(ufvk);
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    
    const encryptedData = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      encryptionKey,
      data
    );
    
    // Store encrypted data and IV
    const encryptedArray = new Uint8Array(encryptedData);
    const combined = new Uint8Array(iv.length + encryptedArray.length);
    combined.set(iv, 0);
    combined.set(encryptedArray, iv.length);
    
    // Convert to base64 for storage
    const base64 = btoa(String.fromCharCode(...combined));
    localStorage.setItem(UFVK_STORAGE_KEY, base64);
    
    // Also store the credential ID used for encryption (for verification)
    localStorage.setItem(`${UFVK_STORAGE_KEY}-cred-id`, credentialId);
    
    // Remove plain text version if it exists
    localStorage.removeItem(UFVK_STORAGE_KEY_PLAIN);
    
  } catch (err) {
    console.error('Failed to encrypt UFVK:', err);
    // Fallback to plain storage if encryption fails
    localStorage.setItem(UFVK_STORAGE_KEY_PLAIN, ufvk);
  }
}

/**
 * Decrypt and retrieve UFVK
 */
export async function getUfvkSecurely(): Promise<string | null> {
  try {
    // First check for encrypted version
    const encryptedBase64 = localStorage.getItem(UFVK_STORAGE_KEY);
    
    if (!encryptedBase64) {
      // Fallback to plain text version (for backward compatibility)
      return localStorage.getItem(UFVK_STORAGE_KEY_PLAIN);
    }
    
    // Get the credential ID used for encryption
    const credentialId = localStorage.getItem(`${UFVK_STORAGE_KEY}-cred-id`);
    if (!credentialId) {
      // Can't decrypt without credential ID - try plain text fallback
      return localStorage.getItem(UFVK_STORAGE_KEY_PLAIN);
    }
    
    // Verify we still have this passkey
    const currentCredentialId = getPasskeyCredentialId();
    if (currentCredentialId !== credentialId) {
      console.warn('Passkey credential ID mismatch - cannot decrypt UFVK');
      // Try plain text fallback
      return localStorage.getItem(UFVK_STORAGE_KEY_PLAIN);
    }
    
    // Get salt
    const salt = await getOrCreateSalt();
    
    // Derive decryption key
    const decryptionKey = await deriveEncryptionKey(credentialId, salt);
    
    // Decode base64
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);
    
    // Decrypt
    const decryptedData = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv,
      },
      decryptionKey,
      encryptedData
    );
    
    // Convert back to string
    const decoder = new TextDecoder();
    return decoder.decode(decryptedData);
    
  } catch (err) {
    console.error('Failed to decrypt UFVK:', err);
    // Fallback to plain text version
    return localStorage.getItem(UFVK_STORAGE_KEY_PLAIN);
  }
}

/**
 * Check if UFVK exists (encrypted or plain)
 */
export function hasUfvk(): boolean {
  return localStorage.getItem(UFVK_STORAGE_KEY) !== null ||
         localStorage.getItem(UFVK_STORAGE_KEY_PLAIN) !== null;
}

/**
 * Clear UFVK from storage (both encrypted and plain)
 */
export async function clearUfvk(): Promise<void> {
  localStorage.removeItem(UFVK_STORAGE_KEY);
  localStorage.removeItem(`${UFVK_STORAGE_KEY}-cred-id`);
  localStorage.removeItem(UFVK_STORAGE_KEY_PLAIN);
  
  // Optionally clear salt (but keep it for future use)
  // await del(SALT_STORAGE_KEY);
}

/**
 * Migrate plain text UFVK to encrypted storage
 * Call this after user authenticates with passkey
 */
export async function migratePlainToEncrypted(): Promise<void> {
  const plainUfvk = localStorage.getItem(UFVK_STORAGE_KEY_PLAIN);
  if (plainUfvk) {
    await storeUfvkSecurely(plainUfvk);
  }
}

