# Multi-stage Dockerfile for the Mote Capture cloud app.
# Production runtime uses a custom Next.js server (server.ts) that attaches
# Socket.io to the same HTTP listener, so we cannot use `next start` /
# the standalone auto-generated `server.js`. Instead we ship the source
# tree + production node_modules and run `tsx server.ts`.

# ---- Stage 1: deps (install full workspace deps for build) ----
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/cloud/package.json apps/cloud/
COPY apps/bridge/package.json apps/bridge/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ---- Stage 2: builder (next build) ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/cloud/node_modules ./apps/cloud/node_modules
COPY --from=deps /app/apps/bridge/node_modules ./apps/bridge/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter cloud build

# ---- Stage 3: prod-deps (production-only deps for runtime) ----
FROM node:20-alpine AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/
COPY apps/bridge/package.json apps/bridge/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
# Install only the cloud filter's prod deps. Bridge is excluded — the
# standalone bridge electron build is unrelated to the cloud server.
RUN pnpm install --frozen-lockfile --prod --filter cloud...
# Workspace packages with no prod deps don't get a node_modules folder;
# ensure the dirs exist so the runner stage's COPY doesn't fail.
RUN mkdir -p apps/cloud/node_modules packages/db/node_modules packages/shared/node_modules

# ---- Stage 4: runner (custom server via tsx) ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat

# Non-root user for the running process.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Workspace metadata (so tsx + pnpm can resolve workspace packages).
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.base.json ./

# Production-only node_modules from the prod-deps stage.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nextjs:nodejs /app/apps/cloud/node_modules ./apps/cloud/node_modules
COPY --from=prod-deps --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=prod-deps --chown=nextjs:nodejs /app/packages/shared/node_modules ./packages/shared/node_modules

# Source we need at runtime: the cloud app (server.ts + lib/ + app/ + components/)
# and the workspace packages it imports.
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/server.ts ./apps/cloud/server.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/next.config.js ./apps/cloud/next.config.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/package.json ./apps/cloud/package.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/tsconfig.json ./apps/cloud/tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/middleware.ts ./apps/cloud/middleware.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/postcss.config.js ./apps/cloud/postcss.config.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/tailwind.config.ts ./apps/cloud/tailwind.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/components.json ./apps/cloud/components.json
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/app ./apps/cloud/app
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/lib ./apps/cloud/lib
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/components ./apps/cloud/components
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/public ./apps/cloud/public

# Pre-built Next assets (served by next() inside server.ts).
COPY --from=builder --chown=nextjs:nodejs /app/apps/cloud/.next ./apps/cloud/.next

# Workspace packages (server.ts → @capture/db, @capture/shared).
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db
COPY --from=builder --chown=nextjs:nodejs /app/packages/shared ./packages/shared

# Runtime upload directory (mock R2 mode writes here). Make it writable.
RUN mkdir -p /app/apps/cloud/public/uploads /app/apps/cloud/.next/cache \
    && chown -R nextjs:nodejs /app/apps/cloud/public/uploads /app/apps/cloud/.next

USER nextjs
WORKDIR /app/apps/cloud
EXPOSE 5000
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

# Custom server: `tsx server.ts` boots Next then attaches Socket.io to the
# same HTTP server (see ./server.ts and ./lib/socket/server.ts).
# tsx is a production dep of cloud → resolved via node_modules/.bin.
CMD ["./node_modules/.bin/tsx", "server.ts"]
