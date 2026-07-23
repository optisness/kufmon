-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscriptionsLimit" INTEGER,
    "minimumIntervalMinutes" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "planId" TEXT;
ALTER TABLE "User" ADD COLUMN     "planExpiresAt" TIMESTAMP(3);

-- Seed plans
INSERT INTO "Plan" ("id", "name", "subscriptionsLimit", "minimumIntervalMinutes", "enabled", "createdAt", "updatedAt") VALUES
('single', '1 подписка', 1, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('triple', '3 подписки', 3, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('unlimited', 'анлим', NULL, 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('bonus', '1 бонусная подписка', 1, 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('technical', 'техническая', NULL, 5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Backfill existing users with the technical plan so the current service keeps working until billing is assigned manually.
UPDATE "User"
SET
    "planId" = COALESCE("planId", 'technical'),
    "planExpiresAt" = COALESCE("planExpiresAt", CURRENT_TIMESTAMP + INTERVAL '10 years')
WHERE "planId" IS NULL OR "planExpiresAt" IS NULL;

-- Create history rows for existing users.
INSERT INTO "UserSubscription" ("id", "userId", "planId", "status", "startedAt", "expiresAt", "autoRenew", "createdAt", "updatedAt")
SELECT
    CONCAT('seed-', "id"),
    "id",
    COALESCE("planId", 'technical'),
    CASE
        WHEN COALESCE("planExpiresAt", CURRENT_TIMESTAMP + INTERVAL '10 years') > CURRENT_TIMESTAMP THEN 'ACTIVE'
        ELSE 'EXPIRED'
    END,
    CURRENT_TIMESTAMP,
    COALESCE("planExpiresAt", CURRENT_TIMESTAMP + INTERVAL '10 years'),
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT DO NOTHING;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubscription" ADD CONSTRAINT "UserSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "UserSubscription_userId_status_idx" ON "UserSubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSubscription_expiresAt_idx" ON "UserSubscription"("expiresAt");
