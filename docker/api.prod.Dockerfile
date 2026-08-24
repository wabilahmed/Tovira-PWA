# syntax=docker/dockerfile:1
# Production image for the Tovira API (ECS Fargate).
#
# The app EXECUTES TypeScript directly via tsx, so ALL workspace deps are
# installed — tsx is required at runtime, not just in dev, so we do NOT
# `--omit=dev`. Migrations run automatically on boot (apps/api/src/index.ts);
# health is GET /health on PORT 3001. tini gives a clean SIGTERM so the DB pools
# shut down gracefully.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
# Manifests first for a cacheable install layer. Workspaces are apps/api +
# apps/web (packages/brand is a plain relative import with no manifest, and is
# not needed by the API at runtime).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# Installed deps (tsx included) + the API source and its SQL migrations.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
EXPOSE 3001
USER node
# tini as PID 1 → forwards SIGTERM to npm → tsx → the server's shutdown handler.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start", "-w", "apps/api"]
