# Single image: the API serves the built web app (WEB_DIST_DIR). One process, one port.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @hp/web build && pnpm --filter @hp/api build
RUN pnpm --filter @hp/api deploy --prod --legacy /out/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 WEB_DIST_DIR=/app/web MIGRATIONS_DIR=/app/api/drizzle STORAGE_DIR=/data/storage
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 app && mkdir -p /data/storage && chown -R app /data
COPY --from=build /out/api /app/api
COPY --from=build /app/apps/api/dist /app/api/dist
COPY --from=build /app/apps/api/drizzle /app/api/drizzle
COPY --from=build /app/apps/web/dist /app/web
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start.
CMD ["sh", "-c", "node api/dist/db/migrate.js && node api/dist/server.js"]
