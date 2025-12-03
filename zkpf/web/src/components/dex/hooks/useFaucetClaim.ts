import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount } from '@orderly.network/hooks';
import { useOrderlyAccountCheck } from './useOrderlyAccountCheck';

interface FaucetResponse {
  success: boolean;
  timestamp?: number;
  error?: string;
  message?: string;
}

interface ClaimHistory {
  count: number;
  lastClaim: number | null;
}

const FAUCET_ENDPOINT = 'https://testnet-operator-evm.orderly.org/v1/faucet/usdc';
const FAUCET_AMOUNT = '1,000';
const CHAIN_ID = '421614'; // Arbitrum Sepolia
const MAX_CLAIMS = 5;
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

const getStorageKey = (address: string) => `faucet_claims_${address}`;

export function useFaucetClaim() {
  const { account } = useAccount();
  const { exists: isRegistered, checking: checkingRegistration } = useOrderlyAccountCheck('EVM');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimHistory, setClaimHistory] = useState<ClaimHistory>({ count: 0, lastClaim: null });

  // Load claim history from localStorage
  useEffect(() => {
    if (!account?.address) {
      setClaimHistory({ count: 0, lastClaim: null });
      return;
    }

    try {
      const stored = localStorage.getItem(getStorageKey(account.address));
      if (stored) {
        const data = JSON.parse(stored) as ClaimHistory;
        setClaimHistory({ count: data.count || 0, lastClaim: data.lastClaim || null });
      }
    } catch (e) {
      console.error('Failed to load faucet history:', e);
    }
  }, [account?.address]);

  // Save claim history to localStorage
  const saveClaimHistory = useCallback((count: number, timestamp: number) => {
    if (!account?.address) return;
    
    const data: ClaimHistory = { count, lastClaim: timestamp };
    localStorage.setItem(getStorageKey(account.address), JSON.stringify(data));
    setClaimHistory(data);
  }, [account?.address]);

  const claim = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    if (!account?.address) {
      const message = 'Please connect your wallet first';
      setError(message);
      return { success: false, message };
    }

    if (!isRegistered) {
      const message = 'Your account is not registered with Orderly. Please register first.';
      setError(message);
      return { success: false, message };
    }

    if (claimHistory.count >= MAX_CLAIMS) {
      const message = `Maximum ${MAX_CLAIMS} claims reached for this account`;
      setError(message);
      return { success: false, message };
    }

    // Check cooldown
    if (claimHistory.lastClaim) {
      const timeSinceLastClaim = Date.now() - claimHistory.lastClaim;
      if (timeSinceLastClaim < COOLDOWN_MS) {
        const hoursLeft = Math.ceil((COOLDOWN_MS - timeSinceLastClaim) / (60 * 60 * 1000));
        const message = `Please wait ${hoursLeft} hours before claiming again`;
        setError(message);
        return { success: false, message };
      }
    }

    setLoading(true);
    setError(null);

    try {
      const requestBody = {
        user_address: account.address,
        broker_id: 'orderly',
        chain_id: CHAIN_ID,
      };

      const response = await fetch(FAUCET_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data: FaucetResponse = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to claim USDC');
      }

      const timestamp = Date.now();
      const newCount = claimHistory.count + 1;
      saveClaimHistory(newCount, timestamp);
      const message = `Successfully claimed ${FAUCET_AMOUNT} USDC!`;
      return { success: true, message };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to claim USDC. Please try again.';
      console.error('Faucet claim error:', err);
      setError(message);
      return { success: false, message };
    } finally {
      setLoading(false);
    }
  }, [account?.address, isRegistered, claimHistory, saveClaimHistory]);

  const canClaim = useMemo(() => 
    account?.address !== undefined &&
    claimHistory.count < MAX_CLAIMS && 
    !loading && 
    isRegistered === true &&
    !checkingRegistration,
    [account?.address, claimHistory.count, loading, isRegistered, checkingRegistration]
  );

  const remainingClaims = MAX_CLAIMS - claimHistory.count;

  return {
    claim,
    loading,
    canClaim,
    remainingClaims,
    claimHistory,
    isRegistered,
    checkingRegistration,
    error,
  };
}

