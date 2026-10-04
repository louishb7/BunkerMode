CREATE TABLE "conquistas_objetivos" (
  "id" SERIAL PRIMARY KEY,
  "objetivo_id" INTEGER UNIQUE,
  "usuario_id" INTEGER NOT NULL,
  "conquistado_em" TIMESTAMP(6),
  "nota" VARCHAR(2000),
  "snapshot" JSONB NOT NULL,
  CONSTRAINT "conquistas_objetivos_objetivo_id_fkey" FOREIGN KEY ("objetivo_id") REFERENCES "objetivos"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "conquistas_objetivos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("usuario_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "conquistas_objetivos_usuario_id_conquistado_em_idx" ON "conquistas_objetivos"("usuario_id", "conquistado_em");

-- Não reconstruir relações históricas a partir de dados vivos. Preservar a
-- conclusão existente e identificar explicitamente a memória incompleta.
INSERT INTO "conquistas_objetivos" ("objetivo_id", "usuario_id", "conquistado_em", "snapshot")
SELECT o.id, o.usuario_id, o.concluded_at, jsonb_build_object(
  'version', 1, 'titulo', o.titulo, 'proposito', o.descricao,
  'criado_em', to_char(o.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'data_alvo', o.data_alvo,
  'fuso_horario', u.timezone, 'historico_incompleto', true, 'nos', '[]'::jsonb
)
FROM "objetivos" o JOIN "usuarios" u ON u.usuario_id = o.usuario_id
WHERE o.status = 'concluido';
