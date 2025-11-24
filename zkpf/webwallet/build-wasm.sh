#!/bin/bash
set -e

# Build script for WebZjs WASM modules with SharedArrayBuffer support
# This script compiles the WASM with atomics, bulk-memory, and mutable-globals
# to enable multi-threading via wasm-bindgen-rayon
#
# Based on ChainSafe's WebZjs build process:
# https://github.com/ChainSafe/WebZjs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔧 Building WebZjs WASM modules with shared memory support..."
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

# Build webzjs-keys (no special features needed, but use build-std for consistency)
echo ""
echo "🔑 Building webzjs-keys..."
cd crates/webzjs-keys
wasm-pack build --target web --release --out-dir pkg \
    --no-default-features \
    -Z build-std="panic_abort,std"
cd "$SCRIPT_DIR"

# Build webzjs-wallet with wasm-parallel feature for multi-threading
echo ""
echo "💼 Building webzjs-wallet with multi-threading support..."
cd crates/webzjs-wallet
wasm-pack build --target web --release --out-dir pkg \
    --no-default-features --features="wasm wasm-parallel" \
    -Z build-std="panic_abort,std"
cd "$SCRIPT_DIR"

# Update package.json names for workspace linking
echo ""
echo "📦 Updating package names for workspace..."
cd crates/webzjs-keys/pkg
if grep -q '"name": "webzjs-keys"' package.json 2>/dev/null; then
    sed -i.bak 's/"name": "webzjs-keys"/"name": "@chainsafe\/webzjs-keys"/' package.json
    rm -f package.json.bak
fi
cd "$SCRIPT_DIR"

cd crates/webzjs-wallet/pkg
if grep -q '"name": "webzjs-wallet"' package.json 2>/dev/null; then
    sed -i.bak 's/"name": "webzjs-wallet"/"name": "@chainsafe\/webzjs-wallet"/' package.json
    rm -f package.json.bak
fi
cd "$SCRIPT_DIR"

echo ""
echo "✅ WASM build complete!"
echo ""
echo "The following packages have been built:"
echo "  - crates/webzjs-keys/pkg/"
echo "  - crates/webzjs-wallet/pkg/"
echo ""
echo "To use in web-wallet, run:"
echo "  cd web-wallet && pnpm install && pnpm run dev"

