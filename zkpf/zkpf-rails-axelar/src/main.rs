//! Axelar GMP Rail Service
//!
//! Entry point for the zkpf Axelar interchain messaging service.

use zkpf_rails_axelar::main_entry;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    main_entry::run_server().await
}

