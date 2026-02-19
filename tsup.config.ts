import { defineConfig } from "tsup";

export default defineConfig([
  // Core (vanilla TS — no framework deps)
  {
    entry: { "core/index": "src/core/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    target: "es2020",
    treeshake: true,
  },
  // React wrapper
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    target: "es2020",
    treeshake: true,
    external: ["react"],
  },
  // Svelte wrapper
  {
    entry: { "svelte/index": "src/svelte/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    target: "es2020",
    treeshake: true,
    external: ["svelte"],
  },
]);
