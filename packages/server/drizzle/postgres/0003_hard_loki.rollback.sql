-- Rollback migration 0003: Remove users, refresh_tokens, and overrides tables
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS overrides;
