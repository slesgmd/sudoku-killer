// Alias que solo existe en desarrollo y en las pruebas (vite.config.ts): el manifiesto del banco para
// el servidor simulado. El build de producción no lo resuelve (T-31.2).
declare module "@dev/bank-manifest" {
  const manifest: unknown;
  export default manifest;
}
