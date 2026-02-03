import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.postgres.ts",
  out: "./drizzle/postgres",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://localhost:5432/agentgate",
  },
});
