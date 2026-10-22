/**
 * Elemento `index` de `list`, o un `RangeError` si no existe. Sustituye a la aserción `!` fuera
 * de los solvers (docs/motor.md): un índice fuera de rango falla en el acto en vez de propagar
 * `undefined`.
 */
export function at<T>(list: ArrayLike<T>, index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`Index ${String(index)} is out of range`);
  return value;
}
