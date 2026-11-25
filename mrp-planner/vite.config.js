import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const env = { ...loadEnv('development', projectRoot, ''), ...process.env };
const apiProxy = { '/api': { target: `http://127.0.0.1:${Number(env.PORT) || 3001}`, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: false,
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
    host: "0.0.0.0",
    port: 4173,
    strictPort: false,
  },
});
