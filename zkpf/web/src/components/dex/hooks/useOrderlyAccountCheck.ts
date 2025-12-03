import { useState, useEffect, useCallback } from 'react';
import { useAccount } from '@orderly.network/hooks';
import { useNetwork } from '../context/NetworkContext';

interface AccountCheckResult {
  exists: boolean | null;
  accountId: string | null;
  checking: boolean;
  error: string | null;
}

const ORDERLY_API_BASE = {
  testnet: 'https://testnet-api.orderly.org',
  mainnet: 'https://api.orderly.org',
};

/**
 * Hook to check if an Orderly account exists for the connected wallet
 * Supports both EVM and Solana wallets
 */
export function useOrderlyAccountCheck(chainType: 'EVM' | 'SOL' = 'EVM') {
  const { account } = useAccount();
  const { network } = useNetwork();
  const [result, setResult] = useState<AccountCheckResult>({
    exists: null,
    accountId: null,
    checking: false,
    error: null,
  });

  const checkAccount = useCallback(async (address: string): Promise<AccountCheckResult> => {
    setResult(prev => ({ ...prev, checking: true, error: null }));

    try {
      const brokerId = 'orderly';
      const apiBase = ORDERLY_API_BASE[network];
      
      const params = new URLSearchParams({
        address,
        broker_id: brokerId,
        chain_type: chainType,
      });

      const response = await fetch(
        `${apiBase}/v1/get_account?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();
      
      if (data.success && data.data?.account_id) {
        setResult({
          exists: true,
          accountId: data.data.account_id,
          checking: false,
          error: null,
        });
        return {
          exists: true,
          accountId: data.data.account_id,
          checking: false,
          error: null,
        };
      } else {
        setResult({
          exists: false,
          accountId: null,
          checking: false,
          error: null,
        });
        return {
          exists: false,
          accountId: null,
          checking: false,
          error: null,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check account';
      console.error('Failed to check account registration:', error);
      setResult({
        exists: null,
        accountId: null,
        checking: false,
        error: errorMessage,
      });
      return {
        exists: null,
        accountId: null,
        checking: false,
        error: errorMessage,
      };
    }
  }, [network, chainType]);

  // Auto-check when account changes
  useEffect(() => {
    if (account?.address) {
      checkAccount(account.address);
    } else {
      setResult({
        exists: null,
        accountId: null,
        checking: false,
        error: null,
      });
    }
  }, [account?.address, checkAccount]);

  return {
    ...result,
    checkAccount: () => account?.address ? checkAccount(account.address) : Promise.resolve(result),
  };
}

