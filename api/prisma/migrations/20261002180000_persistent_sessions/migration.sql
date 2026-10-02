CREATE TABLE "PersistentSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "authVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(6),
    "revokedAt" TIMESTAMP(6),
    CONSTRAINT "PersistentSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersistentSession_tokenHash_key" ON "PersistentSession"("tokenHash");
CREATE INDEX "PersistentSession_userId_revokedAt_idx" ON "PersistentSession"("userId", "revokedAt");
ALTER TABLE "PersistentSession" ADD CONSTRAINT "PersistentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("usuario_id") ON DELETE CASCADE ON UPDATE CASCADE;
