# Single container: web app + in-process scheduler. Works on Railway, Render, Fly.io or any Docker host.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production RUN_SCHEDULER=1 PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
