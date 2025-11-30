/**
 * Custom hooks for Omni Bridge operations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  omniBridgeApi,
  ChainInfo,
  TokenInfo,
  TransferStatus,
  FeeEstimate,
  BridgeInfo,
} from '../services/omni-bridge-api';

// ============================================================================
// useBridgeInfo - Fetch bridge configuration
// ============================================================================

export function useBridgeInfo() {
  const [info, setInfo] = useState<BridgeInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const data = await omniBridgeApi.getInfo();
        setInfo(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch bridge info');
      } finally {
        setIsLoading(false);
      }
    }
    fetchInfo();
  }, []);

  return { info, isLoading, error };
}

// ============================================================================
// useChains - Fetch supported chains
// ============================================================================

export function useChains() {
  const [chains, setChains] = useState<ChainInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchChains() {
      try {
        const data = await omniBridgeApi.getChains();
        setChains(data.chains);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch chains');
      } finally {
        setIsLoading(false);
      }
    }
    fetchChains();
  }, []);

  return { chains, isLoading, error };
}

// ============================================================================
// useTokens - Fetch supported tokens
// ============================================================================

export function useTokens() {
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTokens() {
      try {
        const data = await omniBridgeApi.getTokens();
        setTokens(data.tokens);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch tokens');
      } finally {
        setIsLoading(false);
      }
    }
    fetchTokens();
  }, []);

  const getTokensForChain = useCallback((chainId: string) => {
    return tokens.filter(t => t.availableChains?.includes(chainId));
  }, [tokens]);

  return { tokens, isLoading, error, getTokensForChain };
}

// ============================================================================
// useFeeEstimate - Estimate transfer fees with debouncing
// ============================================================================

interface FeeEstimateParams {
  sourceChain: string;
  destinationChain: string;
  token: string;
  amount: string;
  fastMode?: boolean;
}

export function useFeeEstimate(params: FeeEstimateParams) {
  const [fee, setFee] = useState<FeeEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Skip if missing required params or amount is 0
    if (!params.sourceChain || !params.destinationChain || !params.token || !params.amount) {
      setFee(null);
      return;
    }

    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) {
      setFee(null);
      return;
    }

    // Debounce the API call
    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await omniBridgeApi.estimateFee({
          sourceChain: params.sourceChain,
          destinationChain: params.destinationChain,
          token: params.token,
          amount: params.amount,
          fastMode: params.fastMode,
        });
        setFee(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to estimate fee');
        setFee(null);
      } finally {
        setIsLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [params.sourceChain, params.destinationChain, params.token, params.amount, params.fastMode]);

  return { fee, isLoading, error };
}

// ============================================================================
// useTransfer - Track a single transfer
// ============================================================================

export function useTransfer(transferId: string | null) {
  const [transfer, setTransfer] = useState<TransferStatus | null>(null);
  const [isLoading, setIsLoading] = useState(!!transferId);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!transferId) {
      setTransfer(null);
      setIsLoading(false);
      return;
    }

    async function fetchTransfer() {
      try {
        const data = await omniBridgeApi.getTransfer(transferId!);
        setTransfer(data);
        
        // Stop polling if terminal state
        if (data.status === 'Completed' || data.status === 'Failed') {
          if (pollRef.current) {
            clearInterval(pollRef.current);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch transfer');
      } finally {
        setIsLoading(false);
      }
    }

    // Initial fetch
    fetchTransfer();

    // Poll every 5 seconds
    pollRef.current = setInterval(fetchTransfer, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [transferId]);

  return { transfer, isLoading, error };
}

// ============================================================================
// useTransferHistory - Fetch transfer history
// ============================================================================

export function useTransferHistory() {
  const [transfers, setTransfers] = useState<TransferStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await omniBridgeApi.getTransfers();
      setTransfers(data.transfers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch transfers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { transfers, isLoading, error, refresh };
}

// ============================================================================
// useInitiateTransfer - Handle transfer initiation
// ============================================================================

interface InitiateTransferParams {
  sourceChain: string;
  destinationChain: string;
  sender: string;
  recipient: string;
  token: string;
  amount: string;
  memo?: string;
  fastMode?: boolean;
}

export function useInitiateTransfer() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferId, setTransferId] = useState<string | null>(null);

  const initiate = useCallback(async (params: InitiateTransferParams) => {
    setIsLoading(true);
    setError(null);
    setTransferId(null);

    try {
      const result = await omniBridgeApi.initiateTransfer(params);
      setTransferId(result.transferId);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate transfer';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setTransferId(null);
  }, []);

  return { initiate, isLoading, error, transferId, reset };
}

// ============================================================================
// useAssetProof - Generate bridged asset proofs
// ============================================================================

interface AssetProofParams {
  chain: string;
  address: string;
  tokens: string[];
}

export function useAssetProof() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (params: AssetProofParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const proof = await omniBridgeApi.proveAssets(params);
      return proof;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate proof';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { generate, isLoading, error };
}

// ============================================================================
// useAttestation - Create cross-chain attestations
// ============================================================================

interface AttestationParams {
  holderId: string;
  sourceChain: string;
  destinationChain: string;
  address: string;
  tokens: string[];
}

export function useAttestation() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async (params: AttestationParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const attestation = await omniBridgeApi.createAttestation(params);
      return attestation;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create attestation';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { create, isLoading, error };
}

