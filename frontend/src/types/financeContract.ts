export const financeEntryTypes = ["receita", "despesa", "ajuste_entrada", "ajuste_saida"] as const
export type FinanceEntryType = (typeof financeEntryTypes)[number]
export type FinanceEntryPayload = {
  titulo: string
  tipo: FinanceEntryType
  valor_centavos: number
  data: string
}
export type FinanceEntry = {
  id: number | string
  syncStatus?: string
  created_at?: string
  titulo: string
  tipo: FinanceEntryType
  valor_centavos: number
  data: string
}
export type FinanceOverview = {
  mes: string
  moeda: "BRL"
  saldo_centavos: number
  resultado_centavos: number
  receitas_centavos: number
  despesas_centavos: number
  serie_diaria: {
    data: string
    resultado_centavos: number
    receitas_centavos?: number
    despesas_centavos?: number
  }[]
  lancamentos: FinanceEntry[]
}
