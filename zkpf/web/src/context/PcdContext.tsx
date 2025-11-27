/**
 * PCD (Proof-Carrying Data) Context
 *
 * Manages the Tachyon wallet state machine with ZK proofs.
 * The wallet maintains (S_current, π_current) which can be updated
 * after processing each batch of blocks.
 */

/* eslint-disable react-refresh/only-export-components */

import React, {
  createContext,
  useCallback,
  useContext,
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

// ============================================================
// Client-side PCD Mock (used when backend is unavailable)
// ============================================================

/**
 * Generate a deterministic hash for state commitment (client-side mock).
 * Uses Web Crypto API for SHA-256.
 */
async function computeStateCommitment(state: WalletState): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(state));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a mock proof (64 random bytes as hex).
 * In production, this would be a real ZK proof from the backend.
 */
function generateMockProof(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a deterministic commitment for a set of notes.
 */
async function computeNotesRoot(notes: NoteIdentifier[]): Promise<string> {
  if (notes.length === 0) {
    return '0x' + '0'.repeat(64); // Empty tree
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(notes.map(n => n.commitment).sort().join(''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a genesis PCD state (client-side mock).
 */
async function createMockGenesisPcd(initialNotes: NoteIdentifier[] = []): Promise<PcdState> {
  const notesRoot = await computeNotesRoot(initialNotes);
  
  const genesisState: WalletState = {
    height: 0,
    anchor: '0x' + '0'.repeat(64), // Empty anchor
    notes_root: notesRoot,
    nullifiers_root: '0x' + '0'.repeat(64), // No nullifiers
    version: 1,
  };
  
  const sGenesis = await computeStateCommitment(genesisState);
  const mockProof = generateMockProof();
  
  return {
    wallet_state: genesisState,
    s_current: sGenesis,
    proof_current: mockProof,
    circuit_version: 1,
    s_genesis: sGenesis,
    chain_length: 1,
  };
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

interface PcdContextValue {
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
}

const PcdContext = createContext<PcdContextValue | null>(null);

export function usePcdContext(): PcdContextValue {
  const context = useContext(PcdContext);
  if (!context) {
    throw new Error('usePcdContext must be used within PcdProvider');
  }
  return context;
}

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
        // Try the backend first
        const response = await client.pcdInit(initialNotes);
        dispatch({ type: 'set-pcd-state', payload: response.pcd_state });
        dispatch({ type: 'set-notes', payload: initialNotes });
        dispatch({ type: 'set-nullifiers', payload: [] });
        dispatch({ type: 'set-initialized', payload: true });
        dispatch({ type: 'set-last-sync', payload: Date.now() });
        dispatch({ type: 'set-status', payload: 'idle' });
        console.info('[PCD] Initialized new chain via backend, genesis:', response.pcd_state.s_genesis);
      } catch (err) {
        // Check if it's a 404 or connection error - use client-side mock
        const isBackendUnavailable = 
          (err instanceof ApiError && (err.status === 404 || err.status === 502)) ||
          (err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')));
        
        if (isBackendUnavailable) {
          console.warn('[PCD] Backend unavailable, using client-side mock initialization');
          try {
            const mockPcdState = await createMockGenesisPcd(initialNotes);
            dispatch({ type: 'set-pcd-state', payload: mockPcdState });
            dispatch({ type: 'set-notes', payload: initialNotes });
            dispatch({ type: 'set-nullifiers', payload: [] });
            dispatch({ type: 'set-initialized', payload: true });
            dispatch({ type: 'set-last-sync', payload: Date.now() });
            dispatch({ type: 'set-status', payload: 'idle' });
            console.info('[PCD] Initialized new chain via mock, genesis:', mockPcdState.s_genesis);
            return;
          } catch (mockErr) {
            console.error('[PCD] Mock initialization failed:', mockErr);
          }
        }
        
        dispatch({
          type: 'set-error',
          payload: err instanceof Error ? err.message : 'Failed to initialize PCD',
        });
        throw err;
      }
    },
    [client]
  );

  const updatePcd = useCallback(
    async (delta: BlockDelta) => {
      if (!state.pcdState) {
        throw new Error('PCD not initialized');
      }

      dispatch({ type: 'set-status', payload: 'syncing' });
      
      // Helper to update state
      const applyDelta = async (pcdState: PcdState): Promise<PcdState> => {
        // Update notes: remove spent, add new
        const spentCommitments = new Set(
          delta.spent_nullifiers.map((nf) => nf.note_commitment)
        );
        const updatedNotes = state.notes
          .filter((n) => !spentCommitments.has(n.commitment))
          .concat(delta.new_notes);
        
        const notesRoot = await computeNotesRoot(updatedNotes);
        
        const newWalletState: WalletState = {
          height: delta.block_height,
          anchor: delta.anchor_new,
          notes_root: notesRoot,
          nullifiers_root: pcdState.wallet_state.nullifiers_root, // Simplified
          version: pcdState.wallet_state.version,
        };
        
        const sNew = await computeStateCommitment(newWalletState);
        
        return {
          wallet_state: newWalletState,
          s_current: sNew,
          proof_current: generateMockProof(),
          circuit_version: pcdState.circuit_version,
          s_genesis: pcdState.s_genesis,
          chain_length: pcdState.chain_length + 1,
        };
      };
      
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
        // Check if backend is unavailable - use client-side mock
        const isBackendUnavailable = 
          (err instanceof ApiError && (err.status === 404 || err.status === 502)) ||
          (err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')));
        
        if (isBackendUnavailable && state.pcdState) {
          console.warn('[PCD] Backend unavailable, using client-side mock update');
          try {
            const newPcdState = await applyDelta(state.pcdState);
            
            const spentCommitments = new Set(
              delta.spent_nullifiers.map((nf) => nf.note_commitment)
            );
            const updatedNotes = state.notes
              .filter((n) => !spentCommitments.has(n.commitment))
              .concat(delta.new_notes);
            const updatedNullifiers = state.nullifiers.concat(delta.spent_nullifiers);
            
            dispatch({ type: 'set-pcd-state', payload: newPcdState });
            dispatch({ type: 'set-notes', payload: updatedNotes });
            dispatch({ type: 'set-nullifiers', payload: updatedNullifiers });
            dispatch({ type: 'set-last-sync', payload: Date.now() });
            dispatch({ type: 'set-status', payload: 'idle' });
            
            console.info('[PCD] Updated via mock to height:', newPcdState.wallet_state.height);
            return;
          } catch (mockErr) {
            console.error('[PCD] Mock update failed:', mockErr);
          }
        }
        
        dispatch({
          type: 'set-error',
          payload: err instanceof Error ? err.message : 'Failed to update PCD',
        });
        throw err;
      }
    },
    [client, state.pcdState, state.notes, state.nullifiers]
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
      const isBackendUnavailable = 
        (err instanceof ApiError && (err.status === 404 || err.status === 502)) ||
        (err instanceof Error && (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')));
      
      if (isBackendUnavailable && state.pcdState) {
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
    ]
  );

  return <PcdContext.Provider value={contextValue}>{children}</PcdContext.Provider>;
}

