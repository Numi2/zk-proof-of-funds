/**
 * ZkBridge zkApp
 *
 * This zkApp generates bridge messages for cross-chain attestation
 * propagation. It allows other chains (EVM, Starknet, etc.) to verify
 * zkpf attestations without directly interacting with the full proof.
 *
 * The bridge emits compact messages containing:
 * - Attestation validity bit
 * - Policy parameters
 * - Merkle proof of inclusion
 * - State root commitment
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
  MerkleWitness,
  Provable,
} from 'o1js';

import { AttestationLeaf, Attestation, AttestationWitness } from './AttestationRegistry.js';

/**
 * Target chain identifiers.
 */
export const TargetChains = {
  ETHEREUM: Field(1),
  STARKNET: Field(2),
  POLYGON: Field(3),
  ARBITRUM: Field(4),
  OPTIMISM: Field(5),
  BASE: Field(6),
  ZKSYNC: Field(7),
  SCROLL: Field(8),
};

/**
 * Bridge message type.
 */
export const MessageTypes = {
  ATTESTATION_RESULT: Field(1),
  BATCH_ATTESTATION: Field(2),
  STATE_ROOT_UPDATE: Field(3),
  REVOCATION: Field(4),
};

/**
 * Bridge message structure.
 */
export class BridgeMessage extends Struct({
  messageType: Field,
  targetChain: Field,
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  hasValidAttestation: Bool,
  minaSlot: UInt64,
  stateRoot: Field,
  merkleProofHash: Field,
  nonce: UInt64,
}) {
  /**
   * Compute the message hash for signing/verification.
   */
  hash(): Field {
    return Poseidon.hash([
      this.messageType,
      this.targetChain,
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      Provable.if(this.hasValidAttestation, Field(1), Field(0)),
      this.minaSlot.value,
      this.stateRoot,
      this.merkleProofHash,
      this.nonce.value,
    ]);
  }

  /**
   * Encode for target chain consumption.
   * Returns a compact representation suitable for EVM calldata.
   */
  encode(): Field[] {
    return [
      this.messageType,
      this.targetChain,
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      Provable.if(this.hasValidAttestation, Field(1), Field(0)),
      this.minaSlot.value,
      this.stateRoot,
      this.merkleProofHash,
      this.nonce.value,
      this.hash(),
    ];
  }
}

/**
 * Event emitted when a bridge message is sent.
 */
export class BridgeMessageSentEvent extends Struct({
  messageHash: Field,
  targetChain: Field,
  holderBinding: Field,
  policyId: UInt64,
  hasValidAttestation: Bool,
  nonce: UInt64,
}) {}

/**
 * ZkBridge zkApp contract.
 */
export class ZkBridge extends SmartContract {
  // State field 0: Registry address hash
  @state(Field) registryAddressHash = State<Field>();

  // State field 1: Message nonce
  @state(UInt64) messageNonce = State<UInt64>();

  // State field 2: Total messages sent
  @state(UInt64) totalMessages = State<UInt64>();

  // State field 3: Admin public key hash
  @state(Field) adminPubkeyHash = State<Field>();

  // State field 4: Supported target chains (bit flags)
  @state(Field) supportedChains = State<Field>();

  // State fields 5-7: Reserved
  @state(Field) reserved1 = State<Field>();
  @state(Field) reserved2 = State<Field>();
  @state(Field) reserved3 = State<Field>();

  events = {
    bridgeMessageSent: BridgeMessageSentEvent,
  };

  /**
   * Initialize the bridge.
   */
  @method async init() {
    super.init();

    this.registryAddressHash.set(Field(0));
    this.messageNonce.set(UInt64.zero);
    this.totalMessages.set(UInt64.zero);

    // Admin is the deployer
    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    // Support all chains by default
    this.supportedChains.set(Field(0xffffffff));

    this.reserved1.set(Field(0));
    this.reserved2.set(Field(0));
    this.reserved3.set(Field(0));
  }

  /**
   * Set the attestation registry address (admin only).
   */
  @method async setRegistry(registryAddress: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can set registry');

    this.registryAddressHash.set(Poseidon.hash(registryAddress.toFields()));
  }

  /**
   * Create and emit a bridge message for an attestation.
   *
   * This method verifies the attestation exists and is valid,
   * then emits a bridge message that can be relayed to other chains.
   */
  @method async createBridgeMessage(
    query: Attestation,
    leaf: AttestationLeaf,
    witness: AttestationWitness,
    stateRoot: Field,
    targetChain: Field
  ) {
    // Get current state
    const nonce = this.messageNonce.getAndRequireEquals();
    const totalMessages = this.totalMessages.getAndRequireEquals();
    const supportedChains = this.supportedChains.getAndRequireEquals();

    // Get current slot
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    // Verify leaf matches query
    leaf.holderBinding.assertEquals(query.holderBinding);
    leaf.policyId.assertEquals(query.policyId);
    leaf.epoch.assertEquals(query.epoch);

    // Verify Merkle proof
    const leafHash = leaf.hash();
    const calculatedRoot = witness.calculateRoot(leafHash);
    calculatedRoot.assertEquals(stateRoot, 'Invalid Merkle proof');

    // Check validity
    const isNotExpired = leaf.expiresAtSlot.greaterThan(UInt64.from(currentSlot));
    const isValid = leaf.isValid.and(isNotExpired);

    // Compute Merkle proof hash for compact encoding
    const merkleProofHash = Poseidon.hash([leafHash, stateRoot]);

    // Create bridge message
    const message = new BridgeMessage({
      messageType: MessageTypes.ATTESTATION_RESULT,
      targetChain,
      holderBinding: query.holderBinding,
      policyId: query.policyId,
      epoch: query.epoch,
      hasValidAttestation: isValid,
      minaSlot: UInt64.from(currentSlot),
      stateRoot,
      merkleProofHash,
      nonce: nonce.add(1),
    });

    // Update state
    this.messageNonce.set(nonce.add(1));
    this.totalMessages.set(totalMessages.add(1));

    // Emit event
    this.emitEvent(
      'bridgeMessageSent',
      new BridgeMessageSentEvent({
        messageHash: message.hash(),
        targetChain,
        holderBinding: query.holderBinding,
        policyId: query.policyId,
        hasValidAttestation: isValid,
        nonce: nonce.add(1),
      })
    );
  }

  /**
   * Create a batch bridge message for multiple attestations.
   *
   * This is more gas-efficient for relaying multiple attestations.
   */
  @method async createBatchBridgeMessage(
    queries: Attestation[],
    leaves: AttestationLeaf[],
    witnesses: AttestationWitness[],
    stateRoot: Field,
    targetChain: Field
  ) {
    // Get current state
    const nonce = this.messageNonce.getAndRequireEquals();
    const totalMessages = this.totalMessages.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    // Verify all attestations and compute combined validity
    let combinedHash = Field(0);
    let allValid = Bool(true);

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const leaf = leaves[i];
      const witness = witnesses[i];

      // Verify leaf matches query
      leaf.holderBinding.assertEquals(query.holderBinding);
      leaf.policyId.assertEquals(query.policyId);
      leaf.epoch.assertEquals(query.epoch);

      // Verify Merkle proof
      const leafHash = leaf.hash();
      const calculatedRoot = witness.calculateRoot(leafHash);
      calculatedRoot.assertEquals(stateRoot, 'Invalid Merkle proof');

      // Check validity
      const isNotExpired = leaf.expiresAtSlot.greaterThan(UInt64.from(currentSlot));
      const isValid = leaf.isValid.and(isNotExpired);
      allValid = allValid.and(isValid);

      // Combine hashes
      combinedHash = Poseidon.hash([combinedHash, query.id()]);
    }

    // Create batch message
    const message = new BridgeMessage({
      messageType: MessageTypes.BATCH_ATTESTATION,
      targetChain,
      holderBinding: combinedHash, // Used as batch identifier
      policyId: UInt64.zero, // Not applicable for batch
      epoch: UInt64.from(currentSlot),
      hasValidAttestation: allValid,
      minaSlot: UInt64.from(currentSlot),
      stateRoot,
      merkleProofHash: combinedHash,
      nonce: nonce.add(1),
    });

    // Update state
    this.messageNonce.set(nonce.add(1));
    this.totalMessages.set(totalMessages.add(1));

    // Emit event
    this.emitEvent(
      'bridgeMessageSent',
      new BridgeMessageSentEvent({
        messageHash: message.hash(),
        targetChain,
        holderBinding: combinedHash,
        policyId: UInt64.zero,
        hasValidAttestation: allValid,
        nonce: nonce.add(1),
      })
    );
  }

  /**
   * Emit a state root update message.
   *
   * This allows target chains to track the current Mina state root
   * for independent verification.
   */
  @method async emitStateRootUpdate(stateRoot: Field, targetChain: Field) {
    // Get current state
    const nonce = this.messageNonce.getAndRequireEquals();
    const totalMessages = this.totalMessages.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    // Create state root update message
    const message = new BridgeMessage({
      messageType: MessageTypes.STATE_ROOT_UPDATE,
      targetChain,
      holderBinding: Field(0),
      policyId: UInt64.zero,
      epoch: UInt64.from(currentSlot),
      hasValidAttestation: Bool(true),
      minaSlot: UInt64.from(currentSlot),
      stateRoot,
      merkleProofHash: Field(0),
      nonce: nonce.add(1),
    });

    // Update state
    this.messageNonce.set(nonce.add(1));
    this.totalMessages.set(totalMessages.add(1));

    // Emit event
    this.emitEvent(
      'bridgeMessageSent',
      new BridgeMessageSentEvent({
        messageHash: message.hash(),
        targetChain,
        holderBinding: Field(0),
        policyId: UInt64.zero,
        hasValidAttestation: Bool(true),
        nonce: nonce.add(1),
      })
    );
  }

  /**
   * Update supported chains (admin only).
   */
  @method async updateSupportedChains(newChains: Field) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update chains');

    this.supportedChains.set(newChains);
  }
}

