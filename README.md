# KufMon

> Real-time real estate monitoring platform for Kufar.by.

KufMon monitors real estate listings on Kufar, detects changes between synchronization runs, stores historical events, and delivers notifications to subscribed users.

The project is built using a documentation-first approach: the architecture and domain model are fully designed before implementation begins.

---

# Goals

The MVP provides:

- Automatic synchronization with Kufar.
- Detection of new, changed and removed advertisements.
- Persistent storage in PostgreSQL.
- Immutable event history.
- Telegram notifications.
- REST API for future web and mobile clients.

Future versions will support:

- Multiple marketplaces.
- Email notifications.
- Admin UI at `/ui`.
- User accounts.
- Paid subscriptions.

---

# Architecture Overview

```
                    +----------------------+
                    |      Scheduler       |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |     SyncService      |
                    +----------+-----------+
                               |
                     Fetch advertisements
                               |
                               v
                    +----------------------+
                    |     Kufar Client     |
                    +----------+-----------+
                               |
                         Raw JSON payload
                               |
                               v
                    +----------------------+
                    |        Mapper        |
                    +----------+-----------+
                               |
                     Normalized Domain Model
                               |
                               v
                    +----------------------+
                    |      Comparer        |
                    +----------+-----------+
                               |
                     Domain Events
                               |
                               v
                    +----------------------+
                    |   NotificationSvc    |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    | Telegram DeliverySvc |
                    +----------------------+

                               |
                               v

                         PostgreSQL
```

---

# Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Runtime | Node.js 22 LTS |
| Web Framework | Fastify |
| ORM | Prisma |
| Database | PostgreSQL |
| Database Hosting | Neon |
| Notifications | Telegram Bot API |
| Validation | Zod |
| Logging | Pino |
| Monitoring | `/health`, `/metrics` |
| Testing | Vitest |
| Containerization | Docker |
| Repository | GitHub |
| CI | GitHub Actions |

---

# Design Principles

The project follows several core principles.

## Documentation First

Implementation starts only after documentation is complete.

Documentation is considered the source of truth.

---

## Domain First

Business logic is independent from:

- HTTP framework
- database
- scheduler
- Telegram
- hosting provider

Infrastructure depends on the domain, never the opposite.

---

## Immutable Events

Advertisement events are append-only.

Supported events:

- NEW
- CHANGED
- REMOVED

Events are never modified.

---

## Snapshot Synchronization

Synchronization compares complete snapshots.

Partial synchronization never removes advertisements.

---

## Raw Payload Preservation

The complete original Kufar JSON response is stored.

This allows:

- debugging
- API migration
- new field extraction
- historical analysis

---

# Project Documentation

| Document | Description |
|-----------|-------------|
| 01_architecture.md | System architecture |
| 02_database.md | Database schema |
| 03_sync_algorithm.md | Synchronization algorithm |
| 04_kufar_json_reference.md | Kufar API reference |
| 05_kufar_mapping.md | Mapping specification |
| 06_notification_algorithm.md | Notification pipeline |
| 07_api.md | Public REST API |
| 08_deployment.md | Deployment strategy |
| 09_roadmap.md | Project roadmap |
| 10_decisions.md | Architecture Decision Records |
| 11_glossary.md | Project glossary |
| 12_testing_strategy.md | Testing strategy |
| 13_project_structure.md | Source code organization |

---

# High-Level Synchronization Flow

```
Scheduler
        │
        ▼
Kufar Client
        │
        ▼
Mapper
        │
        ▼
Snapshot
        │
        ▼
Comparer
        │
        ▼
SyncService
        │
        ├──────────────► ads
        │
        ├──────────────► ad_events
        │
        ▼
NotificationService
        │
        ▼
Telegram
```

---

# Repository Structure

```
kufmon/
│
├── docs/
├── src/
├── prisma/
├── tests/
├── docker/
├── .github/
├── package.json
├── tsconfig.json
└── README.md
```

Detailed structure is described in **13_project_structure.md**.

---

# Development Workflow

1. Update documentation.
2. Implement feature.
3. Write tests.
4. Verify locally.
5. Open Pull Request.
6. Run CI.
7. Merge to main.

---

# Coding Standards

- TypeScript strict mode.
- Small focused classes.
- Dependency Injection.
- Repository pattern.
- Immutable domain objects.
- Pure business logic.
- Infrastructure isolation.

---

# Kufar Categories

Kufar Search API uses a numeric category code (`cat`) to select real estate type.

Defaults:

- Apartments: `1010`

Supported overrides:

- Houses and cottages: `1020`
- Land plots: `1080`
- Commercial real estate: `1050`

How to override:

- Environment: `KUFAR_CATEGORY=1020`
- HTTP (debug): `GET /kufar?cat=1020` and `GET /sync?cat=1020`
- SOLID principles where appropriate.

---

# Current Status

Current project stage:

- ✅ Architecture completed
- ✅ Database designed
- ✅ Synchronization algorithm designed
- ✅ Notification pipeline designed
- ✅ REST API designed
- ✅ Technology stack finalized
- ⏳ Implementation not started

---

# License

Private repository.
