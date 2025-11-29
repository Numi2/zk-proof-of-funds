//! Sinsemilla hash computation for Orchard Merkle path verification.
//!
//! This module provides Sinsemilla-based hash computation using the primitives
//! from `halo2_gadgets::sinsemilla::primitives`. These are the same primitives
//! used in the Orchard protocol for Merkle tree construction.
//!
//! The computed hashes can be verified in-circuit using Sinsemilla gadgets,
//! or used to pre-compute expected values for simplified circuit verification.

use ff::PrimeField;
use group::prime::PrimeCurveAffine;
use group::Curve;
use halo2_gadgets::sinsemilla::primitives::{HashDomain, K};
use pasta_curves::{arithmetic::CurveAffine, pallas};

use crate::circuit::MERKLE_DEPTH;
use crate::domains::MERKLE_CRH_PERSONALIZATION;

/// Sinsemilla hash domain for Orchard Merkle CRH.
///
/// This creates a hash domain with the same personalization as Orchard's
/// MerkleHashOrchard, ensuring hash compatibility.
pub fn merkle_crh_domain() -> HashDomain {
    HashDomain::new(MERKLE_CRH_PERSONALIZATION)
}

/// Compute a single level of Merkle hash using Sinsemilla.
///
/// This implements `MerkleCRH^Orchard(l, left, right)` as specified in ZIP-224.
///
/// # Arguments
/// * `level` - The tree level (0 = leaf level, increasing toward root)
/// * `left` - The left child hash (or leaf commitment)
/// * `right` - The right child hash (or sibling)
///
/// # Returns
/// The parent hash as a Pallas base field element.
pub fn merkle_hash_level(
    level: u8,
    left: pallas::Base,
    right: pallas::Base,
) -> Option<pallas::Base> {
    let domain = merkle_crh_domain();

    // Construct the message: l || left || right
    // l is 10 bits (fits in K=10 bit word)
    // left and right are each 255 bits
    let mut message = Vec::with_capacity(520);

    // Level prefix (10 bits) - cast to u16 to avoid overflow
    let level_u16 = level as u16;
    for i in 0..K {
        message.push((level_u16 >> i) & 1 == 1);
    }

    // Left hash (255 bits, LSB first)
    let left_bytes = left.to_repr();
    for byte in left_bytes.iter().take(31) {
        for i in 0..8 {
            message.push((byte >> i) & 1 == 1);
        }
    }
    // Last 7 bits of the 255-bit representation
    for i in 0..7 {
        message.push((left_bytes[31] >> i) & 1 == 1);
    }

    // Right hash (255 bits, LSB first)
    let right_bytes = right.to_repr();
    for byte in right_bytes.iter().take(31) {
        for i in 0..8 {
            message.push((byte >> i) & 1 == 1);
        }
    }
    // Last 7 bits
    for i in 0..7 {
        message.push((right_bytes[31] >> i) & 1 == 1);
    }

    // Compute Sinsemilla hash
    let point_option = domain.hash_to_point(message.into_iter());

    // Convert CtOption to Option
    if bool::from(point_option.is_some()) {
        let point = point_option.unwrap();
        Some(extract_p(&point.to_affine()))
    } else {
        None
    }
}

/// Extract the x-coordinate from a Pallas point.
///
/// This is the same extraction function used in Orchard.
fn extract_p(point: &pallas::Affine) -> pallas::Base {
    if bool::from(point.is_identity()) {
        pallas::Base::zero()
    } else {
        *point.coordinates().unwrap().x()
    }
}

/// Compute the Merkle root from a leaf and authentication path.
///
/// # Arguments
/// * `leaf` - The leaf value (extracted note commitment cmx)
/// * `position` - The leaf position in the tree
/// * `auth_path` - Authentication path siblings from leaf to root
///
/// # Returns
/// The computed Merkle root.
pub fn compute_merkle_root(
    leaf: pallas::Base,
    position: u32,
    auth_path: &[pallas::Base; MERKLE_DEPTH],
) -> Option<pallas::Base> {
    let mut current = leaf;

    for (level, sibling) in auth_path.iter().enumerate() {
        let pos_bit = (position >> level) & 1;

        // Determine left/right based on position bit
        let (left, right) = if pos_bit == 0 {
            (current, *sibling)
        } else {
            (*sibling, current)
        };

        current = merkle_hash_level(level as u8, left, right)?;
    }

    Some(current)
}

/// Verify a Merkle path against an expected anchor.
///
/// # Arguments
/// * `leaf` - The leaf value (extracted note commitment cmx)
/// * `position` - The leaf position in the tree
/// * `auth_path` - Authentication path siblings from leaf to root
/// * `expected_anchor` - The expected Merkle root
///
/// # Returns
/// `true` if the computed root matches the expected anchor.
pub fn verify_merkle_path(
    leaf: pallas::Base,
    position: u32,
    auth_path: &[pallas::Base; MERKLE_DEPTH],
    expected_anchor: pallas::Base,
) -> bool {
    match compute_merkle_root(leaf, position, auth_path) {
        Some(computed_root) => computed_root == expected_anchor,
        None => false,
    }
}

/// Compute the empty root at a given depth.
///
/// This computes the Merkle root of an empty tree, which is needed for
/// padding and verification.
pub fn empty_root(depth: u8) -> pallas::Base {
    let mut current = pallas::Base::zero(); // Empty leaf

    for level in 0..depth {
        current = merkle_hash_level(level, current, current).unwrap_or(pallas::Base::zero());
    }

    current
}

/// Batch compute multiple Merkle roots.
///
/// This is useful for verifying multiple notes in a single PoF statement.
///
/// # Arguments
/// * `leaves` - Vector of (leaf, position, auth_path) tuples
///
/// # Returns
/// Vector of computed Merkle roots.
pub fn batch_compute_merkle_roots(
    leaves: &[(pallas::Base, u32, [pallas::Base; MERKLE_DEPTH])],
) -> Vec<Option<pallas::Base>> {
    leaves
        .iter()
        .map(|(leaf, position, auth_path)| compute_merkle_root(*leaf, *position, auth_path))
        .collect()
}

/// Convert a 32-byte array to a Pallas base field element.
pub fn bytes_to_field(bytes: &[u8; 32]) -> pallas::Base {
    pallas::Base::from_repr(*bytes).unwrap_or(pallas::Base::zero())
}

/// Convert a Pallas base field element to a 32-byte array.
pub fn field_to_bytes(field: pallas::Base) -> [u8; 32] {
    field.to_repr()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_hash_domain() {
        let domain = merkle_crh_domain();
        // Just verify the domain can be created
        let _ = domain;
    }

    #[test]
    fn test_merkle_hash_level() {
        // Test that hashing produces non-zero output
        let left = pallas::Base::from(1u64);
        let right = pallas::Base::from(2u64);

        let result = merkle_hash_level(0, left, right);
        assert!(result.is_some());

        let hash = result.unwrap();
        assert_ne!(hash, pallas::Base::zero());
    }

    #[test]
    fn test_merkle_hash_consistency() {
        // Same inputs should produce same output
        let left = pallas::Base::from(12345u64);
        let right = pallas::Base::from(67890u64);

        let hash1 = merkle_hash_level(0, left, right).unwrap();
        let hash2 = merkle_hash_level(0, left, right).unwrap();

        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_merkle_hash_order_matters() {
        // Swapping left/right should produce different output
        let a = pallas::Base::from(100u64);
        let b = pallas::Base::from(200u64);

        let hash1 = merkle_hash_level(0, a, b).unwrap();
        let hash2 = merkle_hash_level(0, b, a).unwrap();

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_merkle_hash_level_matters() {
        // Different levels should produce different output
        let left = pallas::Base::from(100u64);
        let right = pallas::Base::from(200u64);

        let hash0 = merkle_hash_level(0, left, right).unwrap();
        let hash1 = merkle_hash_level(1, left, right).unwrap();

        assert_ne!(hash0, hash1);
    }

    #[test]
    fn test_compute_merkle_root_trivial() {
        // Test with all-zero path
        let leaf = pallas::Base::from(1u64);
        let position = 0u32;
        let auth_path = [pallas::Base::zero(); MERKLE_DEPTH];

        let root = compute_merkle_root(leaf, position, &auth_path);
        assert!(root.is_some());
    }

    #[test]
    fn test_verify_merkle_path() {
        // Compute a root, then verify the path
        let leaf = pallas::Base::from(42u64);
        let position = 0u32;
        let auth_path = [pallas::Base::from(1u64); MERKLE_DEPTH];

        let root = compute_merkle_root(leaf, position, &auth_path).unwrap();

        // Verification should succeed with correct root
        assert!(verify_merkle_path(leaf, position, &auth_path, root));

        // Verification should fail with wrong root
        assert!(!verify_merkle_path(
            leaf,
            position,
            &auth_path,
            pallas::Base::zero()
        ));
    }

    #[test]
    fn test_empty_root() {
        // Empty root should be computable
        let root = empty_root(MERKLE_DEPTH as u8);
        // Empty root should be deterministic
        let root2 = empty_root(MERKLE_DEPTH as u8);
        assert_eq!(root, root2);
    }

    #[test]
    fn test_batch_compute() {
        let leaves = vec![
            (
                pallas::Base::from(1u64),
                0u32,
                [pallas::Base::zero(); MERKLE_DEPTH],
            ),
            (
                pallas::Base::from(2u64),
                1u32,
                [pallas::Base::zero(); MERKLE_DEPTH],
            ),
        ];

        let roots = batch_compute_merkle_roots(&leaves);
        assert_eq!(roots.len(), 2);
        assert!(roots.iter().all(|r| r.is_some()));
    }

    #[test]
    fn test_field_conversion_roundtrip() {
        let original = pallas::Base::from(0x123456789ABCDEFu64);
        let bytes = field_to_bytes(original);
        let recovered = bytes_to_field(&bytes);
        assert_eq!(original, recovered);
    }
}
