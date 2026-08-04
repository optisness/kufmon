# Testing Strategy

**Canonical index:** [00_index.md](00_index.md)

## Purpose

Tests protect business behavior, not implementation details.

## Pyramid

- Unit tests for pure helpers and rules.
- Integration tests for Prisma-backed flows.
- End-to-end tests for key admin flows when useful.

## What must be covered

- sync comparisons;
- event generation;
- subscription filtering;
- billing rules and reminders;
- Telegram formatting and logging;
- admin sorting and pagination;
- critical regressions.

## Test data

Include:

- apartments;
- houses;
- land;
- companies and private sellers;
- changed price cases;
- missing listings;
- malformed or partial Kufar payloads.

## Rule

Every fix to business logic should add or update a test.

