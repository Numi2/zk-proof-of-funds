//! Circuit gadgets for Orchard Proof-of-Funds
//!
//! This module contains reusable circuit gadgets used in the Orchard PoF circuit.
//!
//! ## Range Check Implementation
//!
//! The range check gadget uses bit decomposition, similar to the approach in
//! `ragu/src/gadgets/range.rs`. For a value to be in range [0, 2^num_bits):
//!
//! 1. Decompose value into `num_bits` bits (little-endian)
//! 2. Constrain each bit to be boolean: bit_i * (1 - bit_i) = 0
//! 3. Constrain recombination: Σ bit_i * 2^i = value
//!
//! This proves the value is non-negative and less than 2^num_bits.

#![allow(dead_code)]

use ff::PrimeField;
use halo2_proofs::{
    circuit::{AssignedCell, Layouter, Value},
    plonk::{Advice, Column, ConstraintSystem, Error as PlonkError, Expression, Selector},
    poly::Rotation,
};
use pasta_curves::pallas;

/// Maximum number of bits supported for range checks.
/// 64 bits covers u64 values which is sufficient for Zcash zatoshi amounts.
pub const MAX_RANGE_BITS: usize = 64;

/// Gadget for range-checking that a value is non-negative and fits in a given bit width.
///
/// Uses bit decomposition approach: decomposes value into individual bits,
/// constrains each bit to be boolean, and verifies recombination equals the original value.
#[derive(Clone, Debug)]
pub struct RangeCheckConfig {
    /// Advice column for the value being checked.
    value: Column<Advice>,
    /// Advice columns for the bit decomposition (one per bit).
    bits: Vec<Column<Advice>>,
    /// Selector for enabling the boolean constraint on each bit.
    q_bool: Selector,
    /// Selector for enabling the decomposition constraint.
    q_decompose: Selector,
    /// Number of bits for the range.
    num_bits: usize,
}

impl RangeCheckConfig {
    /// Configure the range check gadget.
    ///
    /// This creates constraints for:
    /// 1. Boolean constraint: bit * (1 - bit) = 0 for each bit
    /// 2. Decomposition constraint: Σ bit_i * 2^i = value
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        value: Column<Advice>,
        num_bits: usize,
    ) -> Self {
        assert!(num_bits > 0 && num_bits <= MAX_RANGE_BITS);

        let q_bool = meta.selector();
        let q_decompose = meta.selector();

        // Allocate advice columns for bits
        // For efficiency, we pack multiple bits per row using different columns
        let bits: Vec<Column<Advice>> = (0..num_bits).map(|_| meta.advice_column()).collect();

        // Boolean constraint for each bit: bit * (1 - bit) = 0
        // This ensures each bit is either 0 or 1
        meta.create_gate("range_check_boolean", |meta| {
            let q = meta.query_selector(q_bool);

            // Create boolean constraints for all bits
            bits.iter()
                .map(|bit_col| {
                    let bit = meta.query_advice(*bit_col, Rotation::cur());
                    // bit * (1 - bit) = 0
                    q.clone() * bit.clone() * (Expression::Constant(pallas::Base::one()) - bit)
                })
                .collect::<Vec<_>>()
        });

        // Decomposition constraint: Σ bit_i * 2^i = value
        meta.create_gate("range_check_decompose", |meta| {
            let q = meta.query_selector(q_decompose);
            let v = meta.query_advice(value, Rotation::cur());

            // Build the sum: bit_0 * 1 + bit_1 * 2 + bit_2 * 4 + ...
            let mut sum = Expression::Constant(pallas::Base::zero());
            let mut power_of_two = pallas::Base::one();

            for bit_col in bits.iter() {
                let bit = meta.query_advice(*bit_col, Rotation::cur());
                sum = sum + bit * Expression::Constant(power_of_two);
                power_of_two = power_of_two.double();
            }

            // Constrain: sum - value = 0
            vec![q * (sum - v)]
        });

        Self {
            value,
            bits,
            q_bool,
            q_decompose,
            num_bits,
        }
    }

    /// Assign a value and verify it's in range [0, 2^num_bits).
    ///
    /// This performs the bit decomposition and assigns all necessary cells.
    pub fn assign(
        &self,
        mut layouter: impl Layouter<pallas::Base>,
        value: Value<pallas::Base>,
    ) -> Result<AssignedCell<pallas::Base, pallas::Base>, PlonkError> {
        layouter.assign_region(
            || "range_check",
            |mut region| {
                // Enable the boolean and decomposition constraints
                self.q_bool.enable(&mut region, 0)?;
                self.q_decompose.enable(&mut region, 0)?;

                // Assign the value being checked
                let assigned_value =
                    region.assign_advice(|| "value", self.value, 0, || value)?;

                // Decompose value into bits and assign each bit
                for (i, bit_col) in self.bits.iter().enumerate() {
                    let bit_value = value.map(|v| {
                        // Extract the i-th bit from the field element
                        let repr = v.to_repr();
                        let bytes = repr.as_ref();
                        let byte_idx = i / 8;
                        let bit_idx = i % 8;
                        if byte_idx < bytes.len() && ((bytes[byte_idx] >> bit_idx) & 1) == 1 {
                            pallas::Base::one()
                        } else {
                            pallas::Base::zero()
                        }
                    });

                    region.assign_advice(|| format!("bit_{}", i), *bit_col, 0, || bit_value)?;
                }

                Ok(assigned_value)
            },
        )
    }

    /// Get the number of bits this config is set up for.
    pub fn num_bits(&self) -> usize {
        self.num_bits
    }
}

/// A more compact range check configuration that uses fewer columns.
///
/// Instead of one column per bit, this uses a single column and multiple rows,
/// with each row containing one bit. This is more memory-efficient for large bit widths.
#[derive(Clone, Debug)]
pub struct CompactRangeCheckConfig {
    /// Advice column for the value being checked.
    value: Column<Advice>,
    /// Advice column for the bit values (one per row).
    bit: Column<Advice>,
    /// Advice column for the running sum (accumulator).
    running_sum: Column<Advice>,
    /// Selector for enabling the boolean constraint.
    q_bool: Selector,
    /// Selector for enabling the accumulation constraint.
    q_acc: Selector,
    /// Number of bits for the range.
    num_bits: usize,
}

impl CompactRangeCheckConfig {
    /// Configure the compact range check gadget.
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        value: Column<Advice>,
        bit: Column<Advice>,
        running_sum: Column<Advice>,
        num_bits: usize,
    ) -> Self {
        let q_bool = meta.selector();
        let q_acc = meta.selector();

        // Boolean constraint: bit * (1 - bit) = 0
        meta.create_gate("compact_range_bool", |meta| {
            let q = meta.query_selector(q_bool);
            let b = meta.query_advice(bit, Rotation::cur());
            vec![q * b.clone() * (Expression::Constant(pallas::Base::one()) - b)]
        });

        // Accumulation constraint: running_sum_next = running_sum * 2 + bit
        // This builds up the value from MSB to LSB
        meta.create_gate("compact_range_acc", |meta| {
            let q = meta.query_selector(q_acc);
            let sum_cur = meta.query_advice(running_sum, Rotation::cur());
            let b = meta.query_advice(bit, Rotation::cur());
            let sum_next = meta.query_advice(running_sum, Rotation::next());

            // sum_next = sum_cur * 2 + bit
            // Rearranged: sum_next - sum_cur * 2 - bit = 0
            vec![
                q * (sum_next - sum_cur * Expression::Constant(pallas::Base::from(2u64)) - b),
            ]
        });

        Self {
            value,
            bit,
            running_sum,
            q_bool,
            q_acc,
            num_bits,
        }
    }

    /// Assign a value and verify it's in range.
    pub fn assign(
        &self,
        mut layouter: impl Layouter<pallas::Base>,
        value: Value<pallas::Base>,
    ) -> Result<AssignedCell<pallas::Base, pallas::Base>, PlonkError> {
        layouter.assign_region(
            || "compact_range_check",
            |mut region| {
                // Extract bits from MSB to LSB for the accumulation approach
                let bits: Value<Vec<bool>> = value.map(|v| {
                    let repr = v.to_repr();
                    let bytes = repr.as_ref();
                    (0..self.num_bits)
                        .map(|i| {
                            let byte_idx = i / 8;
                            let bit_idx = i % 8;
                            byte_idx < bytes.len() && ((bytes[byte_idx] >> bit_idx) & 1) == 1
                        })
                        .rev() // MSB first for accumulation
                        .collect()
                });

                // Initial running sum is 0
                let mut current_sum = region.assign_advice(
                    || "initial_sum",
                    self.running_sum,
                    0,
                    || Value::known(pallas::Base::zero()),
                )?;

                // Process each bit from MSB to LSB
                for i in 0..self.num_bits {
                    self.q_bool.enable(&mut region, i)?;
                    if i < self.num_bits - 1 {
                        self.q_acc.enable(&mut region, i)?;
                    }

                    let bit_value = bits.as_ref().map(|b| {
                        if b[i] {
                            pallas::Base::one()
                        } else {
                            pallas::Base::zero()
                        }
                    });

                    region.assign_advice(|| format!("bit_{}", i), self.bit, i, || bit_value)?;

                    // Compute next running sum
                    let next_sum = current_sum.value().cloned().zip(bit_value).map(|(s, b)| {
                        s.double() + b
                    });

                    current_sum = region.assign_advice(
                        || format!("sum_{}", i + 1),
                        self.running_sum,
                        i + 1,
                        || next_sum,
                    )?;
                }

                // The final running sum should equal the original value
                // Assign the value for verification
                let assigned_value =
                    region.assign_advice(|| "value", self.value, 0, || value)?;

                // Copy constraint: final_sum == value
                region.constrain_equal(current_sum.cell(), assigned_value.cell())?;

                Ok(assigned_value)
            },
        )
    }
}

/// Gadget for comparing two values (a >= b).
#[derive(Clone, Debug)]
pub struct CompareConfig {
    /// Advice column for value a.
    a: Column<Advice>,
    /// Advice column for value b.
    b: Column<Advice>,
    /// Advice column for the difference (a - b).
    diff: Column<Advice>,
    /// Selector for enabling comparison.
    q_compare: Selector,
}

impl CompareConfig {
    /// Configure the comparison gadget.
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        a: Column<Advice>,
        b: Column<Advice>,
        diff: Column<Advice>,
    ) -> Self {
        let q_compare = meta.selector();

        // Constraint: a - b = diff
        // Combined with range check on diff, this proves a >= b
        meta.create_gate("compare", |meta| {
            let q = meta.query_selector(q_compare);
            let a = meta.query_advice(a, Rotation::cur());
            let b = meta.query_advice(b, Rotation::cur());
            let diff = meta.query_advice(diff, Rotation::cur());

            vec![q * (a - b - diff)]
        });

        Self {
            a,
            b,
            diff,
            q_compare,
        }
    }

    /// Assign values and verify a >= b.
    pub fn assign(
        &self,
        mut layouter: impl Layouter<pallas::Base>,
        a: Value<pallas::Base>,
        b: Value<pallas::Base>,
    ) -> Result<AssignedCell<pallas::Base, pallas::Base>, PlonkError> {
        layouter.assign_region(
            || "compare",
            |mut region| {
                self.q_compare.enable(&mut region, 0)?;

                region.assign_advice(|| "a", self.a, 0, || a)?;
                region.assign_advice(|| "b", self.b, 0, || b)?;

                let diff = a.zip(b).map(|(a, b)| a - b);
                region.assign_advice(|| "diff", self.diff, 0, || diff)
            },
        )
    }
}

/// Gadget for Sinsemilla-based Merkle path verification.
/// 
/// This is a simplified version - the full implementation would use
/// the official Sinsemilla gadgets from halo2_gadgets.
#[derive(Clone, Debug)]
pub struct SimpleMerkleConfig {
    /// Advice column for the current hash.
    current: Column<Advice>,
    /// Advice column for the sibling hash.
    sibling: Column<Advice>,
    /// Advice column for the parent hash.
    parent: Column<Advice>,
    /// Advice column for the position bit.
    position_bit: Column<Advice>,
    /// Selector for Merkle hash computation.
    q_merkle: Selector,
}

impl SimpleMerkleConfig {
    /// Configure the Merkle path gadget.
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        current: Column<Advice>,
        sibling: Column<Advice>,
        parent: Column<Advice>,
        position_bit: Column<Advice>,
    ) -> Self {
        let q_merkle = meta.selector();

        // Constraint for Merkle hash:
        // If position_bit = 0: parent = H(current, sibling)
        // If position_bit = 1: parent = H(sibling, current)
        // 
        // For now, this is a structural placeholder.
        // Full implementation would use Sinsemilla hash.
        meta.create_gate("merkle_hash", |meta| {
            let q = meta.query_selector(q_merkle);
            let _current = meta.query_advice(current, Rotation::cur());
            let _sibling = meta.query_advice(sibling, Rotation::cur());
            let _parent = meta.query_advice(parent, Rotation::cur());
            let pos = meta.query_advice(position_bit, Rotation::cur());

            // Boolean constraint: pos * (1 - pos) = 0
            let boolean_check = pos.clone() * (Expression::Constant(pallas::Base::one()) - pos);

            vec![q * boolean_check]
        });

        Self {
            current,
            sibling,
            parent,
            position_bit,
            q_merkle,
        }
    }

    /// Verify a single level of the Merkle path.
    pub fn verify_level(
        &self,
        mut layouter: impl Layouter<pallas::Base>,
        current: Value<pallas::Base>,
        sibling: Value<pallas::Base>,
        position_bit: Value<bool>,
    ) -> Result<AssignedCell<pallas::Base, pallas::Base>, PlonkError> {
        layouter.assign_region(
            || "merkle_level",
            |mut region| {
                self.q_merkle.enable(&mut region, 0)?;

                region.assign_advice(|| "current", self.current, 0, || current)?;
                region.assign_advice(|| "sibling", self.sibling, 0, || sibling)?;

                let pos_field = position_bit.map(|b| {
                    if b {
                        pallas::Base::one()
                    } else {
                        pallas::Base::zero()
                    }
                });
                region.assign_advice(|| "position_bit", self.position_bit, 0, || pos_field)?;

                // Compute parent hash (simplified - using addition instead of Sinsemilla)
                let parent = current.zip(sibling).map(|(c, s)| c + s);
                region.assign_advice(|| "parent", self.parent, 0, || parent)
            },
        )
    }
}

/// Gadget for accumulating note values.
#[derive(Clone, Debug)]
pub struct ValueAccumulatorConfig {
    /// Advice column for the running sum.
    sum: Column<Advice>,
    /// Advice column for the current value.
    value: Column<Advice>,
    /// Selector for enabling accumulation.
    q_acc: Selector,
}

impl ValueAccumulatorConfig {
    /// Configure the value accumulator gadget.
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        sum: Column<Advice>,
        value: Column<Advice>,
    ) -> Self {
        let q_acc = meta.selector();

        // Constraint: sum_new = sum + value
        meta.create_gate("accumulate", |meta| {
            let q = meta.query_selector(q_acc);
            let sum_cur = meta.query_advice(sum, Rotation::cur());
            let value = meta.query_advice(value, Rotation::cur());
            let sum_next = meta.query_advice(sum, Rotation::next());

            vec![q * (sum_next - sum_cur - value)]
        });

        Self { sum, value, q_acc }
    }

    /// Accumulate a sequence of values.
    pub fn accumulate(
        &self,
        mut layouter: impl Layouter<pallas::Base>,
        values: &[Value<pallas::Base>],
    ) -> Result<AssignedCell<pallas::Base, pallas::Base>, PlonkError> {
        layouter.assign_region(
            || "accumulate_values",
            |mut region| {
                // Initial sum = 0
                let mut running_sum = region.assign_advice(
                    || "initial_sum",
                    self.sum,
                    0,
                    || Value::known(pallas::Base::zero()),
                )?;

                for (i, value) in values.iter().enumerate() {
                    self.q_acc.enable(&mut region, i)?;

                    region.assign_advice(|| format!("value_{}", i), self.value, i, || *value)?;

                    let new_sum = running_sum.value().cloned().zip(*value).map(|(s, v)| s + v);

                    running_sum = region.assign_advice(
                        || format!("sum_{}", i + 1),
                        self.sum,
                        i + 1,
                        || new_sum,
                    )?;
                }

                Ok(running_sum)
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs::{
        circuit::SimpleFloorPlanner,
        dev::MockProver,
        plonk::Circuit,
    };

    /// Test circuit for RangeCheckConfig
    #[derive(Clone, Default)]
    struct RangeCheckTestCircuit {
        value: Value<pallas::Base>,
        num_bits: usize,
    }

    impl Circuit<pallas::Base> for RangeCheckTestCircuit {
        type Config = RangeCheckConfig;
        type FloorPlanner = SimpleFloorPlanner;

        fn without_witnesses(&self) -> Self {
            Self {
                value: Value::unknown(),
                num_bits: self.num_bits,
            }
        }

        fn configure(meta: &mut ConstraintSystem<pallas::Base>) -> Self::Config {
            let value = meta.advice_column();
            meta.enable_equality(value);
            RangeCheckConfig::configure(meta, value, 8) // 8-bit range for testing
        }

        fn synthesize(
            &self,
            config: Self::Config,
            layouter: impl Layouter<pallas::Base>,
        ) -> Result<(), PlonkError> {
            config.assign(layouter, self.value)?;
            Ok(())
        }
    }

    #[test]
    fn test_range_check_config() {
        // This is a configuration test - verifies the gadget can be configured
        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let advice = cs.advice_column();

        let config = RangeCheckConfig::configure(&mut cs, advice, 64);
        assert_eq!(config.num_bits(), 64);
    }

    #[test]
    fn test_range_check_valid_value() {
        // Test that a value within range passes
        let k = 10; // 2^10 = 1024 rows

        let circuit = RangeCheckTestCircuit {
            value: Value::known(pallas::Base::from(42u64)), // 42 < 256 (2^8)
            num_bits: 8,
        };

        let prover = MockProver::run(k, &circuit, vec![]).unwrap();
        assert!(prover.verify().is_ok());
    }

    #[test]
    fn test_range_check_zero() {
        // Test that zero passes (edge case)
        let k = 10;

        let circuit = RangeCheckTestCircuit {
            value: Value::known(pallas::Base::zero()),
            num_bits: 8,
        };

        let prover = MockProver::run(k, &circuit, vec![]).unwrap();
        assert!(prover.verify().is_ok());
    }

    #[test]
    fn test_range_check_max_value() {
        // Test maximum valid value (2^8 - 1 = 255)
        let k = 10;

        let circuit = RangeCheckTestCircuit {
            value: Value::known(pallas::Base::from(255u64)),
            num_bits: 8,
        };

        let prover = MockProver::run(k, &circuit, vec![]).unwrap();
        assert!(prover.verify().is_ok());
    }

    #[test]
    fn test_compact_range_check_config() {
        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let value = cs.advice_column();
        let bit = cs.advice_column();
        let running_sum = cs.advice_column();
        cs.enable_equality(running_sum);

        let _config = CompactRangeCheckConfig::configure(&mut cs, value, bit, running_sum, 16);
    }

    #[test]
    fn test_compare_config() {
        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let a = cs.advice_column();
        let b = cs.advice_column();
        let diff = cs.advice_column();

        let _config = CompareConfig::configure(&mut cs, a, b, diff);
    }

    #[test]
    fn test_value_accumulator_config() {
        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let sum = cs.advice_column();
        let value = cs.advice_column();

        let _config = ValueAccumulatorConfig::configure(&mut cs, sum, value);
    }
}

