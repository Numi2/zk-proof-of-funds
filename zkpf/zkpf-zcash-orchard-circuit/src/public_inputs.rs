//zkpf-zcash-orchard-circuit/src/public_inputs.rs
// Numan Thabit 2025

use halo2_proofs::halo2curves::bn256::Fr;
use serde::{Deserialize, Serialize};

/// Public inputs exposed by the Orchard PoF circuit.
///
/// All 32-byte values are later encoded into field elements for Halo2.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrchardPofPublicInputs {
    /// Orchard anchor (Merkle root).
    pub anchor: [u8; 32],
    /// Minimum total value required to satisfy the proof.
    pub threshold_raw: u64,
    /// Actual proven total value committed by the proof.
    pub proven_value: u64,
    /// Commitment to the holder identity (typically a hash of UFVK or similar).
    pub holder_commitment: [u8; 32],
    /// Hash of the rail metadata (policy, rail_id, circuit version, etc.).
    pub rail_meta_hash: [u8; 32],
}

/// Helper for encoding 32-byte blobs into field elements.
///
/// We interpret the 32 bytes as 4 little-endian u64 limbs; each limb is mapped
/// into a field element via Fr::from(limb). This is *not* a canonical
/// interpretation of the full 256-bit integer, but it is perfectly valid for
/// public inputs as long as the same encoding is used consistently on both
/// prover and verifier side.
fn bytes32_to_field_elements(bytes: &[u8; 32]) -> [Fr; 4] {
    let mut out = [Fr::ZERO; 4];

    for limb_idx in 0..4 {
        let start = limb_idx * 8;
        let mut limb = 0u64;

        for byte_idx in 0..8 {
            let b = bytes[start + byte_idx] as u64;
            limb |= b << (8 * byte_idx);
        }

        out[limb_idx] = Fr::from(limb);
    }

    out
}

impl OrchardPofPublicInputs {
    /// Encodes the public inputs into a flat vector of field elements in a fixed
    /// order. This order must be mirrored by the circuit's instance column
    /// assignment and by the verifier.
    ///
    /// Layout:
    /// - anchor: 4 field elements
    /// - threshold_raw: 1 field element
    /// - proven_value: 1 field element
    /// - holder_commitment: 4 field elements
    /// - rail_meta_hash: 4 field elements
    pub fn to_field_elements(&self) -> Vec<Fr> {
        let mut elems = Vec::with_capacity(4 + 1 + 1 + 4 + 4);

        // Anchor
        elems.extend(bytes32_to_field_elements(&self.anchor));

        // Threshold and proven_value as raw u64 -> Fr
        elems.push(Fr::from(self.threshold_raw));
        elems.push(Fr::from(self.proven_value));

        // Holder commitment and rail meta hash
        elems.extend(bytes32_to_field_elements(&self.holder_commitment));
        elems.extend(bytes32_to_field_elements(&self.rail_meta_hash));

        elems
    }
}