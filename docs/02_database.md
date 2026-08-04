# Database Model

**Status:** Canonical  
**Last updated:** 2026-08-04

## Purpose

This document describes the persistent data model used by KufMon.

Use this file together with:

- [00_index.md](00_index.md) for the navigation map;
- [03_sync_algorithm.md](03_sync_algorithm.md) for event creation;
- [06_notification_algorithm.md](06_notification_algorithm.md) for delivery rules.

## Design rules

- PostgreSQL is the source of truth.
- Timestamps are stored as `TIMESTAMPTZ`.
- `Listing` keeps the current normalized state.
- `AdEvent` keeps immutable history rows.
- `User` stores billing state for fast admin filtering.
- `UserSubscription` stores billing history.

## Core tables

### User

Customer account in the SaaS admin.

Fields:

- `id`
- `name` - optional display name.
- `telegramChatId` - required Telegram destination.
- `phone` - optional customer phone number.
- `notes` - optional free-form notes.
- `planId`
- `planExpiresAt`

### Plan

Fixed billing plan definition.

Fields:

- `id`
- `name`
- `subscriptionsLimit`
- `minimumIntervalMinutes`
- `enabled`

### UserSubscription

Billing history row.

Fields:

- `userId`
- `planId`
- `status`
- `startedAt`
- `expiresAt`
- `autoRenew`

### Subscription

Search subscription used for Kufar monitoring.

Fields:

- `userId`
- `name`
- `source`
- `category`
- `sellerTypeFilter`
- `notificationMode`
- `maxPrice`
- `rooms`
- `filters`
- `intervalMinutes`
- `enabled`

Notes:

- `rooms` supports the special value `5+`.
- `filters` stores optional description keywords and exclusion keywords.
- `notificationMode` supports `new_and_changed` and `new_only`.
- `source` currently defaults to `kufar.by`.

### Listing

Normalized current advertisement snapshot.

Important fields:

- `title`
- `price`
- `currency`
- `sourcePrice`
- `url`
- `location`
- `description`
- `imageUrl`
- `rooms`
- `category`
- `sellerType`
- `sellerName`
- `sellerPhone`
- `sellerPhoneStatus`
- `source`
- `isActive`
- `contentHash`
- `missingCount`
- `firstSeenAt`
- `lastSeenAt`

Notes:

- `price` is the normalized USD value used in the UI, Telegram, and history.
- `currency` stores the original Kufar currency.
- `sourcePrice` stores the raw source amount used for change detection.
- `sellerName` is normalized from Kufar account parameters.
- `sellerPhone` is stored as-is when present.

### AdEvent

Immutable event history for listings.

Fields:

- `listingId`
- `eventType`
- `changesJson`
- `createdAt`

Event types:

- `NEW`
- `CHANGED`
- `REMOVED`

`changesJson` stores the creation snapshot, the diff, or the removal snapshot.

### TelegramDeliveryLog

Log of Telegram sends.

Fields:

- `userId`
- `userLabel`
- `subscriptionName`
- `chatId`
- `purpose`
- `success`
- `statusCode`
- `error`
- `createdAt`

Notes:

- Billing reminders also use this table.
- The reminder `purpose` contains the reminder type and the target expiry date, which prevents duplicate sends for the same expiration.

## Current indexes

- `Listing(source)`
- `AdEvent(listingId, createdAt)`
- `AdEvent(eventType)`
- `Subscription(source)`
- `UserSubscription(userId, status)`
- `UserSubscription(expiresAt)`
- `TelegramDeliveryLog(userId, createdAt)`
- `TelegramDeliveryLog(createdAt)`

## Ownership summary

- `Listing` and `AdEvent` belong to sync/history.
- `Subscription` belongs to user search filters.
- `User` and `UserSubscription` belong to billing.
- `TelegramDeliveryLog` belongs to delivery observability.

