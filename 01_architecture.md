# System Architecture

## Overview

KufMon is a backend service that monitors real estate advertisements published on Kufar.by.

The system periodically downloads advertisement snapshots, detects changes, stores historical events in PostgreSQL, and delivers notifications to subscribers.

The architecture follows **Clean Architecture** and **Domain-Driven Design (DDD)** principles. Business logic is isolated from infrastructure and can evolve independently of external services.

---

# Design Goals

The architecture is designed to provide:

- clear separation of responsibilities;
- deterministic synchronization;
- immutable event history;
- extensibility to multiple marketplaces;
- infrastructure independence;
- high testability;
- simple deployment.

---

# Architectural Principles

## Domain First

Business rules must not depend on infrastructure.

The domain layer has no knowledge of:

- HTTP
- PostgreSQL
- Prisma
- Telegram
- Fastify
- Scheduler
- Docker
- Hosting provider

Dependencies always point inward.

---

## Separation of Concerns

Each layer has exactly one responsibility.

| Layer | Responsibility |
|--------|----------------|
| API | HTTP endpoints |
| Scheduler | Starts synchronization |
| Application | Use cases |
| Domain | Business rules |
| Infrastructure | External integrations |

---

## Immutable Events

Advertisement events are append-only.

Events are never modified or deleted.

---

## Snapshot Synchronization

Each synchronization compares two complete snapshots.

Partial snapshots never produce deletion events.

---

## Infrastructure Independence

Infrastructure components can be replaced without changing business logic.

Examples:

- PostgreSQL → MySQL
- Telegram → Email
- Fastify → Express
- Prisma → Drizzle
- Neon → AWS RDS

None of these changes should affect the domain layer.

---

# High-Level Architecture

```text
                     Scheduler
                         │
                         ▼
                 SyncApplicationService
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  Kufar Client      AdvertisementRepo    EventRepo
        │
        ▼
      Mapper
        │
        ▼
 Domain Advertisement
        │
        ▼
 Snapshot Comparison
        │
        ▼
   Domain Events
        │
        ▼
NotificationService
        │
        ▼
 Telegram Delivery
```

---

# Layered Architecture

```text
┌────────────────────────────────────────────┐
│                Presentation                │
│--------------------------------------------│
│ REST API                                  │
│ Health Endpoint                           │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│               Application                  │
│--------------------------------------------│
│ SyncService                               │
│ NotificationService                       │
│ SubscriptionService                       │
│ AdvertisementService                      │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│                  Domain                    │
│--------------------------------------------│
│ Entities                                  │
│ Value Objects                             │
│ Events                                    │
│ Business Rules                            │
│ Interfaces                                │
└────────────────────────────────────────────┘
                    │
                    ▼
┌────────────────────────────────────────────┐
│              Infrastructure                │
│--------------------------------------------│
│ Prisma                                    │
│ PostgreSQL                                │
│ Kufar API                                 │
│ Telegram                                  │
│ Scheduler                                 │
│ Logging                                   │
└────────────────────────────────────────────┘
```

---

# Component Diagram

```text
                    HTTP
                     │
                     ▼
               Fastify Server
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
 Advertisement API       Subscription API

                     ▲
                     │
              Application Layer
                     │
      ┌──────────────┼──────────────┐
      ▼              ▼              ▼
 SyncService   QueryService   NotificationService
      │
      ▼
 SnapshotComparer
      │
      ▼
 Domain Events
      │
      ▼
Repositories (Interfaces)
      │
      ▼
 Prisma Repositories
      │
      ▼
 PostgreSQL
```

---

# Synchronization Flow

```text
Scheduler

↓

SyncService

↓

Fetch advertisements

↓

Receive JSON

↓

Map JSON

↓

Load current snapshot

↓

Compare snapshots

↓

Generate events

↓

Save advertisements

↓

Save events

↓

Send notifications
```

---

# Request Flow

Example:

```text
GET /api/v1/ads

↓

Fastify Route

↓

AdvertisementService

↓

Repository

↓

Prisma

↓

PostgreSQL

↓

JSON Response
```

---

# Synchronization Flow

Detailed execution:

```text
Scheduler

↓

KufarClient.fetch()

↓

Raw JSON

↓

Mapper

↓

Domain Advertisements

↓

SnapshotComparer

↓

Event Generator

↓

Database Transaction

├── Update advertisements

├── Save events

└── Update sync metadata

↓

NotificationService

↓

Telegram
```

---

# Domain Model

```text
Advertisement

├── id

├── externalId

├── title

├── price

├── location

├── payload

└── hash
```

Relationships

```text
Advertisement

1

↓

N

AdvertisementEvent
```

---

# Infrastructure Components

## Fastify

Responsibilities:

- REST API
- routing
- validation
- serialization

---

## Prisma

Responsibilities:

- ORM
- migrations
- transactions
- database access

---

## PostgreSQL

Stores:

- advertisements
- advertisement history
- subscriptions
- synchronization metadata

---

## Scheduler

Responsibilities:

- periodically starts synchronization
- contains no business logic

Possible implementations:

- node-cron
- Cloud Scheduler
- GitHub Actions
- Kubernetes CronJob

The application is independent of scheduler implementation.

---

## Telegram

Responsibilities:

- deliver notifications
- message formatting
- retry failed deliveries

Telegram logic is isolated behind `DeliveryService`.

---

# Transaction Boundary

One synchronization executes inside a single database transaction whenever practical.

```text
BEGIN

↓

Update advertisements

↓

Insert events

↓

Update sync state

↓

COMMIT
```

If an error occurs:

```text
ROLLBACK
```

Notifications are sent **after** a successful commit to avoid informing users about changes that were not persisted.

---

# Error Handling

Each infrastructure component is responsible for translating external failures into application-level errors.

Examples:

| External Error | Application Error |
|----------------|-------------------|
| HTTP timeout | SyncFailed |
| Database unavailable | PersistenceError |
| Telegram API error | NotificationFailed |

Business logic never handles infrastructure-specific exceptions directly.

---

# Logging

Logging is centralized.

Each synchronization receives a unique execution identifier.

Example:

```text
syncId=2026-07-20T10:00:00Z

↓

Fetch

↓

Compare

↓

Persist

↓

Notify

↓

Completed
```

This allows tracing an entire synchronization run across all components.

---

# Scalability

Current MVP:

```text
1 Scheduler

↓

1 Application Instance

↓

1 PostgreSQL Database
```

Future scaling:

```text
Multiple Schedulers

↓

Multiple Application Instances

↓

Shared PostgreSQL

↓

Message Queue

↓

Notification Workers
```

No changes to the domain layer should be required.

---

# Future Extensions

The architecture is prepared for:

- multiple marketplaces;
- web frontend;
- authentication;
- email notifications;
- push notifications;
- worker queues;
- analytics;
- distributed synchronization.

All future integrations should implement existing interfaces rather than modifying business logic.

---

# Summary

The architecture is intentionally simple for the MVP while remaining extensible.

Key characteristics:

- Clean Architecture
- Domain-driven design
- Immutable event history
- Snapshot-based synchronization
- Infrastructure independence
- Transactional consistency
- Documentation-first development
- Ready for horizontal scaling