/**
 * AttestationRegistry zkApp
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
  MerkleWitness,
  Provable,
  declareMethods,
} from 'o1js';

const TREE_DEPTH = 20;

export class AttestationWitness extends MerkleWitness(TREE_DEPTH) {}

export class AttestationLeaf extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  expiresAtSlot: UInt64,
  isValid: Bool,
}) {
  hash(): Field {
    return Poseidon.hash([
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      this.expiresAtSlot.value,
      Provable.if(this.isValid, Field(1), Field(0)),
    ]);
  }

  static empty(): AttestationLeaf {
    return new AttestationLeaf({
      holderBinding: Field(0),
      policyId: UInt64.zero,
      epoch: UInt64.zero,
      expiresAtSlot: UInt64.zero,
      isValid: Bool(false),
    });
  }
}

export class Attestation extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
}) {
  id(): Field {
    return Poseidon.hash([this.holderBinding, this.policyId.value, this.epoch.value]);
  }
}

export class AttestationStoredEvent extends Struct({
  attestationId: Field,
  leafIndex: UInt64,
  holderBinding: Field,
  policyId: UInt64,
}) {}

export class AttestationRegistry extends SmartContract {
  @state(Field) merkleRoot = State<Field>();
  @state(UInt64) nextLeafIndex = State<UInt64>();
  @state(UInt64) totalAttestations = State<UInt64>();
  @state(Field) verifierAddressHash = State<Field>();
  @state(Field) adminPubkeyHash = State<Field>();
  @state(Field) reserved1 = State<Field>();
  @state(Field) reserved2 = State<Field>();
  @state(Field) reserved3 = State<Field>();

  events = {
    attestationStored: AttestationStoredEvent,
  };

  init() {
    super.init();

    const emptyLeafHash = AttestationLeaf.empty().hash();
    let root = emptyLeafHash;
    for (let i = 0; i < TREE_DEPTH; i++) {
      root = Poseidon.hash([root, root]);
    }
    this.merkleRoot.set(root);

    this.nextLeafIndex.set(UInt64.zero);
    this.totalAttestations.set(UInt64.zero);
    this.verifierAddressHash.set(Field(0));

    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    this.reserved1.set(Field(0));
    this.reserved2.set(Field(0));
    this.reserved3.set(Field(0));
  }

  async setVerifier(verifierAddress: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can set verifier');

    this.verifierAddressHash.set(Poseidon.hash(verifierAddress.toFields()));
  }

  async storeAttestation(leaf: AttestationLeaf, witness: AttestationWitness) {
    const currentRoot = this.merkleRoot.getAndRequireEquals();
    const nextIndex = this.nextLeafIndex.getAndRequireEquals();
    const totalAttestations = this.totalAttestations.getAndRequireEquals();

    const leafHash = leaf.hash();
    const newRoot = witness.calculateRoot(leafHash);

    const expectedRoot = witness.calculateRoot(AttestationLeaf.empty().hash());
    expectedRoot.assertEquals(currentRoot, 'Invalid witness for current root');

    this.merkleRoot.set(newRoot);
    this.nextLeafIndex.set(nextIndex.add(1));
    this.totalAttestations.set(totalAttestations.add(1));

    const attestationId = Poseidon.hash([leaf.holderBinding, leaf.policyId.value, leaf.epoch.value]);

    this.emitEvent(
      'attestationStored',
      new AttestationStoredEvent({
        attestationId,
        leafIndex: nextIndex,
        holderBinding: leaf.holderBinding,
        policyId: leaf.policyId,
      })
    );
  }

  async invalidateAttestation(
    oldLeaf: AttestationLeaf,
    witness: AttestationWitness
  ) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can invalidate');

    const currentRoot = this.merkleRoot.getAndRequireEquals();

    const oldLeafHash = oldLeaf.hash();
    const calculatedRoot = witness.calculateRoot(oldLeafHash);
    calculatedRoot.assertEquals(currentRoot, 'Leaf not found');

    const newLeaf = new AttestationLeaf({
      holderBinding: oldLeaf.holderBinding,
      policyId: oldLeaf.policyId,
      epoch: oldLeaf.epoch,
      expiresAtSlot: oldLeaf.expiresAtSlot,
      isValid: Bool(false),
    });

    const newLeafHash = newLeaf.hash();
    const newRoot = witness.calculateRoot(newLeafHash);
    this.merkleRoot.set(newRoot);
  }
}

// Declare methods with their argument types
declareMethods(AttestationRegistry, {
  setVerifier: [PublicKey],
  storeAttestation: [AttestationLeaf, AttestationWitness],
  invalidateAttestation: [AttestationLeaf, AttestationWitness],
});
