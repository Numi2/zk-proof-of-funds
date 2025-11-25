/**
 * Type definitions for zkpf Mina contracts.
 */

import { Field, Struct, UInt64, Poseidon, Bool, CircuitString } from 'o1js';

/**
 * Public inputs from a zkpf proof bundle.
 */
export class PublicInputs extends Struct({
  thresholdRaw: UInt64,
  requiredCurrencyCode: Field,
  currentEpoch: UInt64,
  verifierScopeId: UInt64,
  policyId: UInt64,
  nullifier: Field,
  custodianPubkeyHash: Field,
  snapshotBlockHeight: UInt64,
  accountCommitment: Field,
  holderBinding: Field,
  provenSum: UInt64,
}) {
  /**
   * Hash the public inputs for commitment.
   */
  hash(): Field {
    return Poseidon.hash([
      this.thresholdRaw.value,
      this.requiredCurrencyCode,
      this.currentEpoch.value,
      this.verifierScopeId.value,
      this.policyId.value,
      this.nullifier,
      this.custodianPubkeyHash,
      this.snapshotBlockHeight.value,
      this.accountCommitment,
      this.holderBinding,
      this.provenSum.value,
    ]);
  }

  /**
   * Verify that the proven sum meets the threshold.
   */
  meetsThreshold(): Bool {
    return this.provenSum.greaterThanOrEqual(this.thresholdRaw);
  }
}

/**
 * Proof bundle from any zkpf rail.
 */
export class ProofBundle extends Struct({
  railId: Field, // Encoded rail identifier
  circuitVersion: Field,
  proofCommitment: Field, // Hash of the actual proof bytes
  publicInputs: PublicInputs,
}) {
  /**
   * Compute the commitment to this proof bundle.
   */
  commitment(): Field {
    return Poseidon.hash([
      this.railId,
      this.circuitVersion,
      this.proofCommitment,
      this.publicInputs.hash(),
    ]);
  }

  /**
   * Check if this bundle is from the Mina rail.
   */
  isMinaRail(): Bool {
    // MINA_RECURSIVE encoded as Field
    const minaRailId = Field(0x4d494e415f524543555253495645n); // "MINA_RECURSIVE" as big int
    return this.railId.equals(minaRailId);
  }
}

/**
 * Rail identifiers as Field values.
 */
export const RailIds = {
  CUSTODIAL: Field(0x435553544f4449414cn), // "CUSTODIAL"
  ORCHARD: Field(0x4f524348415244n), // "ORCHARD"
  STARKNET_L2: Field(0x535441524b4e45545f4c32n), // "STARKNET_L2"
  MINA_RECURSIVE: Field(0x4d494e415f524543555253495645n), // "MINA_RECURSIVE"
};

/**
 * Parse a JSON proof bundle into the circuit struct.
 * Note: In a real implementation, this would need to handle
 * off-chain to on-chain data conversion carefully.
 */
export function parseProofBundle(json: {
  rail_id: string;
  circuit_version: number;
  proof: number[];
  public_inputs: {
    threshold_raw: string;
    required_currency_code: number;
    current_epoch: string;
    verifier_scope_id: string;
    policy_id: string;
    nullifier: string;
    custodian_pubkey_hash: string;
    snapshot_block_height?: string;
    snapshot_anchor_orchard?: string;
    holder_binding?: string;
    proven_sum?: string;
  };
}): ProofBundle {
  // Encode rail_id as Field
  const railIdBytes = Buffer.from(json.rail_id);
  const railId = Field(BigInt('0x' + railIdBytes.toString('hex')));

  // Compute proof commitment
  const proofBytes = Buffer.from(json.proof);
  const proofCommitment = Poseidon.hash(
    Array.from(proofBytes.slice(0, 64)).map((b) => Field(b))
  );

  // Parse public inputs
  const publicInputs = new PublicInputs({
    thresholdRaw: UInt64.from(json.public_inputs.threshold_raw),
    requiredCurrencyCode: Field(json.public_inputs.required_currency_code),
    currentEpoch: UInt64.from(json.public_inputs.current_epoch),
    verifierScopeId: UInt64.from(json.public_inputs.verifier_scope_id),
    policyId: UInt64.from(json.public_inputs.policy_id),
    nullifier: Field(BigInt('0x' + json.public_inputs.nullifier.replace('0x', ''))),
    custodianPubkeyHash: Field(
      BigInt('0x' + json.public_inputs.custodian_pubkey_hash.replace('0x', ''))
    ),
    snapshotBlockHeight: UInt64.from(json.public_inputs.snapshot_block_height || '0'),
    accountCommitment: Field(
      BigInt('0x' + (json.public_inputs.snapshot_anchor_orchard || '0').replace('0x', ''))
    ),
    holderBinding: Field(
      BigInt('0x' + (json.public_inputs.holder_binding || '0').replace('0x', ''))
    ),
    provenSum: UInt64.from(json.public_inputs.proven_sum || '0'),
  });

  return new ProofBundle({
    railId,
    circuitVersion: Field(json.circuit_version),
    proofCommitment,
    publicInputs,
  });
}

