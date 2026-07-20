# 07. Service API

**Version:** 1.0  
**Status:** Draft  
**Last updated:** 2026-07-20

---

# Purpose

This document defines the public API of the service.

The API is independent of the implementation language and runtime.

Current implementation target:

- Google Apps Script
- PostgreSQL

Future implementations may use:

- Cloud Run
- Node.js
- Go
- Java

without changing this contract.

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
    "filters": {
        "rooms": 2,
        "price_max": 80000
    },
    "interval_minutes": 30
}
```

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
    "status": "ok"
}
```

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