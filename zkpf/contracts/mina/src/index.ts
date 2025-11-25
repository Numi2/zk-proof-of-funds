/**
 * zkpf Mina Contracts
 *
 * This package provides Mina zkApp contracts for:
 * 1. ZkpfVerifier - Verifies zkpf ProofBundles and wraps them into Mina-native recursive proofs
 * 2. AttestationRegistry - Stores and queries cross-chain PoF attestations
 * 3. ZkBridge - Generates bridge messages for cross-chain attestation propagation
 */

export { ZkpfVerifier, VerifyProofEvent, AttestationCreatedEvent } from './ZkpfVerifier.js';
export { AttestationRegistry, Attestation, AttestationLeaf } from './AttestationRegistry.js';
export { ZkBridge, BridgeMessage, BridgeMessageSentEvent } from './ZkBridge.js';
export { ProofBundle, PublicInputs, parseProofBundle } from './types.js';

