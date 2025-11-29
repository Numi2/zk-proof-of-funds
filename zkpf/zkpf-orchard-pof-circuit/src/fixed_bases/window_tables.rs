//! Window table computation for fixed-base scalar multiplication.
//!
//! This module computes the precomputed window tables required by the
//! halo2_gadgets ECC chip for efficient fixed-base scalar multiplication.
//!
//! ## Algorithm
//!
//! For each fixed base B, we compute tables of multiples at each "window"
//! of the scalar. With a 3-bit window size (H=8), each window contains 8
//! precomputed points.
//!
//! The tables are computed as described in:
//! https://zcash.github.io/halo2/design/gadgets/ecc/fixed-base-scalar-mul.html

use arrayvec::ArrayVec;
use ff::{Field, PrimeField};
use group::Curve;
use halo2_proofs::arithmetic::lagrange_interpolate;
use pasta_curves::{arithmetic::CurveAffine, pallas};

use super::{FIXED_BASE_WINDOW_SIZE, H, NUM_WINDOWS, NUM_WINDOWS_SHORT};

/// For each fixed base, we calculate its scalar multiples in three-bit windows.
/// Each window will have $2^3 = 8$ points.
///
/// # Arguments
/// * `base` - The fixed-base generator point
/// * `num_windows` - Number of windows (85 for full-width, 22 for short)
///
/// # Returns
/// A vector of windows, each containing H=8 points.
pub fn compute_window_table<C: CurveAffine>(base: C, num_windows: usize) -> Vec<[C; H]> {
    let mut window_table: Vec<[C; H]> = Vec::with_capacity(num_windows);

    // Generate window table entries for all windows but the last.
    // For these first `num_windows - 1` windows, we compute the multiple [(k+2)*(2^3)^w]B.
    // Here, w ranges from [0..`num_windows - 1`)
    for w in 0..(num_windows - 1) {
        let window: [C; H] = (0..H)
            .map(|k| {
                // scalar = (k+2)*(8^w)
                let scalar = C::Scalar::from(k as u64 + 2)
                    * C::Scalar::from(H as u64).pow([w as u64, 0, 0, 0]);
                (base * scalar).to_affine()
            })
            .collect::<ArrayVec<C, H>>()
            .into_inner()
            .unwrap();
        window_table.push(window);
    }

    // Generate window table entries for the last window, w = `num_windows - 1`.
    // For the last window, we compute [k * (2^3)^w - sum]B, where sum is defined
    // as sum = \sum_{j = 0}^{`num_windows - 2`} 2^{3j+1}
    let sum = (0..(num_windows - 1)).fold(C::Scalar::ZERO, |acc, j| {
        acc + C::Scalar::from(2).pow([FIXED_BASE_WINDOW_SIZE as u64 * j as u64 + 1, 0, 0, 0])
    });

    let last_window: [C; H] = (0..H)
        .map(|k| {
            // scalar = k * (2^3)^w - sum, where w = `num_windows - 1`
            let scalar = C::Scalar::from(k as u64)
                * C::Scalar::from(H as u64).pow([(num_windows - 1) as u64, 0, 0, 0])
                - sum;
            (base * scalar).to_affine()
        })
        .collect::<ArrayVec<C, H>>()
        .into_inner()
        .unwrap();
    window_table.push(last_window);

    window_table
}

/// Compute the U-values for a fixed base.
///
/// The U-values are the x-coordinates encoded as bytes, used for
/// in-circuit fixed-base scalar multiplication.
pub fn compute_u_values(base: pallas::Affine, num_windows: usize) -> Vec<[[u8; 32]; H]> {
    let window_table = compute_window_table(base, num_windows);

    window_table
        .iter()
        .map(|window_points| {
            let mut u_window: [[u8; 32]; H] = [[0u8; 32]; H];
            for (i, point) in window_points.iter().enumerate() {
                u_window[i] = point.coordinates().unwrap().x().to_repr();
            }
            u_window
        })
        .collect()
}

/// For each window, we interpolate the x-coordinate.
/// Returns the Lagrange coefficients for the interpolation polynomial.
pub fn compute_lagrange_coeffs(
    base: pallas::Affine,
    num_windows: usize,
) -> Vec<[pallas::Base; H]> {
    // We are interpolating over the 3-bit window, k \in [0..8)
    let points: Vec<_> = (0..H).map(|i| pallas::Base::from(i as u64)).collect();

    let window_table = compute_window_table(base, num_windows);

    window_table
        .iter()
        .map(|window_points| {
            let x_window_points: Vec<_> = window_points
                .iter()
                .map(|point| *point.coordinates().unwrap().x())
                .collect();
            let coeffs = lagrange_interpolate(&points, &x_window_points);
            coeffs
                .into_iter()
                .collect::<ArrayVec<pallas::Base, H>>()
                .into_inner()
                .unwrap()
        })
        .collect()
}

/// For each window, z is a field element such that for each point (x, y) in the window:
/// - z + y = u^2 (some square in the field); and
/// - z - y is not a square.
///
/// Returns a vector of (z, us) for each window, where us are the square roots.
pub fn find_zs_and_us(
    base: pallas::Affine,
    num_windows: usize,
) -> Option<Vec<(u64, [pallas::Base; H])>> {
    // Closure to find z and u's for one window
    let find_z_and_us = |window_points: &[pallas::Affine]| {
        assert_eq!(H, window_points.len());

        let ys: Vec<_> = window_points
            .iter()
            .map(|point| *point.coordinates().unwrap().y())
            .collect();

        // Search for a valid z
        (0..(1000 * (1 << (2 * H)))).find_map(|z| {
            ys.iter()
                .map(|&y| {
                    let neg_sum = -y + pallas::Base::from(z);
                    let pos_sum = y + pallas::Base::from(z);

                    // Check: z - y is not a square, z + y is a square
                    if neg_sum.sqrt().is_none().into() {
                        pos_sum.sqrt().into()
                    } else {
                        None
                    }
                })
                .collect::<Option<ArrayVec<pallas::Base, H>>>()
                .map(|us| (z, us.into_inner().unwrap()))
        })
    };

    let window_table = compute_window_table(base, num_windows);
    window_table
        .iter()
        .map(|window_points| find_z_and_us(window_points))
        .collect()
}

/// Compute just the z-values (without the u's) for faster computation.
/// Uses a simpler heuristic that works for most cases.
pub fn compute_z_values(base: pallas::Affine, num_windows: usize) -> Vec<u64> {
    let window_table = compute_window_table(base, num_windows);

    window_table
        .iter()
        .map(|window_points| {
            let ys: Vec<_> = window_points
                .iter()
                .map(|point| *point.coordinates().unwrap().y())
                .collect();

            // Find a valid z
            for z in 0u64..10000 {
                let valid = ys.iter().all(|&y| {
                    let neg_sum = -y + pallas::Base::from(z);
                    let pos_sum = y + pallas::Base::from(z);
                    // z - y should not be a square, z + y should be a square
                    bool::from(neg_sum.sqrt().is_none()) && bool::from(pos_sum.sqrt().is_some())
                });
                if valid {
                    return z;
                }
            }
            // Fallback - this shouldn't happen for valid generator points
            0
        })
        .collect()
}

/// Full-width window table computation
pub fn compute_full_width_tables(base: pallas::Affine) -> FullWidthTables {
    FullWidthTables {
        u: compute_u_values(base, NUM_WINDOWS),
        z: compute_z_values(base, NUM_WINDOWS),
        lagrange_coeffs: compute_lagrange_coeffs(base, NUM_WINDOWS),
    }
}

/// Short window table computation (for value commitments)
pub fn compute_short_tables(base: pallas::Affine) -> ShortTables {
    ShortTables {
        u: compute_u_values(base, NUM_WINDOWS_SHORT),
        z: compute_z_values(base, NUM_WINDOWS_SHORT),
        lagrange_coeffs: compute_lagrange_coeffs(base, NUM_WINDOWS_SHORT),
    }
}

/// Precomputed tables for full-width scalar multiplication
#[derive(Clone, Debug)]
pub struct FullWidthTables {
    pub u: Vec<[[u8; 32]; H]>,
    pub z: Vec<u64>,
    pub lagrange_coeffs: Vec<[pallas::Base; H]>,
}

/// Precomputed tables for short scalar multiplication
#[derive(Clone, Debug)]
pub struct ShortTables {
    pub u: Vec<[[u8; 32]; H]>,
    pub z: Vec<u64>,
    pub lagrange_coeffs: Vec<[pallas::Base; H]>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use group::prime::PrimeCurveAffine;
    use group::Group;

    fn test_generator() -> pallas::Affine {
        // Use a simple generator for testing
        let scalar = pallas::Scalar::from(12345u64);
        (pallas::Point::generator() * scalar).to_affine()
    }

    #[test]
    fn test_compute_window_table_dimensions() {
        let base = test_generator();
        let table = compute_window_table(base, NUM_WINDOWS);

        assert_eq!(table.len(), NUM_WINDOWS);
        for window in &table {
            assert_eq!(window.len(), H);
        }
    }

    #[test]
    fn test_compute_window_table_short_dimensions() {
        let base = test_generator();
        let table = compute_window_table(base, NUM_WINDOWS_SHORT);

        assert_eq!(table.len(), NUM_WINDOWS_SHORT);
        for window in &table {
            assert_eq!(window.len(), H);
        }
    }

    #[test]
    fn test_window_table_points_valid() {
        let base = test_generator();
        let table = compute_window_table(base, NUM_WINDOWS);

        // All points should be on the curve (not identity)
        for window in &table {
            for point in window {
                assert!(!bool::from(point.is_identity()));
            }
        }
    }

    #[test]
    fn test_u_values_dimensions() {
        let base = test_generator();
        let u = compute_u_values(base, NUM_WINDOWS);

        assert_eq!(u.len(), NUM_WINDOWS);
        for window in &u {
            assert_eq!(window.len(), H);
        }
    }

    #[test]
    fn test_lagrange_coeffs_dimensions() {
        let base = test_generator();
        let coeffs = compute_lagrange_coeffs(base, NUM_WINDOWS);

        assert_eq!(coeffs.len(), NUM_WINDOWS);
        for window in &coeffs {
            assert_eq!(window.len(), H);
        }
    }

    #[test]
    fn test_z_values_dimensions() {
        let base = test_generator();
        let z = compute_z_values(base, NUM_WINDOWS);

        assert_eq!(z.len(), NUM_WINDOWS);
    }

    #[test]
    fn test_full_width_tables() {
        let base = test_generator();
        let tables = compute_full_width_tables(base);

        assert_eq!(tables.u.len(), NUM_WINDOWS);
        assert_eq!(tables.z.len(), NUM_WINDOWS);
        assert_eq!(tables.lagrange_coeffs.len(), NUM_WINDOWS);
    }

    #[test]
    fn test_short_tables() {
        let base = test_generator();
        let tables = compute_short_tables(base);

        assert_eq!(tables.u.len(), NUM_WINDOWS_SHORT);
        assert_eq!(tables.z.len(), NUM_WINDOWS_SHORT);
        assert_eq!(tables.lagrange_coeffs.len(), NUM_WINDOWS_SHORT);
    }
}

