# 03_sync_algorithm.md

Current implementation note: the persisted entity is `Listing`; immutable history rows are written to `AdEvent`; change detection tracks only `price`, `description`, `imageUrl`, and `rooms`; `missingCount` protects against temporary source failures; `REMOVED` is emitted only on the third consecutive miss; and if a listing returns after the first or second miss unchanged, no event is written.

# Алгоритм синхронизации объявлений

## 1. Назначение

`SyncService` синхронизирует локальную базу данных с внешним источником объявлений (Kufar).

Цели:

- получить полный снимок объявлений (Snapshot);
- обновить таблицу `ads`;
- создать события `NEW`, `CHANGED`, `REMOVED`;
- не допускать ложных изменений;
- быть устойчивым к ошибкам API;
- обеспечивать идемпотентность.

---

# 2. Общая архитектура

```text
Kufar API
    │
    ▼
KufarMapper
    │
    ▼
SnapshotBuilder
    │
    ▼
AdComparer
    │
    ▼
SyncService
    │
    ▼
Database
```

---

# 3. Основные принципы

## 3.1 Полный Snapshot

Сначала скачиваются **все объявления**, затем начинается работа с БД.

Если Snapshot неполный:

- база данных не изменяется;
- события не создаются;
- sync_run получает статус FAILED.

---

## 3.2 Идентификатор объявления

Во всей системе используется составной ключ:

```text
(source, source_ad_id)
```

---

## 3.3 Объявления не удаляются

Удаление означает:

```text
is_deleted = true
```

---

## 3.4 События создаются только при изменениях

Нет изменений →

нет события.

---

## 3.5 Все события одного запуска имеют одинаковое время

```text
sync_time
```

используется для

- ad_events.created_at
- ads.last_seen_at

---

# 4. Snapshot

Snapshot представляет собой полное состояние объявлений источника.

Тип:

```text
Map<(source, source_ad_id), Ad>
```

---

## Получение Snapshot

```text
cursor = null

while true:

    page = load(cursor)

    добавить объявления

    если next_cursor отсутствует:
        break

    cursor = next_cursor
```

---

## Защиты

Во время загрузки выполняются:

- retry при HTTP 429;
- retry при HTTP 5xx;
- защита от повторного cursor;
- ограничение максимального числа страниц;
- дедупликация объявлений.

---

## Проверка Snapshot

Snapshot считается валидным только если

- успешно загружены все страницы;
- нет конфликтующих дубликатов;
- mapper успешно обработал объявления;
- количество объявлений не выглядит аномально маленьким.

Если Snapshot невалиден —

он полностью отклоняется.

---

# 5. Content Hash

В таблице `ads` хранится поле

```text
content_hash
```

Hash вычисляется только по значимым полям:

- price
- description
- imageUrl
- rooms

Он не включает timestamps, counters или raw payload.

---

## Использование

Если

```text
old_hash == new_hash
```

то полный diff не выполняется.

Если

```text
old_hash != new_hash
```

вызывается

```text
AdComparer
```

---

# 6. Основной алгоритм

```text
Старт

↓

Создать sync_run

↓

Получить Snapshot

↓

Snapshot валиден?

Нет

↓

FAILED

Да

↓

sync_time = now()

↓

BEGIN TRANSACTION

↓

Загрузить существующие объявления

↓

Для каждого объявления Snapshot

↓

Есть в БД?

Нет

↓

INSERT

↓

NEW

---

Есть

↓

is_deleted ?

Да

↓

RESTORE

↓

NEW

---

Нет

↓

missing_count = 0

↓

Hash совпадает?

Да

↓

last_seen_at = sync_time

↓

Следующее объявление

---

Hash отличается

↓

AdComparer

↓

Есть изменения?

Нет

↓

Обновить hash

↓

Следующее объявление

---

Есть изменения

↓

UPDATE ads

↓

CREATE CHANGED

---

После обхода Snapshot

↓

Все отсутствующие объявления

↓

missing_count++

↓

missing_count >= threshold ?

↓

Да

↓

is_deleted = true

↓

CREATE REMOVED

↓

COMMIT

↓

SUCCESS

↓

NotificationService
```

---

# 7. missing_count

Используется для защиты от ложных удалений.

Первое отсутствие

```text
missing_count = 1
```

Второе

```text
missing_count = 2
```

Третье

```text
missing_count = 3
```

↓

создается

```text
REMOVED
```

---

Если объявление снова найдено

```text
missing_count = 0
```

---

Очень важно

`missing_count`

увеличивается

**только после полностью успешной синхронизации.**

---

# 8. AdComparer

Единственная ответственность —

сравнение объявлений.

Возвращает

```json
{
    "changed": true,
    "changes": {
        "price_usd": {
            "old": 90000,
            "new": 87000
        },
        "description": {
            "old": "...",
            "new": "..."
        }
    }
}
```

Правила:

- сравнение после нормализации;
- игнорируются шумные поля;
- порядок JSON не учитывается;
- сравниваются только утвержденные поля.

---

# 9. События

## NEW

Создается

- при первом появлении;
- при повторном появлении после удаления.

---

## CHANGED

Создается

если изменилось хотя бы одно значимое поле.

Несколько изменений объединяются в одно событие.

---

## REMOVED

Создается

после достижения порога

```text
missing_count
```

---

# 10. Транзакция

В одной транзакции выполняются

- INSERT ads;
- UPDATE ads;
- INSERT ad_events.

При ошибке

```text
ROLLBACK
```

Порог удаления равен `3`, поэтому первый и второй пропуск только увеличивают `missingCount`.

Если объявление вернулось после первого или второго пропуска и значимые поля не изменились, событие не создается.

Если объявление вернулось с изменениями значимых полей, создается `CHANGED` относительно предыдущей версии.

---

# 11. Блокировка

Для одного источника одновременно может работать только один SyncService.

Рекомендуемая реализация

```text
PostgreSQL advisory lock
```

Если блокировка уже занята

новый запуск получает статус

```text
SKIPPED
```

---

# 12. sync_runs

Статусы

```text
RUNNING

SUCCESS

FAILED

SKIPPED
```

Дополнительные поля

```text
source

pages_loaded

ads_received

ads_new

ads_changed

ads_removed

error_code

error_message
```

---

# 13. Изменения модели данных

## ads

Current implementation uses `Listing` and stores:

- `description`
- `imageUrl`
- `contentHash`
- `missingCount`
- `category`
- `rooms`

---

## subscriptions

Current implementation uses `Subscription` and stores:

- `category`
- `maxPrice`
- `rooms`

---

## ad_events

Current implementation uses `AdEvent` and stores:

- `eventType`
- `changesJson`
- `createdAt`

The history UI renders `NEW`, `CHANGED`, and `REMOVED` from this table.

---

## sync_runs

Добавить

```text
source

pages_loaded

ads_received

error_code
```

---

# 14. Edge Cases

### API вернул не все страницы

Sync отменяется.

---

### Объявление исчезло на один цикл

Удаление не создается.

---

### Объявление снова появилось

Создается

```text
NEW
```

---

### Изменилась только сортировка JSON

Изменений нет.

---

### Изменилось только игнорируемое поле

Обновляется объявление,

но событие не создается.

---

### Mapper не смог распарсить обязательное поле

Snapshot считается невалидным.

---

# 15. Обязательные тесты

- первый запуск → NEW;
- повторный запуск → без событий;
- изменение одного поля → CHANGED;
- изменение нескольких полей → один CHANGED;
- первое отсутствие → missing_count++;
- достижение threshold → REMOVED;
- повторное появление → NEW;
- неполный Snapshot → изменений нет;
- ошибка Mapper → изменений нет;
- ошибка транзакции → полный ROLLBACK.

---

# 16. Зафиксированные архитектурные решения

- Snapshot полностью загружается до начала работы с БД.
- Частичная синхронизация запрещена.
- Удаление подтверждается несколькими успешными синхронизациями.
- `missing_count` используется для защиты от ложных удалений.
- `content_hash` применяется как оптимизация.
- `AdComparer` инкапсулирует всю логику сравнения.
- Все изменения одного объявления объединяются в одно событие `CHANGED`.
- `SyncService` никогда не отправляет уведомления.
- После успешной синхронизации запускается `NotificationService`.
