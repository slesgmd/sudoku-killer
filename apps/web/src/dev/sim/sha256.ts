// SHA-256 en JavaScript (FIPS 180-4), solo para el servidor simulado cuando el navegador no expone
// `crypto.subtle` (página servida por `http://<IP>` de la red local, que no es un contexto seguro).
// Así la comprobación del hash contra el manifiesto no se omite. Una prueba compara con `node:crypto`.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H0 = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

function at(words: Uint32Array, i: number): number {
  return words[i] ?? 0;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** El SHA-256 de los bytes, en hexadecimal (64 dígitos). */
export function sha256Hex(bytes: Uint8Array): string {
  // Relleno: un bit 1, ceros y la longitud en bits (64 bits, big-endian), hasta un múltiplo de 64.
  const total = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(total);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const bits = bytes.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x1_0000_0000));
  view.setUint32(total - 4, bits >>> 0);

  const h = new Uint32Array(H0);
  const w = new Uint32Array(64);
  const v = new Uint32Array(8);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = at(w, i - 15);
      const w2 = at(w, i - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = at(w, i - 16) + s0 + at(w, i - 7) + s1;
    }
    // v = [a, b, c, d, e, f, g, h] de cada bloque.
    v.set(h);
    for (let i = 0; i < 64; i++) {
      const a = at(v, 0);
      const b = at(v, 1);
      const c = at(v, 2);
      const d = at(v, 3);
      const e = at(v, 4);
      const f = at(v, 5);
      const g = at(v, 6);
      const t1 =
        at(v, 7) + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + at(K, i);
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      v.set([t1 + at(w, i) + t2, a, b, c, d + t1 + at(w, i), e, f, g].map((x) => x >>> 0));
    }
    for (let j = 0; j < 8; j++) h[j] = at(h, j) + at(v, j);
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}
