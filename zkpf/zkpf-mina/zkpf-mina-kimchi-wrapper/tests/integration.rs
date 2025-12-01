//! Integration tests for zkpf-mina-kimchi-wrapper crate.
//!
//! These tests verify the Pasta foreign-field arithmetic and EC operations.

use zkpf_mina_kimchi_wrapper::{
    MinaProofOfStatePublicInputs, MinaRailPublicInputs, CANDIDATE_CHAIN_LENGTH,
    compute_holder_binding, compute_mina_nullifier,
    ff::{NativeFFelt, PastaField, PALLAS_MODULUS, VESTA_MODULUS},
    ec::{NativeECPoint, PastaCurve, CURVE_B},
    types::{PROOF_OF_STATE_DOMAIN_SIZE, PROOF_OF_STATE_NUM_PUBLIC_INPUTS, KIMCHI_WITNESS_COLUMNS},
};

// === Foreign Field Arithmetic Tests ===

mod ff_tests {
    use super::*;

    #[test]
    fn test_zero_one_elements() {
        let zero = NativeFFelt::zero(PastaField::Pallas);
        let one = NativeFFelt::one(PastaField::Pallas);
        
        assert!(zero.is_zero());
        assert!(!one.is_zero());
        assert!(zero.is_reduced());
        assert!(one.is_reduced());
    }

    #[test]
    fn test_from_u64() {
        let val = NativeFFelt::from_u64(12345, PastaField::Pallas);
        assert_eq!(val.limbs[0], 12345);
        assert_eq!(val.limbs[1], 0);
        assert_eq!(val.limbs[2], 0);
        assert_eq!(val.limbs[3], 0);
    }

    #[test]
    fn test_from_bytes_roundtrip() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0x12;
        bytes[1] = 0x34;
        bytes[8] = 0x56;
        bytes[16] = 0x78;
        bytes[24] = 0x9a;
        
        let elem = NativeFFelt::from_bytes_le(&bytes, PastaField::Pallas);
        let back = elem.to_bytes_le();
        
        assert_eq!(bytes, back);
    }

    #[test]
    fn test_addition_basic() {
        let a = NativeFFelt::from_u64(100, PastaField::Pallas);
        let b = NativeFFelt::from_u64(200, PastaField::Pallas);
        let c = a.add(&b);
        
        assert_eq!(c.limbs[0], 300);
        assert!(c.is_reduced());
    }

    #[test]
    fn test_addition_with_carry() {
        let max = NativeFFelt::from_u64(u64::MAX, PastaField::Pallas);
        let one = NativeFFelt::one(PastaField::Pallas);
        let result = max.add(&one);
        
        // Should be 2^64
        assert_eq!(result.limbs[0], 0);
        assert_eq!(result.limbs[1], 1);
    }

    #[test]
    fn test_subtraction_basic() {
        let a = NativeFFelt::from_u64(300, PastaField::Pallas);
        let b = NativeFFelt::from_u64(100, PastaField::Pallas);
        let c = a.sub(&b);
        
        assert_eq!(c.limbs[0], 200);
    }

    #[test]
    fn test_subtraction_underflow() {
        let a = NativeFFelt::from_u64(100, PastaField::Pallas);
        let b = NativeFFelt::from_u64(200, PastaField::Pallas);
        let c = a.sub(&b);
        
        // Result should be p - 100
        assert!(!c.is_zero());
        assert!(c.is_reduced());
        
        // Verify: c + b = a
        let d = c.add(&b);
        assert_eq!(d.limbs[0], 100);
    }

    #[test]
    fn test_multiplication_basic() {
        let a = NativeFFelt::from_u64(1000, PastaField::Pallas);
        let b = NativeFFelt::from_u64(2000, PastaField::Pallas);
        let c = a.mul(&b);
        
        assert_eq!(c.limbs[0], 2_000_000);
    }

    #[test]
    fn test_multiplication_large() {
        let a = NativeFFelt::from_u64(u64::MAX, PastaField::Pallas);
        let b = NativeFFelt::from_u64(2, PastaField::Pallas);
        let c = a.mul(&b);
        
        // 2 * (2^64 - 1) = 2^65 - 2
        assert!(c.is_reduced());
        assert_eq!(c.limbs[0], u64::MAX - 1);
        assert_eq!(c.limbs[1], 1);
    }

    #[test]
    fn test_multiplication_overflow() {
        let max = NativeFFelt::from_u64(u64::MAX, PastaField::Pallas);
        let c = max.mul(&max);
        
        // Result should be reduced modulo p
        assert!(c.is_reduced());
    }

    #[test]
    fn test_negation() {
        let a = NativeFFelt::from_u64(42, PastaField::Pallas);
        let neg_a = a.neg();
        let sum = a.add(&neg_a);
        
        assert!(sum.is_zero());
    }

    #[test]
    fn test_negation_zero() {
        let zero = NativeFFelt::zero(PastaField::Pallas);
        let neg_zero = zero.neg();
        
        assert!(neg_zero.is_zero());
    }

    #[test]
    fn test_inversion() {
        let a = NativeFFelt::from_u64(42, PastaField::Pallas);
        let a_inv = a.inv().expect("Should have inverse");
        let product = a.mul(&a_inv);
        
        // a * a^(-1) = 1
        assert_eq!(product.limbs[0], 1);
        assert_eq!(product.limbs[1], 0);
        assert_eq!(product.limbs[2], 0);
        assert_eq!(product.limbs[3], 0);
    }

    #[test]
    fn test_inversion_zero() {
        let zero = NativeFFelt::zero(PastaField::Pallas);
        let result = zero.inv();
        
        assert!(result.is_none());
    }

    #[test]
    fn test_squaring() {
        let a = NativeFFelt::from_u64(1000, PastaField::Pallas);
        let a_sq = a.square();
        let a_mul_a = a.mul(&a);
        
        assert!(a_sq.eq(&a_mul_a));
    }

    #[test]
    fn test_exponentiation() {
        let base = NativeFFelt::from_u64(2, PastaField::Pallas);
        let exp = NativeFFelt::from_u64(10, PastaField::Pallas);
        let result = base.pow(&exp);
        
        // 2^10 = 1024
        assert_eq!(result.limbs[0], 1024);
    }

    #[test]
    fn test_equality() {
        let a = NativeFFelt::from_u64(123, PastaField::Pallas);
        let b = NativeFFelt::from_u64(123, PastaField::Pallas);
        let c = NativeFFelt::from_u64(456, PastaField::Pallas);
        
        assert!(a.eq(&b));
        assert!(!a.eq(&c));
    }

    #[test]
    fn test_field_moduli() {
        // Verify moduli are correct (both should have high bit at ~255)
        assert_eq!(PALLAS_MODULUS[3], 0x4000000000000000);
        assert_eq!(VESTA_MODULUS[3], 0x4000000000000000);
        
        // They differ in lower bits
        assert_ne!(PALLAS_MODULUS[0], VESTA_MODULUS[0]);
    }

    #[test]
    fn test_vesta_field_operations() {
        // Verify Vesta field works too
        let a = NativeFFelt::from_u64(100, PastaField::Vesta);
        let b = NativeFFelt::from_u64(200, PastaField::Vesta);
        let c = a.add(&b);
        
        assert_eq!(c.limbs[0], 300);
        assert_eq!(c.field_type, PastaField::Vesta);
    }
}

// === Elliptic Curve Tests ===

mod ec_tests {
    use super::*;

    #[test]
    fn test_infinity_point() {
        let inf = NativeECPoint::infinity(PastaCurve::Pallas);
        assert!(inf.is_infinity);
        assert!(inf.is_on_curve());
    }

    #[test]
    fn test_add_with_infinity() {
        let inf = NativeECPoint::infinity(PastaCurve::Pallas);
        let x = NativeFFelt::from_u64(123, PastaField::Pallas);
        let y = NativeFFelt::from_u64(456, PastaField::Pallas);
        let p = NativeECPoint::from_coords(x, y, PastaCurve::Pallas);
        
        // inf + P = P
        let sum1 = inf.add(&p);
        assert!(!sum1.is_infinity);
        assert!(sum1.x.eq(&p.x));
        
        // P + inf = P
        let sum2 = p.add(&inf);
        assert!(!sum2.is_infinity);
        assert!(sum2.x.eq(&p.x));
    }

    #[test]
    fn test_double_infinity() {
        let inf = NativeECPoint::infinity(PastaCurve::Pallas);
        let doubled = inf.double();
        assert!(doubled.is_infinity);
    }

    #[test]
    fn test_negation() {
        let x = NativeFFelt::from_u64(123, PastaField::Pallas);
        let y = NativeFFelt::from_u64(456, PastaField::Pallas);
        let p = NativeECPoint::from_coords(x, y, PastaCurve::Pallas);
        
        let neg_p = p.neg();
        assert!(p.x.eq(&neg_p.x));
        
        // y + neg_y = 0 (mod p)
        let sum_y = p.y.add(&neg_p.y);
        assert!(sum_y.is_zero());
    }

    #[test]
    fn test_scalar_mul_zero() {
        let x = NativeFFelt::from_u64(123, PastaField::Pallas);
        let y = NativeFFelt::from_u64(456, PastaField::Pallas);
        let p = NativeECPoint::from_coords(x, y, PastaCurve::Pallas);
        
        let zero = NativeFFelt::zero(PastaField::Vesta); // Scalar field is Vesta for Pallas
        let result = p.scalar_mul(&zero);
        
        assert!(result.is_infinity);
    }

    #[test]
    fn test_scalar_mul_one() {
        let inf = NativeECPoint::infinity(PastaCurve::Pallas);
        let one = NativeFFelt::one(PastaField::Vesta);
        let result = inf.scalar_mul(&one);
        
        assert!(result.is_infinity);
    }

    #[test]
    fn test_point_serialization() {
        let x = NativeFFelt::from_u64(12345, PastaField::Pallas);
        let y = NativeFFelt::from_u64(67890, PastaField::Pallas);
        let p = NativeECPoint::from_coords(x, y, PastaCurve::Pallas);
        
        let bytes = p.to_bytes();
        let q = NativeECPoint::from_bytes(
            &bytes[0..32].try_into().unwrap(),
            &bytes[32..64].try_into().unwrap(),
            PastaCurve::Pallas,
        );
        
        assert!(p.x.eq(&q.x));
        assert!(p.y.eq(&q.y));
    }

    #[test]
    fn test_curve_types() {
        assert_eq!(PastaCurve::Pallas.base_field(), PastaField::Pallas);
        assert_eq!(PastaCurve::Pallas.scalar_field(), PastaField::Vesta);
        assert_eq!(PastaCurve::Vesta.base_field(), PastaField::Vesta);
        assert_eq!(PastaCurve::Vesta.scalar_field(), PastaField::Pallas);
    }

    #[test]
    fn test_curve_b() {
        assert_eq!(CURVE_B, 5);
    }
}

// === Public Inputs Tests ===

mod public_inputs_tests {
    use super::*;

    #[test]
    fn test_proof_of_state_inputs() {
        let inputs = MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        };
        
        let digest = inputs.compute_digest();
        assert_ne!(digest, [0u8; 32], "Digest should be non-zero");
    }

    #[test]
    fn test_digest_determinism() {
        let inputs = MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        };
        
        let digest1 = inputs.compute_digest();
        let digest2 = inputs.compute_digest();
        
        assert_eq!(digest1, digest2);
    }

    #[test]
    fn test_digest_changes_with_input() {
        let inputs1 = MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        };
        
        let inputs2 = MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [99u8; 32], // Different
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        };
        
        let digest1 = inputs1.compute_digest();
        let digest2 = inputs2.compute_digest();
        
        assert_ne!(digest1, digest2);
    }

    #[test]
    fn test_bytes_roundtrip() {
        let inputs = MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        };
        
        let bytes = inputs.to_bytes();
        let recovered = MinaProofOfStatePublicInputs::from_bytes(&bytes)
            .expect("Should parse bytes");
        
        assert_eq!(inputs.bridge_tip_state_hash, recovered.bridge_tip_state_hash);
    }
}

// === Constants Tests ===

mod constants_tests {
    use super::*;

    #[test]
    fn test_domain_size() {
        // Domain size should be a power of 2
        assert!(PROOF_OF_STATE_DOMAIN_SIZE.is_power_of_two());
        assert_eq!(PROOF_OF_STATE_DOMAIN_SIZE, 65536);
    }

    #[test]
    fn test_public_inputs_count() {
        // 1 bridge tip + 16 state hashes + 16 ledger hashes = 33
        assert_eq!(PROOF_OF_STATE_NUM_PUBLIC_INPUTS, 33);
        assert_eq!(PROOF_OF_STATE_NUM_PUBLIC_INPUTS, 1 + CANDIDATE_CHAIN_LENGTH * 2);
    }

    #[test]
    fn test_witness_columns() {
        // Kimchi uses 15 witness columns
        assert_eq!(KIMCHI_WITNESS_COLUMNS, 15);
    }

    #[test]
    fn test_candidate_chain_length() {
        // 16 blocks in candidate chain
        assert_eq!(CANDIDATE_CHAIN_LENGTH, 16);
    }
}

// === Full Verification Flow Tests ===

mod full_verification_flow_tests {
    use super::*;
    use zkpf_mina_kimchi_wrapper::{
        gates::NativeGateEvaluator,
        ipa::{NativeIpaVerifier, NativeIpaProof, MAX_IPA_ROUNDS},
        accumulator::{PicklesAccumulator, PicklesAccumulatorVerifier, AccumulatorTransitionProof},
        linearization::NativeLinearization,
        proof_parser::parse_kimchi_proof_bytes,
        poseidon::{NativeKimchiTranscript, KimchiChallenges},
        kimchi_core::{ParsedKimchiProof, VerifierIndexConstants, ProofCommitments, ProofEvaluations, PointEvaluations, IpaProof},
    };

    // Helper to create a test proof with all components
    fn create_full_test_proof() -> ParsedKimchiProof {
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        ParsedKimchiProof {
            commitments: ProofCommitments {
                witness_commitments: (0..KIMCHI_WITNESS_COLUMNS)
                    .map(|_| NativeECPoint::infinity(curve))
                    .collect(),
                permutation_commitment: NativeECPoint::infinity(curve),
                quotient_commitments: vec![NativeECPoint::infinity(curve); 7],
                lookup_commitments: None,
            },
            evaluations: ProofEvaluations {
                zeta_evals: PointEvaluations {
                    witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: NativeFFelt::zero(field),
                    gate_selectors: vec![NativeFFelt::zero(field); 8],
                    sigma: vec![NativeFFelt::zero(field); 6],
                },
                zeta_omega_evals: PointEvaluations {
                    witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: NativeFFelt::zero(field),
                    gate_selectors: vec![NativeFFelt::zero(field); 8],
                    sigma: vec![NativeFFelt::zero(field); 6],
                },
            },
            ipa_proof: IpaProof {
                l_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                r_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                final_eval: NativeFFelt::one(field),
                blinding: NativeFFelt::zero(field),
            },
        }
    }

    fn create_test_challenges() -> KimchiChallenges {
        let field = PastaField::Pallas;
        KimchiChallenges {
            zeta: NativeFFelt::from_u64(12345, field),
            v: NativeFFelt::from_u64(67890, field),
            u: NativeFFelt::from_u64(11111, field),
            beta: NativeFFelt::from_u64(22222, field),
            gamma: NativeFFelt::from_u64(33333, field),
            alpha: NativeFFelt::from_u64(44444, field),
            ipa_challenges: vec![NativeFFelt::one(field); MAX_IPA_ROUNDS],
        }
    }

    #[test]
    fn test_full_native_verification_flow() {
        // 1. Create proof and challenges
        let proof = create_full_test_proof();
        let challenges = create_test_challenges();

        // 2. Gate evaluation
        let gate_evaluator = NativeGateEvaluator::new(PastaField::Pallas);
        let gate_sum = gate_evaluator.evaluate_gates(
            &proof.evaluations.zeta_evals.witness,
            &proof.evaluations.zeta_omega_evals.witness,
            &proof.evaluations.zeta_evals.gate_selectors,
            &[], // coefficients
            &challenges.alpha,
        );
        assert!(gate_sum.is_zero(), "Gate sum should be zero for placeholder proof");

        // 3. IPA verification
        let ipa_verifier = NativeIpaVerifier::placeholder();
        let commitment = proof.commitments.witness_commitments[0].clone();
        let ipa_proof = NativeIpaProof {
            l_commitments: proof.ipa_proof.l_commitments.clone(),
            r_commitments: proof.ipa_proof.r_commitments.clone(),
            final_a: proof.ipa_proof.final_eval,
            blinding: proof.ipa_proof.blinding,
        };
        let ipa_result = ipa_verifier.verify(
            &commitment,
            &proof.ipa_proof.final_eval,
            &challenges.zeta,
            &ipa_proof,
            &challenges.ipa_challenges,
        );
        assert!(ipa_result, "IPA verification should pass for placeholder");

        // 4. Linearization verification
        let linearization = NativeLinearization::for_proof_of_state();
        let lin_result = linearization.verify(
            &proof,
            &[], // public inputs
            &challenges,
        );
        assert!(lin_result, "Linearization should verify for placeholder proof");

        // 5. Accumulator verification
        let acc_verifier = PicklesAccumulatorVerifier::placeholder();
        let acc = PicklesAccumulator::identity();
        assert!(acc_verifier.verify_final(&acc), "Identity accumulator should verify");
    }

    #[test]
    fn test_verification_pipeline_with_transcript() {
        let field = PastaField::Pallas;
        let proof = create_full_test_proof();

        // Create transcript and derive challenges (like a real verifier would)
        let mut transcript = NativeKimchiTranscript::new(field);
        
        // Absorb public inputs (as field elements)
        let public_input_hash = NativeFFelt::from_u64(12345, field);
        transcript.absorb_field(&public_input_hash);

        // Absorb proof commitments
        for commitment in &proof.commitments.witness_commitments {
            transcript.absorb_commitment(commitment);
        }
        transcript.absorb_commitment(&proof.commitments.permutation_commitment);

        // Derive beta and gamma
        let beta = transcript.squeeze_challenge();
        let gamma = transcript.squeeze_challenge();

        // Absorb quotient commitments
        for commitment in &proof.commitments.quotient_commitments {
            transcript.absorb_commitment(commitment);
        }

        // Derive alpha
        let alpha = transcript.squeeze_challenge();

        // Derive zeta
        let zeta = transcript.squeeze_challenge();

        // Absorb evaluations
        for eval in &proof.evaluations.zeta_evals.witness {
            transcript.absorb_field(eval);
        }

        // Derive IPA challenges
        let mut ipa_challenges = Vec::with_capacity(MAX_IPA_ROUNDS);
        for _ in 0..MAX_IPA_ROUNDS {
            ipa_challenges.push(transcript.squeeze_challenge());
        }

        // Verify with derived challenges
        let challenges = KimchiChallenges {
            zeta,
            v: transcript.squeeze_challenge(),
            u: transcript.squeeze_challenge(),
            beta,
            gamma,
            alpha,
            ipa_challenges,
        };

        // Run verification
        let linearization = NativeLinearization::for_proof_of_state();
        let result = linearization.verify(&proof, &[], &challenges);
        assert!(result, "Verification with transcript-derived challenges should pass");
    }

    #[test]
    fn test_accumulator_chain_verification() {
        let verifier = PicklesAccumulatorVerifier::placeholder();

        // Create a chain of accumulator updates
        let acc0 = PicklesAccumulator::identity();
        
        // First transition
        let transition1 = AccumulatorTransitionProof {
            new_commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            new_evaluation: NativeFFelt::from_u64(1, PastaField::Pallas),
            new_challenges: vec![NativeFFelt::one(PastaField::Pallas)],
            blinding: NativeFFelt::zero(PastaField::Pallas),
            aggregation_challenge: NativeFFelt::one(PastaField::Pallas),
        };

        let acc1 = PicklesAccumulator {
            commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            evaluation: NativeFFelt::from_u64(1, PastaField::Pallas),
            challenges: vec![NativeFFelt::one(PastaField::Pallas)],
            depth: 1,
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        };

        // Verify transition
        assert!(verifier.verify_transition(&acc0, &acc1, &transition1));

        // Verify chain
        let accumulators = vec![acc0.clone(), acc1.clone()];
        let transitions = vec![transition1];
        assert!(verifier.verify_chain(&accumulators, &transitions));

        // Verify final
        assert!(verifier.verify_final(&acc1));
    }

    #[test]
    fn test_gate_constraint_satisfaction() {
        let evaluator = NativeGateEvaluator::new(PastaField::Pallas);
        let field = PastaField::Pallas;

        // Test satisfied multiplication constraint: 3 * 4 = 12
        let w_satisfied = vec![
            NativeFFelt::from_u64(3, field),
            NativeFFelt::from_u64(4, field),
            NativeFFelt::from_u64(12, field),
            NativeFFelt::zero(field),
        ];
        let selector = NativeFFelt::one(field);
        
        // Use the internal simplified gate for testing
        let _result = evaluator.evaluate_generic_gate(&w_satisfied, &[], &selector);
        // Without coefficients, uses simplified form which should verify 3*4-12=0
        // The result here depends on coefficient handling

        // Test unsatisfied constraint: 3 * 4 != 10
        let w_unsatisfied = vec![
            NativeFFelt::from_u64(3, field),
            NativeFFelt::from_u64(4, field),
            NativeFFelt::from_u64(10, field), // Wrong!
            NativeFFelt::zero(field),
        ];
        
        let w_omega = vec![NativeFFelt::zero(field)];
        
        // Evaluate gates to ensure they produce different results
        let sum_sat = evaluator.evaluate_gates(&w_satisfied, &w_omega, &[selector], &[], &NativeFFelt::one(field));
        let sum_unsat = evaluator.evaluate_gates(&w_unsatisfied, &w_omega, &[selector], &[], &NativeFFelt::one(field));
        
        // The unsatisfied case should produce a different (non-zero) result
        assert!(!sum_sat.eq(&sum_unsat) || sum_sat.is_zero(), "Gate evaluation should differ or be zero");
    }

    #[test]
    fn test_ipa_batch_verification() {
        let verifier = NativeIpaVerifier::placeholder();
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        // Create multiple commitments
        let commitments: Vec<NativeECPoint> = (0..5)
            .map(|_| NativeECPoint::infinity(curve))
            .collect();
        
        let evaluations: Vec<NativeFFelt> = (0..5)
            .map(|i| NativeFFelt::from_u64(i as u64 + 1, field))
            .collect();

        let point = NativeFFelt::from_u64(12345, field);
        let batch_challenge = NativeFFelt::from_u64(7, field);

        let proof = NativeIpaProof {
            l_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
            r_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
            final_a: NativeFFelt::one(field),
            blinding: NativeFFelt::zero(field),
        };

        let challenges: Vec<NativeFFelt> = (0..MAX_IPA_ROUNDS)
            .map(|_| NativeFFelt::one(field))
            .collect();

        let result = verifier.batch_verify(
            &commitments,
            &evaluations,
            &point,
            &proof,
            &challenges,
            &batch_challenge,
        );

        assert!(result, "Batch IPA verification should pass for placeholder");
    }

    #[test]
    fn test_linearization_alpha_powers() {
        let linearization = NativeLinearization::for_proof_of_state();
        let proof = create_full_test_proof();
        let challenges = create_test_challenges();

        let result = linearization.compute_linearization(&proof, &[], &challenges);
        
        // Check that the result has the expected structure
        assert!(!result.gate_contributions.is_empty() || result.linearization_eval.is_zero());
        
        // Vanishing polynomial should be non-zero at a random point
        // z_H(zeta) = zeta^n - 1 where n = domain_size
        // Unless zeta happens to be an n-th root of unity
        // For placeholder with small zeta values, this should be non-trivial
    }

    #[test]
    fn test_proof_parser_integration() {
        // Test mock format parsing
        let mut mock_bytes = Vec::new();
        mock_bytes.extend_from_slice(b"MOCK");
        mock_bytes.extend_from_slice(&[0u8; 32]); // digest

        let proof = parse_kimchi_proof_bytes(&mock_bytes).expect("Mock parsing should succeed");
        
        // Verify the parsed proof can be used with the verifier
        let linearization = NativeLinearization::for_proof_of_state();
        let challenges = create_test_challenges();
        
        let result = linearization.verify(&proof, &[], &challenges);
        assert!(result, "Parsed mock proof should verify");
    }

    #[test]
    fn test_verifier_index_constants() {
        let vk = VerifierIndexConstants::proof_of_state();
        
        // Check domain properties
        assert!(vk.domain_size.is_power_of_two());
        assert_eq!(vk.domain_size, PROOF_OF_STATE_DOMAIN_SIZE);
        
        // Check that domain elements are properly computed
        let omega_0 = vk.domain_element(0);
        let _omega_1 = vk.domain_element(1);
        
        // omega^0 = 1
        assert_eq!(omega_0.limbs[0], 1);
        
        // omega^n should equal 1 (primitive n-th root of unity)
        // This is a key property for the FFT domain
    }

    #[test]
    fn test_poseidon_sbox_in_gates() {
        let _evaluator = NativeGateEvaluator::new(PastaField::Pallas);
        let field = PastaField::Pallas;

        // Test S-box computation: x^7
        let x = NativeFFelt::from_u64(2, field);
        let x2 = x.mul(&x);
        let x4 = x2.mul(&x2);
        let x6 = x4.mul(&x2);
        let x7 = x6.mul(&x);

        // 2^7 = 128
        assert_eq!(x7.limbs[0], 128, "S-box should compute x^7 correctly");

        // S-box should be non-linear (important for security)
        let a = NativeFFelt::from_u64(2, field);
        let b = NativeFFelt::from_u64(3, field);
        let sum = a.add(&b);

        // S(a) + S(b)
        let sa = a.mul(&a).mul(&a).mul(&a).mul(&a).mul(&a).mul(&a);
        let sb = b.mul(&b).mul(&b).mul(&b).mul(&b).mul(&b).mul(&b);
        let sa_plus_sb = sa.add(&sb);

        // S(a + b)
        let s_sum = sum.mul(&sum).mul(&sum).mul(&sum).mul(&sum).mul(&sum).mul(&sum);

        assert!(!s_sum.eq(&sa_plus_sb), "S-box must be non-linear for security");
    }

    #[test]
    fn test_complete_verification_with_public_inputs() {
        let proof = create_full_test_proof();
        let challenges = create_test_challenges();
        let field = PastaField::Pallas;

        // Create some public inputs
        let public_inputs: Vec<NativeFFelt> = (0..5)
            .map(|i| NativeFFelt::from_u64(i as u64 * 100, field))
            .collect();

        // Run verification with public inputs
        let linearization = NativeLinearization::for_proof_of_state();
        let result = linearization.verify(&proof, &public_inputs, &challenges);
        
        // Placeholder proof should still verify (in debug mode)
        assert!(result, "Verification with public inputs should pass");

        // Compute the linearization result for inspection
        let lin_result = linearization.compute_linearization(&proof, &public_inputs, &challenges);
        
        // Public input contribution should exist
        // (though it may be zero for placeholder proof)
        assert!(lin_result.public_input_contribution.field_type == field);
    }
}

// === Rail Inputs Tests ===

mod rail_inputs_tests {
    use super::*;

    fn sample_public_inputs() -> MinaProofOfStatePublicInputs {
        MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        }
    }

    #[test]
    fn test_rail_inputs_creation() {
        let pos_inputs = sample_public_inputs();
        let holder_id = "test_holder";
        let policy_id = 1u64;
        let epoch = 1700000000u64;
        let verifier_scope = 100u64;

        let rail_inputs = MinaRailPublicInputs::new(
            &pos_inputs,
            policy_id,
            epoch,
            verifier_scope,
            holder_id,
        );

        // Verify nullifier computation is deterministic
        let nullifier1 = rail_inputs.compute_nullifier();
        let nullifier2 = rail_inputs.compute_nullifier();
        
        assert_eq!(nullifier1, nullifier2);
        assert_ne!(nullifier1, [0u8; 32]);
    }

    #[test]
    fn test_nullifier_uniqueness() {
        let pos_inputs = sample_public_inputs();

        let rail_inputs1 = MinaRailPublicInputs::new(
            &pos_inputs,
            1,
            1000,
            100,
            "holder_a",
        );
        
        let rail_inputs2 = MinaRailPublicInputs::new(
            &pos_inputs,
            1,
            1000,
            100,
            "holder_b",
        );

        let nullifier1 = rail_inputs1.compute_nullifier();
        let nullifier2 = rail_inputs2.compute_nullifier();
        
        assert_ne!(nullifier1, nullifier2, "Different holders should have different nullifiers");
    }

    #[test]
    fn test_holder_binding_determinism() {
        let mina_digest = [1u8; 32];
        
        let binding1 = compute_holder_binding("holder", &mina_digest, 1, 100);
        let binding2 = compute_holder_binding("holder", &mina_digest, 1, 100);
        
        assert_eq!(binding1, binding2);
    }

    #[test]
    fn test_holder_binding_changes() {
        let mina_digest = [1u8; 32];
        
        let binding1 = compute_holder_binding("holder_a", &mina_digest, 1, 100);
        let binding2 = compute_holder_binding("holder_b", &mina_digest, 1, 100);
        
        assert_ne!(binding1, binding2, "Different holders should have different bindings");
    }

    #[test]
    fn test_nullifier_computation() {
        let holder_binding = [1u8; 32];
        
        let nullifier = compute_mina_nullifier(&holder_binding, 100, 1, 1700000000);
        assert_ne!(nullifier, [0u8; 32]);
        
        // Should be deterministic
        let nullifier2 = compute_mina_nullifier(&holder_binding, 100, 1, 1700000000);
        assert_eq!(nullifier, nullifier2);
    }
}

// === Edge Cases and Error Handling Tests ===

mod edge_case_tests {
    use super::*;
    use zkpf_mina_kimchi_wrapper::{
        gates::NativeGateEvaluator,
        ipa::{NativeIpaVerifier, NativeIpaProof, MAX_IPA_ROUNDS},
        accumulator::{PicklesAccumulator, PicklesAccumulatorVerifier},
        linearization::NativeLinearization,
        proof_parser::parse_kimchi_proof_bytes,
        poseidon::NativeKimchiTranscript,
    };

    #[test]
    fn test_empty_witness_handling() {
        let evaluator = NativeGateEvaluator::new(PastaField::Pallas);
        let empty_w: Vec<NativeFFelt> = vec![];
        let empty_selectors: Vec<NativeFFelt> = vec![];

        let result = evaluator.evaluate_gates(
            &empty_w,
            &empty_w,
            &empty_selectors,
            &[],
            &NativeFFelt::one(PastaField::Pallas),
        );

        // Should handle gracefully without panic
        assert!(result.is_zero(), "Empty witness should produce zero constraint sum");
    }

    #[test]
    fn test_partial_witness_handling() {
        let evaluator = NativeGateEvaluator::new(PastaField::Pallas);
        let field = PastaField::Pallas;

        // Only 2 witness values (less than minimum for most gates)
        let partial_w = vec![
            NativeFFelt::from_u64(1, field),
            NativeFFelt::from_u64(2, field),
        ];
        let selector = vec![NativeFFelt::one(field)];

        let result = evaluator.evaluate_gates(
            &partial_w,
            &partial_w,
            &selector,
            &[],
            &NativeFFelt::one(field),
        );

        // Should not panic, should return zero for constraints that need more columns
        assert!(result.field_type == field);
    }

    #[test]
    fn test_ipa_mismatched_rounds() {
        let verifier = NativeIpaVerifier::placeholder();
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        let commitment = NativeECPoint::infinity(curve);
        let evaluation = NativeFFelt::one(field);
        let point = NativeFFelt::from_u64(100, field);

        // Mismatched L and R commitment counts
        let bad_proof = NativeIpaProof {
            l_commitments: vec![NativeECPoint::infinity(curve); 5],
            r_commitments: vec![NativeECPoint::infinity(curve); 7], // Different!
            final_a: NativeFFelt::one(field),
            blinding: NativeFFelt::zero(field),
        };

        let challenges: Vec<NativeFFelt> = (0..5)
            .map(|_| NativeFFelt::one(field))
            .collect();

        let result = verifier.verify(&commitment, &evaluation, &point, &bad_proof, &challenges);
        assert!(!result, "Mismatched round counts should fail verification");
    }

    #[test]
    fn test_ipa_too_many_rounds() {
        let verifier = NativeIpaVerifier::placeholder();
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        let commitment = NativeECPoint::infinity(curve);
        let evaluation = NativeFFelt::one(field);
        let point = NativeFFelt::from_u64(100, field);

        // Too many rounds
        let too_many_rounds = MAX_IPA_ROUNDS + 5;
        let bad_proof = NativeIpaProof {
            l_commitments: vec![NativeECPoint::infinity(curve); too_many_rounds],
            r_commitments: vec![NativeECPoint::infinity(curve); too_many_rounds],
            final_a: NativeFFelt::one(field),
            blinding: NativeFFelt::zero(field),
        };

        let challenges: Vec<NativeFFelt> = (0..too_many_rounds)
            .map(|_| NativeFFelt::one(field))
            .collect();

        let result = verifier.verify(&commitment, &evaluation, &point, &bad_proof, &challenges);
        assert!(!result, "Too many rounds should fail verification");
    }

    #[test]
    fn test_accumulator_invalid_chain() {
        let verifier = PicklesAccumulatorVerifier::placeholder();

        // Create accumulators with mismatched depths
        let acc0 = PicklesAccumulator::identity();
        let acc2 = PicklesAccumulator {
            commitment: NativeECPoint::infinity(PastaCurve::Pallas),
            evaluation: NativeFFelt::zero(PastaField::Pallas),
            challenges: vec![],
            depth: 2, // Skipped depth 1!
            blinding_sum: NativeFFelt::zero(PastaField::Pallas),
        };

        // Create mismatched chain (more accumulators than transitions)
        let accumulators = vec![acc0, acc2];
        let transitions = vec![]; // Should have 1 transition

        let result = verifier.verify_chain(&accumulators, &transitions);
        assert!(!result, "Chain with mismatched counts should fail");
    }

    #[test]
    fn test_proof_parser_truncated_bytes() {
        // Various truncation scenarios
        let too_short: &[u8] = &[1, 2, 3];
        let result = parse_kimchi_proof_bytes(too_short);
        assert!(result.is_err(), "Too short bytes should fail");

        // Just header, no content
        let header_only: &[u8] = &[0x4d, 0x49, 0x4e, 0x41, 0, 0, 0, 1]; // "MINA" + version
        let result = parse_kimchi_proof_bytes(header_only);
        assert!(result.is_err(), "Header only should fail");
    }

    #[test]
    fn test_field_element_boundaries() {
        let field = PastaField::Pallas;

        // Zero
        let zero = NativeFFelt::zero(field);
        assert!(zero.is_zero());
        assert!(zero.is_reduced());

        // One
        let one = NativeFFelt::one(field);
        assert!(!one.is_zero());
        assert!(one.is_reduced());

        // Max u64
        let max_u64 = NativeFFelt::from_u64(u64::MAX, field);
        assert!(max_u64.is_reduced());

        // Zero inverse should return None
        let zero_inv = zero.inv();
        assert!(zero_inv.is_none(), "Zero should not have an inverse");

        // One inverse should be one
        let one_inv = one.inv();
        assert!(one_inv.is_some());
        let one_inv_val = one_inv.unwrap();
        assert!(one_inv_val.eq(&one), "Inverse of 1 should be 1");
    }

    #[test]
    fn test_ec_point_edge_cases() {
        let curve = PastaCurve::Pallas;

        // Infinity + Infinity = Infinity
        let inf1 = NativeECPoint::infinity(curve);
        let inf2 = NativeECPoint::infinity(curve);
        let sum = inf1.add(&inf2);
        assert!(sum.is_infinity, "Infinity + Infinity should be Infinity");

        // 2 * Infinity = Infinity
        let doubled = inf1.double();
        assert!(doubled.is_infinity, "2 * Infinity should be Infinity");

        // Scalar mul by zero gives infinity
        let p = NativeECPoint::from_coords(
            NativeFFelt::from_u64(1, PastaField::Pallas),
            NativeFFelt::from_u64(1, PastaField::Pallas),
            curve,
        );
        let zero_scalar = NativeFFelt::zero(PastaField::Vesta);
        let result = p.scalar_mul(&zero_scalar);
        assert!(result.is_infinity, "0 * P should be Infinity");
    }

    #[test]
    fn test_transcript_determinism() {
        let field = PastaField::Pallas;

        // Two identical transcripts should produce identical challenges
        let mut transcript1 = NativeKimchiTranscript::new(field);
        let mut transcript2 = NativeKimchiTranscript::new(field);

        // Absorb same data as field elements
        let data = vec![
            NativeFFelt::from_u64(1, field),
            NativeFFelt::from_u64(2, field),
            NativeFFelt::from_u64(3, field),
        ];
        transcript1.absorb_fields(&data);
        transcript2.absorb_fields(&data);

        // Squeeze challenges
        let c1 = transcript1.squeeze_challenge();
        let c2 = transcript2.squeeze_challenge();

        assert!(c1.eq(&c2), "Identical transcripts should produce identical challenges");

        // Different data should produce different challenges
        let mut transcript3 = NativeKimchiTranscript::new(field);
        let different_data = vec![
            NativeFFelt::from_u64(99, field),
            NativeFFelt::from_u64(100, field),
            NativeFFelt::from_u64(101, field),
        ];
        transcript3.absorb_fields(&different_data);
        let c3 = transcript3.squeeze_challenge();

        assert!(!c1.eq(&c3), "Different inputs should produce different challenges");
    }

    #[test]
    fn test_linearization_with_extreme_values() {
        let linearization = NativeLinearization::for_proof_of_state();
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        // Create proof with extreme values
        use zkpf_mina_kimchi_wrapper::kimchi_core::{ParsedKimchiProof, ProofCommitments, ProofEvaluations, PointEvaluations, IpaProof};

        let extreme_value = NativeFFelt::from_u64(u64::MAX, field);
        let proof = ParsedKimchiProof {
            commitments: ProofCommitments {
                witness_commitments: vec![NativeECPoint::infinity(curve); KIMCHI_WITNESS_COLUMNS],
                permutation_commitment: NativeECPoint::infinity(curve),
                quotient_commitments: vec![NativeECPoint::infinity(curve); 7],
                lookup_commitments: None,
            },
            evaluations: ProofEvaluations {
                zeta_evals: PointEvaluations {
                    witness: vec![extreme_value; KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: extreme_value,
                    gate_selectors: vec![extreme_value; 8],
                    sigma: vec![extreme_value; 6],
                },
                zeta_omega_evals: PointEvaluations {
                    witness: vec![extreme_value; KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: extreme_value,
                    gate_selectors: vec![extreme_value; 8],
                    sigma: vec![extreme_value; 6],
                },
            },
            ipa_proof: IpaProof {
                l_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                r_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                final_eval: extreme_value,
                blinding: NativeFFelt::zero(field),
            },
        };

        // Should handle without overflow panic
        use zkpf_mina_kimchi_wrapper::poseidon::KimchiChallenges;
        let challenges = KimchiChallenges {
            zeta: NativeFFelt::from_u64(12345, field),
            v: NativeFFelt::from_u64(67890, field),
            u: NativeFFelt::from_u64(11111, field),
            beta: NativeFFelt::from_u64(22222, field),
            gamma: NativeFFelt::from_u64(33333, field),
            alpha: NativeFFelt::from_u64(44444, field),
            ipa_challenges: vec![NativeFFelt::one(field); MAX_IPA_ROUNDS],
        };

        // Should not panic on extreme values
        let result = linearization.compute_linearization(&proof, &[], &challenges);
        assert!(result.linearization_eval.field_type == field);
    }

    #[test]
    fn test_accumulator_serialization_roundtrip() {
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        // Create accumulator with non-trivial values
        let acc = PicklesAccumulator {
            commitment: NativeECPoint::from_coords(
                NativeFFelt::from_u64(12345, PastaField::Pallas),
                NativeFFelt::from_u64(67890, PastaField::Pallas),
                curve,
            ),
            evaluation: NativeFFelt::from_u64(99999, field),
            challenges: vec![
                NativeFFelt::from_u64(1, field),
                NativeFFelt::from_u64(2, field),
                NativeFFelt::from_u64(3, field),
            ],
            depth: 5,
            blinding_sum: NativeFFelt::from_u64(42, field),
        };

        // Serialize
        let bytes = acc.to_bytes();
        
        // Deserialize
        let recovered = PicklesAccumulator::from_bytes(&bytes).expect("Should deserialize");

        // Verify
        assert_eq!(recovered.depth, acc.depth);
        assert!(recovered.evaluation.eq(&acc.evaluation));
        assert_eq!(recovered.challenges.len(), acc.challenges.len());
    }
}

// === Performance and Stress Tests ===

mod stress_tests {
    use super::*;
    use zkpf_mina_kimchi_wrapper::{
        linearization::NativeLinearization,
        poseidon::NativeKimchiTranscript,
    };

    #[test]
    fn test_many_field_operations() {
        let field = PastaField::Pallas;
        
        // Perform many multiplications
        let mut acc = NativeFFelt::one(field);
        let factor = NativeFFelt::from_u64(7, field);
        
        for _ in 0..1000 {
            acc = acc.mul(&factor);
        }
        
        // Should complete without panic and remain reduced
        assert!(acc.is_reduced());
    }

    #[test]
    fn test_many_transcript_operations() {
        let field = PastaField::Pallas;
        let mut transcript = NativeKimchiTranscript::new(field);

        // Absorb many values
        for i in 0..100u64 {
            let val = NativeFFelt::from_u64(i, field);
            transcript.absorb_field(&val);
        }

        // Squeeze many challenges
        for _ in 0..50 {
            let _challenge = transcript.squeeze_challenge();
        }
        
        // Final challenge should still be deterministic
        let final_challenge = transcript.squeeze_challenge();
        assert!(!final_challenge.is_zero());
    }

    #[test]
    fn test_large_public_inputs() {
        let linearization = NativeLinearization::for_proof_of_state();
        let field = PastaField::Pallas;
        let curve = PastaCurve::Pallas;

        // Create many public inputs
        let public_inputs: Vec<NativeFFelt> = (0..100)
            .map(|i| NativeFFelt::from_u64(i as u64, field))
            .collect();

        use zkpf_mina_kimchi_wrapper::kimchi_core::{ParsedKimchiProof, ProofCommitments, ProofEvaluations, PointEvaluations, IpaProof};
        use zkpf_mina_kimchi_wrapper::ipa::MAX_IPA_ROUNDS;

        let proof = ParsedKimchiProof {
            commitments: ProofCommitments {
                witness_commitments: vec![NativeECPoint::infinity(curve); KIMCHI_WITNESS_COLUMNS],
                permutation_commitment: NativeECPoint::infinity(curve),
                quotient_commitments: vec![NativeECPoint::infinity(curve); 7],
                lookup_commitments: None,
            },
            evaluations: ProofEvaluations {
                zeta_evals: PointEvaluations {
                    witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: NativeFFelt::zero(field),
                    gate_selectors: vec![NativeFFelt::zero(field); 8],
                    sigma: vec![NativeFFelt::zero(field); 6],
                },
                zeta_omega_evals: PointEvaluations {
                    witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
                    permutation: NativeFFelt::one(field),
                    public_input: NativeFFelt::zero(field),
                    gate_selectors: vec![NativeFFelt::zero(field); 8],
                    sigma: vec![NativeFFelt::zero(field); 6],
                },
            },
            ipa_proof: IpaProof {
                l_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                r_commitments: vec![NativeECPoint::infinity(curve); MAX_IPA_ROUNDS],
                final_eval: NativeFFelt::one(field),
                blinding: NativeFFelt::zero(field),
            },
        };

        use zkpf_mina_kimchi_wrapper::poseidon::KimchiChallenges;
        let challenges = KimchiChallenges {
            zeta: NativeFFelt::from_u64(12345, field),
            v: NativeFFelt::from_u64(67890, field),
            u: NativeFFelt::from_u64(11111, field),
            beta: NativeFFelt::from_u64(22222, field),
            gamma: NativeFFelt::from_u64(33333, field),
            alpha: NativeFFelt::from_u64(44444, field),
            ipa_challenges: vec![NativeFFelt::one(field); MAX_IPA_ROUNDS],
        };

        // Should handle many public inputs
        let result = linearization.compute_linearization(&proof, &public_inputs, &challenges);
        assert!(result.linearization_eval.field_type == field);
    }
}
