# Dockerfile — QSL ERP Production Image
# Multi-stage build: builder → runner

# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# ── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 qsl && \
    adduser  --system --uid 1001 qsl

# Copy built app
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
COPY --from=builder /app/src/lib      ./src/lib
COPY --from=builder /app/database     ./database
COPY --from=builder /app/public       ./public

# Create directories
RUN mkdir -p /app/database /app/uploads && \
    chown -R qsl:qsl /app

USER qsl

EXPOSE 3000

# Initialise DB then start
CMD ["sh", "-c", "node database/init.js && node database/seed.js && npm start"]
