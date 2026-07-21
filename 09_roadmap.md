# Roadmap

## Overview

This roadmap describes the planned evolution of KufMon from an MVP into a production-ready real estate monitoring platform.

The roadmap is feature-oriented rather than date-oriented. A phase is considered complete only when its objectives are fully implemented, tested, and documented.

---

# Guiding Principles

Development follows these principles:

- Documentation First
- Small incremental releases
- Backward-compatible API where practical
- Automated testing
- Stable architecture before new features
- Domain-driven evolution

---

# Current Status

| Area | Status |
|-------|--------|
| Architecture | ✅ Complete |
| Database Design | ✅ Complete |
| Synchronization Algorithm | ✅ Complete |
| Mapping Specification | ✅ Complete |
| Notification Design | ✅ Complete |
| REST API Design | ✅ Complete |
| Documentation | ✅ Complete |
| Implementation | ⚠️ Partially Implemented |

---

# Phase 1 — MVP Foundation

## Goal

Deliver a working backend capable of monitoring Kufar advertisements and sending Telegram notifications.

## Core Infrastructure

- Node.js + TypeScript
- Fastify
- Prisma
- PostgreSQL
- Docker
- GitHub Actions
- Logging
- Configuration management

---

## Database

- Prisma schema
- Initial migrations
- Repository layer
- Database indexes
- Seed scripts

---

## Kufar Client

- HTTP client
- Request retries
- Timeout handling
- Response validation
- Raw payload storage

---

## Mapper

- JSON → Domain mapping
- Validation
- Hash calculation
- Unit tests

---

## Synchronization

- Snapshot loading
- Snapshot comparison
- New advertisements
- Changed advertisements
- Removed advertisements
- Missing counter
- Reappearance detection

---

## Notifications

Telegram integration.

Support:

- NEW
- CHANGED
- REMOVED

---

## REST API

Endpoints:

- Health
- Advertisements
- Events
- Subscriptions

---

## Testing

- Unit tests
- Repository tests
- Mapper tests
- Synchronization tests

---

## MVP Exit Criteria

The MVP is complete when:

- advertisements synchronize automatically;
- changes are detected correctly;
- notifications are delivered;
- REST API works;
- automated tests pass;
- Docker deployment succeeds.

--

## Current implementation status (summary)

- Server & API: реализован HTTP-сервер с базовыми эндпойнтами и простым UI ([src/app.ts](src/app.ts#L1)).
- Synchronization: cron-работа и логика синхронизации/сохранения объявлений реализованы ([src/cron.ts](src/cron.ts#L1), [src/kufar.ts](src/kufar.ts#L1)).
- Database: Prisma-схема и миграции есть, модель `PriceHistory` и `User` присутствуют ([prisma/schema.prisma](prisma/schema.prisma#L1)).
- Notifications: отправка в Telegram реализована ([src/telegram.ts](src/telegram.ts#L1)).
- Monitoring: базовые endpoints `/health` и `/metrics` реализованы, логирование через Pino.
- UI: простая админская страница `/ui` для просмотра объявлений и пользователей ([src/app.ts](src/app.ts#L1)).

## Outstanding work to reach MVP exit criteria

- Добавить полноценное тестовое покрытие (unit/repository/mapper/sync).
- Внедрить retry-политики и обработку ошибок при запросах к Kufar.
- Подготовить Docker образ/compose и CI-пайплайн для развёртывания.
- Проверить и завершить все миграции и seed-скрипты.
- Расширить мониторинг за пределы базовых метрик и health-проверок.

---

# Phase 2 — Stability

## Goal

Improve reliability and operational quality.

---

## Logging

- Structured logging
- Sync identifiers
- Request identifiers
- Error tracking

---

## Error Handling

- Retry policies
- Better diagnostics
- Graceful degradation

---

## Monitoring

- Health checks
- Metrics
- Sync statistics

---

## Performance

- Query optimization
- Better indexing
- Reduced comparisons
- Faster hashing

---

## Testing

Increase coverage.

Target:

```
80%+
```

---

# Phase 3 — User Management

## Goal

Support multiple independent users.

---

Features

- User accounts
- Authentication
- Authorization
- Personal subscriptions
- User preferences

---

# Phase 4 — Web Interface

## Goal

Create a browser-based client.

---

Features

- Dashboard
- Advertisement browser
- Event history
- Search
- Filters
- Subscription management

Possible frontend:

- React
- Next.js

---

# Phase 5 — Advanced Notifications

## Goal

Improve notification capabilities.

---

Channels

- Telegram
- Email
- Push
- Webhooks

---

Features

- Notification templates
- Quiet hours
- Digest mode
- Rate limiting

---

# Phase 6 — Multiple Sources

## Goal

Support marketplaces besides Kufar.

---

Architecture already allows:

```text
Marketplace Interface

├── Kufar

├── Source B

├── Source C

└── Source D
```

Future implementations should reuse the existing synchronization pipeline.

---

# Phase 7 — Search & Analytics

## Goal

Provide insights from collected data.

---

Examples

- Price history
- Average price
- Price changes
- Time on market
- Regional statistics

---

# Phase 8 — Scalability

## Goal

Support significantly larger workloads.

---

Improvements

- Redis
- Queue
- Worker processes
- Horizontal scaling
- Distributed synchronization

---

# Phase 9 — Production Readiness

## Goal

Enterprise-quality deployment.

---

Features

- Rate limiting
- API versioning
- OpenAPI
- Observability
- Backup automation
- Disaster recovery
- Security hardening

---

# Phase 10 — Commercial Platform

Possible future features.

---

Subscriptions

- Free
- Premium
- Enterprise

---

Administration

- Admin panel
- User management
- Audit logs
- Billing

---

Marketplace

- Saved searches
- Smart alerts
- Reports
- Data export

---

# Technical Debt

The following items are intentionally postponed until after MVP.

## Infrastructure

- Redis
- Message queues
- Kubernetes
- Multi-region deployment

---

## Performance

- Cache layer
- Parallel synchronization
- Read replicas

---

## Security

- OAuth
- Multi-factor authentication
- Secret management
- API keys

---

## API

- GraphQL
- WebSockets
- Public SDK

---

# Success Metrics

## MVP

- Stable synchronization
- Accurate change detection
- Reliable notifications
- Successful deployment

---

## Growth

- Multiple users
- Multiple subscriptions
- Multiple marketplaces
- Historical analytics

---

## Production

- High availability
- Low error rate
- Scalable infrastructure
- Fully automated deployment

---

# Version Roadmap

| Version | Goal |
|----------|------|
| 0.1 | Documentation complete |
| 0.2 | Infrastructure |
| 0.3 | Database layer |
| 0.4 | Kufar integration |
| 0.5 | Synchronization engine |
| 0.6 | Telegram notifications |
| 0.7 | REST API |
| 0.8 | Docker deployment |
| 0.9 | Testing and stabilization |
| 1.0 | MVP Release |
| 1.1 | User management |
| 1.2 | Web interface |
| 1.3 | Advanced notifications |
| 2.0 | Multi-marketplace platform |

---

# Out of Scope (MVP)

The following features are explicitly excluded from the MVP.

- Multiple marketplaces
- Authentication
- Web frontend
- Mobile applications
- Payment system
- Email notifications
- Queue infrastructure
- Distributed workers
- AI-powered recommendations
- Analytics dashboard

---

# Long-Term Vision

KufMon evolves from a Kufar monitoring tool into a universal real estate monitoring platform.

Final characteristics:

- Multiple marketplaces
- Multiple notification channels
- Historical analytics
- Public REST API
- Web interface
- Mobile clients
- Extensible architecture
- Cloud-native deployment
- High availability
- Commercial-ready platform