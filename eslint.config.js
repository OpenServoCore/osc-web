import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist/",
    ".output/",
    "coverage/",
    "playwright-report/",
    "test-results/",
    "src/routeTree.gen.ts",
  ]),
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    // Node tooling scripts, not part of the app bundle.
    files: ["scripts/**"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    // Vendored shadcn registry files: keep them diffable against upstream.
    files: ["src/components/ui/**"],
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  prettier,
]);
