# 07. Service API

**Version:** 1.0  
**Status:** Partially implemented (service provides a minimal set of endpoints)
**Last updated:** 2026-07-23

---

# Purpose

This document defines the public API of the service.

The API is independent of the implementation language and runtime.

Current implementation notes:

- The service currently runs on Node.js/TypeScript with Fastify. A minimal HTTP surface is implemented in `src/app.ts` (public login page, protected admin pages, health, sync, metrics, Kufar debug endpoints, and user/subscription management endpoints): [src/app.ts](src/app.ts#L1).
- The public landing page at `/` shows service status and a password field. A valid password issues an authenticated admin session and redirects to `/ui/users`.
- The admin UI is split into protected pages: `/ui/users` for users, `/ui/subscriptions` for subscriptions, and `/ui/listings` for listings. The visible nav after login only links to Users, Subscriptions, Listings, Health, and Sync.
- The admin tables now paginate with `page` and `limit` query parameters instead of rendering the full collection in a single scroll.
- Sorting in the admin tables is server-side and uses `sort` and `dir` query parameters, so sorted results stay consistent across paginated pages.
- Row numbers continue across pages instead of resetting to `1` on every page.
- The users page now shows each user's tariff and payment end date, and both columns can be sorted.
- The users page also supports inline editing of the user name, Telegram chat ID, tariff, and payment end date.
- In the subscriptions table, the active-state toggle is shown as `Enabled` or `Disabled` so the current state is unambiguous.
- The listings page sorts price using the normalized numeric value, so the `"$"` prefix shown in the table does not break sorting.
- The listings page also shows the `missingCount` column, which represents consecutive failed sync attempts before a listing becomes `REMOVED`.
- The listings page now also shows and sorts by the timestamp of the latest `NEW` / `CHANGED` / `REMOVED` event, so operators can quickly see how recently a listing changed.
- The `NEW` history payload includes the normalized snapshot plus the full address, full description, and all photo URLs, but those extra fields are only used in the admin history view.
- `/metrics` and `/kufar` remain protected debug endpoints and are not shown in the main navigation. `metrics` returns uptime plus a few counters; `kufar` returns the raw Kufar search payload.
- Admin login attempts are rate-limited: three wrong passwords lock the form for five minutes and trigger a Telegram notification to the admin.

Future deployments may target Cloud Run, Docker, or other runtimes without changing the contract.

---

# Authentication

The admin interface uses a password-protected browser session:

- the landing page at `/` accepts the admin password;
- a successful login sets an HTTP-only session cookie;
- protected routes redirect back to `/` when the cookie is missing or invalid;
- three failed attempts lock the form for five minutes and notify the admin in Telegram.

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
    "category": "1010",
    "sellerTypeFilter": "private",
    "maxPrice": 80000,
    "rooms": [2],
    "intervalMinutes": 30
}
```

A subscription owns optional filter criteria and is attached to a single user. The implementation keeps the UI simple by splitting the common filters into separate `maxPrice` and `rooms` fields instead of a raw JSON editor.

In the admin UI, the `userId` field is rendered as a dropdown of existing users so the owner is visible by name. The `category` field stores the Kufar category code used for the search, while the UI shows one-word labels such as `Квартира`, `Дом`, `Коммерция`, and `Участок`. The `sellerTypeFilter` field supports `all` and `private`, so a subscription can receive either every matching listing or only private sellers. After creation, the service sends the user a Telegram backfill containing matching active listings from the last subscription interval.

The subscription creation form is compacted into two visual rows in the admin UI: the first row contains name, user, and interval; the second row contains category, seller type, max price, rooms, and submit.

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

- maxPrice
- rooms
- category
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

The synchronization run fetches Kufar search results in cursor-based pages. The first request asks for 100 rows, then the service follows the returned `cursor` token until no further page is available.

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

Collections use cursor pagination:

```

cursor

```

The requested page state lives only in the cursor token provided by the upstream API.

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

GET /listings/{id}/events

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
