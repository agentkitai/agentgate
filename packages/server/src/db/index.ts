import { drizzle } from "drizzle-orm/better-sqlite3";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema.js";

// Get database path from env or use default
// Special value ":memory:" creates in-memory database
function getDatabasePath(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    return envUrl; // Can be ":memory:" or a file path
  }
  return resolve(process.cwd(), "./data/agentgate.db");
}

const DB_PATH = getDatabasePath();

// Ensure data directory exists (only for file-based databases)
if (DB_PATH !== ":memory:") {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

// Create SQLite connection
const sqlite: SqliteDatabase = new Database(DB_PATH);

// Enable WAL mode for better concurrent read/write performance (only for file-based)
if (DB_PATH !== ":memory:") {
  sqlite.pragma("journal_mode = WAL");
}

// Create Drizzle instance
export const db = drizzle(sqlite, { schema });

// Export raw sqlite for migrations
export { sqlite, type SqliteDatabase };

// Export schema for convenience
export * from "./schema.js";
