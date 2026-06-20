/**
 * Vitest global setup (runs before any test module is imported).
 *
 * Provides a real, test-only JWT_SECRET so that importing the server app
 * (src/index.ts) does not fail closed. The app now refuses to start when
 * JWT/OIDC auth is enabled (the default "dual" AUTH_MODE) without a real
 * JWT_SECRET — see resolveJwtSecret() in src/config.ts. This is a real
 * secret for tests, NOT the production dev-placeholder fallback that was
 * removed for security.
 */
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-only-jwt-secret-at-least-32-characters-long!!";
}
