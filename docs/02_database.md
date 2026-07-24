# 02_database.md

# Модель данных

## Принципы

-   PostgreSQL.
-   UUID не используются, первичные ключи BIGSERIAL.
-   Все даты --- TIMESTAMPTZ.
-   Все внешние ключи явные.
-   Объявления не удаляются физически.
-   `payload_json` хранит оригинальный ответ Kufar.

------------------------------------------------------------------------

# users

Пользователи SaaS.

-   `name` is an optional display name for the user.
-   The admin UI uses it to label users and subscription owners.
-   The active tariff is stored on the user itself as `plan_id` and `plan_expires_at` so the admin UI can sort and filter without extra joins.
-   Billing history is stored separately in `user_subscriptions`, so a tariff change creates a new row instead of overwriting the past.

  Поле         Тип            Описание
  ------------ -------------- ---------------
  id           BIGSERIAL PK   идентификатор
  login        TEXT UNIQUE    логин
  email        TEXT           email
  enabled      BOOLEAN        активен
  created_at   TIMESTAMPTZ    создание
  updated_at   TIMESTAMPTZ    изменение

------------------------------------------------------------------------

# notification_channels

Каналы доставки уведомлений.

  Поле               Тип
  ------------------ --------------------
  id                 BIGSERIAL PK
  user_id            FK users
  type               TELEGRAM / WEBHOOK
  telegram_chat_id   BIGINT
  webhook_url        TEXT
  webhook_token      TEXT
  enabled            BOOLEAN
  created_at         TIMESTAMPTZ
  updated_at         TIMESTAMPTZ

CHECK гарантирует заполнение полей согласно `type`.

------------------------------------------------------------------------

# plans

Описание тарифов.

Current fixed tariffs:

- `single` - `1 подписка`, minimum interval `20` minutes
- `triple` - `3 подписки`, minimum interval `10` minutes
- `unlimited` - `анлим`, minimum interval `5` minutes
- `bonus` - `1 бонусная подписка`, minimum interval `5` minutes
- `technical` - `техническая`, free, expires in 10 years, minimum interval `5` minutes

  Поле
  --------------------------
  id
  name
  price
  currency
  subscriptions_limit
  minimum_interval_minutes
  telegram_enabled
  webhook_enabled
  enabled

------------------------------------------------------------------------

# user_subscriptions

Подписка пользователя на SaaS.

  Поле
  ------------
  id
  user_id
  plan_id
  status
  started_at
  expires_at
  auto_renew
  created_at
  updated_at

Статусы:

-   ACTIVE
-   EXPIRED
-   CANCELED

------------------------------------------------------------------------

# search_subscriptions

Поисковые подписки.

-   In the admin UI, `user_id` is selected from existing users instead of being entered manually.
-   `category` stores the Kufar search category code used for the subscription, for example `1010` or `1050`.
-   `max_price` and `rooms` are stored directly on the subscription so the UI can expose them as simple fields instead of a raw JSON editor.
-   `rooms` may include the special token `5+`, which matches any listing with five or more rooms.
-   When a subscription is created or the user tariff changes, the service clamps the interval to the plan minimum and disables the oldest active subscriptions if the plan limit is exceeded.

  Поле
  -------------------
  id
  user_id
  name
  category
  max_price
  rooms JSONB
  filter_json JSONB
  interval_minutes
  last_check_at
  enabled
  created_at
  updated_at

Правила:

-   interval кратен SyncService.
-   last_check_at при создании = created_at - interval.
-   При изменении фильтра подписка не пересоздается.

------------------------------------------------------------------------

# ads

Последнее состояние объявления.

Implementation note: `Listing.price` is the normalized USD price used everywhere in the UI, Telegram messages, and history. `Listing.currency` stores the original Kufar currency, and `sourcePrice` stores the raw source price used for change detection, so exchange-rate drift does not create false `CHANGED` events.

  Поле
  --------------------
  id
  source
  source_ad_id
  category
  subject
  description
  ad_link
  image_url
  city
  district
  price_usd
  price_byn
  sourcePrice
  rooms
  area_total
  floor
  floors_total
  year_built
  seller_type
  published_at
  first_seen_at
  last_seen_at
  is_deleted
  payload_json JSONB

  seller_type stores the normalized Kufar seller flag:
  - company
  - private

UNIQUE(source, source_ad_id)

------------------------------------------------------------------------

# ad_events

Implementation note: Prisma model name is `AdEvent`. The UI history page renders `NEW`, `CHANGED`, and `REMOVED` from this table, and `changes_json` stores either the creation snapshot, the diff, or the removal snapshot plus `missingCount`.

Журнал изменений.

  Поле
  --------------------
  id
  listing_id FK ads
  event_type
  changes_json JSONB
  created_at

event_type:

-   NEW
-   CHANGED
-   REMOVED

`changes_json` содержит только diff.

------------------------------------------------------------------------

# sync_runs

История синхронизаций.

  Поле
  ---------------
  id
  started_at
  finished_at
  duration_ms
  ads_processed
  ads_new
  ads_changed
  ads_removed
  status
  error_message

------------------------------------------------------------------------

# Индексы

## ads

-   UNIQUE(source, source_ad_id)
-   INDEX(category)
-   INDEX(city)
-   INDEX(price_usd)
-   INDEX(rooms)
-   INDEX(year_built)
-   INDEX(is_deleted)
-   INDEX(last_seen_at)

## ad_events

-   INDEX(created_at)
-   INDEX(ad_id)
-   INDEX(event_type)

## search_subscriptions

-   INDEX(user_id)
-   INDEX(category)
-   INDEX(max_price)
-   INDEX(category)
-   INDEX(enabled)
-   INDEX(last_check_at)

Subscriptions also carry `seller_type_filter`, which is currently either `all` or `private` and is used to filter notification delivery.
They also store `source` (currently `kufar.by`) and `notification_mode` (`new_and_changed` or `new_only`) so the sync pipeline can keep multiple advertisement feeds separate and suppress CHANGED Telegram alerts when requested.

## user_subscriptions

-   INDEX(user_id)
-   INDEX(status)

------------------------------------------------------------------------

# Замечания

`payload_json` не участвует в бизнес-логике и используется как архив
оригинального ответа Kufar и для передачи данных через API.
