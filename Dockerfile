FROM oven/bun:1 AS base
WORKDIR /app

COPY bun.lock package.json tsconfig.base.json ./
COPY packages ./packages

RUN bun install --frozen-lockfile

# Production stage — keep client for initial lockfile resolution, then prune
# it so the Fly image doesn't ship phaser/vite. Needs a re-install without
# client in workspaces to drop its prod deps from node_modules.
FROM oven/bun:1
WORKDIR /app

COPY --from=base /app/package.json /app/bun.lock /app/tsconfig.base.json ./
COPY --from=base /app/packages/shared ./packages/shared
COPY --from=base /app/packages/server ./packages/server
COPY --from=base /app/packages/client ./packages/client

RUN bun install --production --frozen-lockfile && rm -rf packages/client && rm -rf node_modules && node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package.json','utf8'));j.workspaces=['packages/shared','packages/server'];fs.writeFileSync('package.json',JSON.stringify(j,null,2))" && bun install --production --frozen-lockfile

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "--cwd", "packages/server", "start"]
