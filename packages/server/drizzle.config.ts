/**
 * Default drizzle config - uses SQLite
 * 
 * For dialect-specific configs, use:
 *   - drizzle.sqlite.config.ts
 *   - drizzle.postgres.config.ts
 * 
 * Or use the npm scripts:
 *   - pnpm db:generate:sqlite
 *   - pnpm db:generate:postgres
 *   - pnpm db:migrate:sqlite
 *   - pnpm db:migrate:postgres
 */
import { defineConfig } from "drizzle-kit";

const dialect = process.env.DB_DIALECT?.toLowerCase() === "postgres" ? "postgresql" : "sqlite";

export default defineConfig({
  schema: dialect === "postgresql" 
    ? "./src/db/schema.postgres.ts" 
    : "./src/db/schema.sqlite.ts",
  out: dialect === "postgresql" 
    ? "./drizzle/postgres" 
    : "./drizzle/sqlite",
  dialect: dialect,
  dbCredentials: {
    url: process.env.DATABASE_URL || 
      (dialect === "postgresql" 
        ? "postgresql://localhost:5432/agentgate" 
        : "./data/agentgate.db"),
  },
});
