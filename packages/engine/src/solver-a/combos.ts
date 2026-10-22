// Tabla de combinaciones por jaula: para cada (tamaño de jaula, suma), las máscaras de dígitos
// distintos que la cumplen. Se construye una vez por tamaño de tablero recorriendo las 2^size
// máscaras (65 536 en 16×16).

type Table = readonly (readonly (readonly number[])[])[];

const EMPTY: readonly number[] = [];
const tables = new Map<number, Table>();

function buildTable(size: number): Table {
  const maxSum = (size * (size + 1)) / 2;
  const table: number[][][] = Array.from({ length: size + 1 }, () =>
    Array.from({ length: maxSum + 1 }, () => []),
  );
  const counts = new Uint8Array(1 << size);
  const sums = new Uint16Array(1 << size);
  for (let mask = 1; mask < 1 << size; mask++) {
    // La máscara sin su bit más bajo ya está calculada.
    const rest = mask & (mask - 1);
    const digit = 32 - Math.clz32(mask & -mask);
    counts[mask] = counts[rest]! + 1;
    sums[mask] = sums[rest]! + digit;
    table[counts[mask]!]![sums[mask]!]!.push(mask);
  }
  return table;
}

/** Máscaras de `count` dígitos distintos entre 1 y `size` que suman `sum`, de menor a mayor. */
export function cageCombinations(size: number, count: number, sum: number): readonly number[] {
  let table = tables.get(size);
  if (!table) {
    table = buildTable(size);
    tables.set(size, table);
  }
  return table[count]?.[sum] ?? EMPTY;
}
