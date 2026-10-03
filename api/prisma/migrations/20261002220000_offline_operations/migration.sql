CREATE TABLE "OfflineOperation" (
    "userId" INTEGER NOT NULL,
    "operationId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfflineOperation_pkey" PRIMARY KEY ("userId","operationId")
);

CREATE INDEX "OfflineOperation_userId_createdAt_idx" ON "OfflineOperation"("userId", "createdAt");

ALTER TABLE "OfflineOperation" ADD CONSTRAINT "OfflineOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("usuario_id") ON DELETE CASCADE ON UPDATE CASCADE;
