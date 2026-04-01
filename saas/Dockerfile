FROM node:20-alpine AS builder

# ── Build SaaS app ────────────────────────────────────────────
WORKDIR /app/saas
COPY saas/package*.json saas/tsconfig.json ./
RUN npm ci
COPY saas/src/ ./src/
RUN npm run build

# ── Build Bot (needed to run child processes) ─────────────────
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Runtime image ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install saas deps
WORKDIR /app/saas
COPY saas/package*.json ./
RUN npm ci --omit=dev

# Install bot deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled code
COPY --from=builder /app/saas/dist /app/saas/dist
COPY --from=builder /app/dist /app/dist

# Copy static data for bot (wallets, events calendar)
COPY data/ /app/data/

WORKDIR /app
ENV NODE_PATH=/app/node_modules
ENV BOT_DIST_PATH=/app/dist
ENV BOT_DATA_PATH=/app/data

EXPOSE 3000
CMD ["node", "saas/dist/server.js"]
