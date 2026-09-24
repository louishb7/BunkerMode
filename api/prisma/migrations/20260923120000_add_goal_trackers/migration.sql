CREATE TABLE "acompanhamentos" (
    "id" SERIAL NOT NULL,
    "objetivo_id" INTEGER NOT NULL,
    "titulo" VARCHAR(200) NOT NULL,
    "descricao" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "acompanhamentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ocorrencias_acompanhamento" (
    "id" SERIAL NOT NULL,
    "acompanhamento_id" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ocorrencias_acompanhamento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "acompanhamentos_objetivo_id_idx" ON "acompanhamentos"("objetivo_id");
CREATE INDEX "ocorrencias_acompanhamento_acompanhamento_id_occurred_at_idx" ON "ocorrencias_acompanhamento"("acompanhamento_id", "occurred_at");

ALTER TABLE "acompanhamentos" ADD CONSTRAINT "acompanhamentos_objetivo_id_fkey"
    FOREIGN KEY ("objetivo_id") REFERENCES "objetivos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ocorrencias_acompanhamento" ADD CONSTRAINT "ocorrencias_acompanhamento_acompanhamento_id_fkey"
    FOREIGN KEY ("acompanhamento_id") REFERENCES "acompanhamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
