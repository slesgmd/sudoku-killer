// drizzle-kit (ADR 0003): genera las migraciones versionadas desde `src/db/schema.ts`.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
