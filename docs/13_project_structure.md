# Project Structure

## Overview

This document defines the directory structure of the KufMon project.

The project follows a layered architecture inspired by Clean Architecture and Domain-Driven Design (DDD). Source code is organized by responsibility rather than by technology.

The primary goals are:

- clear separation of concerns;
- high testability;
- infrastructure independence;
- predictable growth;
- simple navigation.

---

# Repository Layout

```
project-root/
├── docs/
│   ├── 01_architecture.md
│   ├── 02_database.md
│   ├── 03_sync_algorithm.md
│   ├── 04_kufar_json_reference.md
│   ├── 05_kufar_mapping.md
│   ├── 06_notification_algorithm.md
│   ├── 07_api.md
│   ├── 08_deployment.md
│   ├── 09_roadmap.md
│   ├── 10_decisions.md
│   ├── 11_glossary.md
│   ├── 12_testing_strategy.md
│   └── 13_project_structure.md
├── package.json
├── prisma.config.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── generated/
│   └── prisma/
├── kufmon/
├── src/
│   ├── app.ts
│   ├── cron.ts
│   ├── db.ts
│   ├── kufar.ts
│   ├── kufarItem.ts
│   └── telegram.ts
└── README.md
```

---

# Source Tree

```
src/

├── app.ts            # Fastify server and admin UI
├── cron.ts           # Scheduler for periodic sync
├── db.ts             # Prisma client initialization
├── kufar.ts          # Marketplace client and sync logic
├── kufarItem.ts      # Item fetch/parsing helpers
├── telegram.ts       # Telegram notification sender
```

---

# Layer Responsibilities

```
API

↓

Application

↓

Domain

↓

Infrastructure
```

Dependencies always point downward.

The Domain layer must not depend on any other project layer.

---

# api/

## Purpose

Presentation layer.

Responsible for HTTP communication only.

Business logic is prohibited.

```
api/

├── routes/
├── controllers/
├── dto/
├── middleware/
├── plugins/
├── validators/
└── schemas/
```

---

## routes/

Registers Fastify routes.

Example:

```
GET /health
GET /metrics
GET /sync
GET /kufar
GET /ui

GET /ads
POST /subscriptions
```

Routes call controllers only.

---

## controllers/

Translate HTTP requests into application service calls.

Responsibilities:

- validate input
- invoke use case
- convert response
- return HTTP status

Controllers never access the database directly.

---

## dto/

Request/response models.

Example:

```
CreateSubscriptionRequest

AdvertisementResponse

EventResponse
```

DTOs never appear in the Domain layer.

---

## middleware/

Fastify middleware.

Examples:

- logging
- authentication
- request id
- error handling

---

## plugins/

Fastify plugins.

Examples:

- Prisma
- Logger
- Configuration

---

## validators/

Request validation.

Recommended:

```
Zod
```

---

## schemas/

OpenAPI schemas.

Future expansion.

---

# application/

## Purpose

Application use cases.

Coordinates domain objects.

Contains no infrastructure details.

```
application/

├── services/
├── use-cases/
├── ports/
├── dto/
└── mappers/
```

---

## services/

High-level orchestration.

Examples:

```
SyncService

NotificationService

SubscriptionService

AdvertisementService
```

---

## use-cases/

Business use cases.

Examples:

```
SynchronizeAdvertisements

CreateSubscription

GetEvents

ListAdvertisements
```

---

## ports/

Interfaces implemented by Infrastructure.

Examples:

```
MarketplaceClient

NotificationSender

Clock

Hasher
```

---

## dto/

Internal application DTOs.

Separate from HTTP DTOs.

---

## mappers/

Transforms between:

- DTO
- Domain
- Infrastructure

---

# domain/

## Purpose

Core business logic.

Most important layer.

Contains no framework-specific code.

```
domain/

├── entities/
├── value-objects/
├── events/
├── repositories/
├── services/
├── policies/
├── exceptions/
└── types/
```

---

## entities/

Business entities.

Examples:

```
Advertisement

Subscription

User
```

---

## value-objects/

Immutable objects.

Examples:

```
Price

Location

AdvertisementHash
```

---

## events/

Domain events.

```
AdvertisementCreated

AdvertisementChanged

AdvertisementRemoved
```

---

## repositories/

Repository interfaces.

Example:

```
AdvertisementRepository

EventRepository

SubscriptionRepository
```

Only interfaces.

Implementation belongs to Infrastructure.

---

## services/

Pure domain services.

Example:

```
SnapshotComparer

AdvertisementDiffer
```

---

## policies/

Business rules.

Example:

```
RemovalPolicy

NotificationPolicy
```

---

## exceptions/

Domain-specific errors.

Examples:

```
AdvertisementNotFound

InvalidSubscription

SynchronizationFailed
```

---

## types/

Shared domain types.

---

# infrastructure/

## Purpose

Everything outside the business domain.

```
infrastructure/

├── database/
├── kufar/
├── telegram/
├── scheduler/
├── logging/
├── config/
└── http/
```

---

# infrastructure/database/

```
database/

├── prisma/
├── repositories/
└── migrations/
```

---

## prisma/

Prisma initialization.

```
PrismaClient

Connection

Transactions
```

---

## repositories/

Repository implementations.

Examples:

```
PrismaAdvertisementRepository

PrismaEventRepository
```

---

# infrastructure/kufar/

Communication with Kufar.

```
kufar/

├── client/
├── mapper/
├── models/
└── parser/
```

Responsibilities:

- HTTP requests
- JSON parsing
- Mapping
- Retry logic

---

# infrastructure/telegram/

Telegram integration.

```
telegram/

├── bot/
├── formatter/
├── sender/
└── templates/
```

Business logic must never call Telegram directly.

---

# infrastructure/scheduler/

Scheduler implementation.

Possible implementations:

```
node-cron

Cloud Scheduler

GitHub Actions

Kubernetes CronJob
```

The scheduler only starts synchronization.

---

# infrastructure/logging/

Logging implementation.

Implemented in `src/logger.ts` using Pino.

Recommended:

```
Pino
```

---

# infrastructure/metrics/

Metrics implementation.

Implemented in `src/metrics.ts` for sync counters and runtime diagnostics.

---

# infrastructure/config/

Environment configuration.

```
config/

├── env.ts
├── schema.ts
└── loader.ts
```

Responsibilities:

- load environment variables
- validate configuration
- expose typed config

---

# infrastructure/http/

Shared HTTP utilities.

Examples:

- HTTP client
- retry policy
- timeout
- user agent

---

# shared/

## Purpose

Cross-cutting utilities.

```
shared/

├── constants/
├── utils/
├── types/
├── errors/
└── helpers/
```

Shared code must remain generic.

---

# prisma/

```
prisma/

├── schema.prisma
├── migrations/
└── seed.ts
```

---

## schema.prisma

Defines the database model.

---

## migrations/

Generated migration history.

---

## seed.ts

Optional seed data.

---

# tests/

```
tests/

├── unit/
├── integration/
├── e2e/
├── fixtures/
└── helpers/
```

---

## unit/

Pure business logic.

Highest priority.

---

## integration/

Database.

Repositories.

Prisma.

---

## e2e/

Complete application tests.

Example:

```
HTTP

↓

Application

↓

Database
```

---

## fixtures/

Sample JSON.

Sample advertisements.

Mock payloads.

---

## helpers/

Testing utilities.

---

# docs/

```
docs/

01_architecture.md

02_database.md

03_sync_algorithm.md

...

13_project_structure.md
```

Documentation is the project's source of truth.

---

# docker/

```
docker/

├── Dockerfile.dev
├── Dockerfile.prod
└── compose/
```

Optional helper files.

---

# scripts/

Utility scripts.

Examples:

```
build

backup

restore

seed

lint

format
```

---

# .github/

```
.github/

└── workflows/

    ci.yml

    release.yml
```

---

# Root Files

## app.ts

Creates the application.

Registers:

- plugins
- routes
- services

Does not start the server.

---

## server.ts

Entry point.

Responsibilities:

- load configuration
- initialize app
- listen on HTTP port

---

# Dependency Rules

Allowed:

```
API

↓

Application

↓

Domain
```

Infrastructure implements interfaces declared by Application or Domain.

Forbidden:

```
Domain

↓

Fastify

↓

Prisma

↓

Telegram
```

```
Domain

↓

HTTP

↓

Database
```

---

# Naming Conventions

Classes

```
AdvertisementRepository

SyncService

TelegramSender
```

Interfaces

```
MarketplaceClient

NotificationSender

Hasher
```

Files

```
sync-service.ts

telegram-sender.ts

advertisement.repository.ts
```

Directories use:

```
kebab-case
```

---

# Future Extensions

Future modules can be added without changing existing layers.

Examples:

```
infrastructure/

├── email/

├── redis/

├── queue/

└── metrics/
```

```
api/

├── graphql/

└── websocket/
```

The structure is intentionally extensible.

---

# Summary

The project structure emphasizes:

- Layered architecture
- Domain isolation
- Testability
- Infrastructure independence
- Predictable growth
- Clean separation of responsibilities

Each directory has a single, well-defined purpose, making the project easy to navigate, maintain, and extend.
