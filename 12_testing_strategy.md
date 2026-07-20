# 12. Testing Strategy

**Version:** 1.0  
**Status:** Draft

---

# Purpose

This document defines the testing strategy for the project.

Testing focuses on business behavior rather than implementation details.

---

# Testing Pyramid

```
Unit Tests

↓

Integration Tests

↓

End-to-End Tests
```

---

# Unit Tests

Test individual components.

Examples:

- KufarMapper
- AdComparer
- NotificationBuilder

No database required.

---

# Integration Tests

Verify interaction between components.

Examples:

- Mapper + Database
- SyncService + PostgreSQL
- NotificationService + Database

---

# End-to-End Tests

Verify complete synchronization.

Example:

```
Kufar API

↓

Mapper

↓

Sync

↓

Database

↓

Events

↓

Notifications
```

---

# Mapper Tests

## Valid Advertisement

Expected:

- normalized object returned

---

## Missing Optional Fields

Expected:

- NULL values
- no exception

---

## Missing Required Fields

Expected:

- advertisement rejected

---

## Unknown Parameters

Expected:

- ignored
- payload preserved

---

# AdComparer Tests

## Identical Advertisement

Expected:

```
equal = true
changes = []
```

---

## Price Changed

Expected:

```
equal = false

changes:

price
```

---

## Multiple Changes

Expected:

One change set containing all modified fields.

---

## Hash Equal

Expected:

Deep comparison skipped.

---

# Synchronization Tests

## First Synchronization

Database empty.

Expected:

All advertisements become NEW.

---

## Second Synchronization

No changes.

Expected:

No events.

Only:

```
last_seen_at
```

changes.

---

## New Advertisement

Expected:

NEW event.

---

## Changed Advertisement

Expected:

CHANGED event.

---

## Removed Advertisement

Expected:

```
missing_count++

↓

REMOVED
```

after threshold.

---

## Reappearing Advertisement

Expected:

```
missing_count = 0

is_deleted = false

NEW
```

---

## Partial Snapshot

Expected:

Synchronization aborted.

No database changes.

---

## Database Failure

Expected:

Rollback transaction.

---

## Lock Already Held

Expected:

Synchronization skipped.

---

# Notification Tests

## NEW Event

Expected:

One notification.

---

## CHANGED Event

Expected:

Changed fields displayed.

---

## REMOVED Event

Expected:

Removal notification.

---

## Duplicate Event

Expected:

Only one notification.

---

## Delivery Failure

Expected:

Retry.

---

# Database Tests

Verify:

- unique constraints
- indexes
- foreign keys
- transactions

---

# API Tests

Verify:

- authentication
- validation
- status codes
- pagination
- idempotency

---

# Performance Tests

Synchronization with:

- 100 advertisements
- 1,000 advertisements
- 10,000 advertisements

Measure:

- execution time
- memory usage
- SQL queries

---

# Regression Tests

Every resolved bug should produce a permanent automated test.

---

# Test Data

Test fixtures should include:

- apartments
- houses
- land
- deleted advertisements
- malformed JSON
- duplicate advertisements

---

# Acceptance Criteria

MVP is considered ready when:

- all unit tests pass;
- all integration tests pass;
- synchronization is idempotent;
- no duplicate events are generated;
- no duplicate notifications are delivered;
- partial snapshots never modify the database.

---

# Continuous Testing

Every change to:

- mapper;
- synchronization;
- notification logic;
- database schema;

must run the full automated test suite before deployment.