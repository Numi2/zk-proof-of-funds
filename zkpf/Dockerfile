FROM rust:1.81 as builder
WORKDIR /app

# Copy the full workspace so we can build zkpf-backend with its dependencies.
COPY . .

# Build the backend binary with mina-rail feature in release mode.
RUN cargo build --release -p zkpf-backend --features mina-rail

# Build the MetaMask Snap
FROM node:24-slim as snap-builder
WORKDIR /snap
# Copy the snap directory from zkpf-snap
COPY zkpf-snap/package.json zkpf-snap/package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts
COPY zkpf-snap/ ./
# Build the snap
RUN npm run build

FROM debian:bookworm-slim

WORKDIR /app

# Copy the compiled backend binary.
COPY --from=builder /app/target/release/zkpf-backend /usr/local/bin/zkpf-backend

# Copy the built snap files for serving
COPY --from=snap-builder /snap/dist ./snap/dist
COPY --from=snap-builder /snap/snap.manifest.json ./snap/snap.manifest.json
COPY --from=snap-builder /snap/images ./snap/images

# Copy policy config and proving artifacts.
# Using artifacts/starknet which includes the full proving key (pk.bin ~784MB)
# needed for client-side proof generation via artifact download.
COPY config ./config
COPY artifacts/starknet ./artifacts

# Default paths expected by zkpf-backend.
ENV ZKPF_MANIFEST_PATH=/app/artifacts/manifest.json \
    ZKPF_POLICY_PATH=/app/config/policies.json \
    ZKPF_NULLIFIER_DB=/app/data/nullifiers.db

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["zkpf-backend"]


