# AgentGate Dashboard Dockerfile
# Multi-stage build: Vite build → nginx static serve

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
COPY packages/dashboard/package.json ./packages/dashboard/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 3: Build
# =============================================================================
FROM deps AS builder

# Copy source code
COPY packages/core/ ./packages/core/
COPY packages/dashboard/ ./packages/dashboard/
COPY tsconfig.base.json ./

# Build core first (dashboard may depend on it)
RUN pnpm --filter @agentgate/core build

# Build dashboard (Vite production build)
RUN pnpm --filter @agentgate/dashboard build

# =============================================================================
# Stage 4: Production (nginx)
# =============================================================================
FROM nginx:alpine AS runner

# Copy nginx config
COPY packages/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/packages/dashboard/dist /usr/share/nginx/html

# Create non-root user (nginx alpine runs as nginx user by default)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
