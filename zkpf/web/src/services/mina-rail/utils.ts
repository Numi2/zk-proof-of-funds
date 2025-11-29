/**
 * Mina Rail Utility Functions
 */

import type { Tachystamp, TachystampProof } from '../../types/mina-rail';
import type { PcdState, NullifierIdentifier } from '../../types/pcd';

/**
 * Create a tachystamp from PCD state and nullifier.
 */
export function createTachystampFromPcd(
  pcdState: PcdState,
  nullifier: NullifierIdentifier,
  policyId: number,
  threshold: number,
  l1BlockNumber: number,
  l1TxHash: string
): Omit<Tachystamp, 'id' | 'submittedAt'> {
  // Compute holder commitment from PCD state
  const holderCommitment = computeHolderCommitment(pcdState);

  // Extract proof data
  const proofData: TachystampProof = {
    proofBytes: pcdState.proof_current,
    publicInputs: [
      pcdState.s_current,
      pcdState.wallet_state.notes_root,
      pcdState.wallet_state.anchor,
    ],
    vkHash: computeVkHash(pcdState.circuit_version),
  };

  return {
    epoch: computeEpochFromHeight(pcdState.wallet_state.height),
    nullifier: nullifier.nullifier,
    holderCommitment,
    policyId,
    threshold,
    currencyCode: 0x5A4543, // ZEC
    proofData,
    l1BlockNumber,
    l1TxHash,
  };
}

/**
 * Compute holder commitment from PCD state.
 */
export function computeHolderCommitment(pcdState: PcdState): string {
  // Use s_genesis as the holder binding (unique per wallet)
  return pcdState.s_genesis;
}

/**
 * Compute VK hash for a circuit version.
 */
export function computeVkHash(circuitVersion: number): string {
  // In production, this would be a real hash of the verification key
  const encoder = new TextEncoder();
  const data = encoder.encode(`zkpf_circuit_v${circuitVersion}`);
  
  // Simple hash (in production, use crypto.subtle.digest)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash) + data[i];
    hash = hash & hash;
  }
  
  return '0x' + Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * Compute epoch from block height.
 * Epochs are ~1 day (7200 blocks at 12-second blocks).
 */
export function computeEpochFromHeight(height: number): number {
  const BLOCKS_PER_EPOCH = 7200;
  return Math.floor(height / BLOCKS_PER_EPOCH);
}

/**
 * Compute tachystamp ID.
 */
export async function computeTachystampId(
  epoch: number,
  nullifier: string,
  holderCommitment: string,
  policyId: number
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(
    `tachystamp_id_v1:${epoch}:${nullifier}:${holderCommitment}:${policyId}`
  );
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Determine shard ID for a nullifier.
 */
export function getShardIdForNullifier(nullifier: string, numShards: number): number {
  // Use first byte of nullifier as prefix
  const prefix = parseInt(nullifier.slice(2, 4), 16);
  return Math.floor(prefix * numShards / 256);
}

/**
 * Format epoch proof for display.
 */
export function formatEpochProofSummary(proofCount: number, epoch: number): string {
  if (proofCount === 0) {
    return `Epoch ${epoch}: No proofs aggregated`;
  }
  if (proofCount === 1) {
    return `Epoch ${epoch}: 1 proof aggregated`;
  }
  return `Epoch ${epoch}: ${proofCount.toLocaleString()} proofs aggregated`;
}

/**
 * Estimate time until next epoch.
 */
export function estimateTimeToNextEpoch(
  currentSlot: number,
  epochDurationSlots: number,
  slotDurationSeconds: number = 180 // Mina slot is ~3 minutes
): number {
  const slotsUntilEpoch = epochDurationSlots - (currentSlot % epochDurationSlots);
  return slotsUntilEpoch * slotDurationSeconds * 1000; // Return milliseconds
}

/**
 * Format aggregation progress.
 */
export function formatAggregationProgress(
  completedShards: number,
  totalShards: number
): string {
  const percent = Math.round((completedShards / totalShards) * 100);
  return `${completedShards}/${totalShards} shards (${percent}%)`;
}

/**
 * Validate tachystamp structure.
 */
export function validateTachystamp(
  tachystamp: Omit<Tachystamp, 'id' | 'submittedAt'>
): { valid: boolean; error: string | null } {
  // Check nullifier is non-zero
  if (!tachystamp.nullifier || tachystamp.nullifier === '0x' + '0'.repeat(64)) {
    return { valid: false, error: 'Nullifier cannot be zero' };
  }

  // Check proof data exists
  if (!tachystamp.proofData?.proofBytes) {
    return { valid: false, error: 'Proof data is missing' };
  }

  // Check holder commitment
  if (!tachystamp.holderCommitment || tachystamp.holderCommitment === '0x' + '0'.repeat(64)) {
    return { valid: false, error: 'Holder commitment is invalid' };
  }

  // Check policy ID
  if (tachystamp.policyId <= 0) {
    return { valid: false, error: 'Policy ID must be positive' };
  }

  return { valid: true, error: null };
}

/**
 * Parse epoch proof from bridge format.
 */
export function parseEpochProofFromBridge(bytes: Uint8Array): {
  epoch: number;
  nullifierRoot: string;
  proofCount: number;
  ivcProofBytes: Uint8Array;
  minaSlot: number;
} | null {
  if (bytes.length < 100) return null;

  // Check magic bytes
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== 'MREP') return null;

  // Parse fields
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  
  const epoch = Number(view.getBigUint64(8, false));
  
  const nullifierRoot = '0x' + Array.from(bytes.slice(48, 80))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const proofCount = Number(view.getBigUint64(80, false));
  
  const proofLength = view.getUint32(88, false);
  const ivcProofBytes = bytes.slice(92, 92 + proofLength);
  
  const minaSlotOffset = 92 + proofLength + 64 + 32;
  const minaSlot = Number(view.getBigUint64(minaSlotOffset, false));

  return {
    epoch,
    nullifierRoot,
    proofCount,
    ivcProofBytes,
    minaSlot,
  };
}

