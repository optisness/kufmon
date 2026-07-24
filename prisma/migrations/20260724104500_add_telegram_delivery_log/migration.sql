CREATE TABLE "TelegramDeliveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userLabel" TEXT,
    "chatId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramDeliveryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelegramDeliveryLog_userId_createdAt_idx" ON "TelegramDeliveryLog"("userId", "createdAt");
CREATE INDEX "TelegramDeliveryLog_createdAt_idx" ON "TelegramDeliveryLog"("createdAt");

ALTER TABLE "TelegramDeliveryLog"
ADD CONSTRAINT "TelegramDeliveryLog_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
