import type { PracticeIntent, PracticePlan } from "../features/practices/practiceDomain"

export type TrackerOccurrence = {
  id: number
  acompanhamento_id: number
  occurred_at: string
  created_at: string
  recorded_at?: string | null
  kind?: "atividade" | "ocorrencia" | "confirmacao"
  amount?: number | null
  unit?: string | null
  note?: string | null
}

export type Tracker = {
  id: number
  syncStatus?: string
  objetivo_id: number | null
  titulo: string
  descricao: string | null
  intent?: PracticeIntent
  status?: "ativo" | "pausado"
  planos?: PracticePlan[]
  created_at: string
  updated_at: string
  ocorrencias: TrackerOccurrence[]
}
