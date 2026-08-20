# Sync Algorithm

**Status:** Canonical  
**Last updated:** 2026-08-04

## Purpose

The sync job fetches Kufar listings, normalizes them, updates `Listing`, and writes immutable `AdEvent` rows when something meaningful changes.

## Current behavior

- The persisted entity is `Listing`.
- Immutable history rows are written to `AdEvent`.
- The sync compares the listing's raw source price and source currency, plus `description`, `imageUrl`, and `rooms`.
- Exchange-rate drift in USD does not create false `CHANGED` events.
- `missingCount` protects against temporary Kufar failures.
- `REMOVED` is emitted only after the third consecutive miss.
- If a listing returns after the first or second miss unchanged, no event is written.
- Removed and inactive listings stay in the database; sync no longer deletes old rows automatically.

## Flow

1. Resolve the set of categories to sync.
2. Fetch the Kufar search API page by page.
3. Normalize each ad into the internal snapshot model.
4. Enrich new listings with detailed item data.
5. Compare the snapshot with the stored `Listing`.
6. Write `NEW`, `CHANGED`, or `REMOVED` events when needed.
7. Update Telegram notifications for matching subscriptions.

## Event rules

### NEW

Created when:

- the listing appears for the first time;
- a previously removed listing appears again.

For `NEW`, the stored history snapshot includes:

- full address;
- full description text;
- all photo URLs.

### CHANGED

Created when a tracked field changes.

Tracked fields:

- price;
- description;
- image;
- rooms.

### REMOVED

Created only when the listing is missing for the third consecutive sync.

If the listing reappears before the third miss and the snapshot is unchanged, no history row is written.

## Notification interaction

- `new_only` subscriptions receive only `NEW` events.
- `new_and_changed` subscriptions receive `NEW` and `CHANGED` events.
- `REMOVED` notifications remain part of the normal feed when the listing is truly removed.

## Telegram format

- Telegram messages are grouped by `NEW`, `CHANGED`, and `REMOVED`.
- Messages use the canonical Kufar URL for each listing.
- The message header shows the subscription name when available.

## Admin history

- History timestamps are shown in Minsk time.
- Photos in the history view are rendered as thumbnails.
- Clicking a thumbnail opens a gallery with arrow navigation.

## Implementation notes

- The sync is idempotent.
- Temporary Kufar outages should not create duplicate removal events.
- Canonical listing changes should be derived from the raw source fields, not from exchange-rate conversions.
