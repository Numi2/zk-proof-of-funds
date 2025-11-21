use zkpf_backend::serve;

#[tokio::main]
async fn main() {
    serve().await;
}
