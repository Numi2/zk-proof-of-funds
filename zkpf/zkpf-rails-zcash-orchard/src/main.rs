use std::time::Duration;

use tokio::time::sleep;
use zkpf_rails_zcash_orchard::router;
use zkpf_zcash_orchard_wallet::{init_global_wallet, OrchardWalletConfig, sync_once};

#[tokio::main]
async fn main() {
    // Initialize the global Orchard wallet backend from environment variables
    // before binding the HTTP listener. If this fails, we abort startup so that
    // misconfigurations are detected early.
    let wallet_cfg = OrchardWalletConfig::from_env()
        .expect("load Orchard wallet config from environment");
    init_global_wallet(wallet_cfg).expect("initialize global Orchard wallet backend");

    // Spawn a background sync loop that periodically refreshes the wallet's view
    // of chain state. `sync_once` drives the librustzcash lightwalletd sync
    // pipeline (subtree roots, compact blocks, scan_cached_blocks) and updates
    // the cached tip height.
    tokio::spawn(async {
        loop {
            if let Err(err) = sync_once().await {
                eprintln!("Orchard wallet sync_once error: {err}");
            }
            sleep(Duration::from_secs(5)).await;
        }
    });

    let app = router();
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3100")
        .await
        .expect("bind Orchard rail listener");
    axum::serve(listener, app.into_make_service())
        .await
        .expect("serve Orchard rail API");
}


