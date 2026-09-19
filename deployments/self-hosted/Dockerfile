# Verifyistic self-hosted API image — Phase 1 PREVIEW (hardened in Phase 10: non-root,
# read-only filesystem, healthcheck, pinned digests).
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vitest.config.ts biome.json ./
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/storage/package.json packages/storage/
RUN pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "--import", "tsx", "apps/api/src/node.ts"]
