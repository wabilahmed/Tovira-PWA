# Dev image for the Node API. Source is bind-mounted in compose for hot reload;
# this image just carries the toolchain + installed dependencies.
FROM node:20-bookworm-slim
WORKDIR /app

# Install deps using the workspace manifests (better layer caching than COPY .).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

# Source (overridden by the bind mount during `docker compose up`).
COPY . .

EXPOSE 3001
CMD ["npm", "run", "dev", "-w", "apps/api"]
