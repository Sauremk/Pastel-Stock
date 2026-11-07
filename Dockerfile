# syntax=docker/dockerfile:1.7
# Pastel Stock — imagen de producción (ADR-10): multi-stage, node:22-alpine, usuario no root.

# ---------- Etapa 1: dependencias de PRODUCCIÓN (sin devDependencies) ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# ---------- Etapa 2: builder (todas las dependencias + lint del código que se empaqueta) ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY eslint.config.js ./
COPY src ./src
COPY web ./web
RUN npx eslint src web

# ---------- Etapa 3: imagen final mínima y no root ----------
FROM node:22-alpine AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/web ./web
COPY --chown=node:node openapi ./openapi
USER node
EXPOSE 3000
# /health responde 200 sin autenticación (lo consumen Docker, Compose y el despliegue).
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
