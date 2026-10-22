// Máscaras de candidatos: el bit d − 1 corresponde al dígito d (SPEC §2.1).

export function digitBit(digit: number): number {
  return 1 << (digit - 1);
}

/** Máscara con los dígitos 1..size. */
export function fullMask(size: number): number {
  return (1 << size) - 1;
}

export function hasDigit(mask: number, digit: number): boolean {
  return (mask & digitBit(digit)) !== 0;
}

export function popcount(mask: number): number {
  let count = 0;
  for (let m = mask; m !== 0; m &= m - 1) count++;
  return count;
}

/** Dígitos presentes en la máscara, de menor a mayor. */
export function digitsOf(mask: number): number[] {
  const digits: number[] = [];
  for (let digit = 1, m = mask; m !== 0; digit++, m >>>= 1) {
    if (m & 1) digits.push(digit);
  }
  return digits;
}

/** El dígito si la máscara tiene exactamente uno; si no, 0. */
export function singleDigit(mask: number): number {
  if (mask === 0 || (mask & (mask - 1)) !== 0) return 0;
  return 31 - Math.clz32(mask) + 1;
}
