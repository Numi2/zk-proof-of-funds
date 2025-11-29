//! Orchard Fixed-Base Window Tables for the PoF Circuit
//!
//! This module provides precomputed window tables for fixed-base scalar multiplication
//! over the Pallas curve, compatible with `halo2_gadgets::ecc::chip::FixedPoint` trait.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                          Fixed Bases Module                              │
//! ├─────────────────────────────────────────────────────────────────────────┤
//! │  generator.rs     - GroupHash-based generator derivation                │
//! │  window_tables.rs - Window table computation (U, Z, Lagrange)           │
//! │  mod.rs          - Trait implementations & public API                   │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Fixed Bases
//!
//! | Base | Usage | Scalar Type | Windows |
//! |------|-------|-------------|---------|
//! | NullifierK | Nullifier derivation | BaseFieldElem | 85 |
//! | ValueCommitV | Value commitment (value) | ShortScalar | 22 |
//! | ValueCommitR | Value commitment (randomness) | FullScalar | 85 |
//! | SpendAuthG | Spend authorization | FullScalar | 85 |
//! | NoteCommitR | Note commitment randomness | FullScalar | 85 |
//! | CommitIvkR | IVK commitment randomness | FullScalar | 85 |

pub mod generator;
pub mod window_tables;

use group::prime::PrimeCurveAffine;
use group::{Curve, Group};
use halo2_gadgets::ecc::chip::{BaseFieldElem, FixedPoint, FullScalar, ShortScalar};
use halo2_gadgets::ecc::FixedPoints;
use once_cell::sync::Lazy;
use pasta_curves::pallas;

pub use window_tables::{
    compute_full_width_tables, compute_lagrange_coeffs, compute_short_tables, compute_u_values,
    compute_z_values, FullWidthTables, ShortTables,
};

// ============================================================================
// Window Parameters (from Orchard specification)
// ============================================================================

/// Fixed-base window size (bits per window).
pub const FIXED_BASE_WINDOW_SIZE: usize = 3;

/// Number of elements per window (2^FIXED_BASE_WINDOW_SIZE).
pub const H: usize = 1 << FIXED_BASE_WINDOW_SIZE; // 8

/// Number of windows for full-width scalars (255 bits / 3 bits per window).
pub const NUM_WINDOWS: usize = 85;

/// Number of windows for short scalars (64-bit value commitments).
pub const NUM_WINDOWS_SHORT: usize = 22;

// ============================================================================
// Generator Point Derivation
// ============================================================================

/// Seeds for deterministic generator point generation.
/// These produce distinct, valid curve points for each fixed base.
const NULLIFIER_K_SEED: u64 = 0x4E554C4C494649; // "NULLIFI"
const VALUE_COMMIT_V_SEED: u64 = 0x56414C5545565F; // "VALUEV_"
const VALUE_COMMIT_R_SEED: u64 = 0x56414C5545525F; // "VALUER_"
const SPEND_AUTH_G_SEED: u64 = 0x5350454E444147; // "SPENDAG"
const NOTE_COMMIT_R_SEED: u64 = 0x4E4F5445434D52; // "NOTECMR"
const COMMIT_IVK_R_SEED: u64 = 0x434F4D49564B52; // "COMIVKR"

/// Generate a deterministic curve point by scalar multiplication from the generator.
fn generate_fixed_base(seed: u64) -> pallas::Affine {
    let scalar = pallas::Scalar::from(seed);
    let generator = pallas::Point::generator();
    (generator * scalar).to_affine()
}

// ============================================================================
// Lazy-initialized Window Tables
// ============================================================================

/// Precomputed tables for NullifierK (base field element scalar).
static NULLIFIER_K_TABLES: Lazy<FullWidthTables> =
    Lazy::new(|| compute_full_width_tables(generate_fixed_base(NULLIFIER_K_SEED)));

/// Precomputed tables for ValueCommitV (short scalar).
static VALUE_COMMIT_V_TABLES: Lazy<ShortTables> =
    Lazy::new(|| compute_short_tables(generate_fixed_base(VALUE_COMMIT_V_SEED)));

/// Precomputed tables for ValueCommitR (full-width scalar).
static VALUE_COMMIT_R_TABLES: Lazy<FullWidthTables> =
    Lazy::new(|| compute_full_width_tables(generate_fixed_base(VALUE_COMMIT_R_SEED)));

/// Precomputed tables for SpendAuthG (full-width scalar).
static SPEND_AUTH_G_TABLES: Lazy<FullWidthTables> =
    Lazy::new(|| compute_full_width_tables(generate_fixed_base(SPEND_AUTH_G_SEED)));

/// Precomputed tables for NoteCommitR (full-width scalar).
static NOTE_COMMIT_R_TABLES: Lazy<FullWidthTables> =
    Lazy::new(|| compute_full_width_tables(generate_fixed_base(NOTE_COMMIT_R_SEED)));

/// Precomputed tables for CommitIvkR (full-width scalar).
static COMMIT_IVK_R_TABLES: Lazy<FullWidthTables> =
    Lazy::new(|| compute_full_width_tables(generate_fixed_base(COMMIT_IVK_R_SEED)));

// ============================================================================
// Fixed Base Types with FixedPoint Trait Implementation
// ============================================================================

/// Full-width fixed-base scalar types.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrchardFixedBasesFull {
    /// Value commitment randomness.
    ValueCommitR,
    /// Spend authorization signature.
    SpendAuthG,
    /// Note commitment randomness.
    NoteCommitR,
    /// IVK commitment randomness.
    CommitIvkR,
}

impl FixedPoint<pallas::Affine> for OrchardFixedBasesFull {
    type FixedScalarKind = FullScalar;

    fn generator(&self) -> pallas::Affine {
        match self {
            OrchardFixedBasesFull::ValueCommitR => generate_fixed_base(VALUE_COMMIT_R_SEED),
            OrchardFixedBasesFull::SpendAuthG => generate_fixed_base(SPEND_AUTH_G_SEED),
            OrchardFixedBasesFull::NoteCommitR => generate_fixed_base(NOTE_COMMIT_R_SEED),
            OrchardFixedBasesFull::CommitIvkR => generate_fixed_base(COMMIT_IVK_R_SEED),
        }
    }

    fn u(&self) -> Vec<[[u8; 32]; H]> {
        match self {
            OrchardFixedBasesFull::ValueCommitR => VALUE_COMMIT_R_TABLES.u.clone(),
            OrchardFixedBasesFull::SpendAuthG => SPEND_AUTH_G_TABLES.u.clone(),
            OrchardFixedBasesFull::NoteCommitR => NOTE_COMMIT_R_TABLES.u.clone(),
            OrchardFixedBasesFull::CommitIvkR => COMMIT_IVK_R_TABLES.u.clone(),
        }
    }

    fn z(&self) -> Vec<u64> {
        match self {
            OrchardFixedBasesFull::ValueCommitR => VALUE_COMMIT_R_TABLES.z.clone(),
            OrchardFixedBasesFull::SpendAuthG => SPEND_AUTH_G_TABLES.z.clone(),
            OrchardFixedBasesFull::NoteCommitR => NOTE_COMMIT_R_TABLES.z.clone(),
            OrchardFixedBasesFull::CommitIvkR => COMMIT_IVK_R_TABLES.z.clone(),
        }
    }
}

/// Fixed base for nullifier derivation (base field element scalar).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct NullifierK;

impl FixedPoint<pallas::Affine> for NullifierK {
    type FixedScalarKind = BaseFieldElem;

    fn generator(&self) -> pallas::Affine {
        generate_fixed_base(NULLIFIER_K_SEED)
    }

    fn u(&self) -> Vec<[[u8; 32]; H]> {
        NULLIFIER_K_TABLES.u.clone()
    }

    fn z(&self) -> Vec<u64> {
        NULLIFIER_K_TABLES.z.clone()
    }
}

/// Fixed base for value commitment (short scalar).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ValueCommitV;

impl FixedPoint<pallas::Affine> for ValueCommitV {
    type FixedScalarKind = ShortScalar;

    fn generator(&self) -> pallas::Affine {
        generate_fixed_base(VALUE_COMMIT_V_SEED)
    }

    fn u(&self) -> Vec<[[u8; 32]; H]> {
        VALUE_COMMIT_V_TABLES.u.clone()
    }

    fn z(&self) -> Vec<u64> {
        VALUE_COMMIT_V_TABLES.z.clone()
    }
}

// ============================================================================
// Combined FixedPoints Enum
// ============================================================================

/// Combined enum for all Orchard fixed bases.
///
/// This enum is used as the `FixedPoints` associated type in the ECC chip.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrchardFixedBases {
    /// Full-width fixed bases.
    Full(OrchardFixedBasesFull),
    /// Nullifier K base (base field element scalar).
    NullifierK,
    /// Value commit V base (short scalar).
    ValueCommitV,
}

impl FixedPoints<pallas::Affine> for OrchardFixedBases {
    type FullScalar = OrchardFixedBasesFull;
    type ShortScalar = ValueCommitV;
    type Base = NullifierK;
}

/// Alias for PoF circuit fixed bases.
pub type PofFixedBases = OrchardFixedBases;

/// Alias for PoF circuit full-width fixed bases.
pub type PofFixedBasesFull = OrchardFixedBasesFull;

// ============================================================================
// Helper Functions
// ============================================================================

/// Get the generator point for NullifierK.
pub fn nullifier_k_generator() -> pallas::Affine {
    NullifierK.generator()
}

/// Get the generator point for ValueCommitV.
pub fn value_commit_v_generator() -> pallas::Affine {
    ValueCommitV.generator()
}

/// Get the generator point for ValueCommitR.
pub fn value_commit_r_generator() -> pallas::Affine {
    OrchardFixedBasesFull::ValueCommitR.generator()
}

/// Get the generator point for SpendAuthG.
pub fn spend_auth_g_generator() -> pallas::Affine {
    OrchardFixedBasesFull::SpendAuthG.generator()
}

/// Get the generator point for NoteCommitR.
pub fn note_commit_r_generator() -> pallas::Affine {
    OrchardFixedBasesFull::NoteCommitR.generator()
}

/// Get the generator point for CommitIvkR.
pub fn commit_ivk_r_generator() -> pallas::Affine {
    OrchardFixedBasesFull::CommitIvkR.generator()
}

/// Window table accessors for NullifierK.
pub fn nullifier_k_u() -> Vec<[[u8; 32]; H]> {
    NullifierK.u()
}

pub fn nullifier_k_z() -> Vec<u64> {
    NullifierK.z()
}

/// Window table accessors for ValueCommitV.
pub fn value_commit_v_u() -> Vec<[[u8; 32]; H]> {
    ValueCommitV.u()
}

pub fn value_commit_v_z() -> Vec<u64> {
    ValueCommitV.z()
}

/// Window table accessors for ValueCommitR.
pub fn value_commit_r_u() -> Vec<[[u8; 32]; H]> {
    OrchardFixedBasesFull::ValueCommitR.u()
}

pub fn value_commit_r_z() -> Vec<u64> {
    OrchardFixedBasesFull::ValueCommitR.z()
}

/// Window table accessors for SpendAuthG.
pub fn spend_auth_g_u() -> Vec<[[u8; 32]; H]> {
    OrchardFixedBasesFull::SpendAuthG.u()
}

pub fn spend_auth_g_z() -> Vec<u64> {
    OrchardFixedBasesFull::SpendAuthG.z()
}

/// Window table accessors for NoteCommitR.
pub fn note_commit_r_u() -> Vec<[[u8; 32]; H]> {
    OrchardFixedBasesFull::NoteCommitR.u()
}

pub fn note_commit_r_z() -> Vec<u64> {
    OrchardFixedBasesFull::NoteCommitR.z()
}

/// Window table accessors for CommitIvkR.
pub fn commit_ivk_r_u() -> Vec<[[u8; 32]; H]> {
    OrchardFixedBasesFull::CommitIvkR.u()
}

pub fn commit_ivk_r_z() -> Vec<u64> {
    OrchardFixedBasesFull::CommitIvkR.z()
}

/// Verify that a fixed base has a valid (non-identity) generator.
pub fn verify_generator(base: &OrchardFixedBases) -> bool {
    let gen = match base {
        OrchardFixedBases::Full(full) => full.generator(),
        OrchardFixedBases::NullifierK => NullifierK.generator(),
        OrchardFixedBases::ValueCommitV => ValueCommitV.generator(),
    };
    !bool::from(gen.is_identity())
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_gadgets::ecc::chip::FixedPoint as FixedPointTrait;
    use pasta_curves::arithmetic::CurveAffine;

    #[test]
    fn test_nullifier_k_generator_valid() {
        let gen = nullifier_k_generator();
        assert!(!bool::from(gen.is_identity()));

        let coords = gen.coordinates();
        assert!(bool::from(coords.is_some()));
    }

    #[test]
    fn test_value_commit_v_generator_valid() {
        let gen = value_commit_v_generator();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_value_commit_r_generator_valid() {
        let gen = value_commit_r_generator();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_spend_auth_g_generator_valid() {
        let gen = spend_auth_g_generator();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_note_commit_r_generator_valid() {
        let gen = note_commit_r_generator();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_commit_ivk_r_generator_valid() {
        let gen = commit_ivk_r_generator();
        assert!(!bool::from(gen.is_identity()));
    }

    #[test]
    fn test_window_parameters() {
        assert_eq!(FIXED_BASE_WINDOW_SIZE, 3);
        assert_eq!(H, 8);
        assert_eq!(NUM_WINDOWS, 85);
        assert_eq!(NUM_WINDOWS_SHORT, 22);
    }

    #[test]
    fn test_nullifier_k_window_tables_dimensions() {
        let u = nullifier_k_u();
        let z = nullifier_k_z();

        assert_eq!(u.len(), NUM_WINDOWS);
        assert_eq!(z.len(), NUM_WINDOWS);

        for window in &u {
            assert_eq!(window.len(), H);
        }
    }

    #[test]
    fn test_value_commit_v_window_tables_dimensions() {
        let u = value_commit_v_u();
        let z = value_commit_v_z();

        assert_eq!(u.len(), NUM_WINDOWS_SHORT);
        assert_eq!(z.len(), NUM_WINDOWS_SHORT);
    }

    #[test]
    fn test_full_width_bases_window_tables_dimensions() {
        let bases = [
            ("ValueCommitR", value_commit_r_u(), value_commit_r_z()),
            ("SpendAuthG", spend_auth_g_u(), spend_auth_g_z()),
            ("NoteCommitR", note_commit_r_u(), note_commit_r_z()),
            ("CommitIvkR", commit_ivk_r_u(), commit_ivk_r_z()),
        ];

        for (name, u, z) in bases {
            assert_eq!(
                u.len(),
                NUM_WINDOWS,
                "{} should have {} windows",
                name,
                NUM_WINDOWS
            );
            assert_eq!(
                z.len(),
                NUM_WINDOWS,
                "{} should have {} z-values",
                name,
                NUM_WINDOWS
            );
        }
    }

    #[test]
    fn test_verify_all_generators() {
        let bases = [
            OrchardFixedBases::NullifierK,
            OrchardFixedBases::ValueCommitV,
            OrchardFixedBases::Full(OrchardFixedBasesFull::ValueCommitR),
            OrchardFixedBases::Full(OrchardFixedBasesFull::SpendAuthG),
            OrchardFixedBases::Full(OrchardFixedBasesFull::NoteCommitR),
            OrchardFixedBases::Full(OrchardFixedBasesFull::CommitIvkR),
        ];

        for base in bases {
            assert!(
                verify_generator(&base),
                "Generator should be valid for {:?}",
                base
            );
        }
    }

    #[test]
    fn test_generators_are_distinct() {
        let generators = [
            nullifier_k_generator(),
            value_commit_v_generator(),
            value_commit_r_generator(),
            spend_auth_g_generator(),
            note_commit_r_generator(),
            commit_ivk_r_generator(),
        ];

        for (i, g1) in generators.iter().enumerate() {
            for (j, g2) in generators.iter().enumerate() {
                if i != j {
                    assert_ne!(g1, g2, "Generators {} and {} should be different", i, j);
                }
            }
        }
    }

    #[test]
    fn test_fixed_point_trait_implementation() {
        // Test that FixedPoint trait is properly implemented
        let nk = NullifierK;
        let gen = <NullifierK as FixedPointTrait<pallas::Affine>>::generator(&nk);
        assert!(!bool::from(gen.is_identity()));

        let u = <NullifierK as FixedPointTrait<pallas::Affine>>::u(&nk);
        assert_eq!(u.len(), NUM_WINDOWS);

        let z = <NullifierK as FixedPointTrait<pallas::Affine>>::z(&nk);
        assert_eq!(z.len(), NUM_WINDOWS);
    }

    #[test]
    fn test_value_commit_v_fixed_point_trait() {
        let vcv = ValueCommitV;
        let gen = <ValueCommitV as FixedPointTrait<pallas::Affine>>::generator(&vcv);
        assert!(!bool::from(gen.is_identity()));

        let u = <ValueCommitV as FixedPointTrait<pallas::Affine>>::u(&vcv);
        assert_eq!(u.len(), NUM_WINDOWS_SHORT);

        let z = <ValueCommitV as FixedPointTrait<pallas::Affine>>::z(&vcv);
        assert_eq!(z.len(), NUM_WINDOWS_SHORT);
    }
}
