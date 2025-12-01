use halo2_base::poseidon::hasher::spec::OptimizedPoseidonSpec;
use halo2_proofs_axiom::{dev::MockProver, plonk::Circuit};
use halo2curves_axiom::{
    bn256::Fr,
    ff::{Field, PrimeField},
};
use secp256k1::{ecdsa::Signature, Message, PublicKey, Secp256k1, SecretKey};
use std::sync::OnceLock;
use zkpf_circuit::{
    gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey},
    PublicInputs, ZkpfCircuit, ZkpfCircuitInput,
};

// Poseidon parameters - MUST match zkpf_circuit::gadgets::poseidon constants
// These are duplicated here to avoid test dependency on internal module structure.
// Canonical source: zkpf-circuit/src/gadgets/poseidon.rs
const POSEIDON_T: usize = 6;
const POSEIDON_RATE: usize = 5;
const POSEIDON_FULL_ROUNDS: usize = 8;
const POSEIDON_PARTIAL_ROUNDS: usize = 57;

const BASE_BALANCE: u64 = 5_000_000_000;
const BASE_THRESHOLD: u64 = 1_000_000_000;
const BASE_CURRENCY: u32 = 840;
const BASE_CUSTODIAN: u32 = 1337;
const BASE_ATTESTATION_ID: u64 = 9_876_543_210;
const BASE_ISSUED_AT: u64 = 1_700_000_000;
const BASE_VALID_UNTIL: u64 = BASE_ISSUED_AT + 1_000_000;
const BASE_CURRENT_EPOCH: u64 = BASE_ISSUED_AT + 10;
const BASE_SCOPE_ID: u64 = 99;
const BASE_POLICY_ID: u64 = 7;
const ACCOUNT_HASH_SEED: u64 = 0xDEAD_BEEF;
const SIGNING_KEY_BYTES: [u8; 32] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x23,
];

#[test]
fn test_valid_proof_mock() {
    let prover = run_mock_prover(valid_input());
    prover.assert_satisfied();
}

// NOTE: ECDSA signature verification has been moved out of the circuit.
// Signature tests are no longer needed here - signature verification
// is performed by the backend before proof generation.

#[test]
fn test_balance_below_threshold_fails() {
    let input = FixtureBuilder::new()
        .with_att(|att| att.balance_raw = BASE_THRESHOLD - 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

#[test]
fn test_wrong_currency_fails() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.required_currency_code = BASE_CURRENCY + 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

#[test]
fn test_expired_attestation_fails() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.current_epoch = BASE_VALID_UNTIL + 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

#[test]
fn test_current_epoch_before_issued_at_fails() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.current_epoch = BASE_ISSUED_AT - 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

#[test]
fn test_nullifier_mismatch_fails() {
    let mut input = valid_input();
    input.public.nullifier += Fr::ONE;
    assert!(run_mock_prover(input).verify().is_err());
}

#[test]
fn test_custodian_pubkey_hash_mismatch_fails() {
    let mut input = valid_input();
    input.public.custodian_pubkey_hash += Fr::ONE;
    assert!(run_mock_prover(input).verify().is_err());
}

// NOTE: ECDSA-related tests have been removed.
// On-curve validation and signature field element tests are no longer applicable
// because ECDSA verification has been moved out of the circuit to the backend.
// This change reduced pk.bin from ~688MB to ~20MB.

// ============================================================
// Boundary Condition Tests
// ============================================================

/// Test that balance exactly equal to threshold passes.
/// This is the critical edge case for the >= comparison.
#[test]
fn test_balance_equals_threshold_passes() {
    let input = FixtureBuilder::new()
        .with_att(|att| att.balance_raw = BASE_THRESHOLD)
        .build();
    run_mock_prover(input).assert_satisfied();
}

/// Test that balance one unit below threshold fails.
/// Ensures the comparison is >= not >.
#[test]
fn test_balance_one_below_threshold_fails() {
    let input = FixtureBuilder::new()
        .with_att(|att| att.balance_raw = BASE_THRESHOLD - 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

/// Test that current_epoch exactly equal to issued_at passes.
/// This tests the lower bound of the validity window.
#[test]
fn test_epoch_equals_issued_at_passes() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.current_epoch = BASE_ISSUED_AT)
        .build();
    run_mock_prover(input).assert_satisfied();
}

/// Test that current_epoch exactly equal to valid_until passes.
/// This tests the upper bound of the validity window (inclusive).
#[test]
fn test_epoch_equals_valid_until_passes() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.current_epoch = BASE_VALID_UNTIL)
        .build();
    run_mock_prover(input).assert_satisfied();
}

/// Test that current_epoch one unit after valid_until fails.
/// Ensures the validity window upper bound is enforced.
#[test]
fn test_epoch_one_after_valid_until_fails() {
    let input = FixtureBuilder::new()
        .with_public(|public| public.current_epoch = BASE_VALID_UNTIL + 1)
        .build();
    assert!(run_mock_prover(input).verify().is_err());
}

/// Test that currency wildcard (u32::MAX) accepts any currency.
#[test]
fn test_currency_wildcard_accepts_any() {
    use zkpf_circuit::gadgets::CURRENCY_WILDCARD;
    
    // Use wildcard as required currency, with any attestation currency
    let input = FixtureBuilder::new()
        .with_public(|public| public.required_currency_code = CURRENCY_WILDCARD)
        .build();
    run_mock_prover(input).assert_satisfied();
}

/// Test that currency wildcard works with different attestation currencies.
#[test]
fn test_currency_wildcard_accepts_different_currency() {
    use zkpf_circuit::gadgets::CURRENCY_WILDCARD;
    
    // Change attestation currency to EUR (978), require wildcard
    let input = FixtureBuilder::new()
        .with_att(|att| att.currency_code_int = 978) // EUR
        .with_public(|public| public.required_currency_code = CURRENCY_WILDCARD)
        .build();
    run_mock_prover(input).assert_satisfied();
}

fn valid_input() -> ZkpfCircuitInput {
    FixtureBuilder::new().build()
}

fn run_mock_prover(input: ZkpfCircuitInput) -> MockProver<Fr> {
    let public_instances = zkpf_circuit::public_instances(&input.public);
    let circuit = ZkpfCircuit::new(Some(input));
    let k = circuit.params().k as u32;
    match MockProver::run(k, &circuit, public_instances) {
        Ok(prover) => prover,
        Err(err) => panic!("mock prover run failed: {:?}", err),
    }
}

#[derive(Clone)]
struct AttestationCore {
    balance_raw: u64,
    currency_code_int: u32,
    custodian_id: u32,
    attestation_id: u64,
    issued_at: u64,
    valid_until: u64,
    account_id_hash: Fr,
}

#[derive(Clone)]
struct PublicCore {
    threshold_raw: u64,
    required_currency_code: u32,
    current_epoch: u64,
    verifier_scope_id: u64,
    policy_id: u64,
}

#[derive(Clone)]
struct FixtureBuilder {
    att: AttestationCore,
    public: PublicCore,
}

impl FixtureBuilder {
    fn new() -> Self {
        Self {
            att: AttestationCore {
                balance_raw: BASE_BALANCE,
                currency_code_int: BASE_CURRENCY,
                custodian_id: BASE_CUSTODIAN,
                attestation_id: BASE_ATTESTATION_ID,
                issued_at: BASE_ISSUED_AT,
                valid_until: BASE_VALID_UNTIL,
                account_id_hash: Fr::from(ACCOUNT_HASH_SEED),
            },
            public: PublicCore {
                threshold_raw: BASE_THRESHOLD,
                required_currency_code: BASE_CURRENCY,
                current_epoch: BASE_CURRENT_EPOCH,
                verifier_scope_id: BASE_SCOPE_ID,
                policy_id: BASE_POLICY_ID,
            },
        }
    }

    fn with_att(mut self, f: impl FnOnce(&mut AttestationCore)) -> Self {
        f(&mut self.att);
        self
    }

    fn with_public(mut self, f: impl FnOnce(&mut PublicCore)) -> Self {
        f(&mut self.public);
        self
    }

    fn build(&self) -> ZkpfCircuitInput {
        assemble_input(&self.att, &self.public)
    }
}

fn assemble_input(att: &AttestationCore, public: &PublicCore) -> ZkpfCircuitInput {
    let secp = Secp256k1::new();
    let signing_key = deterministic_signing_key();
    let message_hash = attestation_message_hash(att);
    let message = Message::from_digest_slice(&message_hash).expect("32-byte digest");
    let signature = secp.sign_ecdsa(&message, &signing_key);
    let (sig_r, sig_s) = split_signature(&signature);
    let derived_pubkey = secp_pubkey_from_secret(&secp, &signing_key);

    let custodian_pubkey = derived_pubkey;

    let attestation = AttestationWitness {
        balance_raw: att.balance_raw,
        currency_code_int: att.currency_code_int,
        custodian_id: att.custodian_id,
        attestation_id: att.attestation_id,
        issued_at: att.issued_at,
        valid_until: att.valid_until,
        account_id_hash: att.account_id_hash,
        custodian_pubkey,
        signature: EcdsaSignature { r: sig_r, s: sig_s },
        message_hash,
    };

    let nullifier = poseidon_hash(&[
        att.account_id_hash,
        fr_from_u64(public.verifier_scope_id),
        fr_from_u64(public.policy_id),
        fr_from_u64(public.current_epoch),
    ]);
    let custodian_pubkey_hash = hash_custodian_pubkey(&attestation.custodian_pubkey);

    let public_inputs = PublicInputs {
        threshold_raw: public.threshold_raw,
        required_currency_code: public.required_currency_code,
        current_epoch: public.current_epoch,
        verifier_scope_id: public.verifier_scope_id,
        policy_id: public.policy_id,
        nullifier,
        custodian_pubkey_hash,
    };

    ZkpfCircuitInput {
        attestation,
        public: public_inputs,
    }
}

fn deterministic_signing_key() -> SecretKey {
    SecretKey::from_slice(&SIGNING_KEY_BYTES).expect("static key")
}

fn attestation_message_hash(att: &AttestationCore) -> [u8; 32] {
    let digest = poseidon_hash(&[
        fr_from_u64(att.balance_raw),
        fr_from_u64(att.attestation_id),
        fr_from_u32(att.currency_code_int),
        fr_from_u32(att.custodian_id),
        fr_from_u64(att.issued_at),
        fr_from_u64(att.valid_until),
        att.account_id_hash,
    ]);
    fr_to_be_bytes(&digest)
}

fn split_signature(signature: &Signature) -> ([u8; 32], [u8; 32]) {
    let bytes = signature.serialize_compact();
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    r.copy_from_slice(&bytes[..32]);
    s.copy_from_slice(&bytes[32..]);
    (r, s)
}

fn poseidon_hash(inputs: &[Fr]) -> Fr {
    native_poseidon_hash(inputs, poseidon_spec())
}

fn hash_custodian_pubkey(pubkey: &Secp256k1Pubkey) -> Fr {
    let x = fr_from_be_bytes(&pubkey.x);
    let y = fr_from_be_bytes(&pubkey.y);
    poseidon_hash(&[x, y])
}

fn secp_pubkey_from_secret(secp: &Secp256k1<secp256k1::All>, sk: &SecretKey) -> Secp256k1Pubkey {
    let public_key = PublicKey::from_secret_key(secp, sk);
    let encoded = public_key.serialize_uncompressed();
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(&encoded[1..33]);
    y.copy_from_slice(&encoded[33..65]);
    Secp256k1Pubkey { x, y }
}

fn poseidon_spec() -> &'static OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE> {
    static SPEC: OnceLock<OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE>> = OnceLock::new();
    SPEC.get_or_init(|| {
        OptimizedPoseidonSpec::new::<POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, 0>()
    })
}

fn native_poseidon_hash(
    inputs: &[Fr],
    spec: &OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE>,
) -> Fr {
    let mut state = [Fr::ZERO; POSEIDON_T];
    state[0] = Fr::from_u128(1u128 << 64);

    for chunk in inputs.chunks(POSEIDON_RATE) {
        poseidon_permutation(&mut state, chunk, spec);
    }

    if inputs.len() % POSEIDON_RATE == 0 {
        poseidon_permutation(&mut state, &[], spec);
    }

    state[1]
}

fn poseidon_permutation(
    state: &mut [Fr; POSEIDON_T],
    inputs: &[Fr],
    spec: &OptimizedPoseidonSpec<Fr, POSEIDON_T, POSEIDON_RATE>,
) {
    let r_f = spec.r_f() / 2;
    let constants = spec.constants();
    let matrices = spec.mds_matrices();
    let start = constants.start();

    absorb_with_pre_constants(state, inputs, &start[0]);

    for coeffs in start.iter().skip(1).take(r_f - 1) {
        sbox_full(state, coeffs);
        apply_mds(state, matrices.mds().as_ref());
    }

    if let Some(last) = start.last() {
        sbox_full(state, last);
    }
    apply_mds(state, matrices.pre_sparse_mds().as_ref());

    for (constant, sparse) in constants
        .partial()
        .iter()
        .zip(matrices.sparse_matrices().iter())
    {
        sbox_part(state, constant);
        apply_sparse_mds(state, sparse.row(), sparse.col_hat());
    }

    for coeffs in constants.end().iter() {
        sbox_full(state, coeffs);
        apply_mds(state, matrices.mds().as_ref());
    }

    sbox_full(state, &[Fr::ZERO; POSEIDON_T]);
    apply_mds(state, matrices.mds().as_ref());
}

fn absorb_with_pre_constants(
    state: &mut [Fr; POSEIDON_T],
    inputs: &[Fr],
    pre_constants: &[Fr; POSEIDON_T],
) {
    assert!(inputs.len() < POSEIDON_T);

    state[0] += pre_constants[0];
    for (idx, input) in inputs.iter().enumerate() {
        state[idx + 1] += *input + pre_constants[idx + 1];
    }

    let offset = inputs.len() + 1;
    for (i, idx) in (offset..POSEIDON_T).enumerate() {
        let mut addend = pre_constants[idx];
        if i == 0 {
            addend += Fr::ONE;
        }
        state[idx] += addend;
    }
}

fn sbox_full(state: &mut [Fr; POSEIDON_T], constants: &[Fr; POSEIDON_T]) {
    for (value, constant) in state.iter_mut().zip(constants.iter()) {
        *value = value.pow_vartime([5]) + constant;
    }
}

fn sbox_part(state: &mut [Fr; POSEIDON_T], constant: &Fr) {
    state[0] = state[0].pow_vartime([5]) + constant;
}

fn apply_mds(state: &mut [Fr; POSEIDON_T], matrix: &[[Fr; POSEIDON_T]; POSEIDON_T]) {
    let current = *state;
    let mut next = [Fr::ZERO; POSEIDON_T];
    for (i, row) in matrix.iter().enumerate() {
        let mut acc = Fr::ZERO;
        for (coeff, value) in row.iter().zip(current.iter()) {
            acc += *coeff * *value;
        }
        next[i] = acc;
    }
    *state = next;
}

fn apply_sparse_mds(
    state: &mut [Fr; POSEIDON_T],
    row: &[Fr; POSEIDON_T],
    col_hat: &[Fr; POSEIDON_RATE],
) {
    let current = *state;
    let mut next = [Fr::ZERO; POSEIDON_T];

    let mut acc = Fr::ZERO;
    for (coeff, value) in row.iter().zip(current.iter()) {
        acc += *coeff * *value;
    }
    next[0] = acc;

    for (i, (coeff, value)) in col_hat.iter().zip(current.iter().skip(1)).enumerate() {
        next[i + 1] = current[0] * *coeff + *value;
    }

    *state = next;
}

fn fr_from_u64(value: u64) -> Fr {
    Fr::from(value)
}

fn fr_from_u32(value: u32) -> Fr {
    Fr::from(value as u64)
}

fn fr_to_be_bytes(fr: &Fr) -> [u8; 32] {
    let repr = fr.to_repr();
    let mut bytes = [0u8; 32];
    for (dst, src) in bytes.iter_mut().zip(repr.as_ref().iter().rev()) {
        *dst = *src;
    }
    bytes
}

fn fr_from_be_bytes(bytes: &[u8; 32]) -> Fr {
    let mut acc = Fr::ZERO;
    let base = Fr::from(256u64);
    for byte in bytes.iter() {
        acc = acc * base + Fr::from(*byte as u64);
    }
    acc
}
