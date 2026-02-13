# ── Build stage ──────────────────────────────────────────────
FROM node:22 AS build

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace config first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
COPY packages/dashboard/ packages/dashboard/

# Build everything
RUN pnpm run build

# ── Production stage ────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/server/dist/ packages/server/dist/
COPY --from=build /app/packages/dashboard/dist/ packages/dashboard/dist/

ENV NODE_ENV=production
ENV PORT=3002

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
