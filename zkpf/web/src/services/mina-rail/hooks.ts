/**
 * Mina Rail React Hooks
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getMinaRailClient, MinaRailApiError } from './client';
import type {
  MinaRailStatus,
  MinaRailEpochState,
  MinaRailEpochProof,
  SubmitTachystampResponse,
  HolderTachystampHistory,
} from '../../types/mina-rail';
import type { PcdState, NullifierIdentifier } from '../../types/pcd';
import { createTachystampFromPcd, validateTachystamp } from './utils';

/**
 * Hook for Mina Rail status.
 */
export function useMinaRailStatus(
  pollIntervalMs: number = 10000
): {
  status: MinaRailStatus | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = useState<MinaRailStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => getMinaRailClient(), []);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const newStatus = await client.getStatus();
      setStatus(newStatus);
    } catch (err) {
      const message = err instanceof MinaRailApiError 
        ? err.message 
        : 'Failed to fetch Mina Rail status';
      setError(message);
      console.error('[MinaRail] Status fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();

    if (pollIntervalMs > 0) {
      const interval = setInterval(() => void refresh(), pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [refresh, pollIntervalMs]);

  return { status, isLoading, error, refresh };
}

/**
 * Hook for epoch state.
 */
export function useMinaRailEpoch(epoch?: number): {
  epochState: MinaRailEpochState | null;
  epochProof: MinaRailEpochProof | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [epochState, setEpochState] = useState<MinaRailEpochState | null>(null);
  const [epochProof, setEpochProof] = useState<MinaRailEpochProof | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => getMinaRailClient(), []);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const state = await client.getEpochState(epoch);
      setEpochState(state);

      if (state.isFinalized && epoch !== undefined) {
        const proofResponse = await client.getEpochProof(epoch);
        setEpochProof(proofResponse.proof);
      } else {
        setEpochProof(null);
      }
    } catch (err) {
      const message = err instanceof MinaRailApiError
        ? err.message
        : 'Failed to fetch epoch data';
      setError(message);
      console.error('[MinaRail] Epoch fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [client, epoch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { epochState, epochProof, isLoading, error, refresh };
}

/**
 * Hook for submitting tachystamps.
 */
export function useSubmitTachystamp(): {
  submit: (
    pcdState: PcdState,
    nullifier: NullifierIdentifier,
    policyId: number,
    threshold: number,
    l1BlockNumber: number,
    l1TxHash: string
  ) => Promise<SubmitTachystampResponse>;
  isSubmitting: boolean;
  lastSubmission: SubmitTachystampResponse | null;
  error: string | null;
} {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSubmission, setLastSubmission] = useState<SubmitTachystampResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => getMinaRailClient(), []);

  const submit = useCallback(
    async (
      pcdState: PcdState,
      nullifier: NullifierIdentifier,
      policyId: number,
      threshold: number,
      l1BlockNumber: number,
      l1TxHash: string
    ): Promise<SubmitTachystampResponse> => {
      setIsSubmitting(true);
      setError(null);

      try {
        // Create tachystamp from PCD state
        const tachystamp = createTachystampFromPcd(
          pcdState,
          nullifier,
          policyId,
          threshold,
          l1BlockNumber,
          l1TxHash
        );

        // Validate
        const validation = validateTachystamp(tachystamp);
        if (!validation.valid) {
          throw new Error(validation.error ?? 'Invalid tachystamp');
        }

        // Submit
        const response = await client.submitTachystamp({ tachystamp });
        setLastSubmission(response);

        if (!response.success) {
          throw new Error(response.error ?? 'Submission failed');
        }

        console.log('[MinaRail] Tachystamp submitted:', response.tachystampId);
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to submit tachystamp';
        setError(message);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [client]
  );

  return { submit, isSubmitting, lastSubmission, error };
}

/**
 * Hook for holder history.
 */
export function useHolderHistory(holderCommitment: string | null): {
  history: HolderTachystampHistory | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [history, setHistory] = useState<HolderTachystampHistory | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => getMinaRailClient(), []);

  const refresh = useCallback(async () => {
    if (!holderCommitment) {
      setHistory(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await client.getHolderHistory(holderCommitment);
      setHistory(data);
    } catch (err) {
      const message = err instanceof MinaRailApiError
        ? err.message
        : 'Failed to fetch holder history';
      setError(message);
      console.error('[MinaRail] History fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [client, holderCommitment]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { history, isLoading, error, refresh };
}

/**
 * Hook for epoch finalization events.
 */
export function useEpochFinalizationEvents(
  onEpochFinalized?: (proof: MinaRailEpochProof) => void
): {
  latestFinalizedEpoch: MinaRailEpochProof | null;
  isConnected: boolean;
} {
  const [latestFinalizedEpoch, setLatestFinalizedEpoch] = useState<MinaRailEpochProof | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const client = useMemo(() => getMinaRailClient(), []);

  useEffect(() => {
    const handleFinalized = (proof: MinaRailEpochProof) => {
      setLatestFinalizedEpoch(proof);
      onEpochFinalized?.(proof);
    };

    const unsubscribe = client.subscribeToEpochEvents(
      handleFinalized,
      () => setIsConnected(false)
    );

    setIsConnected(true);

    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [client, onEpochFinalized]);

  return { latestFinalizedEpoch, isConnected };
}

/**
 * Hook for checking nullifier status.
 */
export function useNullifierCheck(nullifier: string | null): {
  isUsed: boolean | null;
  isChecking: boolean;
  error: string | null;
  recheck: () => Promise<void>;
} {
  const [isUsed, setIsUsed] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(() => getMinaRailClient(), []);

  const recheck = useCallback(async () => {
    if (!nullifier) {
      setIsUsed(null);
      return;
    }

    try {
      setIsChecking(true);
      setError(null);
      const used = await client.isNullifierUsed(nullifier);
      setIsUsed(used);
    } catch (err) {
      const message = err instanceof MinaRailApiError
        ? err.message
        : 'Failed to check nullifier';
      setError(message);
    } finally {
      setIsChecking(false);
    }
  }, [client, nullifier]);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  return { isUsed, isChecking, error, recheck };
}

