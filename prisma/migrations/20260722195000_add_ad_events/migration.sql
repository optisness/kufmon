-- Add event journal support for listings
ALTER TABLE "Listing" ADD COLUMN     "description" TEXT;
ALTER TABLE "Listing" ADD COLUMN     "imageUrl" TEXT;
ALTER TABLE "Listing" ADD COLUMN     "contentHash" TEXT;
ALTER TABLE "Listing" ADD COLUMN     "missingCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AdEvent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "changesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdEvent_listingId_createdAt_idx" ON "AdEvent"("listingId", "createdAt");
CREATE INDEX "AdEvent_eventType_idx" ON "AdEvent"("eventType");

ALTER TABLE "AdEvent" ADD CONSTRAINT "AdEvent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
