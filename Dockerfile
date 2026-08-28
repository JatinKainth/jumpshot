FROM oven/bun:1 AS base
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server

RUN bun install --frozen-lockfile

ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/server/src/index.ts"]
