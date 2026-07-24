# 06. Notification Algorithm

**Version:** 1.0  
**Status:** Draft  
**Last updated:** 2026-07-24

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
- if subscription has a category, the event must belong to the same category.
- if subscription has `max_price`, the listing price must be at or below that limit;
- if subscription has `rooms`, the listing room count must match one of the selected values.

Matching uses the normalized `ads` table, not raw JSON.

When a subscription is created, the service also sends a one-time backfill message with matching active listings seen during the last subscription interval, so the user does not have to wait for the next sync cycle.

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

Telegram notifications are sent as grouped blocks in the order `NEW`, `CHANGED`, `REMOVED`.
Each listing card starts with a category-specific icon, then shows the title in bold, the current price first, the room count second, optional change summary, and a canonical Kufar page link.
The current template keeps the text black and does not use colored category labels or accents.
Price-only updates below 50 USD are ignored and do not create a `CHANGED` event.
For `rooms`, the subscription filter supports the special `5+` value, which matches any listing with five or more rooms.
When the sync creates a `NEW` history event, the payload stores the normalized snapshot plus the full address, the full description text, and all photo URLs for later inspection in the admin history view.
The admin history view renders those photo URLs as a thumbnail gallery; clicking a thumbnail opens a lightbox that lets operators move through the full photo set with arrows.
History timestamps in the admin view are shown in Minsk time (`Europe/Minsk`) so they match the rest of the admin tables.

## NEW

Contains:

- title
- price
- area
- rooms
- location
- link
- category icon

---

## CHANGED

Contains:

- changed fields only
- previous value
- new value
- title
- rooms
- current price
- canonical link

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
- weekly digests;
- personalized recommendations.

# Implementation Notes Update

- Subscription matching now respects the listing `source`, so future non-Kufar feeds can be kept separate.
- Subscriptions can opt into `new_only` mode; in that mode CHANGED events are not delivered to Telegram.
- The NEW history payload stores the full address, the full description text, and all photo URLs for admin inspection.
- In the admin history view, those photos are shown as thumbnails and open in a gallery lightbox with arrow navigation.
- History timestamps in the admin view use Minsk time, matching the listings table.
