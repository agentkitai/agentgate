import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import requestsRouter from "./routes/requests.js";
import policiesRouter from "./routes/policies.js";
import apiKeysRouter from "./routes/api-keys.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import tokensRouter from "./routes/tokens.js";
import decideRouter from "./routes/decide.js";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";
import { getConfig, validateProductionConfig } from "./config.js";
import { securityHeadersMiddleware } from "./middleware/security-headers.js";
import { initDatabase, runMigrations, closeDatabase, getDb, approvalRequests } from "./db/index.js";
import { resetRateLimiter } from "./lib/rate-limiter/index.js";
import { initLogger, getLogger } from "./lib/logger.js";
import { startRetryScanner } from "./lib/webhook.js";
import { startLastUsedFlusher, stopLastUsedFlusher } from "./lib/api-keys.js";
import { sql } from "drizzle-orm";

// Create Hono app with typed variables
const app = new Hono<{ Variables: AuthVariables }>();

// Load config and initialize logger
const config = getConfig();
const log = initLogger();

// Enforce production security requirements
if (config.isProduction) {
  const warnings = validateProductionConfig(config);
  const criticalWarnings = warnings.filter(w => w.includes('ADMIN_API_KEY'));
  if (criticalWarnings.length > 0) {
    log.fatal('Production security requirements not met');
    criticalWarnings.forEach(w => log.fatal(`  - ${w}`));
    log.fatal('Set ADMIN_API_KEY environment variable (min 16 characters) to start in production mode.');
    process.exit(1);
  }
  // Log non-critical warnings
  warnings.filter(w => !w.includes('ADMIN_API_KEY')).forEach(w => log.warn(w));
}

// Middleware
app.use("*", logger());

// CORS configuration:
// - If corsAllowedOrigins is set, use those specific origins
// - In development (no origins set), allow all origins
// - In production (no origins set), deny cross-origin requests (same-origin only)
app.use(
  "*",
  cors({
    origin: config.corsAllowedOrigins
      ? config.corsAllowedOrigins
      : config.isDevelopment
        ? "*"
        : (origin) => (origin ? null : origin), // Reject all cross-origin in production
    credentials: true,
  })
);
app.use("*", securityHeadersMiddleware);

// Body size limit for API routes (1MB) - prevents oversized payload attacks
app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024 }));

// Health check endpoint (public, no auth required)
// GET /health        → shallow check (fast, backward compatible)
// GET /health?deep=true → deep check (verifies DB connectivity)
app.get("/health", async (c) => {
  const deep = c.req.query("deep") === "true";

  if (!deep) {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  }

  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
  let overallHealthy = true;

  // Check database
  try {
    const start = Date.now();
    const db = getDb();
    await db.select({ one: sql<number>`1` }).from(approvalRequests).limit(1);
    checks.database = { status: "healthy", latencyMs: Date.now() - start };
  } catch (err) {
    checks.database = { status: "unhealthy", error: String(err) };
    overallHealthy = false;
  }

  const status = overallHealthy ? "ok" : "degraded";
  const httpStatus = overallHealthy ? 200 : 503;

  return c.json({ status, timestamp: new Date().toISOString(), checks }, httpStatus);
});

// Decision endpoint (public, no auth required - uses tokens)
app.route("/api/decide", decideRouter);

// Apply auth middleware to all /api/* routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/requests", requestsRouter);
app.route("/api", tokensRouter);
app.route("/api/policies", policiesRouter);
app.route("/api/api-keys", apiKeysRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/audit", auditRouter);

// Global error handler
app.onError((err, c) => {
  // Always log full error server-side
  getLogger().error({ err }, `Error: ${err.message}`);

  // Only expose error details in development
  const isDev = process.env.NODE_ENV !== "production";

  return c.json(
    {
      error: "Internal Server Error",
      ...(isDev && { message: err.message }),
    },
    500
  );
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404
  );
});

// Start server
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Initialize database BEFORE server starts listening.
  // This is critical for PostgreSQL which requires async initialization.
  // For SQLite, the sync `db` export still works, but all routes now use getDb()
  // which returns the same initialized instance.
  await initDatabase();
  getLogger().info("Database initialized.");

  await runMigrations();
  getLogger().info("Database migrations applied.");

  getLogger().info(`Starting AgentGate server on port ${port}...`);

  const server = serve({
    fetch: app.fetch,
    port,
  });

  getLogger().info(`AgentGate server running at http://localhost:${port}`);

  // Start webhook retry scanner (persistent retries via DB polling)
  const retryScannerInterval = startRetryScanner();
  getLogger().info('Webhook retry scanner started (30s interval).');

  // Start batched lastUsedAt flusher (reduces per-request DB writes)
  startLastUsedFlusher();
  getLogger().info('API key lastUsedAt flusher started (60s interval).');

  // --- Graceful shutdown ---
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    getLogger().info(`${signal} received. Starting graceful shutdown...`);

    server.close(() => {
      getLogger().info('HTTP server closed.');
    });

    clearInterval(retryScannerInterval);
    getLogger().info('Webhook retry scanner stopped.');

    stopLastUsedFlusher();
    getLogger().info('API key lastUsedAt flusher stopped.');

    try {
      await resetRateLimiter();
      getLogger().info('Rate limiter cleaned up.');
    } catch (err) {
      getLogger().error({ err }, 'Error cleaning up rate limiter');
    }

    try {
      await closeDatabase();
      getLogger().info('Database connections closed.');
    } catch (err) {
      getLogger().error({ err }, 'Error closing database');
    }

    getLogger().info('Graceful shutdown complete.');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Safety net: force exit after 10 seconds if shutdown stalls
  const forceExitTimeout = setTimeout(() => {
    getLogger().error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
  forceExitTimeout.unref();
}

main().catch((err) => {
  getLogger().fatal({ err }, "Failed to start server");
  process.exit(1);
});

export default app;
