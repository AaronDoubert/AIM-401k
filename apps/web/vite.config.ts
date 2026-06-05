import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Condenser visual prototype dev/build config.
// The app consumes the built workspace packages (@condenser/*) via pnpm
// workspace resolution, so run `pnpm build` at the repo root once before
// `vite build` / `vite preview` on a fresh checkout (turbo wires this up).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
});
