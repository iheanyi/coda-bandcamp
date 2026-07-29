import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

const serverPort = Number(process.env.PORT ?? 1420);
if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const nodeMajorVersion = Number.parseInt(process.versions.node, 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: serverPort,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "jsdom",
    // Node 25+ enables its own Web Storage globals by default. Disable them in
    // test workers so jsdom remains the single browser-storage implementation.
    execArgv: nodeMajorVersion >= 25 ? ["--no-experimental-webstorage"] : [],
    setupFiles: ["./test/setup.ts"],
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
    sourcemap: false,
  },
});
