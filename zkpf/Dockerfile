FROM rust:1.81 as builder
WORKDIR /app

# Copy the full workspace so we can build zkpf-backend with its dependencies.
COPY . .

# Build only the backend binary in release mode.
RUN cargo build --release -p zkpf-backend

# Build the MetaMask Snap (part of pnpm workspace)
FROM node:20-slim as snap-builder
RUN npm install -g pnpm
WORKDIR /webwallet
# Copy workspace config and lockfile
COPY webwallet/pnpm-workspace.yaml webwallet/pnpm-lock.yaml webwallet/package.json ./
# Copy ALL workspace packages - pnpm requires all declared packages to exist
# even if they're not direct dependencies of the snap being built
COPY webwallet/crates/webzjs-keys/pkg ./crates/webzjs-keys/pkg
COPY webwallet/crates/webzjs-wallet/pkg ./crates/webzjs-wallet/pkg
COPY webwallet/web-wallet ./web-wallet
COPY webwallet/snap ./snap
# Install dependencies (now all workspace packages are present)
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts
# Build the snap
RUN cd snap && pnpm run build

FROM debian:bookworm-slim

WORKDIR /app

# Copy the compiled backend binary.
COPY --from=builder /app/target/release/zkpf-backend /usr/local/bin/zkpf-backend

# Copy the built snap files for serving
COPY --from=snap-builder /webwallet/snap/dist ./snap/dist
COPY --from=snap-builder /webwallet/snap/snap.manifest.json ./snap/snap.manifest.json
COPY --from=snap-builder /webwallet/snap/images ./snap/images

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


