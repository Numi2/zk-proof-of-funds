/**
 * Mina Recursive Rail Types
 *
 * The Mina Rail is a Mina-based app-chain that aggregates Tachyon tachystamps
 * into a single succinct proof per epoch, offloading PCD computation from L1.
 */

/**
 * A tachystamp submitted to the Mina Rail.
 */
export interface Tachystamp {
  /** Unique identifier */
  id: string;
  /** The epoch this tachystamp is valid for */
  epoch: number;
  /** Nullifier to prevent double-counting */
  nullifier: string;
  /** Commitment to the holder's identity */
  holderCommitment: string;
  /** Policy ID that was verified */
  policyId: number;
  /** The balance threshold that was proven */
  threshold: number;
  /** Currency code (ZEC = 0x5A4543) */
  currencyCode: number;
  /** Proof data from the local zkpf proof */
  proofData: TachystampProof;
  /** L1 block number where this was emitted */
  l1BlockNumber: number;
  /** L1 transaction hash */
  l1TxHash: string;
  /** Submission timestamp */
  submittedAt: number;
}

/**
 * Proof data embedded in a tachystamp.
 */
export interface TachystampProof {
  /** The proof bytes (base64 encoded) */
  proofBytes: string;
  /** Public inputs (hex strings) */
  publicInputs: string[];
  /** Verification key hash */
  vkHash: string;
}

/**
 * Epoch state from the Mina Rail.
 */
export interface MinaRailEpochState {
  /** Current epoch number */
  epoch: number;
  /** Mina slot at epoch start */
  startSlot: number;
  /** Mina slot at epoch end (if finalized) */
  endSlot: number | null;
  /** Merkle root of all nullifiers */
  nullifierRoot: string;
  /** Number of tachystamps processed */
  tachystampCount: number;
  /** Number of unique holders */
  holderCount: number;
  /** IVC accumulator state hash */
  accumulatorHash: string;
  /** Previous epoch's proof hash */
  previousEpochHash: string;
  /** Whether the epoch is finalized */
  isFinalized: boolean;
}

/**
 * Epoch proof from the Mina Rail.
 */
export interface MinaRailEpochProof {
  /** The epoch number */
  epoch: number;
  /** Pre-state hash */
  preStateHash: string;
  /** Post-state hash */
  postStateHash: string;
  /** Final nullifier root */
  nullifierRoot: string;
  /** Total proofs aggregated */
  proofCount: number;
  /** IVC proof data */
  ivcProof: IVCProofData;
  /** Shard commitment */
  shardCommitment: string;
  /** Mina block hash where anchored */
  minaAnchorHash: string;
  /** Mina slot at finalization */
  minaSlot: number;
  /** Proof hash for verification */
  proofHash: string;
}

/**
 * IVC proof data.
 */
export interface IVCProofData {
  /** Pickles proof bytes (base64) */
  proofBytes: string;
  /** Public inputs */
  publicInputs: string[];
  /** Accumulated challenges */
  challenges: string[];
  /** Final accumulator commitment */
  accumulatorCommitment: string;
}

/**
 * Shard status in the aggregation.
 */
export interface ShardStatus {
  /** Shard ID */
  shardId: number;
  /** Number of tachystamps in this shard */
  tachystampCount: number;
  /** Shard nullifier root */
  nullifierRoot: string;
  /** Whether the shard proof is generated */
  isProofGenerated: boolean;
  /** Shard proof hash (if generated) */
  proofHash: string | null;
}

/**
 * Overall Mina Rail status.
 */
export interface MinaRailStatus {
  /** Current epoch being aggregated */
  currentEpoch: number;
  /** Status of each shard */
  shards: ShardStatus[];
  /** Total tachystamps in current epoch */
  totalTachystamps: number;
  /** Aggregation progress (0-100) */
  aggregationProgress: number;
  /** Rail sync status */
  syncStatus: MinaRailSyncStatus;
  /** Latest finalized epoch */
  latestFinalizedEpoch: number;
  /** Latest epoch proof hash */
  latestEpochProofHash: string | null;
  /** Time until next epoch */
  timeToNextEpoch: number;
  /** Error message if any */
  error: string | null;
}

/**
 * Mina Rail sync status.
 */
export type MinaRailSyncStatus =
  | 'idle'
  | 'syncing'
  | 'aggregating'
  | 'finalizing'
  | 'bridging'
  | 'error';

/**
 * Request to submit a tachystamp.
 */
export interface SubmitTachystampRequest {
  /** The tachystamp to submit */
  tachystamp: Omit<Tachystamp, 'id' | 'submittedAt'>;
}

/**
 * Response from tachystamp submission.
 */
export interface SubmitTachystampResponse {
  /** Whether submission was successful */
  success: boolean;
  /** Assigned tachystamp ID */
  tachystampId: string;
  /** Assigned shard */
  shardId: number;
  /** Current epoch */
  epoch: number;
  /** Position in aggregation queue */
  queuePosition: number;
  /** Error message if failed */
  error: string | null;
}

/**
 * Request to get epoch proof.
 */
export interface GetEpochProofRequest {
  /** Epoch number */
  epoch: number;
}

/**
 * Response with epoch proof.
 */
export interface GetEpochProofResponse {
  /** Whether the epoch is finalized */
  isFinalized: boolean;
  /** The epoch proof (if finalized) */
  proof: MinaRailEpochProof | null;
  /** State at time of request */
  epochState: MinaRailEpochState;
}

/**
 * Holder's tachystamp history.
 */
export interface HolderTachystampHistory {
  /** Holder commitment */
  holderCommitment: string;
  /** All tachystamps for this holder */
  tachystamps: Tachystamp[];
  /** Epochs with finalized proofs */
  finalizedEpochs: number[];
  /** Total nullifiers used */
  nullifierCount: number;
}

/**
 * Bridge message from L1.
 */
export interface L1BridgeMessage {
  /** Message type */
  type: 'tachystamp' | 'epoch_request' | 'status_query';
  /** Payload data (JSON) */
  payload: string;
  /** L1 block number */
  l1BlockNumber: number;
  /** L1 transaction hash */
  l1TxHash: string;
  /** Timestamp */
  timestamp: number;
}

/**
 * Epoch verification result.
 */
export interface EpochVerificationResult {
  /** Whether verification passed */
  valid: boolean;
  /** Verified nullifier root */
  nullifierRoot: string;
  /** Verified proof count */
  proofCount: number;
  /** Mina slot verified at */
  verifiedAtSlot: number;
  /** Error if verification failed */
  error: string | null;
}

