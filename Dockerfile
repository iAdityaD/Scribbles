FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/mobile/package.json apps/mobile/package.json
RUN npm ci --workspace @scribbles/server --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY packages ./packages
COPY apps/server/src ./apps/server/src
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0
EXPOSE 3001
USER node
CMD ["node", "--import", "tsx", "apps/server/src/index.ts"]
