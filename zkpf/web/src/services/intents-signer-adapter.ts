/**
 * Intent Signer Adapter for NEAR Intents SDK
 * 
 * Bridges NEAR Connect wallet to SDK's intent signer interface.
 * Supports NEP-413 signing standard used by most NEAR wallets.
 */

import { createIntentSignerNEP413, type IIntentSigner } from '@defuse-protocol/intents-sdk';
import type { NearContextValue } from '../components/dex/context/NearContext';
import type { NearOrderlyService } from './near-orderly';

/**
 * Create an NEP-413 intent signer from NEAR Connect wallet.
 * 
 * This adapter uses the wallet's signMessage method to sign intent payloads
 * according to the NEP-413 standard.
 */
export async function createIntentSignerFromNearContext(
  nearContext: NearContextValue,
  accountId: string
): Promise<IIntentSigner> {
  if (!nearContext.isConnected || !nearContext.service) {
    throw new Error('NEAR wallet not connected');
  }

  const service = nearContext.service;
  const connector = service.getConnector();
  
  if (!connector) {
    throw new Error('NEAR Connect connector not available');
  }

  // Get wallet instance from connector
  const wallet = await connector.wallet?.();
  
  if (!wallet || !wallet.signMessage) {
    throw new Error('Wallet does not support message signing (NEP-413)');
  }

  // Create NEP-413 signer using wallet's signMessage
  return createIntentSignerNEP413({
    signMessage: async (nep413Payload) => {
      // nep413Payload is an object with message, nonce, recipient, and optional callback_url
      // Extract the message string from the payload
      const message = typeof nep413Payload === 'string' 
        ? nep413Payload 
        : (nep413Payload as { message: string }).message;

      // Use the nonce from the payload if provided, otherwise generate one
      const nonceArray = typeof nep413Payload === 'object' && (nep413Payload as { nonce?: number[] }).nonce
        ? new Uint8Array((nep413Payload as { nonce: number[] }).nonce)
        : new Uint8Array(32);
      
      if (nonceArray.length === 32 && nonceArray.every(n => n === 0)) {
        crypto.getRandomValues(nonceArray);
      }

      // Sign the message using wallet's signMessage
      const result = await wallet.signMessage({
        message,
        recipient: accountId,
        nonce: nonceArray,
      });

      // Extract public key from wallet if available
      // NEAR Connect wallets typically provide this in the sign result
      let publicKey: string;
      if (result.publicKey) {
        publicKey = result.publicKey;
      } else {
        // Try to get public key from accounts
        const accounts = await wallet.signIn();
        if (accounts && accounts.length > 0 && accounts[0].publicKey) {
          publicKey = accounts[0].publicKey;
        } else {
          // Fallback: construct ed25519 public key format from account
          // This is a simplified approach - in production, you'd get the actual public key
          throw new Error('Could not determine public key from wallet');
        }
      }

      return {
        publicKey,
        signature: result.signature,
      };
    },
    accountId,
  });
}

/**
 * Create an intent signer from NearOrderlyService directly.
 * Useful when you have the service instance but not the full context.
 */
export async function createIntentSignerFromService(
  service: NearOrderlyService,
  accountId: string
): Promise<IIntentSigner> {
  const connector = service.getConnector();
  
  if (!connector) {
    throw new Error('NEAR Connect connector not available');
  }

  const wallet = await connector.wallet?.();
  
  if (!wallet || !wallet.signMessage) {
    throw new Error('Wallet does not support message signing (NEP-413)');
  }

  return createIntentSignerNEP413({
    signMessage: async (nep413Payload) => {
      // nep413Payload is an object with message, nonce, recipient, and optional callback_url
      // Extract the message string from the payload
      const message = typeof nep413Payload === 'string' 
        ? nep413Payload 
        : (nep413Payload as { message: string }).message;

      // Use the nonce from the payload if provided, otherwise generate one
      const nonceArray = typeof nep413Payload === 'object' && (nep413Payload as { nonce?: number[] }).nonce
        ? new Uint8Array((nep413Payload as { nonce: number[] }).nonce)
        : new Uint8Array(32);
      
      if (nonceArray.length === 32 && nonceArray.every(n => n === 0)) {
        crypto.getRandomValues(nonceArray);
      }

      // Sign the message using wallet's signMessage
      const result = await wallet.signMessage({
        message,
        recipient: accountId,
        nonce: nonceArray,
      });

      let publicKey: string;
      if (result.publicKey) {
        publicKey = result.publicKey;
      } else {
        const accounts = await wallet.signIn();
        if (accounts && accounts.length > 0 && accounts[0].publicKey) {
          publicKey = accounts[0].publicKey;
        } else {
          throw new Error('Could not determine public key from wallet');
        }
      }

      return {
        publicKey,
        signature: result.signature,
      };
    },
    accountId,
  });
}

