// Reloj del servidor (SPEC §8.2): la hora y los temporizadores llegan por esta interfaz, así las
// pruebas avanzan un reloj falso a mano y prueban los plazos de 120 s sin esperar.
export interface Clock {
  /** Milisegundos desde la época Unix. */
  now(): number;
  /** Programa `fn` dentro de `ms` milisegundos. Devuelve la función que lo cancela. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => {
      clearTimeout(handle);
    };
  },
};
