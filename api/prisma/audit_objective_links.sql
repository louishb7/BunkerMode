-- Auditoria somente de leitura. Execute apenas em uma base autorizada.
WITH issues AS (
  SELECT 'tarefa_sem_objetivo_existente' AS tipo, m.missao_id AS entidade_id
  FROM missoes m
  LEFT JOIN objetivos o ON o.id = m.objetivo_id
  WHERE m.objetivo_id IS NOT NULL AND o.id IS NULL

  UNION ALL
  SELECT 'tarefa_de_outro_usuario', m.missao_id
  FROM missoes m
  JOIN objetivos o ON o.id = m.objetivo_id
  WHERE m.responsavel_id <> o.usuario_id

  UNION ALL
  SELECT 'serie_de_outro_usuario', s.recurrence_series_id
  FROM series_recorrencia s
  JOIN objetivos o ON o.id = s.objetivo_id
  WHERE s.responsavel_id <> o.usuario_id

  UNION ALL
  SELECT 'ocorrencia_diverge_da_serie', m.missao_id
  FROM missoes m
  JOIN series_recorrencia s ON s.recurrence_series_id = m.recurrence_series_id
  WHERE m.objetivo_id IS DISTINCT FROM s.objetivo_id

  UNION ALL
  SELECT 'ocorrencia_de_outro_usuario', m.missao_id
  FROM missoes m
  JOIN series_recorrencia s ON s.recurrence_series_id = m.recurrence_series_id
  WHERE m.responsavel_id <> s.responsavel_id
)
SELECT tipo, entidade_id FROM issues ORDER BY tipo, entidade_id;
