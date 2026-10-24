// Punto de entrada del cliente (`@sudoku-killer/game/client`): solo lo que el navegador necesita en
// producción. No exporta `decide` ni arrastra el calificador, el generador ni los solvers (T-31.2).
export { NORMAL_RULES, normalCan, type Action, type ModeRules } from "./permissions.ts";
export { closedUnitsOf, noteKey } from "./board.ts";
