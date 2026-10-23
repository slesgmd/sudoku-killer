// Propiedades con semilla visible: todo fallo de una prueba aleatoria dice con qué semilla
// reproducirlo, y cada semilla que falló queda como caso fijo de regresión (docs/motor.md).
import fc from "fast-check";

/** Una ejecución que falló, tal como la informa fast-check: `{ seed, path }`. */
export interface Regression {
  readonly seed: number;
  readonly path?: string;
}

export interface PropertyOptions {
  readonly numRuns?: number;
  /** Semillas que fallaron alguna vez: se ejecutan siempre, antes que la aleatoria. */
  readonly regressions?: readonly Regression[];
}

function run<Ts>(property: fc.IProperty<Ts>, params: fc.Parameters<Ts>): number {
  const details = fc.check(property, params);
  if (details.failed) {
    // El mensaje de fast-check incluye la semilla, el path y el contraejemplo reducido.
    throw new Error(fc.defaultReportMessage(details), { cause: details.errorInstance });
  }
  return details.seed;
}

/**
 * Como `fc.assert`, con dos diferencias. Primero ejecuta las regresiones registradas y después una
 * semilla nueva. Devuelve esa semilla para que las comprobaciones posteriores sobre el conjunto de
 * ejecuciones también la impriman al fallar (`expect(x, seedMessage(seed))`).
 */
export function assertProperty<Ts>(
  property: fc.IProperty<Ts>,
  { numRuns, regressions = [] }: PropertyOptions = {},
): number {
  const runs: fc.Parameters<Ts> = numRuns === undefined ? {} : { numRuns };
  for (const regression of regressions) run(property, { ...runs, ...regression });
  return run(property, runs);
}

/** Mensaje para un `expect` que depende de toda la ejecución de una propiedad. */
export function seedMessage(seed: number): string {
  return `fast-check seed ${String(seed)} (add it to the regressions of this property)`;
}
