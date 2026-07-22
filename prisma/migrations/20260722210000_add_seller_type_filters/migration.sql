-- Add seller type tracking for listings and subscription filters
ALTER TABLE "Listing" ADD COLUMN     "sellerType" TEXT;

ALTER TABLE "Subscription" ADD COLUMN     "sellerTypeFilter" TEXT NOT NULL DEFAULT 'all';
