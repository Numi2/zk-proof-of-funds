import { defineConfig } from "vite";
// https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react
// import react from "@vitejs/plugin-react";
// https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react-swc
import react from "@vitejs/plugin-react-swc";

import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), // https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
    nodePolyfills({
      include: ["path", "stream", "util", "assert", "crypto"],
      exclude: ["http"],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      overrides: {
        fs: "memfs",
      },
      protocolImports: true,
    }),
  ],
  server: {
    open: true,
    host: true,
  },
});
