import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Paquetes puros: el tiempo y el azar llegan desde fuera (ADR 0004, SPEC §5). */
export const PURE_PACKAGES = ["packages/engine/**", "packages/scoring/**", "packages/game/**"];

export default defineConfig(
  globalIgnores(["**/dist/", "**/coverage/", "evidence/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/server/**", "**/test/**", "tests/**", "*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: PURE_PACKAGES,
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "Paquete puro: el tiempo llega en el evento o en el contexto (ADR 0004).",
        },
        {
          object: "Math",
          property: "random",
          message: "Paquete puro: el azar llega como un generador con semilla (ADR 0004).",
        },
      ],
    },
  },
  {
    // Motor: índices garantizados por construcción en bucles sobre arreglos tipados.
    files: ["packages/engine/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    // El solver B no reutiliza código de A ni del modelo: solo los tipos de datos (SPEC R-35).
    files: ["packages/engine/src/solver-b/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: String.raw`^\.\./(?!types\.ts$)|^@sudoku-killer/`,
              message: "Solver B: solo puede importar ../types.ts y sus propios módulos (R-35).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/src/solver-a/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "solver-b",
              message: "Solver A no puede importar el solver B (R-35).",
            },
          ],
        },
      ],
    },
  },
);
