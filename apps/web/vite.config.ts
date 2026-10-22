import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Los paquetes del monorepo se consumen desde sus fuentes TypeScript.
    conditions: ["@sudoku-killer/source", ...defaultClientConditions],
  },
});
