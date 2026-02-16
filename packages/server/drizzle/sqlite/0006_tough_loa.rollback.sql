-- Rollback migration 0006: Remove users, refresh_tokens, and overrides tables
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS overrides;
DROP INDEX IF EXISTS idx_overrides_agent_id;
DROP INDEX IF EXISTS idx_overrides_expires_at;
DROP INDEX IF EXISTS idx_refresh_tokens_hash;
DROP INDEX IF EXISTS idx_users_sub;
