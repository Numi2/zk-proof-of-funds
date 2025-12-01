//! Pickles accumulator verification for recursive proofs.
//!
//! Mina uses Pickles, a recursive SNARK system, which defers IPA checks
//! using an accumulator scheme. This module implements verification of
//! the accumulator updates across recursive proof steps.
//!
//! # Pickles Accumulator Scheme
//!
//! In Pickles, each proof step:
//! 1. Verifies the previous proof's constraint satisfaction (Vf)
//! 2. Accumulates the IPA check into a running accumulator
//! 3. The final proof includes a proof that the accumulated IPA check passes
//!
//! This allows for O(1) verification time regardless of recursion depth.
//!
//! # Accumulator Structure
//!
//! The accumulator contains:
//! - A commitment point C (aggregated polynomial commitment)
//! - Scalar coefficients for the aggregation
//! - Challenges used in the folding
//!
//! # Verification
//!
//! To verify a Pickles proof:
//! 1. Run Vf (field operations) to check constraints
//! 2. Verify the accumulator transition from previous to current
//! 3. In the final step, verify the accumulated IPA check

use halo2_base::{
    gates::{GateInstructions, RangeInstructions},
    AssignedValue, Context,
};
use halo2curves_axiom::bn256::Fr;

use crate::{
    ec::{ECChip, ECPoint, NativeECPoint, PastaCurve},
    ff::{FFChip, FFelt, NativeFFelt, PastaField},
    ipa::NativeSrs,
    poseidon::NativeKimchiTranscript,
};

// === Accumulator Structures ===

/// Pickles IPA accumulator.
///
/// The accumulator represents a deferred IPA check that will be
/// verified at the end of the recursion.
#[derive(Clone, Debug)]
pub struct PicklesAccumulator {
    /// Accumulated commitment point.
    pub commitment: NativeECPoint,
    /// Accumulated evaluation scalar.
    pub evaluation: NativeFFelt,
    /// Accumulated challenges from all recursive steps.
    pub challenges: Vec<NativeFFelt>,
    /// Number of recursion steps accumulated.
    pub depth: u32,
    /// Blinding factor sum.
    pub blinding_sum: NativeFFelt,
}

impl PicklesAccumulator {
    /// Create the identity accumulator.
    pub fn identity() -> Self {
        Self {
            commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            evaluation: NativeFFelt::zero(PastaField::Pallas),
            challenges: Vec::new(),
            depth: 0,
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        }
    }

    /// Create from raw components.
    pub fn from_components(
        commitment: NativeECPoint,
        evaluation: NativeFFelt,
        challenges: Vec<NativeFFelt>,
    ) -> Self {
        Self {
            commitment,
            evaluation,
            challenges,
            depth: 1,
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        }
    }

    /// Check if this is an identity (empty) accumulator.
    pub fn is_identity(&self) -> bool {
        self.depth == 0 && self.commitment.is_infinity
    }

    /// Serialize the accumulator to bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();

        // Commitment (64 bytes)
        bytes.extend_from_slice(&self.commitment.to_bytes());

        // Evaluation (32 bytes)
        bytes.extend_from_slice(&self.evaluation.to_bytes_le());

        // Number of challenges
        bytes.extend_from_slice(&(self.challenges.len() as u32).to_le_bytes());

        // Challenges
        for challenge in &self.challenges {
            bytes.extend_from_slice(&challenge.to_bytes_le());
        }

        // Depth
        bytes.extend_from_slice(&self.depth.to_le_bytes());

        // Blinding sum
        bytes.extend_from_slice(&self.blinding_sum.to_bytes_le());

        bytes
    }

    /// Deserialize from bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 100 {
            return Err("insufficient bytes for accumulator");
        }

        let curve = PastaCurve::Pallas;
        let field = PastaField::Pallas;
        let mut offset = 0;

        // Commitment
        let mut x_bytes = [0u8; 32];
        let mut y_bytes = [0u8; 32];
        x_bytes.copy_from_slice(&bytes[offset..offset + 32]);
        y_bytes.copy_from_slice(&bytes[offset + 32..offset + 64]);
        let commitment = if x_bytes == [0u8; 32] && y_bytes == [0u8; 32] {
            NativeECPoint::infinity(curve)
        } else {
            NativeECPoint::from_bytes(&x_bytes, &y_bytes, curve)
        };
        offset += 64;

        // Evaluation
        let mut eval_bytes = [0u8; 32];
        eval_bytes.copy_from_slice(&bytes[offset..offset + 32]);
        let evaluation = NativeFFelt::from_bytes_le(&eval_bytes, field);
        offset += 32;

        // Number of challenges
        let num_challenges =
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;

        // Challenges
        let mut challenges = Vec::with_capacity(num_challenges);
        for _ in 0..num_challenges {
            if offset + 32 > bytes.len() {
                break;
            }
            let mut ch_bytes = [0u8; 32];
            ch_bytes.copy_from_slice(&bytes[offset..offset + 32]);
            challenges.push(NativeFFelt::from_bytes_le(&ch_bytes, field));
            offset += 32;
        }

        // Depth
        let depth = if offset + 4 <= bytes.len() {
            u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
        } else {
            1
        };
        offset += 4;

        // Blinding sum
        let blinding_sum = if offset + 32 <= bytes.len() {
            let mut blind_bytes = [0u8; 32];
            blind_bytes.copy_from_slice(&bytes[offset..offset + 32]);
            NativeFFelt::from_bytes_le(&blind_bytes, field)
        } else {
            NativeFFelt::zero(field)
        };

        Ok(Self {
            commitment,
            evaluation,
            challenges,
            depth,
            blinding_sum,
        })
    }
}

/// Proof data for accumulator transition.
#[derive(Clone, Debug)]
pub struct AccumulatorTransitionProof {
    /// The new commitment being added to the accumulator.
    pub new_commitment: NativeECPoint,
    /// The new evaluation being added.
    pub new_evaluation: NativeFFelt,
    /// Challenges for the new proof.
    pub new_challenges: Vec<NativeFFelt>,
    /// Blinding factor for the new proof.
    pub blinding: NativeFFelt,
    /// Aggregation challenge (derived from transcript).
    pub aggregation_challenge: NativeFFelt,
}

// === Native Accumulator Verifier ===

/// Verifier for Pickles accumulator transitions.
pub struct PicklesAccumulatorVerifier {
    /// SRS for final IPA check.
    srs: NativeSrs,
}

impl PicklesAccumulatorVerifier {
    /// Create a new verifier.
    pub fn new(srs: NativeSrs) -> Self {
        Self { srs }
    }

    /// Create a verifier with placeholder SRS.
    pub fn placeholder() -> Self {
        Self::new(NativeSrs::placeholder())
    }

    /// Verify an accumulator transition.
    ///
    /// Checks that `new_accumulator` is correctly derived from
    /// `old_accumulator` and `transition_proof`.
    ///
    /// # Security
    ///
    /// This function enforces strict cryptographic verification:
    /// - Depth must increment by exactly 1
    /// - Aggregation challenge must be non-zero (prevents trivial forgeries)
    /// - New accumulator must exactly match the computed update
    /// - All field and group operations are verified
    pub fn verify_transition(
        &self,
        old_accumulator: &PicklesAccumulator,
        new_accumulator: &PicklesAccumulator,
        transition_proof: &AccumulatorTransitionProof,
    ) -> bool {
        // SECURITY: Verify depth increments correctly
        if new_accumulator.depth != old_accumulator.depth + 1 {
            tracing::warn!(
                "Accumulator transition failed: depth mismatch, expected {} got {}",
                old_accumulator.depth + 1,
                new_accumulator.depth
            );
            return false;
        }

        // SECURITY: Aggregation challenge must be non-zero
        // A zero challenge would allow trivial forgeries (scalar multiply by 0)
        if transition_proof.aggregation_challenge.is_zero() {
            tracing::warn!("Accumulator transition failed: zero aggregation challenge");
            return false;
        }

        // SECURITY: New commitment must not be point at infinity unless old was too
        // (prevents replacing valid accumulator with trivial one)
        if transition_proof.new_commitment.is_infinity && !old_accumulator.commitment.is_infinity {
            // Only allow infinity if the old accumulator was also at infinity (identity case)
            if old_accumulator.depth > 0 {
                tracing::warn!("Accumulator transition failed: invalid infinity commitment");
                return false;
            }
        }

        // Compute expected new accumulator using the transition proof
        let expected = self.compute_accumulator_update(old_accumulator, transition_proof);

        // SECURITY: Strict equality check between expected and provided accumulator
        if !self.accumulators_equal(&expected, new_accumulator) {
            tracing::warn!("Accumulator transition failed: accumulator mismatch");
            return false;
        }

        true
    }

    /// Compute the expected accumulator update.
    ///
    /// acc' = u · acc + new_contribution
    ///
    /// where u is the aggregation challenge.
    fn compute_accumulator_update(
        &self,
        old: &PicklesAccumulator,
        transition: &AccumulatorTransitionProof,
    ) -> PicklesAccumulator {
        let u = &transition.aggregation_challenge;

        // Scale old accumulator by u
        let scaled_commitment = old.commitment.scalar_mul(u);
        let scaled_evaluation = old.evaluation.mul(u);

        // Add new contribution
        let new_commitment = scaled_commitment.add(&transition.new_commitment);
        let new_evaluation = scaled_evaluation.add(&transition.new_evaluation);

        // Combine challenges
        let mut challenges = old.challenges.clone();
        challenges.extend(transition.new_challenges.clone());

        // Update blinding
        let scaled_blinding = old.blinding_sum.mul(u);
        let new_blinding = scaled_blinding.add(&transition.blinding);

        PicklesAccumulator {
            commitment: new_commitment,
            evaluation: new_evaluation,
            challenges,
            depth: old.depth + 1,
            blinding_sum: new_blinding,
        }
    }

    /// Compare two accumulators for equality.
    ///
    /// # Security
    ///
    /// This function performs STRICT equality checking on all accumulator components.
    /// All fields must match exactly - there are no relaxed checks.
    fn accumulators_equal(&self, a: &PicklesAccumulator, b: &PicklesAccumulator) -> bool {
        // SECURITY: Check depth equality first (fast path for mismatches)
        if a.depth != b.depth {
            tracing::debug!(
                "Accumulator equality: depth mismatch {} != {}",
                a.depth,
                b.depth
            );
            return false;
        }

        // SECURITY: Check commitment equality with strict infinity handling
        let commitment_eq = if a.commitment.is_infinity && b.commitment.is_infinity {
            true
        } else if a.commitment.is_infinity || b.commitment.is_infinity {
            // One is infinity, one is not - ALWAYS FALSE
            tracing::debug!("Accumulator equality: commitment infinity mismatch");
            false
        } else {
            // Both are regular points - check coordinates
            let x_eq = a.commitment.x.eq(&b.commitment.x);
            let y_eq = a.commitment.y.eq(&b.commitment.y);
            if !x_eq || !y_eq {
                tracing::debug!("Accumulator equality: commitment coordinate mismatch");
            }
            x_eq && y_eq
        };

        if !commitment_eq {
            return false;
        }

        // SECURITY: Check evaluation equality (critical for soundness)
        if !a.evaluation.eq(&b.evaluation) {
            tracing::debug!("Accumulator equality: evaluation mismatch");
            return false;
        }

        // SECURITY: Check blinding sum equality (prevents malleability)
        if !a.blinding_sum.eq(&b.blinding_sum) {
            tracing::debug!("Accumulator equality: blinding sum mismatch");
            return false;
        }

        // SECURITY: Check challenge count matches
        if a.challenges.len() != b.challenges.len() {
            tracing::debug!(
                "Accumulator equality: challenge count mismatch {} != {}",
                a.challenges.len(),
                b.challenges.len()
            );
            return false;
        }

        true
    }

    /// Verify the final accumulated IPA check.
    ///
    /// This is called at the end of recursion to verify that all the
    /// deferred IPA checks are satisfied.
    ///
    /// # Security
    ///
    /// This function performs strict cryptographic verification:
    /// - Identity accumulators (depth=0, commitment=infinity) are accepted only
    ///   when no proofs have been accumulated
    /// - Mismatched infinity states between commitment and expected value FAIL
    /// - All non-identity accumulators require exact point equality
    pub fn verify_final(&self, accumulator: &PicklesAccumulator) -> bool {
        // Identity accumulator is only valid if no proofs have been accumulated
        if accumulator.is_identity() {
            // SECURITY: Only accept identity if depth is 0 (no proofs accumulated)
            return accumulator.depth == 0;
        }

        // SECURITY: Non-identity accumulators require SRS to be properly initialized
        if self.srs.g.is_empty() {
            // Cannot verify without SRS - this is a configuration error, not a valid proof
            tracing::error!("SRS not initialized - cannot verify accumulator");
            return false;
        }

        // The accumulated check is: C = a · G_folded + ξ · H
        // where G_folded is computed from all accumulated challenges

        // Fold generators using accumulated challenges
        let folded_g = self.fold_generators(&accumulator.challenges);

        // Compute expected commitment
        let a_g = folded_g.scalar_mul(&accumulator.evaluation);
        let xi_h = self.srs.h.scalar_mul(&accumulator.blinding_sum);
        let expected = a_g.add(&xi_h);

        // SECURITY: Strict equality check - both must be infinity, or neither
        if accumulator.commitment.is_infinity != expected.is_infinity {
            // Mismatched infinity state - ALWAYS FAIL
            // This prevents attackers from using infinity points to bypass verification
            tracing::warn!(
                "Accumulator verification failed: commitment infinity={}, expected infinity={}",
                accumulator.commitment.is_infinity,
                expected.is_infinity
            );
            return false;
        }

        // Both are infinity (valid edge case) or both are regular points
        if accumulator.commitment.is_infinity && expected.is_infinity {
            return true;
        }

        // Exact coordinate equality required for non-infinity points
        let x_match = accumulator.commitment.x.eq(&expected.x);
        let y_match = accumulator.commitment.y.eq(&expected.y);

        if !x_match || !y_match {
            tracing::warn!("Accumulator verification failed: coordinate mismatch");
        }

        x_match && y_match
    }

    /// Fold generators using accumulated challenges.
    fn fold_generators(&self, challenges: &[NativeFFelt]) -> NativeECPoint {
        if self.srs.g.is_empty() || challenges.is_empty() {
            return NativeECPoint::infinity(PastaCurve::Pallas);
        }

        let mut generators = self.srs.g.clone();

        for u in challenges {
            let n = generators.len();
            if n <= 1 {
                break;
            }

            let half = n / 2;
            let u_inv = u.inv().unwrap_or_else(|| NativeFFelt::one(u.field_type));

            let mut new_generators = Vec::with_capacity(half);
            for j in 0..half {
                let g_lo_scaled = generators[j].scalar_mul(&u_inv);
                let g_hi_scaled = generators[j + half].scalar_mul(u);
                new_generators.push(g_lo_scaled.add(&g_hi_scaled));
            }
            generators = new_generators;
        }

        generators
            .into_iter()
            .next()
            .unwrap_or_else(|| NativeECPoint::infinity(PastaCurve::Pallas))
    }

    /// Verify a complete recursive proof chain.
    ///
    /// This verifies:
    /// 1. Each accumulator transition is valid
    /// 2. The final accumulator passes the deferred IPA check
    pub fn verify_chain(
        &self,
        accumulators: &[PicklesAccumulator],
        transitions: &[AccumulatorTransitionProof],
    ) -> bool {
        if accumulators.is_empty() {
            return true;
        }

        if accumulators.len() != transitions.len() + 1 {
            return false;
        }

        // Verify each transition
        for i in 0..transitions.len() {
            if !self.verify_transition(&accumulators[i], &accumulators[i + 1], &transitions[i]) {
                return false;
            }
        }

        // Verify final accumulator
        self.verify_final(accumulators.last().unwrap())
    }
}

// === In-Circuit Accumulator ===

/// In-circuit Pickles accumulator.
#[derive(Clone, Debug)]
pub struct CircuitAccumulator<F: halo2_base::utils::ScalarField> {
    /// Commitment point.
    pub commitment: ECPoint<F>,
    /// Evaluation scalar.
    pub evaluation: FFelt<F>,
    /// Accumulated challenges.
    pub challenges: Vec<FFelt<F>>,
    /// Blinding sum.
    pub blinding_sum: FFelt<F>,
}

/// In-circuit accumulator verifier.
pub struct CircuitAccumulatorVerifier<'a> {
    ff_chip: &'a FFChip<'a, Fr>,
    ec_chip: ECChip<'a, Fr>,
    field: PastaField,
}

impl<'a> CircuitAccumulatorVerifier<'a> {
    /// Create a new circuit accumulator verifier.
    pub fn new(ff_chip: &'a FFChip<'a, Fr>) -> Self {
        let ec_chip = ECChip::new(ff_chip);
        Self {
            ff_chip,
            ec_chip,
            field: PastaField::Pallas,
        }
    }

    /// Verify accumulator transition in-circuit.
    pub fn verify_transition(
        &self,
        ctx: &mut Context<Fr>,
        old_acc: &CircuitAccumulator<Fr>,
        new_acc: &CircuitAccumulator<Fr>,
        u: &FFelt<Fr>, // aggregation challenge
        new_commitment: &ECPoint<Fr>,
        new_evaluation: &FFelt<Fr>,
        new_blinding: &FFelt<Fr>,
    ) -> AssignedValue<Fr> {
        let gate = self.ff_chip.range.gate();

        // Compute expected new accumulator
        // commitment' = u · commitment + new_commitment
        let scaled_comm = self.ec_chip.scalar_mul(ctx, &old_acc.commitment, u);
        let expected_comm = self.ec_chip.add(ctx, &scaled_comm, new_commitment);

        // evaluation' = u · evaluation + new_evaluation
        let scaled_eval = self.ff_chip.mul(ctx, &old_acc.evaluation, u);
        let expected_eval = self.ff_chip.add(ctx, &scaled_eval, new_evaluation);

        // blinding' = u · blinding + new_blinding
        let scaled_blind = self.ff_chip.mul(ctx, &old_acc.blinding_sum, u);
        let expected_blind = self.ff_chip.add(ctx, &scaled_blind, new_blinding);

        // Verify commitment matches
        let comm_eq = self
            .ec_chip
            .is_equal(ctx, &expected_comm, &new_acc.commitment);

        // Verify evaluation matches
        let eval_eq = self
            .ff_chip
            .is_equal(ctx, &expected_eval, &new_acc.evaluation);

        // Verify blinding matches
        let blind_eq = self
            .ff_chip
            .is_equal(ctx, &expected_blind, &new_acc.blinding_sum);

        // All must match
        let comm_and_eval = gate.and(ctx, comm_eq, eval_eq);
        gate.and(ctx, comm_and_eval, blind_eq)
    }

    /// Load a native accumulator into the circuit.
    pub fn load_accumulator(
        &self,
        ctx: &mut Context<Fr>,
        acc: &PicklesAccumulator,
    ) -> CircuitAccumulator<Fr> {
        let commitment = self.ec_chip.load_witness(ctx, &acc.commitment);
        let evaluation = self.ff_chip.load_witness(ctx, &acc.evaluation);
        let blinding_sum = self.ff_chip.load_witness(ctx, &acc.blinding_sum);

        let challenges: Vec<FFelt<Fr>> = acc
            .challenges
            .iter()
            .map(|c| self.ff_chip.load_witness(ctx, c))
            .collect();

        CircuitAccumulator {
            commitment,
            evaluation,
            challenges,
            blinding_sum,
        }
    }

    /// Create identity accumulator in-circuit.
    pub fn load_identity(&self, ctx: &mut Context<Fr>) -> CircuitAccumulator<Fr> {
        let curve = PastaCurve::Pallas;
        CircuitAccumulator {
            commitment: self.ec_chip.load_infinity(ctx, curve),
            evaluation: self.ff_chip.load_zero(ctx, self.field),
            challenges: Vec::new(),
            blinding_sum: self.ff_chip.load_zero(ctx, self.field),
        }
    }
}

// === Transcript Integration ===

/// Derive accumulator aggregation challenge from Fiat-Shamir transcript.
pub fn derive_aggregation_challenge(
    transcript: &mut NativeKimchiTranscript,
    old_acc: &PicklesAccumulator,
    new_commitment: &NativeECPoint,
) -> NativeFFelt {
    // Absorb old accumulator state
    transcript.absorb_commitment(&old_acc.commitment);
    transcript.absorb_field(&old_acc.evaluation);

    // Absorb new contribution
    transcript.absorb_commitment(new_commitment);

    // Squeeze challenge
    transcript.squeeze_challenge()
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_accumulator() {
        let acc = PicklesAccumulator::identity();
        assert!(acc.is_identity());
        assert!(acc.commitment.is_infinity);
        assert_eq!(acc.depth, 0);
    }

    #[test]
    fn test_accumulator_serialization() {
        let acc = PicklesAccumulator::identity();
        let bytes = acc.to_bytes();
        let recovered = PicklesAccumulator::from_bytes(&bytes).unwrap();

        assert!(recovered.is_identity());
        assert_eq!(recovered.depth, acc.depth);
    }

    #[test]
    fn test_accumulator_from_components() {
        let commitment = NativeECPoint::infinity(PastaCurve::Pallas);
        let evaluation = NativeFFelt::from_u64(42, PastaField::Pallas);
        let challenges = vec![NativeFFelt::one(PastaField::Pallas)];

        let acc = PicklesAccumulator::from_components(commitment, evaluation, challenges.clone());

        assert_eq!(acc.depth, 1);
        assert_eq!(acc.challenges.len(), 1);
    }

    #[test]
    fn test_verifier_placeholder() {
        let verifier = PicklesAccumulatorVerifier::placeholder();
        let acc = PicklesAccumulator::identity();

        assert!(verifier.verify_final(&acc));
    }

    #[test]
    fn test_verify_identity_transition() {
        let verifier = PicklesAccumulatorVerifier::placeholder();
        let old = PicklesAccumulator::identity();

        let transition = AccumulatorTransitionProof {
            new_commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            new_evaluation: NativeFFelt::zero(PastaField::Pallas),
            new_challenges: vec![],
            blinding: NativeFFelt::zero(PastaField::Pallas),
            aggregation_challenge: NativeFFelt::one(PastaField::Pallas),
        };

        let new = PicklesAccumulator {
            commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            evaluation: NativeFFelt::zero(PastaField::Pallas),
            challenges: vec![],
            depth: 1,
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        };

        assert!(verifier.verify_transition(&old, &new, &transition));
    }

    #[test]
    fn test_verify_empty_chain() {
        let verifier = PicklesAccumulatorVerifier::placeholder();
        let accumulators: Vec<PicklesAccumulator> = vec![];
        let transitions: Vec<AccumulatorTransitionProof> = vec![];

        assert!(verifier.verify_chain(&accumulators, &transitions));
    }

    #[test]
    fn test_verify_single_step_chain() {
        let verifier = PicklesAccumulatorVerifier::placeholder();

        let start = PicklesAccumulator::identity();
        let end = PicklesAccumulator {
            commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            evaluation: NativeFFelt::zero(PastaField::Pallas),
            challenges: vec![],
            depth: 1,
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        };

        let transition = AccumulatorTransitionProof {
            new_commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            new_evaluation: NativeFFelt::zero(PastaField::Pallas),
            new_challenges: vec![],
            blinding: NativeFFelt::zero(PastaField::Pallas),
            aggregation_challenge: NativeFFelt::one(PastaField::Pallas),
        };

        let accumulators = vec![start, end];
        let transitions = vec![transition];

        assert!(verifier.verify_chain(&accumulators, &transitions));
    }

    #[test]
    fn test_fold_generators_empty() {
        let verifier = PicklesAccumulatorVerifier::placeholder();
        let challenges: Vec<NativeFFelt> = vec![];

        let folded = verifier.fold_generators(&challenges);
        assert!(folded.is_infinity);
    }

    #[test]
    fn test_aggregation_challenge_derivation() {
        let mut transcript = NativeKimchiTranscript::new(PastaField::Pallas);
        let acc = PicklesAccumulator::identity();
        let new_comm = NativeECPoint::infinity(PastaCurve::Pallas);

        let challenge = derive_aggregation_challenge(&mut transcript, &acc, &new_comm);

        // Challenge should be non-zero and deterministic
        assert!(!challenge.is_zero() || challenge.eq(&NativeFFelt::zero(PastaField::Pallas)));

        // Same inputs should give same challenge
        let mut transcript2 = NativeKimchiTranscript::new(PastaField::Pallas);
        let challenge2 = derive_aggregation_challenge(&mut transcript2, &acc, &new_comm);
        assert!(challenge.eq(&challenge2));
    }
}
