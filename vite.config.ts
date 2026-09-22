import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      // Delete with src/stubs and src/types/osc-client.d.ts once client/web/pkg exists.
      "@openservocore/client": "/src/stubs/osc-client.ts",
    },
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
