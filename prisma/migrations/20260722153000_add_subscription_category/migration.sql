-- Add category fields for search filtering and ad tracking
ALTER TABLE "Listing" ADD COLUMN "category" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "category" TEXT;

CREATE INDEX "Listing_category_idx" ON "Listing"("category");
CREATE INDEX "Subscription_category_idx" ON "Subscription"("category");
