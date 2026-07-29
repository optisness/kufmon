-- Add seller name and phone to listings for admin view and history snapshots

ALTER TABLE "Listing"
ADD COLUMN IF NOT EXISTS "sellerName" TEXT,
ADD COLUMN IF NOT EXISTS "sellerPhone" TEXT;
