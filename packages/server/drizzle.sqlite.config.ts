import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.sqlite.ts",
  out: "./drizzle/sqlite",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "./data/agentgate.db",
  },
});
