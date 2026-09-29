// @lovable.dev/vite-tanstack-config already includes tanstackStart, React, Tailwind, nitro, etc.
// Do NOT add them manually.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  // Build a standard Node.js web server (runs on AWS, Azure, GCP, any VPS, Docker).
  nitro: { preset: "node-server" },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
} as Parameters<typeof defineConfig>[0]);
