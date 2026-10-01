#!/bin/sh
# Container entrypoint.
#
# Migrations are no longer run here. They used to be, and while they ran or
# retried nothing listened on the port, so a failure showed up from outside
# only as a 502/timeout loop with the cause buried in the host's deploy log.
# The bot now binds its HTTP server first and runs `prisma migrate deploy`
# itself (src/lib/migrate.ts), reporting state and any Prisma error on
# /healthz. This script only hands off to the process.
set -e
echo "[entrypoint] Starting bot (migrations run in-process; see /healthz for status)..."
exec "$@"
