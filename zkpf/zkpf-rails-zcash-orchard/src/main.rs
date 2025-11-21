use zkpf_rails_zcash_orchard::router;

#[tokio::main]
async fn main() {
    let app = router();
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3100")
        .await
        .expect("bind Orchard rail listener");
    axum::serve(listener, app.into_make_service())
        .await
        .expect("serve Orchard rail API");
}


