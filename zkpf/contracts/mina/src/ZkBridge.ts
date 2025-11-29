/**
 * ZkBridge zkApp - Bidirectional Tachyon ↔ Mina Bridge
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

import { AttestationLeaf, Attestation, AttestationWitness } from './AttestationRegistry.js';

// Target chain identifiers
export const TargetChains = {
  ETHEREUM: Field(1),
  STARKNET: Field(2),
  POLYGON: Field(3),
  ARBITRUM: Field(4),
};

// Message types
export const MessageTypes = {
  ATTESTATION_RESULT: Field(1),
  BATCH_ATTESTATION: Field(2),
  STATE_ROOT_UPDATE: Field(3),
  REVOCATION: Field(4),
};

// Tachyon epoch commitment from L1
export class TachyonEpochCommitment extends Struct({
  epoch: UInt64,
  nullifierRoot: Field,
  stateHash: Field,
  proofCount: UInt64,
  zcashBlockHeight: UInt64,
  epochProofHash: Field,
}) {
  hash(): Field {
    return Poseidon.hash([
      this.epoch.value,
      this.nullifierRoot,
      this.stateHash,
      this.proofCount.value,
      this.zcashBlockHeight.value,
      this.epochProofHash,
    ]);
  }
}

// Tachyon account proof
export class TachyonAccountProof extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  thresholdMet: Bool,
  nullifierProofHash: Field,
  balanceCommitment: Field,
}) {
  hash(): Field {
    return Poseidon.hash([
      this.holderBinding,
      this.policyId.value,
      this.epoch.value,
      Provable.if(this.thresholdMet, Field(1), Field(0)),
      this.nullifierProofHash,
      this.balanceCommitment,
    ]);
  }
}

// Bridge message structure
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
}

// Events
export class BridgeMessageSentEvent extends Struct({
  messageHash: Field,
  targetChain: Field,
  holderBinding: Field,
  policyId: UInt64,
  hasValidAttestation: Bool,
  nonce: UInt64,
}) {}

export class TachyonEpochRegisteredEvent extends Struct({
  epoch: UInt64,
  nullifierRoot: Field,
  stateHash: Field,
  proofCount: UInt64,
  registeredAtSlot: UInt64,
}) {}

export class TachyonAccountVerifiedEvent extends Struct({
  holderBinding: Field,
  policyId: UInt64,
  epoch: UInt64,
  thresholdMet: Bool,
  verifiedAtSlot: UInt64,
}) {}

/**
 * ZkBridge zkApp contract.
 */
export class ZkBridge extends SmartContract {
  @state(Field) registryAddressHash = State<Field>();
  @state(UInt64) messageNonce = State<UInt64>();
  @state(UInt64) totalMessages = State<UInt64>();
  @state(Field) adminPubkeyHash = State<Field>();
  @state(Field) supportedChains = State<Field>();
  @state(UInt64) latestTachyonEpoch = State<UInt64>();
  @state(Field) tachyonStateRoot = State<Field>();
  @state(UInt64) tachyonVerificationCount = State<UInt64>();

  events = {
    bridgeMessageSent: BridgeMessageSentEvent,
    tachyonEpochRegistered: TachyonEpochRegisteredEvent,
    tachyonAccountVerified: TachyonAccountVerifiedEvent,
  };

  init() {
    super.init();

    this.registryAddressHash.set(Field(0));
    this.messageNonce.set(UInt64.zero);
    this.totalMessages.set(UInt64.zero);

    const sender = this.sender.getAndRequireSignature();
    this.adminPubkeyHash.set(Poseidon.hash(sender.toFields()));

    this.supportedChains.set(Field(0xffffffff));
    this.latestTachyonEpoch.set(UInt64.zero);
    this.tachyonStateRoot.set(Field(0));
    this.tachyonVerificationCount.set(UInt64.zero);
  }

  async setRegistry(registryAddress: PublicKey) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can set registry');

    this.registryAddressHash.set(Poseidon.hash(registryAddress.toFields()));
  }

  async registerTachyonEpoch(
    commitment: TachyonEpochCommitment,
    epochProof: Field
  ) {
    const latestEpoch = this.latestTachyonEpoch.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    commitment.epoch.assertGreaterThan(latestEpoch, 'Epoch must be newer than latest');

    const expectedProofHash = Poseidon.hash([
      commitment.nullifierRoot,
      commitment.stateHash,
      commitment.epoch.value,
    ]);
    epochProof.assertEquals(expectedProofHash, 'Invalid epoch proof');

    commitment.proofCount.assertLessThanOrEqual(
      UInt64.from(1000000),
      'Proof count exceeds maximum'
    );

    this.latestTachyonEpoch.set(commitment.epoch);
    this.tachyonStateRoot.set(commitment.stateHash);

    this.emitEvent(
      'tachyonEpochRegistered',
      new TachyonEpochRegisteredEvent({
        epoch: commitment.epoch,
        nullifierRoot: commitment.nullifierRoot,
        stateHash: commitment.stateHash,
        proofCount: commitment.proofCount,
        registeredAtSlot: currentSlot,
      })
    );
  }

  async verifyTachyonAccount(
    accountProof: TachyonAccountProof,
    epochCommitment: TachyonEpochCommitment
  ) {
    const latestEpoch = this.latestTachyonEpoch.getAndRequireEquals();
    const tachyonRoot = this.tachyonStateRoot.getAndRequireEquals();
    const verificationCount = this.tachyonVerificationCount.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    accountProof.epoch.assertEquals(epochCommitment.epoch, 'Epoch mismatch');
    accountProof.epoch.assertLessThanOrEqual(latestEpoch, 'Epoch not yet registered');
    epochCommitment.stateHash.assertEquals(tachyonRoot, 'State root mismatch');

    const accountLeaf = accountProof.hash();
    const expectedNullifierProof = Poseidon.hash([
      accountLeaf,
      epochCommitment.nullifierRoot,
    ]);
    accountProof.nullifierProofHash.assertEquals(
      expectedNullifierProof,
      'Invalid nullifier proof'
    );

    this.tachyonVerificationCount.set(verificationCount.add(1));

    this.emitEvent(
      'tachyonAccountVerified',
      new TachyonAccountVerifiedEvent({
        holderBinding: accountProof.holderBinding,
        policyId: accountProof.policyId,
        epoch: accountProof.epoch,
        thresholdMet: accountProof.thresholdMet,
        verifiedAtSlot: currentSlot,
      })
    );
  }

  async createBridgeMessage(
    query: Attestation,
    leaf: AttestationLeaf,
    witness: AttestationWitness,
    stateRoot: Field,
    targetChain: Field
  ) {
    const nonce = this.messageNonce.getAndRequireEquals();
    const totalMessages = this.totalMessages.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    leaf.holderBinding.assertEquals(query.holderBinding);
    leaf.policyId.assertEquals(query.policyId);
    leaf.epoch.assertEquals(query.epoch);

    const leafHash = leaf.hash();
    const calculatedRoot = witness.calculateRoot(leafHash);
    calculatedRoot.assertEquals(stateRoot, 'Invalid Merkle proof');

    const isNotExpired = leaf.expiresAtSlot.greaterThan(currentSlot);
    const isValid = leaf.isValid.and(isNotExpired);

    const merkleProofHash = Poseidon.hash([leafHash, stateRoot]);

    const message = new BridgeMessage({
      messageType: MessageTypes.ATTESTATION_RESULT,
      targetChain,
      holderBinding: query.holderBinding,
      policyId: query.policyId,
      epoch: query.epoch,
      hasValidAttestation: isValid,
      minaSlot: currentSlot,
      stateRoot,
      merkleProofHash,
      nonce: nonce.add(1),
    });

    this.messageNonce.set(nonce.add(1));
    this.totalMessages.set(totalMessages.add(1));

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

  async emitStateRootUpdate(stateRoot: Field, targetChain: Field) {
    const nonce = this.messageNonce.getAndRequireEquals();
    const totalMessages = this.totalMessages.getAndRequireEquals();
    const currentSlot = this.network.globalSlotSinceGenesis.getAndRequireEquals();

    const message = new BridgeMessage({
      messageType: MessageTypes.STATE_ROOT_UPDATE,
      targetChain,
      holderBinding: Field(0),
      policyId: UInt64.zero,
      epoch: currentSlot,
      hasValidAttestation: Bool(true),
      minaSlot: currentSlot,
      stateRoot,
      merkleProofHash: Field(0),
      nonce: nonce.add(1),
    });

    this.messageNonce.set(nonce.add(1));
    this.totalMessages.set(totalMessages.add(1));

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

  async updateSupportedChains(newChains: Field) {
    const adminHash = this.adminPubkeyHash.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const senderHash = Poseidon.hash(sender.toFields());
    senderHash.assertEquals(adminHash, 'Only admin can update chains');

    this.supportedChains.set(newChains);
  }
}

// Declare methods with their argument types
declareMethods(ZkBridge, {
  setRegistry: [PublicKey],
  registerTachyonEpoch: [TachyonEpochCommitment, Field],
  verifyTachyonAccount: [TachyonAccountProof, TachyonEpochCommitment],
  createBridgeMessage: [Attestation, AttestationLeaf, AttestationWitness, Field, Field],
  emitStateRootUpdate: [Field, Field],
  updateSupportedChains: [Field],
});
