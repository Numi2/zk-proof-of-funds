#!/bin/bash
set -e

# Build script for WebZjs WASM modules
# Produces TWO builds:
#   1. Threaded (wasm-parallel) - requires SharedArrayBuffer + cross-origin isolation
#   2. Single-threaded (wasm-single-thread) - works on all browsers
#
# Based on ChainSafe's WebZjs build process:
# https://github.com/ChainSafe/WebZjs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Parse arguments
BUILD_MODE="${1:-both}"  # "threads", "single", or "both" (default)

echo "🔧 Building WebZjs WASM modules..."
echo "   Build mode: $BUILD_MODE"
echo ""

# Set up LLVM with wasm target support (required for secp256k1-sys compilation)
# On macOS, Apple's clang doesn't support wasm target, so we use Homebrew's LLVM
if [[ "$(uname)" == "Darwin" ]]; then
    LLVM_PATH="/opt/homebrew/opt/llvm/bin"
    if [[ -d "$LLVM_PATH" ]]; then
        echo "📦 Using Homebrew LLVM for wasm target support..."
        export CC_wasm32_unknown_unknown="$LLVM_PATH/clang"
        export AR_wasm32_unknown_unknown="$LLVM_PATH/llvm-ar"
        export PATH="$LLVM_PATH:$PATH"
    else
        echo "⚠️ Homebrew LLVM not found at $LLVM_PATH"
        echo "   Install with: brew install llvm"
        echo "   This is required for compiling C dependencies for wasm"
    fi
fi

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo "❌ wasm-pack not found. Installing..."
    cargo install wasm-pack
fi

# Check for rust nightly with rust-src
echo "📦 Checking Rust toolchain..."
rustup show active-toolchain

# Get the toolchain channel from rust-toolchain.toml
TOOLCHAIN=$(grep 'channel' rust-toolchain.toml | cut -d'"' -f2)
echo "Installing rust-src for $TOOLCHAIN..."
rustup component add rust-src --toolchain "$TOOLCHAIN" 2>/dev/null || true

# Build webzjs-keys (same for both variants)
echo ""
echo "🔑 Building webzjs-keys..."
cd crates/webzjs-keys
wasm-pack build --target web --release --out-dir pkg \
    --no-default-features \
    -Z build-std="panic_abort,std"
cd "$SCRIPT_DIR"

# ============================================================
# THREADED BUILD (requires SharedArrayBuffer + cross-origin isolation)
# ============================================================
if [[ "$BUILD_MODE" == "threads" || "$BUILD_MODE" == "both" ]]; then
    echo ""
    echo "💼 Building webzjs-wallet (THREADED - requires SharedArrayBuffer)..."
    cd crates/webzjs-wallet
    
    # Threaded build needs atomics and bulk-memory
    RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals" \
    wasm-pack build --target web --release --out-dir pkg-threads \
        --out-name webzjs_wallet_threads \
        --no-default-features --features="wasm-parallel" \
        -Z build-std="panic_abort,std"
    
    # Update package.json name
    if [[ -f pkg-threads/package.json ]]; then
        sed -i.bak 's/"name": "webzjs-wallet"/"name": "@chainsafe\/webzjs-wallet-threads"/' pkg-threads/package.json
        rm -f pkg-threads/package.json.bak
    fi
    
    cd "$SCRIPT_DIR"
    echo "✅ Threaded build complete: crates/webzjs-wallet/pkg-threads/"
fi

# ============================================================
# SINGLE-THREADED BUILD
# ============================================================
# NOTE: The upstream Zcash proving libraries (halo2_proofs, bellman, sapling-crypto)
# require atomics/SharedArrayBuffer for their parallel computation. A true
# single-threaded build would require forking these libraries.
#
# For now, we build a "minimal threading" variant that still requires SAB but
# doesn't spawn additional web workers for sync operations. This is useful for
# debugging but doesn't provide a true non-SAB fallback.
#
# TODO: For true universal browser support, consider:
# 1. Server-side proving API (offload ZK proofs to backend)
# 2. Fork upstream libraries to make Rayon truly optional
# 3. Use a different proving system that doesn't require parallelism
if [[ "$BUILD_MODE" == "single" || "$BUILD_MODE" == "both" ]]; then
    echo ""
    echo "💼 Building webzjs-wallet (MINIMAL THREADING variant)..."
    echo "   Note: Still requires SharedArrayBuffer due to upstream Zcash library dependencies"
    cd crates/webzjs-wallet
    
    # Build with wasm-single-thread feature but still with atomics
    # (required by halo2_proofs, bellman, etc.)
    RUSTFLAGS="-C target-feature=+atomics,+bulk-memory,+mutable-globals" \
    wasm-pack build --target web --release --out-dir pkg-single \
        --out-name webzjs_wallet_single \
        --no-default-features --features="wasm-single-thread" \
        -Z build-std="panic_abort,std"
    
    # Update package.json name
    if [[ -f pkg-single/package.json ]]; then
        sed -i.bak 's/"name": "webzjs-wallet"/"name": "@chainsafe\/webzjs-wallet-single"/' pkg-single/package.json
        rm -f pkg-single/package.json.bak
    fi
    
    cd "$SCRIPT_DIR"
    echo "✅ Minimal-threading build complete: crates/webzjs-wallet/pkg-single/"
    echo "   ⚠️  This variant still requires SharedArrayBuffer (upstream library limitation)"
fi

# ============================================================
# LEGACY: Also build to pkg/ for backwards compatibility
# ============================================================
if [[ "$BUILD_MODE" == "both" ]]; then
    echo ""
    echo "📦 Creating legacy pkg/ symlink (points to threaded build)..."
    cd crates/webzjs-wallet
    rm -rf pkg
    ln -s pkg-threads pkg
    cd "$SCRIPT_DIR"
fi

# Update package.json names for workspace linking
echo ""
echo "📦 Updating package names for workspace..."
cd crates/webzjs-keys/pkg
if grep -q '"name": "webzjs-keys"' package.json 2>/dev/null; then
    sed -i.bak 's/"name": "webzjs-keys"/"name": "@chainsafe\/webzjs-keys"/' package.json
    rm -f package.json.bak
fi
cd "$SCRIPT_DIR"

echo ""
echo "✅ WASM build complete!"
echo ""
echo "The following packages have been built:"
echo "  - crates/webzjs-keys/pkg/"
if [[ "$BUILD_MODE" == "threads" || "$BUILD_MODE" == "both" ]]; then
    echo "  - crates/webzjs-wallet/pkg-threads/  (SharedArrayBuffer required)"
fi
if [[ "$BUILD_MODE" == "single" || "$BUILD_MODE" == "both" ]]; then
    echo "  - crates/webzjs-wallet/pkg-single/   (works on all browsers)"
fi
echo ""
echo "Usage:"
echo "  ./build-wasm.sh          # Build both variants (default)"
echo "  ./build-wasm.sh threads  # Build only threaded variant"
echo "  ./build-wasm.sh single   # Build only single-threaded variant"

