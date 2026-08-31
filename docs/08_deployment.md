# Deployment

**Canonical index:** [00_index.md](00_index.md)

## Purpose

This is the operational runbook for deploying KufMon.

## Current setup

- single backend service;
- managed PostgreSQL;
- Render deployment;
- environment-based configuration;
- cron started inside the app after the server is listening.
- Kufar sync runs every 15 minutes instead of every 5 minutes to reduce outbound traffic.

## Important variables

- `DATABASE_URL`
- `TELEGRAM_TOKEN`
- `ADMIN_PASSWORD`
- `ADMIN_TELEGRAM_CHAT_ID`
- `KUFAR_CATEGORY`
- `PORT`

## Deployment sequence

1. Merge to `main`.
2. Render builds the image.
3. Prisma client is generated during build.
4. App starts.
5. Health check confirms the service is up.
6. Cron jobs start inside the running instance.

## Database changes

- Apply Prisma migrations before or during deploy, depending on the environment policy.
- If a migration already exists in the database, mark it resolved instead of rerunning it.

## Health check

- `/health` must return `200`.
- Unauthorized HTML responses are expected on protected pages, but not on the health probe.

## Failure recovery

- Check logs first.
- Verify `DATABASE_URL`.
- Verify Telegram credentials.
- Restart only after confirming the issue is not a pending migration problem.

## Minimal checklist

- build passes;
- migrations are consistent;
- health is green;
- Telegram sends work;
- cron starts;
- admin login works.
