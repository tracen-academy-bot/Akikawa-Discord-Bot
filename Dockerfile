FROM node:20-slim
WORKDIR /app

# OpenSSL is required by Prisma. The renderers use fonts bundled in
# src/assets/fonts (registered at startup), so the look does not depend on the
# host. The apt font packages remain only as a last-resort fallback that keeps
# CJK legible if bundled registration ever fails. See docs/fonts.md.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends \
        openssl \
        fontconfig \
        fonts-dejavu-core \
        fonts-wqy-zenhei \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# `prisma generate` runs during `npm ci` (postinstall) and wants DATABASE_URL
# present. This is an ARG, not an ENV, on purpose: an ENV would bake a bogus
# connection string into the final image, where it would silently satisfy the
# bot's "is DATABASE_URL set?" check at runtime and send it to a database that
# does not exist. As an ARG it exists only for the build.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .

RUN npm run build
RUN mkdir -p dist/assets && cp -r src/assets/* dist/assets/

# Migrations run at container start, not at build time: the database does not
# exist yet while the image is being built.
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
