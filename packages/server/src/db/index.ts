/**
 * Database connection module
 * 
 * Supports both SQLite and PostgreSQL via DB_DIALECT environment variable.
 * Default: sqlite
 * 
 * SQLite:
 *   - DB_DIALECT=sqlite (or unset)
 *   - DATABASE_URL=./data/agentgate.db (file path or :memory:)
 * 
 * PostgreSQL:
 *   - DB_DIALECT=postgres
 *   - DATABASE_URL=postgresql://user:pass@host:5432/dbname
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

// Type for supported dialects
export type DbDialect = "sqlite" | "postgres";

// Schema type union for both dialects
import type * as sqliteSchema from "./schema.sqlite.js";

// The schema shapes are identical, so we use the SQLite schema type
type Schema = typeof sqliteSchema;

// Union type for the database instance
export type Database = 
  | BetterSQLite3Database<Schema>
  | PostgresJsDatabase<Schema>;

// Get the current dialect from environment
export function getDialect(): DbDialect {
  const dialect = process.env.DB_DIALECT?.toLowerCase();
  if (dialect === "postgres" || dialect === "postgresql") {
    return "postgres";
  }
  return "sqlite";
}

// Get database URL from environment
function getDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    return envUrl;
  }
  // Default for SQLite
  return "./data/agentgate.db";
}

// Lazy-loaded database instance
let _db: Database | null = null;
let _sqlite: import("better-sqlite3").Database | null = null;
let _pgClient: import("postgres").Sql | null = null;

/**
 * Initialize and return the database instance
 * 
 * This function is async to support dynamic imports and lazy loading.
 * Call this at application startup.
 */
export async function initDatabase(): Promise<Database> {
  if (_db) {
    return _db;
  }

  const dialect = getDialect();
  const dbUrl = getDatabaseUrl();

  if (dialect === "postgres") {
    // Dynamically import PostgreSQL dependencies
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    const schema = await import("./schema.postgres.js");

    // Create postgres client
    _pgClient = postgres(dbUrl);
    
    // Create Drizzle instance
    _db = drizzle(_pgClient, { schema }) as unknown as Database;
  } else {
    // Dynamically import SQLite dependencies
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const Database = (await import("better-sqlite3")).default;
    const { mkdirSync, existsSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const schema = await import("./schema.sqlite.js");

    // Resolve database path
    const dbPath = dbUrl === ":memory:" ? ":memory:" : resolve(process.cwd(), dbUrl);

    // Ensure data directory exists (only for file-based databases)
    if (dbPath !== ":memory:") {
      const dataDir = dirname(dbPath);
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
    }

    // Create SQLite connection
    _sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrent read/write performance (only for file-based)
    if (dbPath !== ":memory:") {
      _sqlite.pragma("journal_mode = WAL");
    }

    // Create Drizzle instance
    _db = drizzle(_sqlite, { schema }) as unknown as Database;
  }

  return _db;
}

/**
 * Get the database instance (must call initDatabase first)
 * 
 * @throws Error if database not initialized
 */
export function getDatabase(): Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _db;
}

/**
 * Get the database instance typed for use with SQLite schema tables.
 * 
 * Both SQLite and PostgreSQL Drizzle instances expose the same query API
 * (.select(), .insert(), .update(), .delete()), so we return the SQLite
 * flavor type which all route/lib files were originally written against.
 * At runtime, PostgresJsDatabase methods are fully compatible.
 * 
 * @throws Error if database not initialized
 */
export function getDb(): BetterSQLite3Database<Schema> {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _db as unknown as BetterSQLite3Database<Schema>;
}

/**
 * Get the raw SQLite connection (only for SQLite dialect)
 * 
 * @throws Error if using PostgreSQL or not initialized
 */
export function getSqliteConnection(): import("better-sqlite3").Database {
  if (getDialect() !== "sqlite") {
    throw new Error("getSqliteConnection() is only available for SQLite dialect");
  }
  if (!_sqlite) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _sqlite;
}

/**
 * Get the raw PostgreSQL client (only for PostgreSQL dialect)
 * 
 * @throws Error if using SQLite or not initialized
 */
export function getPostgresClient(): import("postgres").Sql {
  if (getDialect() !== "postgres") {
    throw new Error("getPostgresClient() is only available for PostgreSQL dialect");
  }
  if (!_pgClient) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _pgClient;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
  }
  if (_pgClient) {
    await _pgClient.end();
    _pgClient = null;
  }
  _db = null;
}

/**
 * Run database migrations automatically.
 *
 * Uses drizzle-orm's built-in migrators which are idempotent — already-applied
 * migrations are skipped.  Must be called after initDatabase().
 *
 * Migration SQL files live under `packages/server/drizzle/<dialect>/`.
 * We resolve the path relative to this source file so it works regardless of
 * whether the server is launched via `tsx` (from src/) or `node` (from dist/).
 */
export async function runMigrations(): Promise<void> {
  if (!_db) {
    throw new Error("Database not initialized. Call initDatabase() before runMigrations().");
  }

  const { fileURLToPath } = await import("node:url");
  const { resolve, dirname } = await import("node:path");

  // __dirname equivalent for ESM
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // From src/db/ or dist/db/ → go up two levels to package root, then into drizzle/<dialect>
  const packageRoot = resolve(currentDir, "..", "..");

  const dialect = getDialect();

  if (dialect === "postgres") {
    const migrationsFolder = resolve(packageRoot, "drizzle", "postgres");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(_db as unknown as import("drizzle-orm/postgres-js").PostgresJsDatabase, {
      migrationsFolder,
    });
  } else {
    const migrationsFolder = resolve(packageRoot, "drizzle", "sqlite");
    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    migrate(_db as unknown as import("drizzle-orm/better-sqlite3").BetterSQLite3Database, {
      migrationsFolder,
    });
  }
}

// ============================================================================
// Synchronous API for backward compatibility
// ============================================================================

// For backward compatibility with existing code that imports `db` directly,
// we provide a synchronous initialization for SQLite (the default).
// This only works for SQLite; PostgreSQL requires async initialization.

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.sqlite.js";

function initSqliteSync(): BetterSQLite3Database<typeof schema> {
  const dialect = getDialect();
  if (dialect !== "sqlite") {
    // Return a placeholder that will throw on use
    // Application should use initDatabase() for PostgreSQL
    return new Proxy({} as BetterSQLite3Database<typeof schema>, {
      get() {
        throw new Error(
          "PostgreSQL database requires async initialization. Use initDatabase() instead of importing db directly."
        );
      },
    });
  }

  const dbUrl = getDatabaseUrl();
  const dbPath = dbUrl === ":memory:" ? ":memory:" : resolve(process.cwd(), dbUrl);

  // Ensure data directory exists (only for file-based databases)
  if (dbPath !== ":memory:") {
    const dataDir = dirname(dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  // Create SQLite connection
  const sqliteDb = new Database(dbPath);
  _sqlite = sqliteDb;

  // Enable WAL mode for better concurrent read/write performance (only for file-based)
  if (dbPath !== ":memory:") {
    sqliteDb.pragma("journal_mode = WAL");
  }

  // Create Drizzle instance
  const drizzleDb = drizzle(sqliteDb, { schema });
  _db = drizzleDb as unknown as Database;

  // Auto-run migrations for in-memory databases (tests) and file-based (dev)
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(currentDir, "..", "..");
    const migrationsFolder = resolve(packageRoot, "drizzle", "sqlite");
    if (existsSync(migrationsFolder)) {
      migrateSqlite(drizzleDb, { migrationsFolder });
    }
  } catch {
    // Migrations may fail if drizzle meta files are missing; non-fatal for dev
  }

  return drizzleDb;
}

// Synchronous db export (SQLite only, for backward compatibility)
export const db = initSqliteSync();

// Export raw sqlite for migrations (backward compatibility)
export const sqlite = _sqlite;
export type { Database as SqliteDatabase } from "better-sqlite3";

// Re-export schema for convenience
export * from "./schema.js";
