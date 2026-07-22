# 05. Kufar Mapping

**Version:** 1.0  
**Status:** Draft  
**Last updated:** 2026-07-20

---

# Purpose

This document describes how raw Kufar JSON is transformed into the internal domain model used by the application.

Responsibilities of the mapper:

- validate incoming JSON;
- normalize values;
- extract structured attributes;
- preserve the original payload;
- produce a stable `Ad` object.

The mapper **does not**:

- compare advertisements;
- generate events;
- save data to the database.

Those responsibilities belong to `AdComparer` and `SyncService`.

---

# Mapping Pipeline

```
Kufar JSON
      │
      ▼
KufarMapper
      │
      ▼
Internal Ad
      │
      ▼
AdComparer
      │
      ▼
SyncService
```

---

# Internal Ad Model

The mapper produces the following normalized model.

| Field | Type | Source |
|--------|------|--------|
| source | string | constant (`kufar`) |
| source_ad_id | bigint | ad_id |
| category | string | category |
| subject | string | subject |
| description | string/null | body → body_short |
| ad_link | string | ad_link |
| image_url | string/null | first image |
| city | string/null | area |
| district | string/null | future |
| latitude | decimal | coordinates |
| longitude | decimal | coordinates |
| price_usd | decimal | price_usd |
| price_byn | decimal | price_byn |
| rooms | integer | rooms |
| area_total | decimal | size |
| floor | integer | floor |
| floors_total | integer | re_number_floors |
| year_built | integer | year_built |
| seller_type | string | company_ad |
| published_at | timestamp | list_time |
| payload_json | jsonb | raw payload |
| content_hash | string | generated |

---

# Constant Fields

Always populated.

| Field | Value |
|--------|-------|
| source | kufar |

---

# Direct Mapping

The following fields are copied without modification.

| JSON | Internal |
|------|----------|
| ad_id | source_ad_id |
| subject | subject |
| category | category |
| ad_link | ad_link |
| list_time | published_at |

---

# Description Mapping

Priority:

```
body

↓

body_short

↓

null
```

Rules:

- if `body` is not empty → use `body`;
- otherwise use `body_short`;
- otherwise `null`.

---

# Price Mapping

Incoming values:

```json
{
    "price_usd": "6000000",
    "price_byn": "17362800"
}
```

Kufar stores prices in minor monetary units.
The service treats `price_usd` as the canonical price source and displays it with a `$` prefix.

Normalization:

```
6000000

↓

$60000.00
```

Rules:

```
price = price_usd / 100

If `price_usd` is unavailable, the implementation may fall back to `price_byn` for compatibility, but USD remains the canonical display currency.
```

If the value is missing:

```
NULL
```

---

# Image Mapping

Current implementation stores only the first image.

Incoming:

```json
"path": "adim1/example.jpg"
```

Generated:

```
https://rms.kufar.by/v1/gallery/adim1/example.jpg
```

If there are no images:

```
image_url = NULL
```

Future versions may store all images separately.

---

# Parameter Extraction

Most advertisement properties are stored inside:

```
ad_parameters
```

The mapper searches by machine-readable key:

```
p
```

Never by:

- pl
- vl

because those fields are intended for display and may change.

---

# Parameter Lookup

Logical helper:

```
findParameter(key)
```

Returns:

- raw value (`v`)
- or `null`

---

# Rooms

Lookup key:

```
rooms
```

Mapping:

```
v

↓

integer
```

---

# Total Area

Lookup:

```
size
```

Mapping:

```
40.1

↓

40.1
```

Stored as decimal.

---

# Floor

Lookup:

```
floor
```

Observed format:

```json
"v": [7]
```

Rules:

- if array contains one value → use first element;
- otherwise NULL.

---

# Total Floors

Lookup:

```
re_number_floors
```

Rules identical to floor.

---

# Construction Year

Lookup:

```
year_built
```

Stored as integer.

---

# Coordinates

Lookup:

```
coordinates
```

Observed:

```json
[
    23.811005,
    53.619952
]
```

Order:

```
longitude
latitude
```

Mapping:

```
longitude = value[0]

latitude = value[1]
```

---

# City

Lookup:

```
area
```

Current implementation stores:

```
Гродно
```

Future versions may normalize city identifiers separately.

---

# Seller Type

Source:

```
company_ad
```

Mapping:

| company_ad | seller_type |
|------------|-------------|
| true | company |
| false | private |

This field is persisted on `Listing.sellerType` and can be used by subscription filters to keep only private sellers.

---

# Nullable Fields

The following fields may legitimately be NULL.

- description
- image_url
- city
- district
- latitude
- longitude
- rooms
- area_total
- floor
- floors_total
- year_built
- price_byn
- price_usd

The mapper must never fail because of missing optional fields.

---

# Unknown Parameters

Unknown parameters are ignored.

Example:

```
flat_windows_side

bathroom

balcony

...
```

Current mapper does not extract them.

They remain available inside:

```
payload_json
```

---

# Payload Preservation

The original advertisement JSON is stored without modification.

Purpose:

- debugging;
- future mappings;
- recovery;
- API evolution.

The mapper never edits the payload.

---

# Content Hash

The mapper generates a deterministic hash from significant business fields.

Hash excludes:

- payload_json
- first_seen_at
- last_seen_at
- missing_count
- database identifiers

Recommended fields:

- subject
- description
- category
- price_usd
- price_byn
- rooms
- area_total
- floor
- floors_total
- year_built
- latitude
- longitude
- seller_type
- image_url

The exact hashing algorithm is implementation-specific.

---

# Validation Rules

Required:

- ad_id
- subject
- ad_link

If one of these fields is missing:

Advertisement is rejected.

Optional fields become NULL.

---

# Error Handling

Mapper errors must affect only the current advertisement.

Rules:

- invalid advertisement → skip;
- write warning to logs;
- continue processing remaining advertisements.

A malformed advertisement must never abort the entire synchronization.

---

# Mapping Example

Input:

```json
{
    "ad_id": 1077901280,
    "subject": "1комн квартира",
    "price_usd": "6000000",
    "list_time": "2026-07-20T15:54:32Z"
}
```

Output:

```json
{
    "source": "kufar",
    "source_ad_id": 1077901280,
    "subject": "1комн квартира",
    "price_usd": 60000.00,
    "published_at": "2026-07-20T15:54:32Z"
}
```

---

# Responsibilities

The mapper is responsible for:

- field extraction;
- normalization;
- validation;
- payload preservation;
- content hash generation.

The mapper is **not** responsible for:

- database writes;
- synchronization;
- duplicate detection;
- event generation;
- notification generation.

Those concerns are handled by the synchronization pipeline.
