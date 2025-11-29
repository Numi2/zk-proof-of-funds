//! Build script for generating gRPC bindings from lightwalletd protos.

fn main() {
    // Only run proto generation when the lightwalletd-proto feature is enabled
    // This requires tonic-build which is gated behind that feature
    #[cfg(feature = "lightwalletd-proto")]
    generate_proto_bindings();
}

#[cfg(feature = "lightwalletd-proto")]
fn generate_proto_bindings() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let proto_dir = std::path::PathBuf::from(&manifest_dir)
        .parent()
        .unwrap()
        .join("webwallet")
        .join("protos");

    let service_proto = proto_dir.join("service.proto");
    let compact_proto = proto_dir.join("compact_formats.proto");

    if service_proto.exists() && compact_proto.exists() {
        println!("cargo:rerun-if-changed={}", service_proto.display());
        println!("cargo:rerun-if-changed={}", compact_proto.display());

        // Output to OUT_DIR for proper include! usage
        let out_dir = std::env::var("OUT_DIR").unwrap();
        
        tonic_build::configure()
            .build_server(false)
            .build_client(true)
            .out_dir(&out_dir)
            .compile(
                &[service_proto, compact_proto],
                &[proto_dir],
            )
            .expect("Failed to compile lightwalletd protos");
            
        println!("cargo:rerun-if-env-changed=OUT_DIR");
    } else {
        // Proto files not found, skip generation
        println!("cargo:warning=Proto files not found at {:?}, skipping gRPC binding generation", proto_dir);
    }
}

