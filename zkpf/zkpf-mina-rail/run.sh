#!/bin/bash
# Run the Mina Rail server

set -e

# Configuration via environment variables
export MINA_RAIL_LISTEN_ADDR="${MINA_RAIL_LISTEN_ADDR:-0.0.0.0:3001}"
export MINA_RAIL_NUM_SHARDS="${MINA_RAIL_NUM_SHARDS:-16}"
export MINA_RAIL_MAX_TACHYSTAMPS="${MINA_RAIL_MAX_TACHYSTAMPS:-10000}"
export MINA_RAIL_EPOCH_SLOTS="${MINA_RAIL_EPOCH_SLOTS:-7200}"
export MINA_RAIL_IVC_DEPTH="${MINA_RAIL_IVC_DEPTH:-14}"
export MINA_RAIL_ENABLE_CORS="${MINA_RAIL_ENABLE_CORS:-true}"
export RUST_LOG="${RUST_LOG:-info,zkpf_mina_rail=debug}"

echo "Starting Mina Recursive Rail..."
echo "  Listen: $MINA_RAIL_LISTEN_ADDR"
echo "  Shards: $MINA_RAIL_NUM_SHARDS"
echo "  Max Tachystamps: $MINA_RAIL_MAX_TACHYSTAMPS"
echo ""

# Run the server
cd "$(dirname "$0")"
cargo run --release --bin mina-rail-server

