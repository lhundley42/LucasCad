import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ cacheDir: "node_modules/.vite-fillet-qa", plugins: [react()], server: { host: "127.0.0.1", port: 4312, strictPort: true }, build: { outDir: "dist-browser-tests" } });
