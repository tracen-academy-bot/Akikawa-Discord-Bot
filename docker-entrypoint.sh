#!/bin/sh
# Container entrypoint.
#
# Applies pending database migrations before starting the bot. This step is the
# fix for the outage where every Prisma-backed command failed with P2021
# ("table does not exist"): the image built and the bot logged in to Discord,
# but nothing ever created the tables, so a fresh Postgres volume left the
# schema empty. `prisma generate` (run by npm postinstall) only writes the
# client; it never touches the database.
set -e

echo "[entrypoint] Applying database migrations..."

# Postgres in compose may still be starting on the first boot. Retry with
# backoff instead of crash-looping the container on an expected race.
attempt=1
max_attempts=10
until npx prisma migrate deploy; do
    if [ "$attempt" -ge "$max_attempts" ]; then
        echo "[entrypoint] Migrations failed after ${max_attempts} attempts. Giving up." >&2
        exit 1
    fi
    delay=$((attempt * 2))
    echo "[entrypoint] Migration attempt ${attempt}/${max_attempts} failed. Retrying in ${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
done

echo "[entrypoint] Migrations applied. Starting bot..."
exec "$@"
