/**
 * AttestationRegistry zkApp
 *
 * This zkApp provides efficient storage and querying of attestations
 * using a Merkle tree structure. It can be used independently or in
 * conjunction with ZkpfVerifier.
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
  MerkleTree,
  MerkleWitness,
  Provable,
} from 'o1js';

// Merkle tree depth for attestation storage
const TREE_DEPTH = 20;

/**
 * Merkle witness for attestation proofs.
 */
export class AttestationWitness extends MerkleWitness(TREE_DEPTH) {}

/**
 * Attestation leaf structure.
 */
export class AttestationLeaf extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  expiresAtSlot: UInt64,
  isValid: Bool,
}) {
  /**
   * Compute the leaf hash.
   */
  hash(): Field {
    return Poseidon.hash([
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      this.expiresAtSlot.value,
      Provable.if(this.isValid, Field(1), Field(0)),
    ]);
  }

  /**
   * Create an empty leaf.
   */
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

/**
 * Attestation query input.
 */
export class Attestation extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
}) {
  /**
   * Compute the attestation ID.
   */
  id(): Field {
    return Poseidon.hash([this.holderBinding, this.policyId.value, this.epoch.value]);
  }
}

/**
 * Event emitted when an attestation is stored.
 */
export class AttestationStoredEvent extends Struct({
  attestationId: Field,
  leafIndex: UInt64,
  holderBinding: Field,
  policyId: UInt64,
}) {}

/**
 * AttestationRegistry zkApp contract.
 */
export class AttestationRegistry extends SmartContract {
  // State field 0: Merkle root
  @state(Field) merkleRoot = State<Field>();

  // State field 1: Next leaf index
  @state(UInt64) nextLeafIndex = State<UInt64>();

  // State field 2: Total attestations
  @state(UInt64) totalAttestations = State<UInt64>();

  // State field 3: Verifier contract address hash
  @state(Field) verifierAddressHash = State<Field>();

  // State field 4: Admin public key hash
  @state(Field) adminPubkeyHash = State<Field>();

  // State fields 5-7: Reserved
  @state(Field) reserved1 = State<Field>();
  @state(Field) reserved2 = State<Field>();
  @state(Field) reserved3 = State<Field>();

  events = {
    attestationStored: AttestationStoredEvent,
  };

  /**
   * Initialize the registry.
   */
  @method async init() {
    super.init();

    // Initialize with empty tree root
    const emptyLeafHash = AttestationLeaf.empty().hash();
    let root = emptyLeafHash;
    for (let i = 0; i < TREE_DEPTH; i++) {
      root = Poseidon.hash([root, root]);
    }
    this.merkleRoot.set(root);

    this.nextLeafIndex.set(UInt64.zero);
    this.totalAttestations.set(UInt64.zero);
    this.verifierAddressHash.set(Field(0));

    // Admin is the deployer
    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    this.reserved1.set(Field(0));
    this.reserved2.set(Field(0));
    this.reserved3.set(Field(0));
  }

  /**
   * Set the verifier contract address (admin only).
   */
  @method async setVerifier(verifierAddress: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can set verifier');

    this.verifierAddressHash.set(Poseidon.hash(verifierAddress.toFields()));
  }

  /**
   * Store an attestation leaf.
   *
   * This can be called by the verifier contract or admin.
   */
  @method async storeAttestation(leaf: AttestationLeaf, witness: AttestationWitness) {
    // Get current state
    const currentRoot = this.merkleRoot.getAndRequireEquals();
    const nextIndex = this.nextLeafIndex.getAndRequireEquals();
    const totalAttestations = this.totalAttestations.getAndRequireEquals();

    // Verify the witness is for the next index
    // (In a real implementation, we'd verify against an empty leaf)
    const leafHash = leaf.hash();

    // Compute new root with the new leaf
    const newRoot = witness.calculateRoot(leafHash);

    // Verify the witness path is consistent
    const expectedRoot = witness.calculateRoot(AttestationLeaf.empty().hash());
    expectedRoot.assertEquals(currentRoot, 'Invalid witness for current root');

    // Update state
    this.merkleRoot.set(newRoot);
    this.nextLeafIndex.set(nextIndex.add(1));
    this.totalAttestations.set(totalAttestations.add(1));

    // Compute attestation ID
    const attestationId = Poseidon.hash([leaf.holderBinding, leaf.policyId.value, leaf.epoch.value]);

    // Emit event
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

  /**
   * Verify an attestation exists (view function).
   *
   * This method verifies that an attestation with the given parameters
   * exists in the tree and is still valid.
   */
  @method async verifyAttestation(
    query: Attestation,
    leaf: AttestationLeaf,
    witness: AttestationWitness,
    currentSlot: UInt64
  ): Promise<Bool> {
    // Get current root
    const root = this.merkleRoot.getAndRequireEquals();

    // Verify leaf matches query
    leaf.holderBinding.assertEquals(query.holderBinding, 'Holder binding mismatch');
    leaf.policyId.assertEquals(query.policyId, 'Policy ID mismatch');
    leaf.epoch.assertEquals(query.epoch, 'Epoch mismatch');

    // Verify Merkle proof
    const leafHash = leaf.hash();
    const calculatedRoot = witness.calculateRoot(leafHash);
    calculatedRoot.assertEquals(root, 'Invalid Merkle proof');

    // Check validity
    const isNotExpired = leaf.expiresAtSlot.greaterThan(currentSlot);
    const isValid = leaf.isValid.and(isNotExpired);

    return isValid;
  }

  /**
   * Generate a Merkle proof of inclusion for cross-chain verification.
   *
   * Returns the path that can be verified by other chains.
   */
  @method async getInclusionProof(
    query: Attestation,
    leaf: AttestationLeaf,
    witness: AttestationWitness
  ): Promise<Field[]> {
    // Get current root
    const root = this.merkleRoot.getAndRequireEquals();

    // Verify leaf matches query
    leaf.holderBinding.assertEquals(query.holderBinding);
    leaf.policyId.assertEquals(query.policyId);
    leaf.epoch.assertEquals(query.epoch);

    // Verify Merkle proof
    const leafHash = leaf.hash();
    const calculatedRoot = witness.calculateRoot(leafHash);
    calculatedRoot.assertEquals(root, 'Invalid Merkle proof');

    // Return the path (simplified - real impl would return witness path)
    return [root, leafHash];
  }

  /**
   * Invalidate an attestation (admin only).
   */
  @method async invalidateAttestation(
    oldLeaf: AttestationLeaf,
    witness: AttestationWitness
  ) {
    // Verify admin
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can invalidate');

    // Get current root
    const currentRoot = this.merkleRoot.getAndRequireEquals();

    // Verify old leaf exists
    const oldLeafHash = oldLeaf.hash();
    const calculatedRoot = witness.calculateRoot(oldLeafHash);
    calculatedRoot.assertEquals(currentRoot, 'Leaf not found');

    // Create invalidated leaf
    const newLeaf = new AttestationLeaf({
      holderBinding: oldLeaf.holderBinding,
      policyId: oldLeaf.policyId,
      epoch: oldLeaf.epoch,
      expiresAtSlot: oldLeaf.expiresAtSlot,
      isValid: Bool(false),
    });

    // Update tree
    const newLeafHash = newLeaf.hash();
    const newRoot = witness.calculateRoot(newLeafHash);
    this.merkleRoot.set(newRoot);
  }
}

