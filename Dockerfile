# =============================================================================
# Personal Finance Manager — Production Dockerfile
# Multi-stage build with Bun + Next.js standalone output.
# =============================================================================

# ---- Stage 1: Install dependencies ----
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- Stage 2: Build the app ----
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generate the Prisma client (reads prisma/schema.prisma)
RUN bunx prisma generate
# Build Next.js (produces .next/standalone/)
RUN bun run build

# ---- Stage 3: Production runner (small image) ----
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy the standalone server and static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Copy Prisma schema + generated client so migrations run at startup
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000

# Run schema sync on startup, then start the Next.js server
# (uses prisma db push instead of migrate deploy — no migrations folder needed)
CMD ["sh", "-c", "bunx prisma db push --accept-data-loss && bun server.js"]
