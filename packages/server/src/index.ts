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
import { initDatabase, runMigrations, closeDatabase } from "./db/index.js";
import { resetRateLimiter } from "./lib/rate-limiter/index.js";

// Create Hono app with typed variables
const app = new Hono<{ Variables: AuthVariables }>();

// Load config
const config = getConfig();

// Enforce production security requirements
if (config.isProduction) {
  const warnings = validateProductionConfig(config);
  const criticalWarnings = warnings.filter(w => w.includes('ADMIN_API_KEY'));
  if (criticalWarnings.length > 0) {
    console.error('FATAL: Production security requirements not met:');
    criticalWarnings.forEach(w => console.error(`  - ${w}`));
    console.error('Set ADMIN_API_KEY environment variable (min 16 characters) to start in production mode.');
    process.exit(1);
  }
  // Log non-critical warnings
  warnings.filter(w => !w.includes('ADMIN_API_KEY')).forEach(w => console.warn(`Warning: ${w}`));
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
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
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
  console.error(`Error: ${err.message}`, err.stack);

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
  console.log("Database initialized.");

  await runMigrations();
  console.log("Database migrations applied.");

  console.log(`Starting AgentGate server on port ${port}...`);

  const server = serve({
    fetch: app.fetch,
    port,
  });

  console.log(`AgentGate server running at http://localhost:${port}`);

  // --- Graceful shutdown ---
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return; // Prevent double-shutdown
    shuttingDown = true;

    console.log(`\n${signal} received. Starting graceful shutdown...`);

    server.close(() => {
      console.log('HTTP server closed.');
    });

    try {
      await resetRateLimiter();
      console.log('Rate limiter cleaned up.');
    } catch (err) {
      console.error('Error cleaning up rate limiter:', err);
    }

    try {
      await closeDatabase();
      console.log('Database connections closed.');
    } catch (err) {
      console.error('Error closing database:', err);
    }

    console.log('Graceful shutdown complete.');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Safety net: force exit after 10 seconds if shutdown stalls
  const forceExitTimeout = setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000);
  forceExitTimeout.unref();
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

export default app;
