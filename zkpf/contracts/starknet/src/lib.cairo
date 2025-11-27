// zkpf Starknet Contracts
//
// This library provides Cairo contracts for zkpf on Starknet:
//
// - AttestationRegistry: Records verified zkpf attestations on-chain
// - ZkpfVerifier: Verifies zkpf proofs and checks attestations
// - MinaStateVerifier: Verifies Mina cross-chain PoF attestations
// - ZkpfGatedLending: Example DeFi integration for PoF-gated lending
// - MinaGatedLending: Example DeFi integration for cross-chain PoF
//
// Usage:
//   1. Deploy AttestationRegistry with an admin address
//   2. Deploy ZkpfVerifier with the registry address
//   3. Integrate ZkpfVerifier into your DeFi protocol
//
// For cross-chain PoF via Mina:
//   1. Deploy MinaStateVerifier with an admin address
//   2. Add authorized relayers for attestation submission
//   3. Integrate MinaStateVerifier into your DeFi protocol
//
// Example (local Starknet PoF):
//   let verifier = IZkpfVerifierDispatcher { contract_address: verifier_addr };
//   let has_pof = verifier.check_attestation(holder_id, policy_id, snapshot_id);
//   assert(has_pof, 'PoF required');
//
// Example (cross-chain PoF via Mina):
//   let mina_verifier = IMinaStateVerifierDispatcher { contract_address: mina_addr };
//   let has_pof = mina_verifier.has_valid_pof(holder_binding, policy_id);
//   assert(has_pof, 'Cross-chain PoF required');

pub mod AttestationRegistry;
pub mod ZkpfVerifier;
pub mod MinaStateVerifier;
