# Образ сервиса Schema Brain: API, веб и команды (apps/server/src/cli.ts).
# TypeScript сервиса запускается без сборки (Node.js 24); при сборке образа генерируется
# клиент базы и собирается веб.

# ---------- клиент базы и веб ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY apps/web apps/web
RUN npx vite build apps/web

# ---------- модель векторов e5 (решение 2026-11-06): версия закреплена, файлы проверяются по SHA-256 ----------
FROM node:24-bookworm-slim AS model
COPY scripts/fetch-model.mjs /fetch-model.mjs
RUN node /fetch-model.mjs /model

# ---------- зависимости продукта ----------
# --omit=optional: иначе в образ попадает служебная программа prisma (необязательная зависимость
# @prisma/client) с уязвимыми mysql2 и deepmerge-ts; из рабочих необязательных пакетов отпадает
# только pg-cloudflare — для Cloudflare Workers, сервису не нужен
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# onnxruntime-node везёт библиотеки под все системы — в образе нужна только Linux
RUN npm ci --omit=dev --omit=optional --ignore-scripts \
  && rm -rf node_modules/onnxruntime-node/bin/napi-v*/win32 node_modules/onnxruntime-node/bin/napi-v*/darwin

# ---------- образ ----------
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    EMBED_MODEL_DIR=/app/models/e5-small

COPY --from=deps /app/node_modules node_modules
COPY package.json package-lock.json ./
COPY packages/core/src packages/core/src
COPY skills/vyvody/record.mjs skills/vyvody/record.mjs
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/server/src/generated apps/server/src/generated
COPY --from=build /app/apps/web/dist apps/web/dist
COPY prisma/migrations prisma/migrations
COPY --from=model /model models/e5-small

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
