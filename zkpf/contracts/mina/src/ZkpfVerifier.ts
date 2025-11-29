/**
 * ZkpfVerifier zkApp
 */

import {
  SmartContract,
  state,
  State,
  Field,
  Poseidon,
  PublicKey,
  UInt64,
  Bool,
  Struct,
  Provable,
  declareMethods,
} from 'o1js';

import { ProofBundle } from './types.js';

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
  sourceRailIds: Field,
  isValid: Bool,
}) {
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
  @state(Field) attestationRoot = State<Field>();
  @state(UInt64) attestationCount = State<UInt64>();
  @state(UInt64) lastUpdatedSlot = State<UInt64>();
  @state(Field) adminPubkeyHash = State<Field>();
  @state(Field) supportedRails = State<Field>();
  @state(UInt64) defaultValidityWindow = State<UInt64>();
  @state(Field) reserved1 = State<Field>();
  @state(Field) reserved2 = State<Field>();

  events = {
    verifyProof: VerifyProofEvent,
    attestationCreated: AttestationCreatedEvent,
  };

  init() {
    super.init();

    const emptyRoot = Poseidon.hash([Field(0)]);
    this.attestationRoot.set(emptyRoot);
    this.attestationCount.set(UInt64.zero);
    this.lastUpdatedSlot.set(UInt64.zero);

    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    this.supportedRails.set(Field(0xffffffff));
    this.defaultValidityWindow.set(UInt64.from(7200));
    this.reserved1.set(Field(0));
    this.reserved2.set(Field(0));
  }

  async verifyAndAttest(bundle: ProofBundle, validityWindowSlots: UInt64) {
    const attestationRoot = this.attestationRoot.getAndRequireEquals();
    const attestationCount = this.attestationCount.getAndRequireEquals();
    const defaultValidity = this.defaultValidityWindow.getAndRequireEquals();

    const actualValidity = Provable.if(
      validityWindowSlots.equals(UInt64.zero),
      defaultValidity,
      validityWindowSlots
    );

    bundle.publicInputs.meetsThreshold().assertTrue('Proof does not meet threshold');

    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    const attestationId = Poseidon.hash([
      bundle.publicInputs.holderBinding,
      bundle.publicInputs.policyId.value,
      bundle.publicInputs.currentEpoch.value,
    ]);

    const attestation = new AttestationData({
      attestationId,
      holderBinding: bundle.publicInputs.holderBinding,
      policyId: bundle.publicInputs.policyId,
      epoch: bundle.publicInputs.currentEpoch,
      createdAtSlot: currentSlot,
      expiresAtSlot: currentSlot.add(actualValidity),
      sourceRailIds: bundle.railId,
      isValid: Bool(true),
    });

    const newLeaf = attestation.hash();
    const newRoot = Poseidon.hash([attestationRoot, newLeaf]);

    this.attestationRoot.set(newRoot);
    this.attestationCount.set(attestationCount.add(1));
    this.lastUpdatedSlot.set(currentSlot);

    this.emitEvent(
      'verifyProof',
      new VerifyProofEvent({
        proofCommitment: bundle.proofCommitment,
        policyId: bundle.publicInputs.policyId,
        holderBinding: bundle.publicInputs.holderBinding,
        sourceRailId: bundle.railId,
        timestamp: currentSlot,
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

  async revokeAttestation(attestationId: Field) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can revoke attestations');

    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();
    this.lastUpdatedSlot.set(currentSlot);
  }

  async updateAdmin(newAdmin: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update admin');

    this.adminPubkeyHash.set(Poseidon.hash(newAdmin.toFields()));
  }

  async updateSupportedRails(newRails: Field) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update rails');

    this.supportedRails.set(newRails);
  }
}

// Declare methods with their argument types
declareMethods(ZkpfVerifier, {
  verifyAndAttest: [ProofBundle, UInt64],
  revokeAttestation: [Field],
  updateAdmin: [PublicKey],
  updateSupportedRails: [Field],
});
