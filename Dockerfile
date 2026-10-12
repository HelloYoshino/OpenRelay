# syntax=docker/dockerfile:1

# ---- build: compile server, SDK and dashboard
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
RUN npm run build

# ---- deps: production dependencies of the server only
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --workspace @openrelay/server --no-audit --no-fund && mkdir -p packages/server/node_modules

# ---- runtime
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    OPENRELAY_DATA_DIR=/data \
    OPENRELAY_WEB_DIR=/app/web
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./web
RUN mkdir -p /data/plugins && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "/app/packages/server/dist/cli.js"]
