# Mina Proof of State Integration

This document describes the integration of the **Mina Proof of State** circuit from [lambdaclass/mina_bridge](https://github.com/lambdaclass/mina_bridge) into zkpf.

## Overview

The Mina Proof of State circuit is the production-grade state proof that:

1. **Verifies Mina's recursive state proof** (Pickles state SNARK) for the tip state
2. **Checks chain consistency** - state hashes form a valid chain, ledger roots match states
3. **Ensures consensus conditions** - short/long-range fork checks, transition frontier semantics

This is the same circuit used by Aligned Layer and Lambdaclass for the Mina↔Ethereum state bridge.

## Public Inputs

From the Mina Bridge specification, a Mina Proof of State has these public inputs:

```json
[
  "bridge_tip_state_hash",       // Hash of currently bridged tip state
  "candidate_chain_state_hashes[16]",  // 16 state hashes of candidate chain
  "candidate_chain_ledger_hashes[16]"  // 16 ledger root hashes
]
```

### Field Descriptions

| Field | Description |
|-------|-------------|
| `bridge_tip_state_hash` | Hash of the last verified Mina state in the bridge contract |
| `candidate_chain_state_hashes[16]` | Hashes of a 16-block chain segment ending in the new candidate tip. Encodes the transition frontier segment being proposed. |
| `candidate_chain_ledger_hashes[16]` | Ledger-root hashes for each of the 16 states. Each is a Merkle root over account hashes. |

### Witness Data

The proof witness includes:
- `candidate_tip_proof` - Pickles/Kimchi state proof for the tip state
- `candidate_chain_states` - Full state bodies for consensus verification
- `bridge_tip_state` - Previous bridged tip for continuity checks

## zkpf Integration

### BN254 Wrapper Circuit

The `zkpf-mina-kimchi-wrapper` crate provides a BN254 circuit that:

1. Takes the Mina Proof of State Kimchi proof as witness
2. Re-runs the Kimchi verifier using foreign-field Pasta arithmetic
3. Computes a digest over the public inputs:

```
mina_digest = H(
  bridge_tip_state_hash ||
  candidate_chain_state_hashes[0..16] ||
  candidate_chain_ledger_hashes[0..16]
)
```

4. Exposes `mina_digest` as the single BN254 public input

### zkpf Rail Public Inputs

For the Mina rail, zkpf uses this structure:

```rust
pub struct MinaRailPublicInputs {
    /// H(bridge_tip_state_hash || 16 state hashes || 16 ledger hashes)
    pub mina_digest: [u8; 32],
    
    /// Policy ID from zkpf policy registry
    pub policy_id: u64,
    
    /// Current epoch
    pub current_epoch: u64,
    
    /// Verifier scope identifier
    pub verifier_scope_id: u64,
    
    /// Holder binding: H(holder_id || mina_digest || policy_id || scope)
    pub holder_binding: [u8; 32],
}
```

Only `mina_digest` is fed into the BN254 wrapper verifier as its public input. The other fields live in zkpf's `VerifierPublicInputs` struct.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Mina Proof of State Flow                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────────────┐    ┌──────────────────────────────────────────────────┐ │
│  │  Mina Protocol    │    │  Kimchi Circuit (Pasta Curves)                   │ │
│  │                   │    │                                                   │ │
│  │  • Tip state      │───►│  • Verify Pickles state proof                    │ │
│  │  • Chain segment  │    │  • Check state hash chain continuity             │ │
│  │  • Ledger roots   │    │  • Verify ledger root consistency                │ │
│  │                   │    │  • Consensus condition checks                    │ │
│  └───────────────────┘    └─────────────────────┬────────────────────────────┘ │
│                                                  │                              │
│                                                  ▼                              │
│                           ┌──────────────────────────────────────────────────┐ │
│                           │  BN254 Wrapper Circuit (zkpf-mina-kimchi-wrapper)│ │
│                           │                                                   │ │
│                           │  • Foreign-field Pasta arithmetic                 │ │
│                           │  • Verify Kimchi proof in-circuit                 │ │
│                           │  • Compute mina_digest = H(public_inputs)         │ │
│                           │  • Expose mina_digest as BN254 public input       │ │
│                           └─────────────────────┬────────────────────────────┘ │
│                                                  │                              │
│                                                  ▼                              │
│                           ┌──────────────────────────────────────────────────┐ │
│                           │  zkpf Mina Rail                                   │ │
│                           │                                                   │ │
│                           │  • Bind mina_digest to holder/policy/epoch        │ │
│                           │  • Compute holder_binding and nullifier           │ │
│                           │  • Create ProofBundle for cross-chain use         │ │
│                           └──────────────────────────────────────────────────┘ │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Verify Proof of State Binding

```bash
POST /rails/mina/proof-of-state/verify

{
  "bridge_tip_state_hash": "0x...",
  "candidate_chain_state_hashes": ["0x...", ...],  // 16 hashes
  "candidate_chain_ledger_hashes": ["0x...", ...], // 16 hashes
  "holder_id": "user-123",
  "policy_id": 100,
  "current_epoch": 1700000000,
  "verifier_scope_id": 42
}
```

**Response:**
```json
{
  "success": true,
  "mina_digest": "0x...",
  "holder_binding": "0x...",
  "nullifier": "0x..."
}
```

### Create Proof of State Bundle

```bash
POST /rails/mina/proof-of-state/create-bundle

{
  "bridge_tip_state_hash": "0x...",
  "candidate_chain_state_hashes": ["0x...", ...],
  "candidate_chain_ledger_hashes": ["0x...", ...],
  "holder_id": "user-123",
  "policy_id": 100,
  "verifier_scope_id": 42,
  "current_epoch": 1700000000,
  "currency_code": 1027,
  "mina_slot": 500000
}
```

**Response:**
```json
{
  "success": true,
  "bundle": { ... },
  "mina_digest": "0x..."
}
```

### Verify Proof of State Bundle

```bash
POST /rails/mina/proof-of-state/verify-bundle

{
  "bundle": { ... }
}
```

**Response:**
```json
{
  "valid": true,
  "mina_digest": "0x...",
  "holder_binding": "0x..."
}
```

## Account Proofs

After verifying a Proof of State, you can use the ledger roots to verify account balances:

1. Query account data from the Mina ledger
2. Generate Merkle proof from account to ledger root
3. Verify the proof against one of the 16 `candidate_chain_ledger_hashes`

This enables proving "holder has balance ≥ threshold" without revealing exact amounts.

```rust
pub struct MinaAccountProofRequest {
    /// The verified Mina Proof of State public inputs
    pub proof_of_state: MinaProofOfStatePublicInputs,
    
    /// Account addresses to verify
    pub account_addresses: Vec<String>,
    
    /// Merkle proofs for each account
    pub account_proofs: Vec<MinaAccountMerkleProof>,
    
    /// Balance threshold
    pub threshold: u64,
}
```

## Security Considerations

### Chain Validity

The Mina Proof of State ensures:
- The candidate chain links correctly to the bridge tip
- All state transitions are valid
- Consensus rules are satisfied (prevents long-range attacks)

### Binding Security

The holder binding is computed as:
```
holder_binding = H(holder_id || mina_digest || policy_id || scope_id)
```

This ensures:
- The holder cannot reuse proofs for different policies
- The proof is bound to a specific chain state
- Replay protection via nullifier derivation

### Foreign-Field Arithmetic

The BN254 wrapper circuit uses foreign-field arithmetic to verify Pasta curve operations. This is computationally intensive (~10-50M constraints) but provides the same security guarantees as native verification.

## Future Work

1. **Full Kimchi Verification**: Implement complete foreign-field Kimchi verifier
2. **Optimized Wrapper**: Reduce constraint count through specialized gates
3. **Batched Verification**: Verify multiple Proof of State instances in one proof
4. **Direct Account Proofs**: Combine state proof with account balance proof in single circuit

## References

- [lambdaclass/mina_bridge](https://github.com/lambdaclass/mina_bridge) - Original Mina Bridge specification
- [Mina Protocol Documentation](https://docs.minaprotocol.com/) - Official Mina docs
- [Pickles SNARK](https://minaprotocol.com/blog/pickles-snark) - Mina's recursive proof system
- [Kimchi](https://o1-labs.github.io/proof-systems/specs/kimchi.html) - Plonkish proof system used by Mina

