-- Track when Kufar hides the phone by IP so we do not retry forever.
ALTER TABLE "Listing"
ADD COLUMN IF NOT EXISTS "sellerPhoneStatus" TEXT;
