import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Paquetes puros: el tiempo y el azar llegan desde fuera (ADR 0004, SPEC §5). */
export const PURE_PACKAGES = ["packages/engine/**", "packages/scoring/**", "packages/game/**"];

/** Código de los solvers: el único lugar del monorepo donde se permite la aserción `!`. */
export const SOLVER_FILES = [
  "packages/engine/src/solver-a/**/*.ts",
  "packages/engine/src/solver-b/**/*.ts",
];

/** Pruebas de todo el monorepo. */
const TEST_FILES = ["**/test/**", "tests/**"];

const PURE_RESTRICTIONS = [
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
];

const TEST_RESTRICTIONS = [
  {
    object: "fc",
    property: "assert",
    message:
      "Usar assertProperty (packages/engine/test/helpers/property.ts): imprime la semilla en todo fallo y ejecuta las regresiones (docs/motor.md).",
  },
];

export default defineConfig(
  globalIgnores(["**/dist/", "**/coverage/", "evidence/", "design/prototipo/"]),
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
    files: ["**/*.{js,mjs}"],
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
  // Las opciones de una regla no se suman entre bloques: el último que aplica las reemplaza. Por
  // eso las pruebas de los paquetes puros repiten las dos listas.
  {
    files: PURE_PACKAGES,
    rules: { "no-restricted-properties": ["error", ...PURE_RESTRICTIONS] },
  },
  {
    files: TEST_FILES,
    rules: { "no-restricted-properties": ["error", ...TEST_RESTRICTIONS] },
  },
  {
    files: PURE_PACKAGES.map((pkg) => pkg.replace("/**", "/test/**")),
    rules: { "no-restricted-properties": ["error", ...PURE_RESTRICTIONS, ...TEST_RESTRICTIONS] },
  },
  {
    // Solo los solvers: bucles críticos sobre arreglos tipados con índices garantizados por
    // construcción. El resto del motor usa comprobaciones explícitas (docs/motor.md).
    files: SOLVER_FILES,
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
