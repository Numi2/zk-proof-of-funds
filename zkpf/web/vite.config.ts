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
    // Proxy lightwalletd requests to avoid CORS issues in development
    proxy: {
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
      // WebWallet WASM bindings built from `zkpf/webwallet/crates/webzjs-wallet`
      // Expected build output:
      //   cd zkpf/webwallet
      //   wasm-pack build crates/webzjs-wallet --target web --out-dir pkg
      // which produces `pkg/webzjs_wallet.js` and friends.
      '@chainsafe/webzjs-wallet': path.resolve(__dirname, '../webwallet/pkg/webzjs_wallet.js'),
      // WebKeys WASM bindings built from `zkpf/webwallet/crates/webzjs-keys`
      // Expected build output:
      //   cd zkpf/webwallet
      //   wasm-pack build crates/webzjs-keys --target web --out-dir pkg
      // which produces `pkg/webzjs_keys.js` and friends.
      '@chainsafe/webzjs-keys': path.resolve(__dirname, '../webwallet/crates/webzjs-keys/pkg/webzjs_keys.js'),
    },
  },
  optimizeDeps: {
    // Exclude WASM modules from pre-bundling
    exclude: ['@chainsafe/webzjs-wallet', '@chainsafe/webzjs-keys'],
  },
});
