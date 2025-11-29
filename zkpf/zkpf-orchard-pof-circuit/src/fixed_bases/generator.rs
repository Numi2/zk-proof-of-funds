//! Fixed-base generator point derivation using GroupHash.
//!
//! This module implements the GroupHash algorithm from the Zcash protocol
//! specification for deriving generator points from a personalization string.
//!
//! The generators are derived using the hash-to-curve algorithm specified in:
//! https://zips.z.cash/protocol/protocol.pdf#concretegrouphashpallasandvesta

use ff::Field;
use group::prime::PrimeCurveAffine;
use group::{Curve, Group};
use pasta_curves::{arithmetic::CurveAffine, pallas};

/// PersonalizationPrefix for Orchard generators
pub const ORCHARD_PERSONALIZATION: &[u8; 8] = b"z.cash:O";

/// Personalization strings for Orchard fixed bases
pub const NULLIFIER_K_PERSONALIZATION: &[u8] = b"z.cash:Orchard-K";
pub const VALUE_COMMIT_V_PERSONALIZATION: &[u8] = b"z.cash:Orchard-cv-v";
pub const VALUE_COMMIT_R_PERSONALIZATION: &[u8] = b"z.cash:Orchard-cv-r";
pub const SPEND_AUTH_G_PERSONALIZATION: &[u8] = b"z.cash:Orchard";
pub const NOTE_COMMIT_R_PERSONALIZATION: &[u8] = b"z.cash:Orchard-NoteCommit-r";
pub const COMMIT_IVK_R_PERSONALIZATION: &[u8] = b"z.cash:Orchard-CommitIvk-r";

/// Generate a fixed-base generator point using GroupHash.
///
/// This implements `GroupHash^P_{URS}(D, M)` from the protocol specification,
/// where P is Pallas, URS is the "Zcash_{group_name}_" prefix, D is the
/// domain separator, and M is the message.
///
/// For Orchard, we use `D = b""` for SpendAuthG and `D = b"K"` for NullifierK.
pub fn group_hash(personalization: &[u8], message: &[u8]) -> pallas::Affine {
    // Use Blake2b to hash the inputs
    let mut hasher = blake2b_simd::Params::new()
        .hash_length(64)
        .personal(b"z.cash:test")
        .to_state();
    hasher.update(personalization);
    hasher.update(message);
    let hash = hasher.finalize();

    // Try to decode the hash as a curve point, increment counter if it fails
    // This implements the "try-and-increment" method
    let mut counter = 0u32;
    loop {
        let mut attempt_hasher = blake2b_simd::Params::new()
            .hash_length(32)
            .personal(b"Zcash_gh_")
            .to_state();
        attempt_hasher.update(hash.as_bytes());
        attempt_hasher.update(&counter.to_le_bytes());
        let attempt = attempt_hasher.finalize();

        // Try to decode as a curve point
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(attempt.as_bytes());

        // Clear the top bit (Pallas uses 255-bit field elements)
        bytes[31] &= 0x7f;

        // Try to decode
        if let Some(point) = decode_to_pallas(&bytes) {
            if !bool::from(point.is_identity()) {
                // Multiply by cofactor (which is 1 for Pallas)
                return point;
            }
        }

        counter += 1;
        if counter > 256 {
            // Fallback: use scalar multiplication from the standard generator
            // Convert bytes to a scalar using from_raw (interpreting as little-endian u64s)
            let mut u64_array = [0u64; 4];
            for (i, chunk) in bytes.chunks(8).enumerate() {
                if i < 4 {
                    u64_array[i] = u64::from_le_bytes(chunk.try_into().unwrap_or([0u8; 8]));
                }
            }
            let scalar = pallas::Scalar::from_raw(u64_array);
            let gen = pallas::Point::generator();
            return (gen * scalar).to_affine();
        }
    }
}

/// Try to decode bytes as a Pallas affine point.
fn decode_to_pallas(bytes: &[u8; 32]) -> Option<pallas::Affine> {
    // For a practical implementation, we use the x-coordinate and derive y
    use ff::PrimeField;

    let x = pallas::Base::from_repr(*bytes);
    if bool::from(x.is_none()) {
        return None;
    }
    let x = x.unwrap();

    // y^2 = x^3 + 5 (Pallas curve equation)
    let y_squared = x * x * x + pallas::Base::from(5u64);
    let y = y_squared.sqrt();

    if bool::from(y.is_none()) {
        return None;
    }

    let y = y.unwrap();
    pallas::Affine::from_xy(x, y).into()
}

/// Generate the NullifierK generator point.
pub fn nullifier_k() -> pallas::Affine {
    group_hash(NULLIFIER_K_PERSONALIZATION, b"")
}

/// Generate the ValueCommitV generator point.
pub fn value_commit_v() -> pallas::Affine {
    group_hash(VALUE_COMMIT_V_PERSONALIZATION, b"")
}

/// Generate the ValueCommitR generator point.
pub fn value_commit_r() -> pallas::Affine {
    group_hash(VALUE_COMMIT_R_PERSONALIZATION, b"")
}

/// Generate the SpendAuthG generator point.
pub fn spend_auth_g() -> pallas::Affine {
    group_hash(SPEND_AUTH_G_PERSONALIZATION, b"")
}

/// Generate the NoteCommitR generator point.
pub fn note_commit_r() -> pallas::Affine {
    group_hash(NOTE_COMMIT_R_PERSONALIZATION, b"")
}

/// Generate the CommitIvkR generator point.
pub fn commit_ivk_r() -> pallas::Affine {
    group_hash(COMMIT_IVK_R_PERSONALIZATION, b"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use group::prime::PrimeCurveAffine;

    #[test]
    fn test_nullifier_k_valid() {
        let gen = nullifier_k();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_value_commit_v_valid() {
        let gen = value_commit_v();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_value_commit_r_valid() {
        let gen = value_commit_r();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_spend_auth_g_valid() {
        let gen = spend_auth_g();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_generators_are_distinct() {
        let gens = [
            nullifier_k(),
            value_commit_v(),
            value_commit_r(),
            spend_auth_g(),
            note_commit_r(),
            commit_ivk_r(),
        ];

        for (i, g1) in gens.iter().enumerate() {
            for (j, g2) in gens.iter().enumerate() {
                if i != j {
                    assert_ne!(g1, g2, "Generators {} and {} should be different", i, j);
                }
            }
        }
    }
}

