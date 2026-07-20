# 06. Notification Algorithm

**Version:** 1.0  
**Status:** Draft  
**Last updated:** 2026-07-20

---

# Purpose

This document describes how advertisement events are converted into user notifications.

Notification generation is completely independent of synchronization.

Pipeline:

```

SyncService
↓
ad_events
↓
NotificationService
↓
NotificationBuilder
↓
DeliveryService
↓
Telegram / Email

```

---

# Responsibilities

## SyncService

Responsible for:

- detecting changes;
- creating immutable `ad_events`.

Does NOT notify users.

---

## NotificationService

Responsible for:

- finding subscriptions affected by an event;
- filtering events;
- building notification jobs.

---

## NotificationBuilder

Responsible for:

- human-readable text;
- formatting;
- localization.

---

## DeliveryService

Responsible for:

- sending notifications;
- retries;
- channel-specific formatting.

---

# Event Types

Supported events:

```

NEW
CHANGED
REMOVED

```

---

# NEW

Generated when:

- advertisement appears for the first time;
- previously removed advertisement reappears.

Notification example:

```

🆕 New apartment

2 rooms
58 m²
$72,000

https://...

```

---

# CHANGED

Generated whenever one or more tracked fields change.

Examples:

- price
- description
- rooms
- images
- coordinates

One event may contain multiple changed fields.

Example:

```

💰 Price changed

$73,000

↓

$71,000

```

---

# REMOVED

Generated after the configured `missing_count` threshold.

Example:

```

❌ Advertisement removed

```

---

# Subscription Matching

Each event is matched against active subscriptions.

Conditions:

- subscription enabled;
- user has active plan;
- event matches saved search.

Matching uses the normalized `ads` table, not raw JSON.

---

# Deduplication

Each event generates at most one notification per subscription.

Duplicate deliveries are not allowed.

Recommended unique key:

```

(subscription_id, ad_event_id)

```

---

# Notification Channels

V1 supports:

- Telegram
- Email

Architecture allows future channels:

- Push
- SMS
- Discord
- Slack

---

# Delivery Order

Notifications are processed in FIFO order.

Ordering:

```

event_time
↓

subscription

```

---

# Builder Rules

Builder receives:

```

Ad
AdEvent
Subscription

```

Produces:

```

Notification

```

Builder performs no database access.

---

# Message Templates

## NEW

Contains:

- title
- price
- area
- rooms
- location
- link

---

## CHANGED

Contains:

- changed fields only
- previous value
- new value

Example:

```

Price

75000

↓

73000

```

---

## REMOVED

Contains:

- title
- link

---

# Changed Fields

Builder should display only significant fields.

Example:

```

Price

↓

Rooms

↓

Area

```

Fields unchanged are omitted.

---

# Rate Limiting

Future enhancement.

Possible policies:

- immediate
- grouped
- hourly digest
- daily digest

V1:

Immediate delivery.

---

# Failures

Delivery failure must not lose notifications.

Recommended states:

```

PENDING

SENT

FAILED

RETRYING

```

---

# Retry Policy

Transient failures:

- exponential backoff

Permanent failures:

- mark FAILED

---

# Notification Queue

Logical flow:

```

Event

↓

Notification Job

↓

Delivery

↓

Completed

```

Queue implementation is implementation-specific.

---

# User Preferences

Future versions may support:

- NEW only
- price changes only
- removals only
- digest mode

V1 sends all supported events.

---

# Idempotency

Delivery must be idempotent.

Repeated synchronization must never create duplicate notifications.

---

# Future Improvements

Possible additions:

- notification batching;
- AI-generated summaries;
- price history charts;
- weekly digests;
- personalized recommendations.