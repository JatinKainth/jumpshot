FROM oven/bun:1 AS base
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# Production stage — keep client for lockfile resolution but drop it after
# install so the Fly image doesn't ship phaser/vite (client runtime deps).
FROM oven/bun:1
WORKDIR /app

COPY --from=base /app/package.json /app/bun.lock /app/tsconfig.base.json ./
COPY --from=base /app/packages/shared ./packages/shared
COPY --from=base /app/packages/server ./packages/server
COPY --from=base /app/packages/client ./packages/client

RUN bun install --production --frozen-lockfile && rm -rf packages/client

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "--cwd", "packages/server", "start"]
