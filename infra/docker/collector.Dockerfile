FROM node:24-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN corepack use pnpm@11.20.0 && pnpm install --frozen-lockfile && pnpm --filter @lpforge/collector build
CMD ["node","apps/collector/dist/main.js"]
