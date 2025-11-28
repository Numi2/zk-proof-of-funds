import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
    {
      name: 'wasm-worker-resolve',
      enforce: 'pre',
      resolveId(id) {
        // Handle worker module imports that reference non-existent bundler files
        if (id && id.includes('web_worker_module.bundler.js')) {
          // Create a virtual module ID to prevent Vite from trying to resolve the file
          return `\0wasm-worker-stub-${id}`;
        }
        return null;
      },
      load(id) {
        // Provide a stub for worker bundler files
        if (id.startsWith('\0wasm-worker-stub-')) {
          // Return a minimal worker that does nothing (workers are optional for wasm-bindgen-rayon)
          return `// Stub worker module for wasm-bindgen-rayon
export default function () {
  // Worker stub - threading may not be available
}`;
        }
        return null;
      },
    },
  ],
  worker: {
    // wasm-bindgen-rayon expects ESM workers; Vite defaults to "iife" which
    // breaks when workers use code-splitting. Force ES module workers so
    // bundling succeeds in both local and Vercel builds.
    format: 'es',
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
      // WebWallet WASM bindings - THREADED variant (requires SharedArrayBuffer)
      // Build with: cd zkpf/webwallet && ./build-wasm.sh
      // The threaded build is the default for backwards compatibility
      '@chainsafe/webzjs-wallet': path.resolve(__dirname, '../webwallet/crates/webzjs-wallet/pkg-threads/webzjs_wallet_threads.js'),
      // WebWallet WASM bindings - SINGLE-THREADED variant (works on all browsers)
      // Used as fallback when SharedArrayBuffer is unavailable
      '@chainsafe/webzjs-wallet-single': path.resolve(__dirname, '../webwallet/crates/webzjs-wallet/pkg-single/webzjs_wallet_single.js'),
      // WebKeys WASM bindings built from `zkpf/webwallet/crates/webzjs-keys`
      '@chainsafe/webzjs-keys': path.resolve(__dirname, '../webwallet/crates/webzjs-keys/pkg/webzjs_keys.js'),
      // Chat WASM bindings built from `zkpf/zkpf-chat/browser-wasm`
      // Build with (requires LLVM with WASM target):
      //   cd zkpf/zkpf-chat && CC_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/clang" \
      //     AR_wasm32_unknown_unknown="/opt/homebrew/opt/llvm/bin/llvm-ar" \
      //     wasm-pack build ./browser-wasm --dev --weak-refs --reference-types -t bundler -d pkg
      'chat-browser': path.resolve(__dirname, '../zkpf-chat/browser-wasm/pkg/chat_browser.js'),
    },
  },
  optimizeDeps: {
    // Exclude WASM modules from pre-bundling
    exclude: ['@chainsafe/webzjs-wallet', '@chainsafe/webzjs-wallet-single', '@chainsafe/webzjs-keys', 'chat-browser'],
  },
});
