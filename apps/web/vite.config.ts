import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { newPayrollApiPlugin } from "./plugins/new-payroll-api";

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react(), newPayrollApiPlugin(repoRoot)],
  server: {
    port: 3000,
    proxy: {
      "/crs-proxy": {
        target: "https://crs.aztec.network",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/crs-proxy/, ""),
      },
    },
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    exclude: [
      "@aztec/bb.js",
      "@noir-lang/acvm_js",
      "@noir-lang/noirc_abi",
      "@noir-lang/noir_js",
    ],
  },
});
