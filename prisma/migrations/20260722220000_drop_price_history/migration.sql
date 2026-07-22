-- Drop the legacy price history table; event journal is the source of truth now
DROP TABLE IF EXISTS "PriceHistory";
