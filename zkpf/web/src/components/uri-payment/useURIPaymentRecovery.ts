/**
 * Hook for recovering URI payments from wallet seed
 * 
 * When a wallet is restored from backup, this hook scans the blockchain
 * to find any unfinalised URI payments that can be recovered.
 * 
 * Recovery Process:
 * 1. Derive payment keys starting from index 0 using the gap limit (N=3)
 * 2. For each key, derive the incoming viewing key (ivk)
 * 3. Scan the chain for spent nullifiers that match our wallet
 * 4. When a match is found, trial-decrypt outputs with payment ivks
 * 5. If a note is found, store it and continue with next index
 * 6. Stop when N consecutive indices have no corresponding on-chain notes
 */

import { useState, useCallback, useEffect } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import type { UriPayment, SentUriPayment } from './types';
import { loadSentPayments, saveSentPayments, formatZecAmount, MAINNET_HOST } from './utils';

// Gap limit: number of unused indices to scan before stopping
const GAP_LIMIT = 3;

export interface RecoveryProgress {
  isRecovering: boolean;
  scannedIndices: number;
  foundPayments: number;
  currentIndex: number;
  error: string | null;
}

export interface RecoveryResult {
  recoveredPayments: SentUriPayment[];
  totalAmount: number;
  unfinalisedCount: number;
}

/**
 * Hook for recovering URI payments from a restored wallet
 */
export function useURIPaymentRecovery() {
  const { state } = useWebZjsContext();
  const [progress, setProgress] = useState<RecoveryProgress>({
    isRecovering: false,
    scannedIndices: 0,
    foundPayments: 0,
    currentIndex: 0,
    error: null,
  });
  const [result, setResult] = useState<RecoveryResult | null>(null);

  /**
   * Start the recovery process
   * 
   * This should be called after wallet restoration to find any
   * URI payments that may have been created before the backup
   */
  const startRecovery = useCallback(async () => {
    if (!state.webWallet) {
      setProgress(p => ({ ...p, error: 'Wallet not connected' }));
      return;
    }

    setProgress({
      isRecovering: true,
      scannedIndices: 0,
      foundPayments: 0,
      currentIndex: 0,
      error: null,
    });

    try {
      // In a full implementation, we would:
      // 1. Get the wallet seed/spending key
      // 2. Derive payment keys using ZIP 32 derivation
      // 3. For each key, compute the ivk and scan the chain
      // 4. Trial-decrypt outputs to find payment notes
      // 5. Check if notes are spent (finalized) or unspent (recoverable)

      // For now, we'll simulate the process and check local storage
      const existingPayments = loadSentPayments() as SentUriPayment[];
      
      // Simulate scanning process
      let consecutiveEmpty = 0;
      let scannedCount = 0;
      const foundPayments: SentUriPayment[] = [];
      
      for (let idx = 0; idx < 100 && consecutiveEmpty < GAP_LIMIT; idx++) {
        setProgress(p => ({
          ...p,
          currentIndex: idx,
          scannedIndices: scannedCount,
        }));
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if we have a payment at this index in local storage
        const existingAtIndex = existingPayments.find(p => p.payment.paymentIndex === idx);
        
        if (existingAtIndex) {
          // Found a payment!
          foundPayments.push(existingAtIndex);
          consecutiveEmpty = 0;
          setProgress(p => ({
            ...p,
            foundPayments: p.foundPayments + 1,
          }));
        } else {
          // In a real implementation, we'd scan the chain here
          // For now, just increment the gap counter
          consecutiveEmpty++;
        }
        
        scannedCount++;
      }

      // Calculate results
      const unfinalisedPayments = foundPayments.filter(
        p => p.state !== 'finalized' && p.state !== 'cancelled'
      );
      const totalAmount = unfinalisedPayments.reduce(
        (sum, p) => sum + p.payment.amountZats, 
        0
      );

      setResult({
        recoveredPayments: foundPayments,
        totalAmount,
        unfinalisedCount: unfinalisedPayments.length,
      });

      setProgress(p => ({
        ...p,
        isRecovering: false,
        scannedIndices: scannedCount,
      }));

    } catch (err) {
      setProgress(p => ({
        ...p,
        isRecovering: false,
        error: err instanceof Error ? err.message : 'Recovery failed',
      }));
    }
  }, [state.webWallet]);

  /**
   * Cancel an unfinalised payment and recover the funds
   */
  const cancelAndRecover = useCallback(async (payment: SentUriPayment) => {
    if (!state.webWallet) {
      throw new Error('Wallet not connected');
    }

    // In a full implementation, we would:
    // 1. Derive the spending key from the payment key
    // 2. Create a transaction spending the notes to our own address
    // 3. Broadcast the transaction
    // 4. Update local state

    // For now, just update local storage
    const payments = loadSentPayments() as SentUriPayment[];
    const idx = payments.findIndex(p => p.id === payment.id);
    if (idx >= 0) {
      payments[idx].state = 'cancelled';
      saveSentPayments(payments);
    }

    return true;
  }, [state.webWallet]);

  /**
   * Derive a payment key at a specific index
   * This is a placeholder - actual implementation would use crypto
   */
  const derivePaymentKey = useCallback((index: number): string => {
    // In a full implementation:
    // 1. Use ZIP 32 to derive: m_Sapling / 324' / coin_type' / index'
    // 2. Hash the extended spending key with BLAKE2b
    // 3. Return the 32-byte key
    
    // Placeholder: generate deterministic fake key
    const mockKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      mockKey[i] = (index * 37 + i * 13) % 256;
    }
    return Array.from(mockKey).map(b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  /**
   * Create a payment URI from a derived key
   */
  const createPaymentFromKey = useCallback((
    keyHex: string, 
    amountZats: number, 
    index: number,
    description?: string
  ): UriPayment => {
    const amountZec = formatZecAmount(amountZats);
    let fragment = `amount=${amountZec}&key=${keyHex}`;
    if (description) {
      fragment = `amount=${amountZec}&desc=${encodeURIComponent(description)}&key=${keyHex}`;
    }
    
    return {
      amountZats,
      amountZec,
      description,
      keyHex,
      isTestnet: false,
      uri: `https://${MAINNET_HOST}:65536/v1#${fragment}`,
      paymentIndex: index,
    };
  }, []);

  return {
    progress,
    result,
    startRecovery,
    cancelAndRecover,
    derivePaymentKey,
    createPaymentFromKey,
  };
}

/**
 * Hook to track payment indices and ensure no reuse
 */
export function usePaymentIndexTracker() {
  const [nextIndex, setNextIndex] = useState(0);

  // Load the next available index from storage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('zkpf-uri-next-payment-index');
      if (stored) {
        setNextIndex(parseInt(stored, 10));
      } else {
        // Check existing payments to find the highest index
        const payments = loadSentPayments() as SentUriPayment[];
        const maxIndex = payments.reduce((max, p) => {
          const idx = p.payment.paymentIndex ?? -1;
          return idx > max ? idx : max;
        }, -1);
        setNextIndex(maxIndex + 1);
      }
    } catch (e) {
      console.error('Failed to load payment index:', e);
    }
  }, []);

  const getNextIndex = useCallback(() => {
    const current = nextIndex;
    const next = current + 1;
    setNextIndex(next);
    try {
      localStorage.setItem('zkpf-uri-next-payment-index', String(next));
    } catch (e) {
      console.error('Failed to save payment index:', e);
    }
    return current;
  }, [nextIndex]);

  return { nextIndex, getNextIndex };
}

