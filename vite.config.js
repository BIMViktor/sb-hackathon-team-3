import { defineConfig } from "vite";

// Relative base so the same build works on a Vercel root domain.
export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
  },
});
