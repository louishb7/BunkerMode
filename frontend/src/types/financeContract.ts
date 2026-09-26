export type FinanceEntry = {
  id: number
  titulo: string
  tipo: "receita" | "despesa" | "ajuste_entrada" | "ajuste_saida"
  categoria: string
  valor_centavos: number
  data: string
}
export type Reserve = {
  id: number
  titulo: string
  objetivo_id: number | null
  valor_centavos: number
  alvo_centavos: number | null
}
export type FinanceOverview = {
  mes: string
  moeda: "BRL"
  saldo_centavos: number
  reservado_centavos: number
  livre_centavos: number
  receitas_centavos: number
  despesas_centavos: number
  lancamentos: FinanceEntry[]
  reservas: Reserve[]
}
