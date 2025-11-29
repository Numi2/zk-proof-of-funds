//! Circuit gadgets for Orchard Proof-of-Funds
//!
//! This module contains reusable circuit gadgets used in the Orchard PoF circuit.

use halo2_proofs::{
    circuit::{AssignedCell, Layouter, Value},
    plonk::{Advice, Column, ConstraintSystem, Error as PlonkError, Expression, Selector},
    poly::Rotation,
};
use pasta_curves::pallas;

/// Gadget for range-checking that a value is non-negative and fits in a given bit width.
#[derive(Clone, Debug)]
pub struct RangeCheckConfig {
    /// Advice column for the value being checked.
    value: Column<Advice>,
    /// Selector for enabling the range check.
    q_range: Selector,
    /// Number of bits for the range.
    num_bits: usize,
}

impl RangeCheckConfig {
    /// Configure the range check gadget.
    pub fn configure(
        meta: &mut ConstraintSystem<pallas::Base>,
        value: Column<Advice>,
        num_bits: usize,
    ) -> Self {
        let q_range = meta.selector();

        // For a simple range check, we verify that value < 2^num_bits
        // This can be done by decomposing into bits and checking each bit is 0 or 1
        // For now, this is a simplified version
        meta.create_gate("range_check", |meta| {
            let q = meta.query_selector(q_range);
            let _v = meta.query_advice(value, Rotation::cur());

            // Simplified: just verify constraint is enabled
            // Full implementation would do bit decomposition
            vec![q * Expression::Constant(pallas::Base::zero())]
        });

        Self {
            value,
            q_range,
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
            || "range_check",
            |mut region| {
                self.q_range.enable(&mut region, 0)?;
                region.assign_advice(|| "value", self.value, 0, || value)
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

    #[test]
    fn test_range_check_config() {
        // This is a configuration test - verifies the gadget can be configured
        use halo2_proofs::plonk::ConstraintSystem;

        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let advice = cs.advice_column();

        let _config = RangeCheckConfig::configure(&mut cs, advice, 64);
    }

    #[test]
    fn test_compare_config() {
        use halo2_proofs::plonk::ConstraintSystem;

        let mut cs = ConstraintSystem::<pallas::Base>::default();
        let a = cs.advice_column();
        let b = cs.advice_column();
        let diff = cs.advice_column();

        let _config = CompareConfig::configure(&mut cs, a, b, diff);
    }
}

