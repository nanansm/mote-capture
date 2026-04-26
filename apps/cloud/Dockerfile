# Stage 1: deps
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/cloud/package.json apps/cloud/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# Stage 2: builder
FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@9
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/cloud/node_modules ./apps/cloud/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter cloud build

# Stage 3: runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/apps/cloud/.next/standalone ./
COPY --from=builder /app/apps/cloud/.next/static ./apps/cloud/.next/static
COPY --from=builder /app/apps/cloud/public ./apps/cloud/public
USER nextjs
EXPOSE 5000
ENV PORT=5000
ENV HOSTNAME=0.0.0.0
CMD ["node", "apps/cloud/server.js"]
