-- Preserve receipt time and all existing history. Older events have unknown event time.
ALTER TABLE "auditoria_eventos" ADD COLUMN "occurred_at" TIMESTAMP(6);
