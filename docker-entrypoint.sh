#!/bin/sh
set -e

echo "Waiting for database..."
attempts=0
until npx prisma db pull >/dev/null 2>&1 || [ $attempts -ge 10 ]; do
  attempts=$((attempts+1))
  echo "  waiting for db (attempt $attempts)"
  sleep 2
done

echo "Applying migrations..."
# apply migrations (works with production-friendly migrate deploy)
npx prisma migrate deploy || true

echo "Starting app..."
exec node dist/app.js
