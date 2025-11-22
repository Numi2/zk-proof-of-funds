FROM rust:1.81 as builder
WORKDIR /app

# Copy the full workspace so we can build zkpf-backend with its dependencies.
COPY . .

# Build only the backend binary in release mode.
RUN cargo build --release -p zkpf-backend

FROM debian:bookworm-slim

WORKDIR /app

# Copy the compiled backend binary.
COPY --from=builder /app/target/release/zkpf-backend /usr/local/bin/zkpf-backend

# Copy policy config and proving artifacts. For now we reuse the deterministic
# fixtures from zkpf-test-fixtures; these can be swapped to production artifacts
# later without changing the image layout.
COPY config ./config
COPY zkpf-test-fixtures/fixtures ./artifacts

# Default paths expected by zkpf-backend.
ENV ZKPF_MANIFEST_PATH=/app/artifacts/manifest.json \
    ZKPF_POLICY_PATH=/app/config/policies.json \
    ZKPF_NULLIFIER_DB=/app/data/nullifiers.db

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["zkpf-backend"]


