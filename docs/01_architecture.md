# System Architecture

**Canonical index:** [00_index.md](00_index.md)

## Purpose

KufMon monitors Kufar real-estate listings, stores the current state in PostgreSQL, and writes immutable history events for meaningful changes.

## Core principles

- business rules stay independent from HTTP, Prisma, Telegram, and the scheduler;
- listings store current state;
- events store history;
- synchronization is snapshot-based and idempotent;
- integrations are replaceable without rewriting domain logic.

## Current flow

1. Scheduler triggers sync.
2. Sync fetches Kufar pages.
3. Mapper normalizes raw JSON.
4. Comparison detects `NEW`, `CHANGED`, and `REMOVED`.
5. Repository layer persists `Listing` and `AdEvent`.
6. Notification layer sends Telegram messages.

## Layers

- Presentation: Fastify routes and admin pages.
- Application: sync, notifications, billing, and admin use cases.
- Domain: listings, events, subscriptions, billing rules.
- Infrastructure: Prisma, PostgreSQL, Kufar API, Telegram, cron, logs, metrics.

## Practical rules

- Use the canonical index first when you need a document.
- Prefer the current implementation notes in the specific topic doc over repeating the same rule here.
- Keep architecture notes short; move details into the specialized docs.

