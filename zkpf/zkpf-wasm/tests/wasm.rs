#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;
use zkpf_test_fixtures::fixtures;
use zkpf_wasm::{
    generate_proof, generate_proof_bundle, generate_proof_bundle_cached, init_prover_artifacts,
    init_verifier_artifacts, reset_cached_artifacts, verify_proof, verify_proof_bundle,
    verify_proof_bundle_cached,
};

#[wasm_bindgen_test]
fn wasm_round_trip_proof_generation() {
    let fixtures = fixtures();
    reset_cached_artifacts();
    init_verifier_artifacts(fixtures.params_bytes(), fixtures.vk_bytes()).unwrap();
    init_prover_artifacts(fixtures.params_bytes(), fixtures.pk_bytes()).unwrap();

    let proof = generate_proof(
        fixtures.attestation_json(),
        fixtures.params_bytes(),
        fixtures.pk_bytes(),
    )
    .expect("generate proof");

    let valid = verify_proof(
        &proof,
        fixtures.public_inputs_json(),
        fixtures.vk_bytes(),
        fixtures.params_bytes(),
    )
    .expect("verify proof");
    assert!(valid, "verify_proof should accept the generated proof");

    let bundle = generate_proof_bundle(
        fixtures.attestation_json(),
        fixtures.params_bytes(),
        fixtures.pk_bytes(),
    )
    .expect("bundle generation");
    let bundle_valid =
        verify_proof_bundle(&bundle, fixtures.vk_bytes(), fixtures.params_bytes()).unwrap();
    assert!(
        bundle_valid,
        "verify_proof_bundle validates generated bundle"
    );

    let cached_bundle = generate_proof_bundle_cached(fixtures.attestation_json()).unwrap();
    assert!(
        verify_proof_bundle_cached(&cached_bundle).unwrap(),
        "cached verifier validates cached bundle"
    );
}
