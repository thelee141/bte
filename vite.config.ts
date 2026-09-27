import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4100",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "../web-dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
