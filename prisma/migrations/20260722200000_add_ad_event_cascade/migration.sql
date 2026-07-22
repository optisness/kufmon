-- Make ad events disappear together with the parent listing during cleanup.
ALTER TABLE "AdEvent" DROP CONSTRAINT "AdEvent_listingId_fkey";

ALTER TABLE "AdEvent"
ADD CONSTRAINT "AdEvent_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
