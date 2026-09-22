import tailwindcss from "@tailwindcss/vite";
import babel from "@rolldown/plugin-babel";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Dev serves the sibling monorepo's descriptors so nothing reaches for GitHub. */
function localDescriptors(): Plugin {
  return {
    name: "local-descriptors",
    configureServer(server) {
      const root = path.resolve(server.config.root, "../open-servo-core/descriptors");
      server.middlewares.use("/descriptors", (req, res, next) => {
        const file = path.join(root, new URL(req.url ?? "/", "http://localhost").pathname);
        if (!file.startsWith(root + path.sep) || !file.endsWith(".json")) {
          next();
          return;
        }
        readFile(file).then(
          (data) => {
            res.setHeader("content-type", "application/json");
            res.end(data);
          },
          () => {
            next();
          },
        );
      });
    },
  };
}

export default defineConfig({
  resolve: { alias: { "@": "/src" } },
  server: {
    // The file: dependency lives outside this repo, so dev must be allowed to serve its wasm.
    fs: { allow: [".", "../open-servo-core/client/web"] },
  },
  plugins: [
    localDescriptors(),
    tailwindcss(),
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
