import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cross-Origin Isolation headers required for SharedArrayBuffer (WASM threading)
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Use 'credentialless' instead of 'require-corp' to allow external resources
  // without requiring them to have CORP headers (more compatible with third-party APIs)
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  worker: {
    // wasm-bindgen-rayon expects ESM workers; Vite defaults to "iife" which
    // breaks when workers use code-splitting. Force ES module workers so
    // bundling succeeds in both local and Vercel builds.
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    fs: {
      // Allow serving files from the webwallet directory for WASM modules
      allow: ['..'],
    },
    // Enable Cross-Origin Isolation headers for SharedArrayBuffer support
    headers: crossOriginIsolationHeaders,
    // Proxy API requests in development
    proxy: {
      // Proxy zkpf API requests to the Rust backend
      // Use '/zkpf/' (with trailing slash) to avoid proxying /zkpf.png and other static assets
      '/zkpf/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy personhood API requests to the Rust backend
      '/api/personhood': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Proxy lightwalletd requests to avoid CORS issues in development
      '/lightwalletd': {
        target: 'https://zcash-mainnet.chainsafe.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lightwalletd/, ''),
        // Forward gRPC-web headers
        headers: {
          'Origin': 'https://zcash-mainnet.chainsafe.dev',
        },
      },
    },
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  resolve: {
    alias: {
      // WebWallet WASM bindings - vendored single-threaded build (no worker bundling)
      // Source: generated from `cd zkpf/webwallet && ./build-wasm.sh single`
      // and copied into `web/src/wasm/webzjs-wallet-single/` for deployment.
      '@chainsafe/webzjs-wallet': path.resolve(__dirname, './src/wasm/webzjs-wallet-single/webzjs_wallet_single.js'),
      '@chainsafe/webzjs-wallet-single': path.resolve(__dirname, './src/wasm/webzjs-wallet-single/webzjs_wallet_single.js'),
      // WebKeys WASM bindings built from `zkpf/webwallet/crates/webzjs-keys`
      '@chainsafe/webzjs-keys': path.resolve(__dirname, '../webwallet/crates/webzjs-keys/pkg/webzjs_keys.js'),
      // Chat WASM bindings built from `zkpf/zkpf-chat/browser-wasm`
      // Build with (requires LLVM with WASM target):
      //   cd zkpf/zkpf-chat && CC_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/clang" \
      //     AR_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/llvm-ar" \
      //     wasm-pack build ./browser-wasm --dev --weak-refs --reference-types -t bundler -d pkg
      // The generated npm package is checked in at zkpf/zkpf-chat/pkg so Vercel
      // builds do not need to compile the WASM artifact.
      'chat-browser': path.resolve(__dirname, '../zkpf-chat/pkg/chat_browser.js'),
    },
  },
  optimizeDeps: {
    // Exclude WASM modules from pre-bundling
    exclude: ['@chainsafe/webzjs-wallet', '@chainsafe/webzjs-wallet-single', '@chainsafe/webzjs-keys', 'chat-browser'],
  },
  build: {
    target: 'esnext',
  },
});
