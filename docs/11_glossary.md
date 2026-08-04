# Glossary

**Canonical index:** [00_index.md](00_index.md)

## Purpose

Use the same terms in code, docs, and discussion.

## Core terms

- **Listing** - current normalized advertisement state.
- **AdEvent** - immutable history row for a listing.
- **Subscription** - a search filter saved for a user.
- **User** - the customer account with billing state.
- **UserSubscription** - billing history row.
- **Plan** - tariff definition and limits.
- **Source** - external marketplace, currently `kufar.by`.
- **Snapshot** - one fetched representation of a listing.
- **Missing count** - consecutive sync misses before removal.
- **Content hash** - stable fingerprint for change detection.
- **Idempotency** - repeating the same operation should not create duplicates.
- **Soft delete** - keep the row but mark it as inactive/removed.

## Rule

If a term is only used once in the codebase, do not expand the glossary for it.

