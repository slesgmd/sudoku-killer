# 0001 — Stack tecnológico

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto
`PLAN.md` §3 propone un stack por defecto que hay que confirmar en F2. Las restricciones son estas:
- Una sola persona desarrolla.
- TypeScript estricto de punta a punta, con esquemas compartidos entre el cliente y el servidor.
- Lógica pura y testeable con pruebas de propiedades.
- Tiempo real con un servidor autoritativo.
- Una sola instancia en la v1, pero sin cerrar la puerta a escalar.
- Entorno verificado en F0: Node 24, pnpm 12, Windows para desarrollo y Linux para la CI.

## Decisión

| Capa | Elección |
|---|---|
| Monorepo | pnpm workspaces: `packages/{engine,protocol,scoring,game}` y `apps/{server,web}` (`packages/game` se agrega en el ADR 0004) |
| Lenguaje | TypeScript en modo `strict`, más `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Módulos ESM. |
| Runtime del servidor | Node 24 LTS |
| Tiempo real | WebSocket con `ws` (ADR 0002) |
| Validación | Zod: los esquemas viven en `packages/protocol` y los usan los dos extremos |
| Cliente | React y Vite. Estado de la partida en un store propio y pequeño, alimentado por el `Transport`, sin una librería de estado global. i18n con claves desde el primer día; la librería se elige en F8. |
| Base de datos | PostgreSQL con Drizzle ORM y migraciones versionadas (ADR 0003). En las pruebas, PGlite: Postgres en proceso, sin Docker. |
| Pruebas | Vitest, fast-check, Testing Library y Playwright |
| Calidad | ESLint con `typescript-eslint` y reglas con información de tipos (`no-floating-promises`, entre otras), Prettier, y hooks de pre-commit con `lint-staged` |
| CI | GitHub Actions: `pnpm check` y `pnpm test` en Linux |

Las versiones exactas se fijan en F3, en el `package.json` y en el lockfile.

## Alternativas consideradas
- **Biome en lugar de ESLint y Prettier:** es más rápido y es una sola herramienta, pero no tiene reglas con información de tipos como `no-floating-promises`, que son críticas en un servidor asíncrono. Se puede revisar en el futuro.
- **Next.js o un framework con renderizado en el servidor:** no aporta nada a un cliente de tiempo real que funciona como una aplicación de una sola página, y complica el despliegue del WebSocket.
- **Bun o Deno:** menos maduros para `ws`, Drizzle y Playwright en Windows. Node 24 ya está verificado.
- **SQLite:** es más simple, pero F12 prevé una base de datos gestionada con respaldos, y con Postgres el registro de eventos crece sin cambiar de motor.
- **Prisma:** tiene un motor aparte y es más pesado. Drizzle es TypeScript puro y se lleva bien con PGlite.

## Consecuencias
- Un solo lenguaje y un solo conjunto de esquemas reducen la desincronización entre el cliente y el servidor.
- PGlite permite probar los repositorios sin infraestructura. La paridad con Postgres real se verifica en F12.
- Las reglas con información de tipos hacen el lint más lento, lo que se compensa con caché en la CI.
- Queda pendiente para F8 la librería de i18n.

## Nota de F3 (2026-10-22): versiones fijadas
- TypeScript queda en **6.0.x**, no en la 7 (`latest`). La 7 es el compilador nativo y no expone la API de JS que necesitan `typescript-eslint` (8.72 admite `<6.1`) y el test T-31.3. Se revisa cuando `typescript-eslint` admita la 7.
- Resto: ESLint 10, Prettier 3.9, Vitest 5, fast-check 4, Zod 4, Vite 8, React 19 y Husky 9 con lint-staged 17. Las versiones exactas están en los `package.json` y en `pnpm-lock.yaml`.
- Los paquetes exportan sus fuentes con la condición `@sudoku-killer/source` (TypeScript, Vite, Vitest y `node --conditions` en desarrollo), y `dist/` en otro caso. Los imports relativos llevan la extensión `.ts` (`rewriteRelativeImportExtensions`), así Node 24 ejecuta las fuentes sin compilar.

## Nota de F8 (2026-10-24): i18n sin librería
- Los textos de la interfaz están en un catálogo propio (`apps/web/src/i18n/es.ts`) con claves tipadas y una función `t(clave, variables)`. Las variables van entre llaves, y los plurales como `{ one, other }` se eligen con `Intl.PluralRules`.
- No se usa ninguna librería: la v1 tiene un solo idioma y unas 135 claves, y el tipo de las claves ya detecta un texto que falte. Si llega un segundo idioma, se agrega otro catálogo con el mismo tipo y se revisa esta decisión.
- El estado del cliente es un store propio con `useSyncExternalStore`, como pedía este ADR.
