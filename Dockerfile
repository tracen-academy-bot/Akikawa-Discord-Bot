FROM node:24-slim
WORKDIR /app

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

# openssl  -> required by Prisma's query engine
# fontconfig + fonts-dejavu-core -> required by @napi-rs/canvas.
#   The package bundles NO fonts and resolves families through the system font
#   config. With fontconfig but no font package installed, every ctx.fillText()
#   draws zero pixels and the club images come out with no text at all.
#   Add fonts-noto-cjk here too if club or member names can contain CJK.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends \
        openssl \
        fontconfig \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

RUN npm run build
RUN mkdir -p dist/assets && cp -r src/assets/* dist/assets/
CMD ["node", "dist/index.js"]
