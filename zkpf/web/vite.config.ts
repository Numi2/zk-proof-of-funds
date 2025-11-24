import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow serving files from the webwallet directory for WASM modules
      allow: ['..'],
    },
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
});
