FROM oven/bun:1 AS base
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# Production stage — drop devDependencies, keep lockfile-consistent context
FROM oven/bun:1
WORKDIR /app

COPY --from=base /app/package.json /app/bun.lock /app/tsconfig.base.json ./
COPY --from=base /app/packages/shared ./packages/shared
COPY --from=base /app/packages/server ./packages/server
COPY --from=base /app/packages/client ./packages/client

RUN bun install --production --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "--cwd", "packages/server", "start"]
