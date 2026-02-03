/**
 * Database schema re-exports
 * 
 * This module re-exports the dialect-specific schema based on DB_DIALECT.
 * For build/compile time, we export from SQLite (default).
 * Runtime selection happens in the db/index.ts module.
 * 
 * Both schemas export identical table names and type definitions,
 * ensuring application code works with either database.
 */

// Re-export types and tables from SQLite schema (default)
// The actual schema used at runtime is determined by DB_DIALECT in db/index.ts
export * from "./schema.sqlite.js";
