import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const api = "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  // TVs Samsung (Tizen 5.5+) e LG usam Chromium antigo (69+): o build converte a sintaxe nova (?., ??).
  build: { target: ["es2019", "chrome69", "edge88", "firefox78", "safari13"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    port: 8080,
    proxy: { "/api": api },
  },
});
