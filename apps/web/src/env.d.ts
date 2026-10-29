// Variables del build: `VITE_SERVER_URL`, el WebSocket del servidor de salas en producción
// (`wss://…/ws`); vite.config.ts la valida antes de compilar.
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}
