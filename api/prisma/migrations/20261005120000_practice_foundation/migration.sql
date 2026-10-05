-- Evolução aditiva. Nenhuma ocorrência antiga recebe semântica de sucesso/falha.
ALTER TABLE "acompanhamentos"
  ADD COLUMN "intent" VARCHAR(20) NOT NULL DEFAULT 'registro_livre',
  ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'ativo',
  ADD CONSTRAINT "acompanhamentos_intent_check" CHECK ("intent" IN ('registro_livre', 'repetir', 'reduzir', 'evitar')),
  ADD CONSTRAINT "acompanhamentos_status_check" CHECK ("status" IN ('ativo', 'pausado'));

ALTER TABLE "ocorrencias_acompanhamento"
  ADD COLUMN "recorded_at" TIMESTAMP(6),
  ADD COLUMN "kind" VARCHAR(20) NOT NULL DEFAULT 'ocorrencia',
  ADD COLUMN "amount" DECIMAL(14,3),
  ADD COLUMN "unit" VARCHAR(40),
  ADD COLUMN "note" VARCHAR(2000),
  ADD CONSTRAINT "practice_record_kind_check" CHECK ("kind" IN ('ocorrencia', 'atividade', 'confirmacao')),
  ADD CONSTRAINT "practice_record_amount_check" CHECK ("amount" IS NULL OR ("amount" >= 0 AND "amount" <= 1000000000));

CREATE TABLE "planos_pratica" (
  "id" SERIAL PRIMARY KEY,
  "acompanhamento_id" INTEGER NOT NULL REFERENCES "acompanhamentos"("id") ON DELETE CASCADE,
  "effective_from" DATE NOT NULL,
  "effective_until" DATE,
  "frequency" VARCHAR(20) NOT NULL,
  "weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "times_per_week" INTEGER,
  "target_amount" DECIMAL(14,3),
  "unit" VARCHAR(40),
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "timezone" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "practice_plan_frequency_check" CHECK ("frequency" IN ('diaria', 'dias_fixos', 'semanal')),
  CONSTRAINT "practice_plan_dates_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "practice_plan_target_check" CHECK ("target_amount" IS NULL OR ("target_amount" > 0 AND "target_amount" <= 1000000000)),
  CONSTRAINT "practice_plan_weekdays_check" CHECK ("weekdays" <@ ARRAY[0,1,2,3,4,5,6] AND ("frequency" <> 'dias_fixos' OR cardinality("weekdays") > 0)),
  CONSTRAINT "practice_plan_weekly_check" CHECK (
    ("frequency" <> 'semanal' AND "times_per_week" IS NULL) OR
    ("frequency" = 'semanal' AND (("target_amount" IS NOT NULL AND "times_per_week" IS NULL) OR ("target_amount" IS NULL AND "times_per_week" IS NOT NULL AND "times_per_week" BETWEEN 1 AND 100)))
  )
);
CREATE UNIQUE INDEX "planos_pratica_acompanhamento_id_effective_from_key" ON "planos_pratica"("acompanhamento_id", "effective_from");
CREATE INDEX "planos_pratica_acompanhamento_id_effective_until_idx" ON "planos_pratica"("acompanhamento_id", "effective_until");
