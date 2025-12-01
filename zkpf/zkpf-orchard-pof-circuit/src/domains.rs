//! Orchard-compatible domain definitions for Sinsemilla hashing.
//!
//! These types implement the traits required by `halo2_gadgets` for Sinsemilla
//! Merkle path verification, matching the Orchard protocol specification.
//!
//! ## Domain Types
//!
//! - `PofHashDomains` - Hash domain selectors for Sinsemilla operations
//! - `PofCommitDomains` - Commit domain selectors (placeholder for note/ivk commitment)
//! - `PofFixedBases` - Fixed-base scalars for ECC operations (placeholder)
//!
//! ## Generator Points
//!
//! The Q generator points are extracted from the Orchard protocol specification
//! and match exactly with the zcash Orchard crate implementation.

use ff::PrimeField;
use group::prime::PrimeCurveAffine;
use halo2_gadgets::sinsemilla::{CommitDomains, HashDomains};
use pasta_curves::{arithmetic::CurveAffine, pallas};

// Import proper fixed bases with FixedPoint trait implementation
use crate::fixed_bases::{OrchardFixedBases, OrchardFixedBasesFull};

// ============================================================================
// Hash Domain Constants
// ============================================================================

/// SWU hash-to-curve personalization for the Merkle CRH generator.
pub const MERKLE_CRH_PERSONALIZATION: &str = "z.cash:Orchard-MerkleCRH";

/// SWU hash-to-curve personalization for note commitment.
pub const NOTE_COMMITMENT_PERSONALIZATION: &str = "z.cash:Orchard-NoteCommit-M";

/// SWU hash-to-curve personalization for IVK commitment.
pub const COMMIT_IVK_PERSONALIZATION: &str = "z.cash:Orchard-CommitIvk-M";

/// Generator used in SinsemillaHashToPoint for Merkle collision-resistant hash.
/// These are the exact values from the Orchard protocol specification (ZIP-224).
pub const Q_MERKLE_CRH: ([u8; 32], [u8; 32]) = (
    [
        160, 198, 41, 127, 249, 199, 185, 248, 112, 16, 141, 192, 85, 185, 190, 201, 153, 14, 137,
        239, 90, 54, 15, 160, 185, 24, 168, 99, 150, 210, 22, 22,
    ],
    [
        98, 234, 242, 37, 206, 174, 233, 134, 150, 21, 116, 5, 234, 150, 28, 226, 121, 89, 163, 79,
        62, 242, 196, 45, 153, 32, 175, 227, 163, 66, 134, 53,
    ],
);

/// Generator used in SinsemillaHashToPoint for note commitment.
pub const Q_NOTE_COMMITMENT_M_GENERATOR: ([u8; 32], [u8; 32]) = (
    [
        93, 116, 168, 64, 9, 186, 14, 50, 42, 221, 70, 253, 90, 15, 150, 197, 93, 237, 176, 121,
        180, 242, 159, 247, 13, 205, 251, 86, 160, 7, 128, 23,
    ],
    [
        99, 172, 73, 115, 90, 10, 39, 135, 158, 94, 219, 129, 136, 18, 34, 136, 44, 201, 244, 110,
        217, 194, 190, 78, 131, 112, 198, 138, 147, 88, 160, 50,
    ],
);

/// Generator used in SinsemillaHashToPoint for IVK commitment.
pub const Q_COMMIT_IVK_M_GENERATOR: ([u8; 32], [u8; 32]) = (
    [
        242, 130, 15, 121, 146, 47, 203, 107, 50, 162, 40, 81, 36, 204, 27, 66, 250, 65, 162, 90,
        184, 129, 204, 125, 17, 200, 169, 74, 241, 12, 188, 5,
    ],
    [
        190, 222, 173, 207, 206, 229, 90, 190, 241, 165, 109, 201, 29, 53, 196, 70, 75, 5, 222, 32,
        70, 7, 89, 239, 230, 190, 26, 212, 246, 76, 1, 27,
    ],
);

// ============================================================================
// Hash Domains
// ============================================================================

/// Hash domain selectors for Orchard Sinsemilla hashing.
///
/// These correspond to the `OrchardHashDomains` enum in the Orchard crate,
/// providing the generator points (Q) for each hash domain.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PofHashDomains {
    /// Note commitment domain.
    NoteCommit,
    /// IVK commitment domain.
    CommitIvk,
    /// Merkle CRH domain (used for Merkle path verification).
    MerkleCrh,
}

impl PofHashDomains {
    /// Get the personalization string for this domain.
    pub fn personalization(&self) -> &'static str {
        match self {
            PofHashDomains::NoteCommit => NOTE_COMMITMENT_PERSONALIZATION,
            PofHashDomains::CommitIvk => COMMIT_IVK_PERSONALIZATION,
            PofHashDomains::MerkleCrh => MERKLE_CRH_PERSONALIZATION,
        }
    }

    /// Get the raw Q point coordinates for this domain.
    pub fn q_coordinates(&self) -> ([u8; 32], [u8; 32]) {
        match self {
            PofHashDomains::CommitIvk => Q_COMMIT_IVK_M_GENERATOR,
            PofHashDomains::NoteCommit => Q_NOTE_COMMITMENT_M_GENERATOR,
            PofHashDomains::MerkleCrh => Q_MERKLE_CRH,
        }
    }
}

impl HashDomains<pallas::Affine> for PofHashDomains {
    /// Returns the Q generator point for this hash domain.
    ///
    /// The Q point is used as the initial accumulator in Sinsemilla hashing.
    #[allow(non_snake_case)]
    fn Q(&self) -> pallas::Affine {
        let (x_bytes, y_bytes) = self.q_coordinates();

        let x = pallas::Base::from_repr(x_bytes).unwrap();
        let y = pallas::Base::from_repr(y_bytes).unwrap();

        pallas::Affine::from_xy(x, y).unwrap()
    }
}

// ============================================================================
// Commit Domains
// ============================================================================

/// Commit domain selectors for Orchard Sinsemilla commitments.
///
/// In a full implementation, these would be used for note commitment and
/// IVK commitment operations. For the PoF circuit, we primarily need
/// MerkleCrh for path verification.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PofCommitDomains {
    /// Note commitment domain.
    NoteCommit,
    /// IVK commitment domain.
    CommitIvk,
}

impl CommitDomains<pallas::Affine, OrchardFixedBases, PofHashDomains> for PofCommitDomains {
    fn r(&self) -> OrchardFixedBasesFull {
        match self {
            PofCommitDomains::NoteCommit => OrchardFixedBasesFull::NoteCommitR,
            PofCommitDomains::CommitIvk => OrchardFixedBasesFull::CommitIvkR,
        }
    }

    fn hash_domain(&self) -> PofHashDomains {
        match self {
            PofCommitDomains::NoteCommit => PofHashDomains::NoteCommit,
            PofCommitDomains::CommitIvk => PofHashDomains::CommitIvk,
        }
    }
}

// ============================================================================
// Fixed Bases Re-exports
// ============================================================================

// The proper fixed bases with FixedPoint trait implementation are in
// crate::fixed_bases. We re-export the key types for convenience.

/// Re-export OrchardFixedBases as PofFixedBases for consistency.
pub type PofFixedBases = OrchardFixedBases;

/// Re-export OrchardFixedBasesFull as PofFullWidth for consistency.
#[allow(dead_code)]
pub type PofFullWidth = OrchardFixedBasesFull;

// ============================================================================
// Sinsemilla Parameters
// ============================================================================

/// Sinsemilla parameters matching the Orchard specification.
#[allow(dead_code)]
pub mod sinsemilla {
    /// Number of bits of each message piece in SinsemillaHashToPoint.
    /// This is the "K" parameter from ZIP-224.
    pub const K: usize = 10;

    /// The largest integer such that 2^C <= (r_P - 1) / 2, where r_P is the
    /// order of the Pallas curve.
    pub const C: usize = 253;

    /// Orchard Merkle tree message length (in bits).
    /// This is 2 * 255 + 10 = 520 bits for l || left || right.
    pub const L_ORCHARD_MERKLE: usize = 520;

    /// Maximum number of words (K-bit pieces) in a message.
    pub const MAX_WORDS: usize = L_ORCHARD_MERKLE.div_ceil(K);
}

// ============================================================================
// Utility Functions
// ============================================================================

/// Convert raw bytes to a Pallas affine point.
#[allow(dead_code)]
pub fn bytes_to_point(x_bytes: [u8; 32], y_bytes: [u8; 32]) -> Option<pallas::Affine> {
    let x_opt = pallas::Base::from_repr(x_bytes);
    let y_opt = pallas::Base::from_repr(y_bytes);

    if bool::from(x_opt.is_some()) && bool::from(y_opt.is_some()) {
        let x = x_opt.unwrap();
        let y = y_opt.unwrap();
        let point_opt = pallas::Affine::from_xy(x, y);
        if bool::from(point_opt.is_some()) {
            Some(point_opt.unwrap())
        } else {
            None
        }
    } else {
        None
    }
}

/// Extract x-coordinate from a Pallas affine point.
#[allow(dead_code)]
pub fn extract_x(point: &pallas::Affine) -> pallas::Base {
    if bool::from(point.is_identity()) {
        pallas::Base::zero()
    } else {
        *point.coordinates().unwrap().x()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use group::prime::PrimeCurveAffine;

    #[test]
    fn test_merkle_crh_domain() {
        let domain = PofHashDomains::MerkleCrh;
        let q = domain.Q();

        // Verify Q is on the curve (not the identity)
        assert!(!bool::from(q.is_identity()));

        // Verify coordinates match the expected values
        let expected_x = pallas::Base::from_repr(Q_MERKLE_CRH.0).unwrap();
        let expected_y = pallas::Base::from_repr(Q_MERKLE_CRH.1).unwrap();

        // Get coordinates directly from the affine point
        let coords = q.coordinates().unwrap();
        assert_eq!(*coords.x(), expected_x);
        assert_eq!(*coords.y(), expected_y);
    }

    #[test]
    fn test_note_commit_domain() {
        let domain = PofHashDomains::NoteCommit;
        let q = domain.Q();
        assert!(!bool::from(q.is_identity()));
    }

    #[test]
    fn test_commit_ivk_domain() {
        let domain = PofHashDomains::CommitIvk;
        let q = domain.Q();
        assert!(!bool::from(q.is_identity()));
    }

    #[test]
    fn test_all_domains_valid() {
        for domain in [
            PofHashDomains::NoteCommit,
            PofHashDomains::CommitIvk,
            PofHashDomains::MerkleCrh,
        ] {
            let q = domain.Q();
            assert!(
                !bool::from(q.is_identity()),
                "Domain {:?} has identity Q",
                domain
            );
        }
    }

    #[test]
    fn test_domain_personalizations() {
        assert_eq!(
            PofHashDomains::MerkleCrh.personalization(),
            "z.cash:Orchard-MerkleCRH"
        );
        assert_eq!(
            PofHashDomains::NoteCommit.personalization(),
            "z.cash:Orchard-NoteCommit-M"
        );
        assert_eq!(
            PofHashDomains::CommitIvk.personalization(),
            "z.cash:Orchard-CommitIvk-M"
        );
    }

    #[test]
    fn test_commit_domains() {
        // Verify commit domains return correct hash domains
        assert_eq!(
            PofCommitDomains::NoteCommit.hash_domain(),
            PofHashDomains::NoteCommit
        );
        assert_eq!(
            PofCommitDomains::CommitIvk.hash_domain(),
            PofHashDomains::CommitIvk
        );
    }

    #[test]
    fn test_bytes_to_point() {
        // Test with known good point (Q_MERKLE_CRH)
        let point = bytes_to_point(Q_MERKLE_CRH.0, Q_MERKLE_CRH.1);
        assert!(point.is_some());
        assert!(!bool::from(point.unwrap().is_identity()));
    }

    #[test]
    fn test_sinsemilla_params() {
        assert_eq!(sinsemilla::K, 10);
        assert_eq!(sinsemilla::C, 253);
        assert_eq!(sinsemilla::L_ORCHARD_MERKLE, 520);
        assert_eq!(sinsemilla::MAX_WORDS, 52);
    }
}
