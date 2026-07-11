# Dev image for the Vite PWA dev server. Source is bind-mounted in compose for HMR.
FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm install

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "apps/web"]
