// zkpf Starknet Contracts
//
// This library provides Cairo contracts for zkpf on Starknet:
//
// - AttestationRegistry: Records verified zkpf attestations on-chain
// - ZkpfVerifier: Verifies zkpf proofs and checks attestations
// - ZkpfGatedLending: Example DeFi integration for PoF-gated lending
//
// Usage:
//   1. Deploy AttestationRegistry with an admin address
//   2. Deploy ZkpfVerifier with the registry address
//   3. Integrate ZkpfVerifier into your DeFi protocol
//
// Example:
//   // In your lending protocol
//   let verifier = IZkpfVerifierDispatcher { contract_address: verifier_addr };
//   let has_pof = verifier.check_attestation(holder_id, policy_id, snapshot_id);
//   assert(has_pof, 'PoF required');

mod AttestationRegistry;
mod ZkpfVerifier;

