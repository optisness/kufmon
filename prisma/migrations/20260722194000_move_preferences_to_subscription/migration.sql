-- Move search preferences from users to subscriptions
ALTER TABLE "Subscription" ADD COLUMN     "maxPrice" INTEGER;
ALTER TABLE "Subscription" ADD COLUMN     "rooms" JSONB;

ALTER TABLE "User" DROP COLUMN "maxPrice";
ALTER TABLE "User" DROP COLUMN "rooms";
