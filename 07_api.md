# 07. Service API

**Version:** 1.0  
**Status:** Partially implemented (service provides a minimal set of endpoints)
**Last updated:** 2026-07-21

---

# Purpose

This document defines the public API of the service.

The API is independent of the implementation language and runtime.

Current implementation notes:

- The service currently runs on Node.js/TypeScript with Fastify. A minimal HTTP surface is implemented in `src/app.ts` (health, metrics, basic listings, `/sync`, `/kufar`, simple UI and user management endpoints): [src/app.ts](src/app.ts#L1).
- The `/ui` admin page shows numbered tables, sorts users by display name, sorts subscriptions by name/owner/interval, and lets subscriptions pick an owner from existing users.

Future deployments may target Cloud Run, Docker, or other runtimes without changing the contract.

---

# Authentication

V1:

Bearer Token

```

Authorization: Bearer <token>

```

---

# Resources

Main resources:

- Users
- Search Subscriptions
- Advertisements
- Advertisement Events

---

# Search Subscriptions

## Create

```

POST /subscriptions

```

Request:

```json
{
    "name": "Minsk 2 rooms",
    "userId": "user-123",
    "filters": {
        "rooms": [2],
        "price_max": 80000
    },
    "interval_minutes": 30
}
```

A subscription owns optional filter criteria and is attached to a single user. During synchronization, personal subscriptions are evaluated in addition to the user's default preferences.

In the admin UI, the `userId` field is rendered as a dropdown of existing users so the owner is visible by name.

Response:

```
201 Created
```

---

## List

```

GET /subscriptions

```

Returns all subscriptions for the current user.

---

## Get

```

GET /subscriptions/{id}

```

---

## Update

```

PATCH /subscriptions/{id}

```

Supports:

- filters
- interval
- enabled

---

## Delete

```

DELETE /subscriptions/{id}

```

Soft delete is recommended.

---

# Advertisements

## List

```

GET /ads

```

Optional filters:

- city
- rooms
- price
- deleted

---

## Get

```

GET /ads/{id}

```

Returns normalized advertisement.

---

# Advertisement Events

## List

```

GET /events

```

Filters:

- type
- after
- subscription

---

# User Profile

```

GET /me

```

Returns:

- profile
- plan
- channels

---

# Notification Channels

## List

```

GET /channels

```

---

## Add

```

POST /channels

```

---

## Update

```

PATCH /channels/{id}

```

---

## Delete

```

DELETE /channels/{id}

```

---

# Plans

## Current

```

GET /plans/current

```

---

## Available

```

GET /plans

```

---

# Health Check

```

GET /health

```

Returns:

```json
{
    "status": "ok",
    "db": true,
    "telegram": false,
    "uptime": 123.45
}
```

The `/health` endpoint verifies database connectivity and whether Telegram configuration is present. A missing Telegram token does not fail the health response, but is reported with `telegram: false`.

---

# Metrics

```

GET /metrics

```

Returns runtime and sync counters:

```json
{
    "uptime": 123.45,
    "listings": 42,
    "users": 3,
    "metrics": {
        "syncRuns": 7,
        "adsFetched": 124,
        "newListings": 10,
        "priceChanges": 4,
        "alertsSent": 13,
        "deactivations": 2
    }
}
```

# Manual Sync

```

GET /sync

```

Triggers a manual synchronization run and returns the number of ads processed.

Optional query parameters:

- `cat` (string): Kufar category code override (e.g. `1010`, `1020`, `1080`, `1050`).

```json
{
    "synced": 12
}
```

# Raw Kufar Payload

```

GET /kufar

```

Returns the latest raw Kufar payload fetched by the service.

Optional query parameters:

- `cat` (string): Kufar category code override (e.g. `1010`, `1020`, `1080`, `1050`).

---

# Pagination

Collections use:

```

limit
offset

```

Future versions may migrate to cursor pagination.

---

# Errors

Standard format:

```json
{
    "error": {
        "code": "validation_error",
        "message": "Price must be positive."
    }
}
```

---

# HTTP Status Codes

```

200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

500 Internal Server Error

```

---

# Versioning

API prefix:

```

/api/v1/

```

Example:

```

GET /api/v1/subscriptions

```

---

# Idempotency

Recommended for:

```

POST

PATCH

DELETE

```

using:

```

Idempotency-Key

```

header.

---

# Future Endpoints

Possible additions:

```

GET /price-history

GET /statistics

GET /recommendations

POST /notifications/test

GET /sources

```

---

# Non-Goals

The public API is not responsible for:

- synchronization with Kufar;
- mapper execution;
- notification delivery;
- scheduler management.

These are internal service components.
