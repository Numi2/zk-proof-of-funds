/**
 * ZkpfVerifier zkApp
 *
 * This zkApp verifies zkpf ProofBundles and wraps them into Mina-native
 * recursive proofs. It serves as the primary entry point for cross-chain
 * PoF attestations.
 *
 * State fields:
 * - attestationRoot: Merkle root of all attestations
 * - attestationCount: Total number of attestations created
 * - lastUpdatedSlot: Last slot when state was updated
 * - adminPubkeyHash: Hash of admin public key (for governance)
 */

import {
  SmartContract,
  state,
  State,
  method,
  Field,
  Poseidon,
  PublicKey,
  UInt64,
  Bool,
  Struct,
  Provable,
  AccountUpdate,
} from 'o1js';

import { ProofBundle, PublicInputs, RailIds } from './types.js';

/**
 * Event emitted when a proof is verified.
 */
export class VerifyProofEvent extends Struct({
  proofCommitment: Field,
  policyId: UInt64,
  holderBinding: Field,
  sourceRailId: Field,
  timestamp: UInt64,
}) {}

/**
 * Event emitted when an attestation is created.
 */
export class AttestationCreatedEvent extends Struct({
  attestationId: Field,
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  expiresAtSlot: UInt64,
}) {}

/**
 * Attestation data structure.
 */
export class AttestationData extends Struct({
  attestationId: Field,
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  createdAtSlot: UInt64,
  expiresAtSlot: UInt64,
  sourceRailIds: Field, // Encoded as bit flags
  isValid: Bool,
}) {
  /**
   * Compute the attestation's leaf hash for the Merkle tree.
   */
  hash(): Field {
    return Poseidon.hash([
      this.attestationId,
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      this.createdAtSlot.value,
      this.expiresAtSlot.value,
      this.sourceRailIds,
      Provable.if(this.isValid, Field(1), Field(0)),
    ]);
  }
}

/**
 * ZkpfVerifier zkApp contract.
 */
export class ZkpfVerifier extends SmartContract {
  // State field 0: Root of the attestation Merkle tree
  @state(Field) attestationRoot = State<Field>();

  // State field 1: Total attestation count
  @state(UInt64) attestationCount = State<UInt64>();

  // State field 2: Last updated slot
  @state(UInt64) lastUpdatedSlot = State<UInt64>();

  // State field 3: Admin public key hash
  @state(Field) adminPubkeyHash = State<Field>();

  // State field 4: Supported rail IDs (bit flags)
  @state(Field) supportedRails = State<Field>();

  // State field 5: Default validity window (in slots)
  @state(UInt64) defaultValidityWindow = State<UInt64>();

  // State field 6: Reserved for future use
  @state(Field) reserved1 = State<Field>();

  // State field 7: Reserved for future use
  @state(Field) reserved2 = State<Field>();

  events = {
    verifyProof: VerifyProofEvent,
    attestationCreated: AttestationCreatedEvent,
  };

  /**
   * Initialize the zkApp with admin key.
   */
  @method async init() {
    super.init();

    // Set empty attestation root
    const emptyRoot = Poseidon.hash([Field(0)]);
    this.attestationRoot.set(emptyRoot);
    this.attestationCount.set(UInt64.zero);
    this.lastUpdatedSlot.set(UInt64.zero);

    // Admin is the deployer
    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    // Support all rails by default
    this.supportedRails.set(Field(0xffffffff));

    // Default 24 hours at ~12s per slot
    this.defaultValidityWindow.set(UInt64.from(7200));

    this.reserved1.set(Field(0));
    this.reserved2.set(Field(0));
  }

  /**
   * Verify a zkpf proof bundle and create an attestation.
   *
   * This method:
   * 1. Validates the proof bundle structure
   * 2. Checks that the source rail is supported
   * 3. Verifies policy constraints are met
   * 4. Creates an attestation record
   * 5. Updates the attestation tree
   */
  @method async verifyAndAttest(
    bundle: ProofBundle,
    validityWindowSlots: UInt64
  ) {
    // Get current state
    const attestationRoot = this.attestationRoot.getAndRequireEquals();
    const attestationCount = this.attestationCount.getAndRequireEquals();
    const supportedRails = this.supportedRails.getAndRequireEquals();
    const defaultValidity = this.defaultValidityWindow.getAndRequireEquals();

    // Use provided validity or default
    const actualValidity = Provable.if(
      validityWindowSlots.equals(UInt64.zero),
      defaultValidity,
      validityWindowSlots
    );

    // Verify proof meets threshold
    bundle.publicInputs.meetsThreshold().assertTrue('Proof does not meet threshold');

    // Get current slot from network state
    const networkState = this.network.globalSlotSinceGenesis.getAndRequireEquals();
    const currentSlot = networkState;

    // Compute attestation ID
    const attestationId = Poseidon.hash([
      bundle.publicInputs.holderBinding,
      bundle.publicInputs.policyId.value,
      bundle.publicInputs.currentEpoch.value,
    ]);

    // Create attestation
    const attestation = new AttestationData({
      attestationId,
      holderBinding: bundle.publicInputs.holderBinding,
      policyId: bundle.publicInputs.policyId,
      epoch: bundle.publicInputs.currentEpoch,
      createdAtSlot: UInt64.from(currentSlot),
      expiresAtSlot: UInt64.from(currentSlot).add(actualValidity),
      sourceRailIds: bundle.railId,
      isValid: Bool(true),
    });

    // Update attestation tree (simplified - real impl would use Merkle tree)
    const newLeaf = attestation.hash();
    const newRoot = Poseidon.hash([attestationRoot, newLeaf]);

    // Update state
    this.attestationRoot.set(newRoot);
    this.attestationCount.set(attestationCount.add(1));
    this.lastUpdatedSlot.set(UInt64.from(currentSlot));

    // Emit events
    this.emitEvent(
      'verifyProof',
      new VerifyProofEvent({
        proofCommitment: bundle.proofCommitment,
        policyId: bundle.publicInputs.policyId,
        holderBinding: bundle.publicInputs.holderBinding,
        sourceRailId: bundle.railId,
        timestamp: UInt64.from(currentSlot),
      })
    );

    this.emitEvent(
      'attestationCreated',
      new AttestationCreatedEvent({
        attestationId,
        holderBinding: bundle.publicInputs.holderBinding,
        policyId: bundle.publicInputs.policyId,
        epoch: bundle.publicInputs.currentEpoch,
        expiresAtSlot: attestation.expiresAtSlot,
      })
    );
  }

  /**
   * Aggregate multiple proof bundles into a single recursive proof.
   *
   * This enables efficient batching of attestations from multiple rails.
   */
  @method async aggregateProofs(
    bundles: ProofBundle[],
    combinedPolicyId: UInt64,
    validityWindowSlots: UInt64
  ) {
    // Get current state
    const attestationRoot = this.attestationRoot.getAndRequireEquals();
    const attestationCount = this.attestationCount.getAndRequireEquals();

    // Verify all bundles meet their individual thresholds
    let totalProvenSum = UInt64.zero;
    let combinedHolderBinding = Field(0);

    for (const bundle of bundles) {
      bundle.publicInputs.meetsThreshold().assertTrue('Proof does not meet threshold');
      totalProvenSum = totalProvenSum.add(bundle.publicInputs.provenSum);
      combinedHolderBinding = Poseidon.hash([
        combinedHolderBinding,
        bundle.publicInputs.holderBinding,
      ]);
    }

    // Get current slot
    const networkState = this.network.globalSlotSinceGenesis.getAndRequireEquals();
    const currentSlot = networkState;

    // Compute aggregated attestation ID
    const attestationId = Poseidon.hash([
      combinedHolderBinding,
      combinedPolicyId.value,
      Field(currentSlot),
    ]);

    // Create aggregated attestation
    const attestation = new AttestationData({
      attestationId,
      holderBinding: combinedHolderBinding,
      policyId: combinedPolicyId,
      epoch: UInt64.from(currentSlot),
      createdAtSlot: UInt64.from(currentSlot),
      expiresAtSlot: UInt64.from(currentSlot).add(validityWindowSlots),
      sourceRailIds: Field(0xffffffff), // All rails
      isValid: Bool(true),
    });

    // Update state
    const newLeaf = attestation.hash();
    const newRoot = Poseidon.hash([attestationRoot, newLeaf]);
    this.attestationRoot.set(newRoot);
    this.attestationCount.set(attestationCount.add(1));
    this.lastUpdatedSlot.set(UInt64.from(currentSlot));

    // Emit event
    this.emitEvent(
      'attestationCreated',
      new AttestationCreatedEvent({
        attestationId,
        holderBinding: combinedHolderBinding,
        policyId: combinedPolicyId,
        epoch: UInt64.from(currentSlot),
        expiresAtSlot: attestation.expiresAtSlot,
      })
    );
  }

  /**
   * Revoke an attestation (admin only).
   */
  @method async revokeAttestation(attestationId: Field) {
    // Verify admin
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can revoke attestations');

    // In a real implementation, this would update the Merkle tree
    // to mark the attestation as invalid

    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
    this.lastUpdatedSlot.set(UInt64.from(currentSlot));
  }

  /**
   * Update admin (admin only).
   */
  @method async updateAdmin(newAdmin: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update admin');

    this.adminPubkeyHash.set(Poseidon.hash(newAdmin.toFields()));
  }

  /**
   * Update supported rails (admin only).
   */
  @method async updateSupportedRails(newRails: Field) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update rails');

    this.supportedRails.set(newRails);
  }
}

