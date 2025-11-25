# zkpf-mina-kimchi-wrapper

BN254 wrapper circuit for verifying Mina Proof of State (Kimchi) proofs.

## Overview

This crate implements a BN254 circuit that wraps the Mina Proof of State Kimchi circuit from [lambdaclass/mina_bridge](https://github.com/lambdaclass/mina_bridge).

The wrapper circuit:
1. Takes a Mina Proof of State Kimchi proof as witness
2. Re-runs the Kimchi verifier using foreign-field Pasta arithmetic
3. Computes a digest over the public inputs
4. Exposes `mina_digest` as the single BN254 public input

## Mina Proof of State

The Mina Proof of State circuit is the production-grade state proof that:
- Verifies Mina's recursive state proof (Pickles state SNARK)
- Checks chain consistency (state hashes form valid chain)
- Ensures consensus conditions (fork checks, transition frontier semantics)

### Public Inputs

```
[
  bridge_tip_state_hash,           // Currently bridged tip
  candidate_chain_state_hashes[16], // 16 candidate state hashes
  candidate_chain_ledger_hashes[16] // 16 ledger root hashes
]
```

## Digest Computation

The wrapper circuit computes:

```
mina_digest = H(
  bridge_tip_state_hash ||
  candidate_chain_state_hashes[0..16] ||
  candidate_chain_ledger_hashes[0..16]
)
```

where H is a BN254-friendly hash (Poseidon).

## Usage

```rust
use zkpf_mina_kimchi_wrapper::{
    MinaProofOfStatePublicInputs,
    MinaRailPublicInputs,
    MinaProofOfStateWrapperInput,
    create_wrapper_proof,
    CANDIDATE_CHAIN_LENGTH,
};

// Create Mina Proof of State public inputs
let public_inputs = MinaProofOfStatePublicInputs {
    bridge_tip_state_hash: [1u8; 32],
    candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
    candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
};

// Compute digest
let mina_digest = public_inputs.compute_digest();

// Create zkpf rail inputs
let rail_inputs = MinaRailPublicInputs::new(
    &public_inputs,
    100,          // policy_id
    1700000000,   // epoch
    42,           // scope_id
    "holder-123", // holder_id
);

// Create wrapper proof (mock mode)
let wrapper_input = MinaProofOfStateWrapperInput::mock(public_inputs);
let proof = create_wrapper_proof(&wrapper_input).unwrap();
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BN254 Wrapper Circuit                             │
│                                                                      │
│  ┌────────────────────┐    ┌──────────────────────────────────────┐ │
│  │  Kimchi Proof      │    │  Foreign-Field Pasta Arithmetic      │ │
│  │  (Witness)         │───►│  - Verify Pickles state proof        │ │
│  │                    │    │  - Check state hash chain            │ │
│  │  • tip_proof       │    │  - Verify ledger root consistency    │ │
│  │  • chain_states    │    │  - Consensus checks                  │ │
│  │  • bridge_tip      │    │                                      │ │
│  └────────────────────┘    └──────────────────────────────────────┘ │
│                                         │                            │
│                                         ▼                            │
│                            ┌─────────────────────────┐               │
│                            │  Digest Computation     │               │
│                            │  mina_digest = H(...)   │               │
│                            └───────────┬─────────────┘               │
│                                        │                             │
│                                        ▼                             │
│                            ┌─────────────────────────┐               │
│                            │  Public Output          │               │
│                            │  mina_digest : Fr(BN254)│               │
│                            └─────────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

- `mock` - Skip actual Kimchi verification (for development/testing)

## Implementation Status

- [x] Public input types
- [x] Digest computation (BLAKE3 and Poseidon)
- [x] BN254 wrapper circuit structure
- [x] Mock proof generation
- [ ] Full foreign-field Pasta arithmetic
- [ ] Complete Kimchi verifier in-circuit

## References

- [lambdaclass/mina_bridge](https://github.com/lambdaclass/mina_bridge)
- [Mina Protocol](https://minaprotocol.com/)
- [Kimchi Specification](https://o1-labs.github.io/proof-systems/specs/kimchi.html)

