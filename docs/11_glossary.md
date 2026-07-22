# 11. Glossary

**Version:** 1.0  
**Status:** Living Document

---

# Purpose

This document defines the terminology used throughout the project.

The goal is to ensure that all documentation, code and discussions use the same definitions.

---

# Advertisement (Ad)

A normalized real estate listing stored in the database.

Represents the current known state of an advertisement.

Table:

```
ads
```

---

# Source

External platform providing advertisements.

Current sources:

```
kufar
```

Future:

- Onliner
- Realt
- etc.

---

# Source Advertisement ID

Unique advertisement identifier assigned by the external source.

Example:

```
1077901280
```

Combined with `source`, forms a globally unique identifier.

---

# Snapshot

A complete in-memory representation of all advertisements received during a synchronization.

Logical type:

```
Map<(source, source_ad_id), Ad>
```

A snapshot is considered valid only if all pages have been successfully loaded.

---

# Synchronization

The process of updating the local database from an external source.

Steps:

1. Download advertisements.
2. Build snapshot.
3. Compare with database.
4. Generate events.
5. Commit transaction.

---

# Sync Run

One execution of the synchronization process.

Recorded in:

```
sync_runs
```

---

# Advertisement Event

An immutable record describing a change to an advertisement.

Stored in:

```
ad_events
```

Supported types:

- NEW
- CHANGED
- REMOVED

---

# Notification

A user-visible message generated from an advertisement event.

Examples:

- Telegram message
- Email

---

# Notification Channel

A delivery mechanism for notifications.

Current:

- Telegram
- Email

---

# Subscription

A saved search owned by a user.

Contains:

- search filters
- notification interval
- enabled flag

---

# Search Filter

Criteria used to match advertisements.

Examples:

- city
- rooms
- price
- area

---

# Missing Count

Counter tracking consecutive synchronizations in which an advertisement was absent.

Example:

```
0
↓

1
↓

2
↓

3

↓

REMOVED
```

Purpose:

Protect against temporary API failures.

---

# Content Hash

Deterministic hash generated from significant advertisement fields.

Purpose:

Fast equality check.

The hash is an optimization only.

---

# Raw Payload

Original JSON received from Kufar.

Stored unchanged.

Purpose:

- debugging
- future mappings
- recovery

---

# Mapper

Component responsible for converting raw JSON into the internal `Ad` model.

Does not write to the database.

---

# AdComparer

Component comparing two normalized advertisements.

Produces:

- changed fields
- equality result

Does not access external APIs.

---

# SyncService

Main orchestration component.

Responsibilities:

- synchronization
- persistence
- event generation

---

# NotificationService

Finds subscriptions affected by advertisement events.

Creates notification jobs.

---

# NotificationBuilder

Converts domain objects into user-readable messages.

No database access.

---

# DeliveryService

Sends notifications using external providers.

Examples:

- Telegram Bot API
- Email provider

---

# Payload Preservation

Principle requiring that every advertisement's original JSON be stored without modification.

---

# Idempotency

Property ensuring that repeating the same operation produces the same final state.

Applies to:

- synchronization
- notifications
- API

---

# Advisory Lock

Database lock preventing concurrent synchronizations.

Only one synchronization may execute at any given time.

---

# Soft Delete

Advertisement remains in the database but is marked:

```
is_deleted = true
```

instead of being physically removed.

---

# Normalization

Process of converting heterogeneous external data into a stable internal domain model.