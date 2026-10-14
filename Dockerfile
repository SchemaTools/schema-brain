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

# ---------- зависимости продукта ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------- образ ----------
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=deps /app/node_modules node_modules
COPY package.json package-lock.json ./
COPY packages/core/src packages/core/src
COPY skills/vyvody/record.mjs skills/vyvody/record.mjs
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/server/src/generated apps/server/src/generated
COPY --from=build /app/apps/web/dist apps/web/dist
COPY prisma/migrations prisma/migrations

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
