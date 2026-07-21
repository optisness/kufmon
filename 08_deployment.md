# Deployment

## Overview

KufMon is deployed as a containerized backend application.

The deployment architecture is intentionally simple for the MVP while allowing future horizontal scaling.

The application consists of a single backend service connected to a managed PostgreSQL database.

---

# Deployment Architecture

```text
                 GitHub
                    │
                    ▼
          GitHub Actions (CI)
                    │
                    ▼
            Docker Image Build
                    │
                    ▼
             Container Registry
                    │
                    ▼
        ┌────────────────────────┐
        │  Application Container │
        │────────────────────────│
        │ Fastify                │
        │ Scheduler              │
        │ Sync Service           │
        │ REST API               │
        └────────────┬───────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 PostgreSQL (Neon)         Telegram Bot API
```

---

# Runtime Components

The running application consists of five logical components.

```text
Application

├── HTTP API

├── Scheduler

├── Sync Service

├── Notification Service

└── Logger
```

All components run inside a single process for the MVP.

---

# Infrastructure

Current infrastructure.

| Component | Technology |
|------------|------------|
| Runtime | Node.js 22 LTS |
| Web Framework | Fastify |
| ORM | Prisma |
| Database | PostgreSQL |
| Hosting | Neon (database) |
| Container | Docker |
| CI | GitHub Actions |
| Notifications | Telegram |

---

# Deployment Targets

The application is provider-independent.

Supported deployment platforms include:

- Render
- Railway
- Fly.io
- Google Cloud Run
- DigitalOcean
- VPS
- Kubernetes

Changing the hosting provider must not require application code changes.

---

# Container

The application is packaged as a Docker image.

Responsibilities:

- install dependencies
- build TypeScript
- generate Prisma client
- run migrations (optional)
- start application

Example:

```text
docker build

↓

Docker Image

↓

docker run
```

---

# Environment Variables

Required configuration.

| Variable | Description |
|------------|-------------|
| NODE_ENV | Environment |
| PORT | HTTP port |
| DATABASE_URL | PostgreSQL connection |
| TELEGRAM_BOT_TOKEN | Telegram bot token |
| KUFAR_API_URL | Kufar endpoint |
| LOG_LEVEL | Logger level |

Optional:

| Variable | Description |
|------------|-------------|
| SYNC_INTERVAL | Scheduler interval |
| REQUEST_TIMEOUT | HTTP timeout |
| USER_AGENT | HTTP User-Agent |

---

# Startup Sequence

Application startup.

```text
Load configuration

↓

Validate environment

↓

Initialize logger

↓

Connect PostgreSQL

↓

Initialize Prisma

↓

Register services

↓

Register routes

↓

Start scheduler

↓

Listen HTTP
```

Application exits immediately if any mandatory dependency is unavailable.

---

# Scheduler

Synchronization is started by an internal scheduler.

Example:

```text
Every 5 minutes

↓

SyncService.run()
```

The scheduler has only one responsibility:

Start synchronization.

Business logic never depends on scheduler implementation.

Future scheduler implementations:

- node-cron
- Cloud Scheduler
- Kubernetes CronJob
- external HTTP trigger

---

# REST API

The application exposes HTTP endpoints.

Example:

```text
GET /health

GET /api/v1/ads

GET /api/v1/events

POST /api/v1/subscriptions
```

API documentation is described separately.

---

# Database Migration

Schema migrations are managed by Prisma.

Deployment sequence:

```text
Build

↓

Deploy

↓

Run migrations

↓

Start application
```

Migration failures must stop deployment.

---

# Health Checks

The application exposes:

```text
GET /health
```

Response example:

```json
{
    "status": "ok"
}
```

Future versions may include:

```json
{
    "status": "ok",
    "database": "connected",
    "telegram": "connected",
    "scheduler": "running"
}
```

---

# Logging

Application logs are written to stdout.

```text
stdout

↓

Hosting Platform

↓

Log Viewer
```

Logger:

- structured JSON
- timestamps
- log levels
- request IDs
- sync IDs

Recommended library:

```
Pino
```

---

# Failure Recovery

Failures are isolated.

Example:

```text
Telegram unavailable

↓

Save database

↓

Retry notification
```

```text
Database unavailable

↓

Abort synchronization

↓

Retry next schedule
```

Synchronization must never continue after a failed transaction.

---

# Backup Strategy

Database backups are delegated to PostgreSQL hosting.

For Neon:

- automatic backups
- point-in-time recovery (depending on plan)

Optional:

```text
pg_dump

↓

Object Storage
```

---

# Monitoring

Minimum monitoring:

- application logs
- health endpoint
- metrics endpoint
- scheduler status

The service currently exposes `/health` and `/metrics`, and logs are emitted as structured JSON to stdout using Pino.

Future monitoring:

- Prometheus
- Grafana
- OpenTelemetry
- Sentry

---

# Security

Secrets are never committed.

Required secrets:

- DATABASE_URL
- TELEGRAM_BOT_TOKEN

Production recommendations:

- HTTPS only
- read-only database users where applicable
- secret manager
- automatic dependency updates

---

# CI/CD Pipeline

```text
Push

↓

Install Dependencies

↓

Lint

↓

Unit Tests

↓

Build

↓

Docker Build

↓

Deploy
```

Every pull request should execute:

- lint
- tests
- type checking

---

# Rollback Strategy

Application rollback:

```text
Deploy previous Docker image
```

Database rollback:

```text
Restore backup

or

Reverse migration
```

Database rollback procedures should be documented for each migration.

---

# Scaling

Current MVP

```text
1 Container

↓

1 PostgreSQL
```

Future

```text
Load Balancer

↓

Multiple Containers

↓

Shared PostgreSQL

↓

Redis Queue

↓

Notification Workers
```

No business logic changes should be required.

---

# Disaster Recovery

If the application crashes:

```text
Container Restart

↓

Reconnect Database

↓

Continue Scheduler
```

No manual intervention should normally be required.

---

# Deployment Checklist

Before deployment:

- Environment variables configured
- Database available
- Migrations reviewed
- Tests passed
- Docker image built
- Health endpoint verified

After deployment:

- Health endpoint returns OK
- Scheduler started
- Synchronization completed
- Telegram notifications verified
- Logs inspected

---

# Summary

Deployment is intentionally lightweight.

Core principles:

- Containerized application
- Managed PostgreSQL
- Environment-based configuration
- Automated CI/CD
- Infrastructure independence
- Easy migration between hosting providers