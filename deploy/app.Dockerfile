# syntax=docker/dockerfile:1.7
# TI4 Online site: the shim (fake Discord + site API) serving the built web client. Build context: repo root.
#   docker build -f deploy/app.Dockerfile -t ti4-app .
# Multi-arch (amd64/arm64). Behind a TLS-intercepting proxy, see deploy/local-proxy-build.sh.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- web client (Vite) ----
FROM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- shim (TypeScript -> JS) ----
FROM ${NODE_IMAGE} AS shim
WORKDIR /src/shim
COPY shim/package.json shim/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY shim/tsconfig.json ./
COPY shim/src ./src
RUN npx tsc -p . && npm prune --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8090 \
    SHIM_DATA=/data \
    WEB_DIST=/app/web
WORKDIR /app/shim
COPY --from=shim /src/shim/package.json ./
COPY --from=shim /src/shim/node_modules ./node_modules
COPY --from=shim /src/shim/dist ./dist
COPY --from=web /src/web/dist /app/web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8090
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8090)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
