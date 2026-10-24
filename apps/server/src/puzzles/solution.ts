// Solución guardada como texto (ADR 0003): un carácter en base 36 por celda, por filas.

export function encodeSolution(solution: readonly number[]): string {
  return solution
    .map((digit) => {
      if (!Number.isInteger(digit) || digit < 1 || digit > 35) {
        throw new RangeError(`Invalid digit ${String(digit)}`);
      }
      return digit.toString(36);
    })
    .join("");
}

export function decodeSolution(text: string): number[] {
  return Array.from({ length: text.length }, (_, i) => {
    const char = text.charAt(i);
    const digit = parseInt(char, 36);
    if (Number.isNaN(digit) || digit < 1)
      throw new RangeError(`Invalid solution character ${char}`);
    return digit;
  });
}
