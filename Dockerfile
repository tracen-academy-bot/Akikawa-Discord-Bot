FROM node:20-slim
WORKDIR /app

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# OPEN SSL & FONT CONFIG
RUN apt-get update -y && apt-get install -y openssl && apt-get install -y fontconfig && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

RUN npm run build
RUN mkdir -p dist/assets && cp -r src/assets/* dist/assets/
CMD ["node", "dist/index.js"]