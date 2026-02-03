import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import requestsRouter from "./routes/requests.js";
import policiesRouter from "./routes/policies.js";
import apiKeysRouter from "./routes/api-keys.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import tokensRouter from "./routes/tokens.js";
import decideRouter from "./routes/decide.js";
import { authMiddleware, type AuthVariables } from "./middleware/auth.js";

// Create Hono app with typed variables
const app = new Hono<{ Variables: AuthVariables }>();

// Middleware
app.use("*", logger());
app.use("*", cors());

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
  console.error(`Error: ${err.message}`);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
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

console.log(`Starting AgentGate server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`AgentGate server running at http://localhost:${port}`);

export default app;
