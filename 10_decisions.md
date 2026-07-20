# Architecture Decision Records (ADR)

## Purpose

This document records the major architectural decisions made during the design of KufMon.

Each decision includes:

- context;
- selected solution;
- rationale;
- consequences.

The goal is to document **why** a decision was made, not merely **what** was implemented.

---

# ADR-001 — Documentation First

**Status:** Accepted

## Decision

The project follows a documentation-first development process.

Implementation begins only after the architecture, data model, synchronization algorithm and public interfaces are documented.

## Rationale

Benefits:

- shared understanding;
- reduced redesign;
- easier onboarding;
- predictable implementation.

## Consequences

Documentation becomes the primary source of truth.

---

# ADR-002 — Backend Platform

**Status:** Accepted

## Decision

Use a dedicated backend service based on **Node.js**.

## Context

Google Apps Script was initially considered as the execution environment.

After reviewing the architecture, it became clear that GAS introduces unnecessary limitations:

- no direct PostgreSQL connectivity;
- limited execution environment;
- execution time limits;
- dependence on Google infrastructure.

## Consequences

Pros

- standard backend architecture;
- full ecosystem access;
- easy deployment;
- long-term scalability.

Cons

- requires backend hosting.

---

# ADR-003 — Programming Language

**Status:** Accepted

## Decision

Use **TypeScript**.

## Rationale

The project contains:

- complex synchronization logic;
- multiple integrations;
- domain models;
- event processing.

Type safety significantly reduces implementation errors.

---

# ADR-004 — Web Framework

**Status:** Accepted

## Decision

Use **Fastify**.

## Reasons

- excellent TypeScript support;
- high performance;
- lightweight;
- simple plugin architecture.

Alternatives considered:

- Express
- NestJS

Fastify provides the best balance between simplicity and performance.

---

# ADR-005 — Database

**Status:** Accepted

## Decision

Use PostgreSQL.

## Reasons

Required features:

- ACID transactions;
- relational data;
- JSON support;
- indexing;
- constraints.

---

# ADR-006 — Database Hosting

**Status:** Accepted

## Decision

Use **Neon PostgreSQL** for the MVP.

## Reasons

- managed PostgreSQL;
- free tier;
- external connectivity;
- zero server administration.

The application must remain portable to any PostgreSQL provider.

---

# ADR-007 — ORM

**Status:** Accepted

## Decision

Use Prisma.

## Reasons

- migrations;
- type-safe queries;
- excellent TypeScript integration;
- mature ecosystem.

Alternatives

- Drizzle
- TypeORM
- raw SQL

---

# ADR-008 — Layered Architecture

**Status:** Accepted

Application architecture consists of:

```
Presentation

↓

Application

↓

Domain

↓

Infrastructure
```

Dependencies always point inward.

---

# ADR-009 — Domain Independence

**Status:** Accepted

Business logic must not depend on:

- Fastify
- Prisma
- PostgreSQL
- Telegram
- Scheduler
- Docker
- Hosting provider

Only interfaces are visible to the domain layer.

---

# ADR-010 — Repository Pattern

**Status:** Accepted

All persistence is performed through repositories.

Business services never execute SQL directly.

---

# ADR-011 — Snapshot Synchronization

**Status:** Accepted

Synchronization compares two complete snapshots.

Advantages:

- deterministic behavior;
- easy reasoning;
- reliable deletion detection.

---

# ADR-012 — Partial Snapshots

**Status:** Accepted

Partial snapshots never remove advertisements.

Deletion requires a complete successful synchronization.

---

# ADR-013 — Missing Threshold

**Status:** Accepted

Advertisement removal rule:

```
missing_count >= 3
```

Temporary API inconsistencies must not generate false removals.

---

# ADR-014 — Reappearance

**Status:** Accepted

If a removed advertisement appears again:

```
REMOVED

↓

NEW
```

The advertisement is treated as a newly discovered listing.

---

# ADR-015 — Immutable Events

**Status:** Accepted

Advertisement events are immutable.

Supported event types:

- NEW
- CHANGED
- REMOVED

Events are append-only.

---

# ADR-016 — Event Aggregation

**Status:** Accepted

A synchronization run generates at most one CHANGED event per advertisement.

Multiple field changes are aggregated into one event.

---

# ADR-017 — Raw Payload Preservation

**Status:** Accepted

Store the complete original Kufar JSON response.

Reasons:

- debugging;
- remapping;
- future field extraction;
- historical reference.

---

# ADR-018 — Mapping Layer

**Status:** Accepted

External JSON must never be used directly by business logic.

```
Kufar JSON

↓

Mapper

↓

Domain Advertisement
```

---

# ADR-019 — Content Hash

**Status:** Accepted

Each advertisement stores a content hash.

If hashes are equal:

- deep comparison is skipped.

Hash comparison is a performance optimization only.

---

# ADR-020 — Notification Pipeline

**Status:** Accepted

Notifications are generated from domain events.

```
Synchronization

↓

Events

↓

Notification Service

↓

Delivery Service

↓

Telegram
```

Synchronization never communicates with Telegram directly.

---

# ADR-021 — Scheduler Independence

**Status:** Accepted

Scheduler implementation is replaceable.

Supported implementations include:

- node-cron;
- GitHub Actions;
- Cloud Scheduler;
- Kubernetes CronJob.

Business logic is unaware of scheduler implementation.

---

# ADR-022 — Transaction Boundary

**Status:** Accepted

One synchronization executes inside a single database transaction whenever practical.

Either:

```
COMMIT
```

or

```
ROLLBACK
```

No partial synchronization state should be persisted.

---

# ADR-023 — Notification Timing

**Status:** Accepted

Notifications are sent only after a successful transaction commit.

Reason:

Users must never receive notifications about changes that were not persisted.

---

# ADR-024 — Telegram Isolation

**Status:** Accepted

Telegram integration is isolated behind a Delivery Service.

The application layer has no knowledge of Telegram SDK.

---

# ADR-025 — REST API Separation

**Status:** Accepted

REST API is independent from synchronization.

Synchronization can execute without HTTP requests.

HTTP API can continue serving requests while synchronization is running.

---

# ADR-026 — Logging

**Status:** Accepted

Structured JSON logging is used.

Each synchronization receives a unique identifier.

Benefits:

- tracing;
- debugging;
- monitoring.

---

# ADR-027 — Containerization

**Status:** Accepted

The application is distributed as a Docker container.

Benefits:

- reproducible builds;
- deployment portability;
- environment consistency.

---

# ADR-028 — Configuration

**Status:** Accepted

Configuration is provided exclusively through environment variables.

Configuration is never hardcoded.

---

# ADR-029 — Testing Strategy

**Status:** Accepted

Testing pyramid:

```
Unit Tests

↓

Integration Tests

↓

End-to-End Tests
```

Business logic has the highest test coverage priority.

---

# ADR-030 — Deployment Independence

**Status:** Accepted

Deployment platform must not influence application architecture.

Supported platforms include:

- Render
- Railway
- Fly.io
- Google Cloud Run
- VPS
- Kubernetes

Changing hosting must require configuration changes only.

---

# ADR-031 — Marketplace Abstraction

**Status:** Accepted

Kufar is the initial implementation of a marketplace interface.

Future marketplaces should implement the same abstraction.

Example:

```
Marketplace

├── Kufar

├── Source B

└── Source C
```

No synchronization changes should be required.

---

# ADR-032 — Free-Tier Friendly MVP

**Status:** Accepted

The MVP should remain deployable using free tiers whenever practical.

Preferred stack:

- GitHub
- Docker
- Neon
- Fastify
- Prisma
- TypeScript

Paid infrastructure should not be required for initial development.

---

# ADR-033 — Future Scalability

**Status:** Accepted

The architecture should support future migration to:

- multiple application instances;
- worker processes;
- queues;
- Redis;
- distributed synchronization.

These additions should not require changes to the domain layer.

---

# ADR-034 — Simplicity Over Premature Optimization

**Status:** Accepted

The MVP favors simplicity over maximum scalability.

Examples:

- single application process;
- synchronous event generation;
- direct database access;
- no message queue.

Complex infrastructure should only be introduced when justified by measurable requirements.

---

# Summary

The current architecture is based on the following principles:

- Documentation First
- Clean Architecture
- Domain-Driven Design
- Infrastructure Independence
- Immutable Events
- Snapshot Synchronization
- Containerized Deployment
- Replaceable Integrations
- Type Safety
- Simplicity for MVP
- Scalability by Design