#!/bin/sh
set -e
echo "Episode starting…"
node /app/migrate.mjs
exec node /app/build
