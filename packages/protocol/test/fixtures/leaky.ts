// Fixture de control para T-31.3: cada exportación esconde un campo `solution`.
import { z } from "zod";

export interface LeakyState {
  board: { cells: { value: number; solution: number }[] };
}

export type LeakyAlias = Record<string, { solution: string }>;

export const leakySchema = z.object({
  match: z.object({ solution: z.array(z.number()) }),
});

export function leakyFactory(): { puzzle: { solution: number[] } } {
  return { puzzle: { solution: [] } };
}

export const clean = { cells: [] as number[] };

export type LeakyInferred = z.infer<typeof leakySchema>;
