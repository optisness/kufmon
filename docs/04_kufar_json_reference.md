# 04. Kufar JSON Reference

**Version:** 1.0  
**Status:** Draft (based on reverse engineering)  
**Last updated:** 2026-07-20

---

# Purpose

This document describes the JSON contract returned by the Kufar Search API.

It is **not** a mapping specification.

Its purpose is to document:

- endpoint structure;
- response layout;
- field types;
- field semantics;
- known observations;
- fields required by the synchronization service.

Transformation into the internal domain model is described separately in **05_kufar_mapping.md**.

---

# Data Source

Current implementation uses:

```
GET /search-api/v2/search/rendered-paginated
```

Example:

```
https://api.kufar.by/search-api/v2/search/rendered-paginated
```

---

# Top-level Response

Example:

```json
{
  "ads": [...],
  "pagination": {...},
  "total": 734
}
```

| Field | Type | Description |
|--------|------|-------------|
| ads | array | List of advertisements |
| pagination | object | Pagination metadata |
| total | integer | Total number of matching ads |

---

# Advertisement Object

Each element of `ads` is a complete advertisement summary.

Important fields:

| Field | Type | Required | Notes |
|--------|------|----------|------|
| ad_id | integer | Yes | Unique advertisement identifier |
| ad_link | string | Yes | Public advertisement URL |
| subject | string | Yes | Advertisement title |
| body | string/null | No | Full description (often null in search results) |
| body_short | string/null | No | Short description |
| category | string | Yes | Category identifier |
| type | string | Yes | Transaction type |
| currency | string | Yes | Currency code |
| price_usd | string | No | Price in USD minor units |
| price_byn | string | No | Price in BYN minor units |
| list_time | string | Yes | Publication timestamp (ISO-8601) |
| images | array | No | Image metadata |
| ad_parameters | array | Yes | Structured advertisement parameters |
| account_parameters | array | No | Seller information |
| company_ad | boolean | Yes | Company advertisement flag |
| phone_hidden | boolean | Yes | Phone visibility |
| paid_services | object | No | Paid promotion flags |

---

# Identification

Example:

```json
{
    "ad_id": 1077901280,
    "ad_link": "https://re.kufar.by/vi/1077901280"
}
```

## ad_id

Unique advertisement identifier.

Properties:

- stable
- globally unique within Kufar
- primary identifier for synchronization

---

# Title

```
subject
```

Example:

```json
"subject": "1комн квартира 40.1м кв рядом Тц Парус"
```

Human-readable advertisement title.

---

# Description

Fields:

```
body
body_short
```

Observed:

```json
"body": null,
"body_short": "Дом газоселикатный блок, кирпич"
```

Observations:

- `body` may be null.
- `body_short` is usually populated.
- Full description may require another endpoint.

---

# Category

Example:

```json
"category": "1010"
```

Current value is a string.

Represents Kufar category identifier.

Common real-estate categories used by this service:

- `1010` - apartments
- `1020` - houses and cottages
- `1080` - land plots
- `1050` - commercial real estate

The synchronization pipeline uses `price_usd` as the primary displayed price field.

---

# Transaction Type

Example:

```json
"type": "sell"
```

Observed values:

- sell

Other values are currently undocumented.

---

# Publication Time

Example:

```json
"list_time": "2026-07-20T15:54:32Z"
```

ISO-8601 timestamp.

---

# Prices

Example:

```json
{
    "currency": "USD",
    "price_usd": "6000000",
    "price_byn": "17362800"
}
```

Observations:

Prices are returned in **minor monetary units**.

Example:

```
6000000

↓

60000.00 USD
```

Normalization rules are described in Mapping.

---

# Images

Example:

```json
{
    "id": "0000",
    "media_storage": "rms",
    "path": "adim1/eec9bab5-....jpg",
    "yams_storage": false
}
```

Image object fields:

| Field | Type |
|--------|------|
| id | string |
| media_storage | string |
| path | string |
| yams_storage | boolean |

Current implementation stores only:

```
path
```

Image URL construction belongs to Mapping.

---

# Advertisement Parameters

One of the most important sections.

Example:

```json
{
    "pl": "Количество комнат",
    "p": "rooms",
    "v": "1",
    "vl": "1"
}
```

Every parameter contains:

| Field | Description |
|--------|-------------|
| p | Machine-readable key |
| pl | Display name |
| v | Raw value |
| vl | Formatted value |
| pu | URL query parameter name |
| g | UI grouping metadata |

---

# Common Parameter Keys

Observed keys:

| p | Meaning |
|---|---------|
| rooms | Number of rooms |
| size | Total area |
| size_living_space | Living area |
| size_kitchen | Kitchen area |
| floor | Floor |
| re_number_floors | Total floors |
| year_built | Construction year |
| house_type | Wall material |
| coordinates | Geographic coordinates |
| bathroom | Bathroom |
| balcony | Balcony |
| condition | Property condition |
| flat_repair | Repair type |
| flat_windows_side | Window orientation |

This list is not exhaustive.

---

# Coordinates

Coordinates are stored inside `ad_parameters`.

Example:

```json
{
    "p": "coordinates",
    "v": [
        23.811005,
        53.619952
    ]
}
```

Observed order:

```
[
    longitude,
    latitude
]
```

---

# Seller Information

Seller information is stored in:

```
account_parameters
```

Example:

```json
{
    "p": "name",
    "v": "Алексей"
}
```

Another example:

```json
{
    "p": "address",
    "v": "Академическая ул..."
}
```

Observed fields:

- name
- address

---

# Paid Services

Example:

```json
"paid_services": {
    "highlight": false,
    "polepos": false,
    "halva": false
}
```

These fields describe advertisement promotion.

Current MVP ignores them.

---

# Boolean Flags

Observed:

```json
company_ad
phone_hidden
is_mine
```

Current synchronization ignores these fields.

---

# Unknown Fields

Some fields have not yet been analyzed.

Examples:

- calculator
- feedback_info
- message_id
- remuneration_type
- show_parameters

They are preserved in the raw payload.

---

# Nullable Fields

Observed nullable fields:

| Field |
|------|
| body |
| feedback_info |

Additional nullable fields may exist.

Implementation must tolerate missing values.

---

# Arrays

Observed arrays:

- ads
- images
- ad_parameters
- account_parameters

Some arrays may be empty.

---

# Unknown Fields Policy

The Kufar API is not officially documented.

Rules:

- unknown fields must never break parsing;
- parser must ignore unsupported fields;
- raw payload should be preserved for future analysis.

---

# Raw Payload Preservation

Synchronization should preserve the original JSON.

Reasons:

- future debugging;
- API evolution;
- mapping improvements;
- recovery from parser bugs.

Raw payload is stored unchanged in the database.

---

# Stability

Observed stable identifiers:

- ad_id

Potentially unstable:

- display labels (`pl`)
- formatted values (`vl`)
- UI metadata (`g`)

Parser should rely primarily on machine-readable key:

```
p
```

---

# Next Document

Transformation of this JSON into the internal domain model is described in:

```
05_kufar_mapping.md
```
