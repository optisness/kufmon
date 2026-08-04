# Architecture Decision Records

**Status:** Living document  
**Purpose:** record the decisions that define the current system

## How to read this file

- Keep each decision short.
- Record the reason, not only the result.
- Add a new entry when the project changes direction.

## ADR-001 - Documentation first

**Status:** Accepted

The project is documented before or together with implementation.

Why:

- reduces ambiguity;
- lowers rework;
- keeps product and code aligned.

## ADR-002 - Listing history is immutable

**Status:** Accepted

`AdEvent` stores the history of listing changes, while `Listing` stores the current state.

Why:

- easier audit trail;
- safer re-syncs;
- simpler admin history view.

## ADR-003 - Price comparison uses raw source values

**Status:** Accepted

Price-change detection compares Kufar source currency and source amount, not only the normalized USD price.

Why:

- avoids false `CHANGED` events caused by exchange-rate drift;
- keeps user notifications focused on real price changes.

## ADR-004 - Billing state lives on User

**Status:** Accepted

The active tariff and its expiry date are stored on `User`, while billing history stays in `UserSubscription`.

Why:

- fast admin sorting and filtering;
- simple reminders;
- preserved billing history.

## ADR-005 - Telegram deliveries are logged

**Status:** Accepted

Every Telegram send is written to `TelegramDeliveryLog`.

Why:

- observability;
- failure diagnostics;
- delivery control for admin messages and billing reminders.

## ADR-006 - Reminder notifications are scheduled daily

**Status:** Accepted

Billing reminders run daily at 10:00 Europe/Minsk.

Why:

- consistent customer communication;
- predictable operational timing;
- easy support for one-day and three-working-day reminders.

