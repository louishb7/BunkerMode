export type ObjectiveMapNode = {
  id: string
  source_id?: number
  tipo: "tarefa" | "rotina" | "acompanhamento"
  titulo: string
  descricao?: string | null
  estado?: string
  data?: string | null
  frequencia?: number[]
  realizadas?: number
  ultima_ocorrencia?: string | null
  ocorrencias_total?: number
  atividade_em?: string | null
  syncStatus?: string
}

export type AchievementSnapshot = {
  version: 1
  titulo: string
  proposito?: string | null
  criado_em: string
  data_alvo?: string | null
  fuso_horario: string
  historico_incompleto?: boolean
  nos: ObjectiveMapNode[]
}

export type Achievement = {
  id: number
  objetivo_id: number | null
  conquistado_em: string | null
  nota: string | null
  snapshot: AchievementSnapshot
}

export const isAchievementList = (data: unknown): data is Achievement[] =>
  Array.isArray(data) &&
  data.every(
    (item) =>
      item &&
      Number.isSafeInteger(item.id) &&
      item.snapshot?.version === 1 &&
      typeof item.snapshot.titulo === "string" &&
      typeof item.snapshot.criado_em === "string" &&
      typeof item.snapshot.fuso_horario === "string" &&
      (item.conquistado_em === null ||
        (typeof item.conquistado_em === "string" &&
          Number.isFinite(Date.parse(item.conquistado_em)))) &&
      Array.isArray(item.snapshot.nos) &&
      item.snapshot.nos.every(
        (node) =>
          node &&
          typeof node.id === "string" &&
          typeof node.titulo === "string" &&
          ["tarefa", "rotina", "acompanhamento"].includes(node.tipo)
      )
  )
