# ============================================================
# Multi-stage Dockerfile for Comic Drama Engine
# ============================================================
# Node 22+ required for node:sqlite support.
# The server is written in TypeScript and run via tsx.
# tsx is in devDependencies, so we install it explicitly
# in the production stage to keep the image minimal.
# ============================================================

# ----------------------------------------------------------
# Stage 1: Build the frontend
# ----------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the Vue/Vite frontend
COPY . .
RUN npm run build

# ----------------------------------------------------------
# Stage 2: Production image
# ----------------------------------------------------------
FROM node:22-alpine AS production

WORKDIR /app

# Install pm2 globally for process management
RUN npm install -g pm2

# Install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# tsx lives in devDependencies but is needed at runtime to
# execute server/index.ts. Install it as an additional
# production dependency without modifying package.json.
RUN npm install --save-prod tsx

# Copy server source, built frontend, and pm2 config
COPY server/ ./server/
COPY --from=build /app/web/dist/ ./web/dist/
COPY ecosystem.config.cjs ./

# Create data directory for SQLite database and logs
RUN mkdir -p data logs

# Production port
ENV NODE_ENV=production
ENV MY_APP_PORT=3710
EXPOSE 3710

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3710/api/health || exit 1

CMD ["pm2-runtime", "ecosystem.config.cjs"]
