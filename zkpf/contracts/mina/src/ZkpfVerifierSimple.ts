/**
 * ZkpfVerifier zkApp - Simplified Version
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
  UInt32,
  Struct,
} from 'o1js';

/**
 * Event emitted when an attestation is created.
 */
export class AttestationEvent extends Struct({
  attestationId: Field,
  holderBinding: Field,
  policyId: UInt64,
}) {}

/**
 * ZkpfVerifier zkApp contract.
 */
export class ZkpfVerifierSimple extends SmartContract {
  @state(Field) attestationRoot = State<Field>();
  @state(UInt64) attestationCount = State<UInt64>();
  @state(UInt32) lastUpdatedSlot = State<UInt32>();
  @state(Field) adminPubkeyHash = State<Field>();

  events = {
    attestation: AttestationEvent,
  };

  init() {
    super.init();
    this.attestationRoot.set(Poseidon.hash([Field(0)]));
    this.attestationCount.set(UInt64.zero);
    this.lastUpdatedSlot.set(UInt32.from(0));

    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));
  }

  @method
  async createAttestation(
    holderBinding: Field,
    policyId: UInt64,
    epoch: UInt64
  ) {
    const attestationRoot = this.attestationRoot.getAndRequireEquals();
    const attestationCount = this.attestationCount.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    const attestationId = Poseidon.hash([
      holderBinding,
      policyId.value,
      epoch.value,
    ]);

    const newRoot = Poseidon.hash([attestationRoot, attestationId]);

    this.attestationRoot.set(newRoot);
    this.attestationCount.set(attestationCount.add(1));
    this.lastUpdatedSlot.set(currentSlot);

    this.emitEvent(
      'attestation',
      new AttestationEvent({
        attestationId,
        holderBinding,
        policyId,
      })
    );
  }

  @method
  async updateAdmin(newAdmin: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update admin');

    this.adminPubkeyHash.set(Poseidon.hash(newAdmin.toFields()));
  }
}
