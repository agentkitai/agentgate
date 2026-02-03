# AgentGate Server Dockerfile
# Multi-stage build for optimal image size

# =============================================================================
# Stage 1: Base with pnpm
# =============================================================================
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# =============================================================================
# Stage 2: Install dependencies
# =============================================================================
FROM base AS deps

# Copy workspace config files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files for workspace resolution
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 3: Build
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/core/ ./packages/core/
COPY packages/server/ ./packages/server/
COPY tsconfig.base.json ./

# Build core first (server depends on it)
RUN pnpm --filter @agentgate/core build

# Build server
RUN pnpm --filter @agentgate/server build

# =============================================================================
# Stage 4: Production
# =============================================================================
FROM base AS runner

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 agentgate

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json files
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Copy migrations (needed for db:migrate)
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle

# Create data directory
RUN mkdir -p /app/packages/server/data && chown -R agentgate:nodejs /app

USER agentgate

WORKDIR /app/packages/server

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
