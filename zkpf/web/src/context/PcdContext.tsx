/**
 * PCD (Proof-Carrying Data) Context
 *
 * Manages the Tachyon wallet state machine with ZK proofs.
 * The wallet maintains (S_current, π_current) which can be updated
 * after processing each batch of blocks.
 */

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import { get, set, del } from 'idb-keyval';
import { ZkpfClient, ApiError, detectDefaultBase } from '../api/zkpf';
import type {
  PcdState,
  PcdContextState,
  PcdSyncStatus,
  NoteIdentifier,
  NullifierIdentifier,
  BlockDelta,
  PersistedPcdState,
  TachyonMetadata,
  WalletState,
} from '../types/pcd';
import type { SubmitTachystampResponse } from '../types/mina-rail';
import { getMinaRailClient } from '../services/mina-rail/client';
import { createTachystampFromPcd, validateTachystamp } from '../services/mina-rail/utils';

// ============================================================
// Client-side PCD Mock (used when backend is unavailable)
// ============================================================

/**
 * Convert a SHA-256 hash to a valid BN256 field element in little-endian hex format.
 * 
 * The BN256 scalar field modulus is ~2^254, so we:
 * 1. Zero the top 2 bits to ensure the value is < 2^254 < modulus
 * 2. Reverse to little-endian format (matching Fr::to_repr)
 */
function hashBytesToFieldElement(hashBytes: Uint8Array): string {
  // Clone to avoid mutating original
  const bytes = new Uint8Array(hashBytes);
  // Zero top 2 bits of MSB (index 0 in big-endian) to ensure < 2^254
  bytes[0] &= 0x3F;
  // Reverse to little-endian (Fr::to_repr format)
  bytes.reverse();
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a deterministic hash for state commitment (client-side mock).
 * Uses Web Crypto API for SHA-256 and converts to a valid field element.
 */
async function computeStateCommitment(state: WalletState): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(state));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return hashBytesToFieldElement(new Uint8Array(hashBuffer));
}

// All PCD state and proofs must come from the backend

/**
 * Check if an error indicates the backend is unavailable.
 * Handles browser-specific error messages:
 * - Chrome/Firefox: "Failed to fetch", "NetworkError"
 * - Safari: "Load failed"
 */
function isBackendUnavailableError(err: unknown): boolean {
  if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
    return true;
  }
  if (err instanceof Error) {
    const msg = err.message;
    return (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('Load failed')
    );
  }
  return false;
}

// IndexedDB key for persisted PCD state
const PCD_STORAGE_KEY = 'zkpf-pcd-state';

type PcdAction =
  | { type: 'set-pcd-state'; payload: PcdState }
  | { type: 'set-notes'; payload: NoteIdentifier[] }
  | { type: 'set-nullifiers'; payload: NullifierIdentifier[] }
  | { type: 'set-status'; payload: PcdSyncStatus }
  | { type: 'set-error'; payload: string | null }
  | { type: 'set-initialized'; payload: boolean }
  | { type: 'set-last-sync'; payload: number }
  | { type: 'reset' };

const initialState: PcdContextState = {
  pcdState: null,
  notes: [],
  nullifiers: [],
  status: 'idle',
  error: null,
  isInitialized: false,
  lastSyncAt: null,
};

function pcdReducer(state: PcdContextState, action: PcdAction): PcdContextState {
  switch (action.type) {
    case 'set-pcd-state':
      return { ...state, pcdState: action.payload, error: null };
    case 'set-notes':
      return { ...state, notes: action.payload };
    case 'set-nullifiers':
      return { ...state, nullifiers: action.payload };
    case 'set-status':
      return { ...state, status: action.payload };
    case 'set-error':
      return { ...state, error: action.payload, status: 'error' };
    case 'set-initialized':
      return { ...state, isInitialized: action.payload };
    case 'set-last-sync':
      return { ...state, lastSyncAt: action.payload };
    case 'reset':
      return initialState;
    default:
      return state;
  }
}

export interface PcdContextValue {
  state: PcdContextState;
  /** Initialize a new PCD chain from genesis */
  initializePcd: (initialNotes?: NoteIdentifier[]) => Promise<void>;
  /** Update PCD state with a block delta */
  updatePcd: (delta: BlockDelta) => Promise<void>;
  /** Verify the current PCD state */
  verifyPcd: () => Promise<boolean>;
  /** Get Tachyon metadata for spending flow */
  getTachyonMetadata: () => TachyonMetadata | null;
  /** Export PCD state as JSON */
  exportPcdState: () => string | null;
  /** Import PCD state from JSON */
  importPcdState: (json: string) => Promise<void>;
  /** Clear/reset PCD state */
  clearPcdState: () => Promise<void>;
  /** Add a note to the wallet (for testing/demo) */
  addNote: (note: NoteIdentifier) => void;
  /** Mark a note as spent */
  spendNote: (noteCommitment: string, nullifier: string) => void;
  /** Submit tachystamp to Mina Rail for aggregation */
  submitToMinaRail: (
    nullifier: NullifierIdentifier,
    policyId: number,
    threshold: number,
    l1BlockNumber: number,
    l1TxHash: string
  ) => Promise<SubmitTachystampResponse>;
}

export const PcdContext = createContext<PcdContextValue | null>(null);

interface PcdProviderProps {
  children: React.ReactNode;
  apiBaseUrl?: string;
}

export function PcdProvider({ children, apiBaseUrl }: PcdProviderProps) {
  const [state, dispatch] = useReducer(pcdReducer, initialState);

  const client = useMemo(
    () => new ZkpfClient(apiBaseUrl ?? detectDefaultBase()),
    [apiBaseUrl]
  );

  // Load persisted state on mount
  useEffect(() => {
    async function loadPersistedState() {
      try {
        const persisted = await get<PersistedPcdState>(PCD_STORAGE_KEY);
        if (persisted?.pcd_state) {
          // Validate that field elements are in correct format (64 hex chars, little-endian)
          const ws = persisted.pcd_state.wallet_state;
          const isValidFieldElement = (hex: string): boolean => {
            if (!hex || typeof hex !== 'string') return false;
            const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
            if (cleaned.length !== 64) return false;
            // Check it's valid hex
            if (!/^[0-9a-fA-F]+$/.test(cleaned)) return false;
            return true;
          };
          
          // Check wallet state field elements
          if (!isValidFieldElement(ws.anchor) || 
              !isValidFieldElement(ws.notes_root) || 
              !isValidFieldElement(ws.nullifiers_root)) {
            console.warn('[PCD] Stored state has invalid field elements (old format), clearing...');
            await del(PCD_STORAGE_KEY);
            return;
          }
          
          dispatch({ type: 'set-pcd-state', payload: persisted.pcd_state });
          dispatch({ type: 'set-notes', payload: persisted.notes || [] });
          dispatch({ type: 'set-nullifiers', payload: persisted.nullifiers || [] });
          dispatch({ type: 'set-initialized', payload: true });
          dispatch({ type: 'set-last-sync', payload: persisted.updated_at });
          console.info('[PCD] Restored state from storage, height:', persisted.pcd_state.wallet_state.height);
        }
      } catch (err) {
        console.error('[PCD] Failed to load persisted state:', err);
      }
    }
    void loadPersistedState();
  }, []);

  // Persist state changes
  useEffect(() => {
    async function persistState() {
      if (!state.pcdState) return;
      try {
        const persisted: PersistedPcdState = {
          pcd_state: state.pcdState,
          notes: state.notes,
          nullifiers: state.nullifiers,
          updated_at: Date.now(),
        };
        await set(PCD_STORAGE_KEY, persisted);
      } catch (err) {
        console.error('[PCD] Failed to persist state:', err);
      }
    }
    void persistState();
  }, [state.pcdState, state.notes, state.nullifiers]);

  const initializePcd = useCallback(
    async (initialNotes: NoteIdentifier[] = []) => {
      dispatch({ type: 'set-status', payload: 'generating_proof' });
      try {
        // Backend is required - no mock fallback
        const response = await client.pcdInit(initialNotes);
        dispatch({ type: 'set-pcd-state', payload: response.pcd_state });
        dispatch({ type: 'set-notes', payload: initialNotes });
        dispatch({ type: 'set-nullifiers', payload: [] });
        dispatch({ type: 'set-initialized', payload: true });
        dispatch({ type: 'set-last-sync', payload: Date.now() });
        dispatch({ type: 'set-status', payload: 'idle' });
        console.info('[PCD] Initialized via backend, genesis:', response.pcd_state.s_genesis);
      } catch (err) {
        const errorMessage = isBackendUnavailableError(err)
          ? 'Backend unavailable. Please ensure zkpf-backend is running.'
          : err instanceof Error ? err.message : 'Failed to initialize PCD';
        
        dispatch({
          type: 'set-error',
          payload: errorMessage,
        });
        throw new Error(errorMessage);
      }
    },
    [client]
  );

  /**
   * Validate that a field element hex string is properly formatted.
   * Must be 64 hex chars (32 bytes) after 0x prefix.
   */
  const isValidFieldElement = useCallback((hex: string): boolean => {
    if (!hex || typeof hex !== 'string') return false;
    const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleaned.length !== 64) return false;
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) return false;
    return true;
  }, []);

  const updatePcd = useCallback(
    async (delta: BlockDelta) => {
      if (!state.pcdState) {
        throw new Error('PCD not initialized');
      }

      // Validate current state has valid field elements
      const ws = state.pcdState.wallet_state;
      if (!isValidFieldElement(ws.anchor) || 
          !isValidFieldElement(ws.notes_root) || 
          !isValidFieldElement(ws.nullifiers_root)) {
        console.error('[PCD] Current state has invalid field elements, clearing and reinitializing...');
        await del(PCD_STORAGE_KEY);
        dispatch({ type: 'reset' });
        throw new Error('PCD state was corrupted (invalid field elements). Please reinitialize.');
      }

      dispatch({ type: 'set-status', payload: 'syncing' });
      
      try {
        const response = await client.pcdUpdate({
          pcd_state: state.pcdState,
          delta,
          current_notes: state.notes,
          current_nullifiers: state.nullifiers,
        });

        if (!response.prev_proof_verified) {
          console.warn('[PCD] Previous proof verification failed (continuing with trusted S_prev)');
        }

        // Update notes: remove spent, add new
        const spentCommitments = new Set(
          delta.spent_nullifiers.map((nf) => nf.note_commitment)
        );
        const updatedNotes = state.notes
          .filter((n) => !spentCommitments.has(n.commitment))
          .concat(delta.new_notes);

        const updatedNullifiers = state.nullifiers.concat(delta.spent_nullifiers);

        dispatch({ type: 'set-pcd-state', payload: response.pcd_state });
        dispatch({ type: 'set-notes', payload: updatedNotes });
        dispatch({ type: 'set-nullifiers', payload: updatedNullifiers });
        dispatch({ type: 'set-last-sync', payload: Date.now() });
        dispatch({ type: 'set-status', payload: 'idle' });

        console.info(
          '[PCD] Updated to height:',
          response.pcd_state.wallet_state.height,
          'chain_length:',
          response.pcd_state.chain_length
        );
      } catch (err) {
        const errorMessage = isBackendUnavailableError(err)
          ? 'Backend unavailable. Please ensure zkpf-backend is running.'
          : err instanceof Error ? err.message : 'Failed to update PCD';
        
        dispatch({
          type: 'set-error',
          payload: errorMessage,
        });
        throw new Error(errorMessage);
      }
    },
    [client, state.pcdState, state.notes, state.nullifiers, isValidFieldElement]
  );

  const verifyPcd = useCallback(async (): Promise<boolean> => {
    if (!state.pcdState) {
      return false;
    }

    dispatch({ type: 'set-status', payload: 'verifying' });
    try {
      const response = await client.pcdVerify(state.pcdState);
      dispatch({ type: 'set-status', payload: 'idle' });
      
      if (!response.valid && response.error) {
        console.warn('[PCD] Verification failed:', response.error);
      }
      
      return response.valid;
    } catch (err) {
      // Check if backend is unavailable - perform client-side verification
      if (isBackendUnavailableError(err) && state.pcdState) {
        console.warn('[PCD] Backend unavailable, using client-side mock verification');
        try {
          // Verify the state commitment matches
          const computedCommitment = await computeStateCommitment(state.pcdState.wallet_state);
          const isValid = computedCommitment === state.pcdState.s_current;
          dispatch({ type: 'set-status', payload: 'idle' });
          
          if (!isValid) {
            console.warn('[PCD] Mock verification failed: state commitment mismatch');
          } else {
            console.info('[PCD] Mock verification passed');
          }
          
          return isValid;
        } catch (mockErr) {
          console.error('[PCD] Mock verification failed:', mockErr);
        }
      }
      
      dispatch({
        type: 'set-error',
        payload: err instanceof Error ? err.message : 'Failed to verify PCD',
      });
      return false;
    }
  }, [client, state.pcdState]);

  const getTachyonMetadata = useCallback((): TachyonMetadata | null => {
    if (!state.pcdState) {
      return null;
    }
    return {
      s_current: state.pcdState.s_current,
      proof_current: state.pcdState.proof_current,
      height: state.pcdState.wallet_state.height,
      chain_length: state.pcdState.chain_length,
      updated_at: state.lastSyncAt ?? Date.now(),
    };
  }, [state.pcdState, state.lastSyncAt]);

  const exportPcdState = useCallback((): string | null => {
    if (!state.pcdState) {
      return null;
    }
    const exportData: PersistedPcdState = {
      pcd_state: state.pcdState,
      notes: state.notes,
      nullifiers: state.nullifiers,
      updated_at: Date.now(),
    };
    return JSON.stringify(exportData, null, 2);
  }, [state.pcdState, state.notes, state.nullifiers]);

  const importPcdState = useCallback(async (json: string): Promise<void> => {
    try {
      const imported: PersistedPcdState = JSON.parse(json);
      if (!imported.pcd_state?.s_current) {
        throw new Error('Invalid PCD state format');
      }
      dispatch({ type: 'set-pcd-state', payload: imported.pcd_state });
      dispatch({ type: 'set-notes', payload: imported.notes || [] });
      dispatch({ type: 'set-nullifiers', payload: imported.nullifiers || [] });
      dispatch({ type: 'set-initialized', payload: true });
      dispatch({ type: 'set-last-sync', payload: imported.updated_at });
      console.info('[PCD] Imported state, height:', imported.pcd_state.wallet_state.height);
    } catch (err) {
      dispatch({
        type: 'set-error',
        payload: err instanceof Error ? err.message : 'Failed to import PCD state',
      });
      throw err;
    }
  }, []);

  const clearPcdState = useCallback(async (): Promise<void> => {
    try {
      await del(PCD_STORAGE_KEY);
      dispatch({ type: 'reset' });
      console.info('[PCD] State cleared');
    } catch (err) {
      console.error('[PCD] Failed to clear state:', err);
    }
  }, []);

  const addNote = useCallback((note: NoteIdentifier) => {
    dispatch({ type: 'set-notes', payload: [...state.notes, note] });
  }, [state.notes]);

  const spendNote = useCallback(
    (noteCommitment: string, nullifier: string) => {
      const updatedNotes = state.notes.filter((n) => n.commitment !== noteCommitment);
      const newNullifier: NullifierIdentifier = {
        nullifier,
        note_commitment: noteCommitment,
      };
      dispatch({ type: 'set-notes', payload: updatedNotes });
      dispatch({ type: 'set-nullifiers', payload: [...state.nullifiers, newNullifier] });
    },
    [state.notes, state.nullifiers]
  );

  const submitToMinaRail = useCallback(
    async (
      nullifier: NullifierIdentifier,
      policyId: number,
      threshold: number,
      l1BlockNumber: number,
      l1TxHash: string
    ): Promise<SubmitTachystampResponse> => {
      if (!state.pcdState) {
        throw new Error('PCD not initialized');
      }

      console.info('[PCD] Submitting tachystamp to Mina Rail...');
      
      try {
        // Create tachystamp from current PCD state
        const tachystamp = createTachystampFromPcd(
          state.pcdState,
          nullifier,
          policyId,
          threshold,
          l1BlockNumber,
          l1TxHash
        );

        // Validate tachystamp
        const validation = validateTachystamp(tachystamp);
        if (!validation.valid) {
          throw new Error(validation.error ?? 'Invalid tachystamp');
        }

        // Submit to Mina Rail
        const minaRailClient = getMinaRailClient();
        const response = await minaRailClient.submitTachystamp({ tachystamp });

        if (response.success) {
          console.info('[PCD] Tachystamp submitted to Mina Rail:', {
            id: response.tachystampId,
            shard: response.shardId,
            epoch: response.epoch,
            position: response.queuePosition,
          });
        } else {
          console.warn('[PCD] Tachystamp submission failed:', response.error);
        }

        return response;
      } catch (err) {
        console.error('[PCD] Failed to submit to Mina Rail:', err);
        // Return a failed response instead of throwing
        return {
          success: false,
          tachystampId: '',
          shardId: -1,
          epoch: 0,
          queuePosition: -1,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    },
    [state.pcdState]
  );

  const contextValue: PcdContextValue = useMemo(
    () => ({
      state,
      initializePcd,
      updatePcd,
      verifyPcd,
      getTachyonMetadata,
      exportPcdState,
      importPcdState,
      clearPcdState,
      addNote,
      spendNote,
      submitToMinaRail,
    }),
    [
      state,
      initializePcd,
      updatePcd,
      verifyPcd,
      getTachyonMetadata,
      exportPcdState,
      importPcdState,
      clearPcdState,
      addNote,
      spendNote,
      submitToMinaRail,
    ]
  );

  return <PcdContext.Provider value={contextValue}>{children}</PcdContext.Provider>;
}

