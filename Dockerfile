# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build frontend (Vite)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Install only the dependencies needed for the frontend build.
COPY package.json yarn.lock turbo.json ./
COPY packages/shared-types/package.json   ./packages/shared-types/
COPY packages/nanoclaw-gateway/package.json ./packages/nanoclaw-gateway/
COPY apps/frontend/package.json            ./apps/frontend/

RUN yarn install --frozen-lockfile --non-interactive

COPY packages/shared-types/ ./packages/shared-types/
COPY packages/nanoclaw-gateway/ ./packages/nanoclaw-gateway/
COPY apps/frontend/          ./apps/frontend/

# Build shared-types first (frontend imports from it).
RUN yarn workspace @claw-pilot/shared-types build 2>/dev/null || true
RUN yarn workspace @claw-pilot/nanoclaw-gateway build 2>/dev/null || true
RUN yarn workspace frontend build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Build backend (TypeScript → JavaScript)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS backend-builder

WORKDIR /app

COPY package.json yarn.lock turbo.json ./
COPY packages/shared-types/package.json   ./packages/shared-types/
COPY packages/nanoclaw-gateway/package.json ./packages/nanoclaw-gateway/
COPY apps/backend/package.json             ./apps/backend/

RUN yarn install --frozen-lockfile --non-interactive

COPY packages/shared-types/ ./packages/shared-types/
COPY packages/nanoclaw-gateway/ ./packages/nanoclaw-gateway/
COPY apps/backend/           ./apps/backend/

RUN yarn workspace @claw-pilot/shared-types build 2>/dev/null || true
RUN yarn workspace @claw-pilot/nanoclaw-gateway build 2>/dev/null || true
RUN yarn workspace backend build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Install only production dependencies.
COPY package.json yarn.lock turbo.json ./
COPY packages/shared-types/package.json   ./packages/shared-types/
COPY packages/nanoclaw-gateway/package.json ./packages/nanoclaw-gateway/
COPY apps/backend/package.json             ./apps/backend/

RUN yarn install --frozen-lockfile --non-interactive --production

# Copy compiled backend.
COPY --from=backend-builder  /app/apps/backend/dist   ./apps/backend/dist
COPY --from=backend-builder  /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=backend-builder  /app/packages/nanoclaw-gateway/dist ./packages/nanoclaw-gateway/dist

# Copy compiled frontend into the path that @fastify/static expects.
# apps/backend/dist/index.js resolves __dirname to apps/backend/dist/,
# then navigates to ../../frontend/dist → /app/apps/frontend/dist.
COPY --from=frontend-builder /app/apps/frontend/dist  ./apps/frontend/dist

# Persistent data volume mount-point (db.json, db.backup.json).
VOLUME ["/app/apps/backend/data"]

# OpenClaw config directory — mount your ~/.openclaw here at runtime.
# Example: -v ~/.openclaw:/openclaw:ro
ENV OPENCLAW_HOME=/openclaw

EXPOSE 54321

ENV NODE_ENV=production

CMD ["node", "apps/backend/dist/index.js"]
