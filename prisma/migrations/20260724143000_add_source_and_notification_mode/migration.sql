-- Add canonical source tracking and notification mode controls

ALTER TABLE "Listing"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'kufar.by';

ALTER TABLE "Subscription"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'kufar.by',
ADD COLUMN "notificationMode" TEXT NOT NULL DEFAULT 'new_and_changed';

UPDATE "Listing"
SET "source" = 'kufar.by'
WHERE "source" = 'kufar';

CREATE INDEX "Listing_source_idx" ON "Listing"("source");
CREATE INDEX "Subscription_source_idx" ON "Subscription"("source");
