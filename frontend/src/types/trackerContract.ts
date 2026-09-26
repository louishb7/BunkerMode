export type TrackerOccurrence = {
  id: number
  acompanhamento_id: number
  occurred_at: string
  created_at: string
}

export type Tracker = {
  id: number
  objetivo_id: number | null
  titulo: string
  descricao: string | null
  created_at: string
  updated_at: string
  ocorrencias: TrackerOccurrence[]
}
