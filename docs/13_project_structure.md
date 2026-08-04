# Project Structure

**Canonical index:** [00_index.md](00_index.md)

## Purpose

This file tells you where things live.

## High-level layout

- `src/` - runtime code.
- `prisma/` - schema and migrations.
- `tests/` - Vitest suites.
- `docs/` - canonical documentation.
- `scripts/` - local helper scripts.
- `public/` or UI assets if added later.

## Source ownership

- `app.ts` - HTTP routes and admin UI.
- `kufar.ts` - Kufar sync pipeline.
- `billing.ts` - plans and limits.
- `billingReminders.ts` - subscription expiry reminders.
- `telegram.ts` - Telegram delivery and logging.
- `adminSorting.ts` - admin sort helpers.
- `adminPagination.ts` - pagination helpers.
- `listingTable.ts` - table formatting.
- `historyView.ts` - history rendering.

## Rule

- Keep files small and responsibility-driven.
- Prefer one feature per module.
- Move shared helpers into focused utility files.

