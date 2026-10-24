// Propiedades asíncronas con semilla visible, como `assertProperty` del motor
// (packages/engine/test/helpers/property.ts): todo fallo dice con qué semilla reproducirlo, y las
// semillas que fallaron se agregan como regresiones fijas.
import fc from "fast-check";
import type { PropertyOptions } from "../../../../packages/engine/test/helpers/property.ts";

async function run<Ts>(
  property: fc.IAsyncProperty<Ts>,
  params: fc.Parameters<Ts>,
): Promise<number> {
  const details = await fc.check(property, params);
  if (details.failed) {
    throw new Error(fc.defaultReportMessage(details), { cause: details.errorInstance });
  }
  return details.seed;
}

export async function assertAsyncProperty<Ts>(
  property: fc.IAsyncProperty<Ts>,
  { numRuns, regressions = [] }: PropertyOptions = {},
): Promise<number> {
  const runs: fc.Parameters<Ts> = numRuns === undefined ? {} : { numRuns };
  for (const regression of regressions) await run(property, { ...runs, ...regression });
  return run(property, runs);
}
