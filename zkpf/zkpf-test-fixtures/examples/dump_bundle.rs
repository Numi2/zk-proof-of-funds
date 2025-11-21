use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::json;
use zkpf_test_fixtures::fixtures;

fn main() {
    let fixtures = fixtures();
    let proof_b64 = STANDARD.encode(fixtures.proof());
    let public_inputs_bytes_b64 = STANDARD.encode(fixtures.public_inputs_bytes());
    let bundle_bytes = serde_json::to_vec(fixtures.bundle()).expect("bundle json");

    let payload = json!({
        "bundle": fixtures.bundle(),
        "proof_base64": proof_b64,
        "public_inputs_json": fixtures.public_inputs_json(),
        "public_inputs_bytes_base64": public_inputs_bytes_b64,
        "attestation_json": fixtures.attestation_json(),
        "bundle_json": String::from_utf8(bundle_bytes).expect("bundle string"),
        "circuit_version": fixtures.bundle().circuit_version,
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&payload).expect("serialize payload")
    );
}
