import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/types.ts", "src/**/*.test.{ts,tsx}"],
      thresholds: {
        statements: 40,
        branches: 40,
        functions: 35,
        lines: 45,
      },
    },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    cssMinify: "esbuild",
    sourcemap: false,
  },
});
