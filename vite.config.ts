import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // The file: dependency lives outside this repo, so dev must be allowed to serve its wasm.
    fs: { allow: [".", "../open-servo-core/client/web"] },
  },
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
        prerender: { outputPath: "/index.html" },
      },
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
