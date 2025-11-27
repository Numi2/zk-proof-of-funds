/**
 * PCD (Proof-Carrying Data) Types
 *
 * The PCD pattern allows a wallet to maintain a chain of proofs where each
 * new proof commits to the previous state. This is the "Tachyon" state
 * commitment system for the wallet.
 */

/**
 * Note identifier in the wallet's note set.
 */
export interface NoteIdentifier {
  /** Note commitment (field element as hex) */
  commitment: string;
  /** Value in base units (zatoshis) */
  value: number;
  /** Position in the global note commitment tree */
  position: number;
}

/**
 * Nullifier identifier for spent notes.
 */
export interface NullifierIdentifier {
  /** The nullifier value (field element as hex) */
  nullifier: string;
  /** Reference to the note being spent */
  note_commitment: string;
}

/**
 * Wallet state representation.
 */
export interface WalletState {
  /** Last processed block height */
  height: number;
  /** Orchard Merkle tree root (hex) */
  anchor: string;
  /** Commitment to unspent notes (hex) */
  notes_root: string;
  /** Commitment to spent nullifiers (hex) */
  nullifiers_root: string;
  /** State version / circuit ID */
  version: number;
}

/**
 * Block delta for state transitions.
 */
export interface BlockDelta {
  /** Block height being processed */
  block_height: number;
  /** New anchor after this block (hex) */
  anchor_new: string;
  /** New notes discovered in this block */
  new_notes: NoteIdentifier[];
  /** Nullifiers spent in this block */
  spent_nullifiers: NullifierIdentifier[];
}

/**
 * Full PCD state including wallet state and proof chain.
 */
export interface PcdState {
  /** The current wallet state */
  wallet_state: WalletState;
  /** Commitment to the current state (hex) */
  s_current: string;
  /** The current proof (hex-encoded) */
  proof_current: string;
  /** Circuit version for the proof */
  circuit_version: number;
  /** Genesis state commitment (hex) */
  s_genesis: string;
  /** Chain length (transitions from genesis) */
  chain_length: number;
}

/**
 * Request for initializing a new PCD chain.
 */
export interface PcdInitRequest {
  /** Optional initial notes for non-empty genesis */
  initial_notes?: NoteIdentifier[];
}

/**
 * Response from PCD initialization.
 */
export interface PcdInitResponse {
  pcd_state: PcdState;
}

/**
 * Request for updating PCD state.
 */
export interface PcdUpdateRequest {
  /** Current PCD state */
  pcd_state: PcdState;
  /** Block delta to apply */
  delta: BlockDelta;
  /** Current notes in wallet */
  current_notes: NoteIdentifier[];
  /** Current nullifiers in wallet */
  current_nullifiers: NullifierIdentifier[];
}

/**
 * Response from PCD update.
 */
export interface PcdUpdateResponse {
  /** Updated PCD state */
  pcd_state: PcdState;
  /** Whether the previous proof was verified */
  prev_proof_verified: boolean;
}

/**
 * Request for verifying PCD state.
 */
export interface PcdVerifyRequest {
  pcd_state: PcdState;
}

/**
 * Response from PCD verification.
 */
export interface PcdVerifyResponse {
  /** Whether the proof is valid */
  valid: boolean;
  /** The verified state commitment */
  s_current: string;
  /** Chain length */
  chain_length: number;
  /** Error message if invalid */
  error: string | null;
}

/**
 * Tachyon metadata for spending flow.
 */
export interface TachyonMetadata {
  /** Current state commitment */
  s_current: string;
  /** Current proof (hex) */
  proof_current: string;
  /** Last processed block height */
  height: number;
  /** Chain length */
  chain_length: number;
  /** Timestamp of last update */
  updated_at: number;
}

/**
 * Local storage format for persisted PCD state.
 */
export interface PersistedPcdState {
  /** The PCD state */
  pcd_state: PcdState;
  /** Current notes (private, not in proof) */
  notes: NoteIdentifier[];
  /** Current nullifiers (private) */
  nullifiers: NullifierIdentifier[];
  /** Last update timestamp */
  updated_at: number;
}

/**
 * PCD sync status for UI display.
 */
export type PcdSyncStatus = 
  | 'idle'
  | 'syncing'
  | 'verifying'
  | 'generating_proof'
  | 'error';

/**
 * PCD context state for React.
 */
export interface PcdContextState {
  /** The current PCD state (null if not initialized) */
  pcdState: PcdState | null;
  /** Current notes in wallet */
  notes: NoteIdentifier[];
  /** Current nullifiers */
  nullifiers: NullifierIdentifier[];
  /** Sync status */
  status: PcdSyncStatus;
  /** Error message if any */
  error: string | null;
  /** Is PCD initialized? */
  isInitialized: boolean;
  /** Last sync timestamp */
  lastSyncAt: number | null;
}

