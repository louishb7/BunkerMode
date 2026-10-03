import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"
import type { FinanceOverview, Reserve } from "../../../types/financeContract"
import { getFinanceSnapshot, setFinanceSnapshot } from "../../../state/financeCache"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { readSnapshot, saveSnapshot } from "../../../offline/snapshots"
import type { OutboxOperation } from "../../../offline/snapshots"
import {
  enqueueOperation,
  projectFinances,
  projectReserves,
  subscribeOutbox,
} from "../../../offline/outbox"

const validFinance = (data: unknown): data is FinanceOverview => {
  const item = data as FinanceOverview
  return (
    !!item &&
    typeof item === "object" &&
    typeof item.mes === "string" &&
    item.moeda === "BRL" &&
    Number.isSafeInteger(item.saldo_centavos) &&
    Number.isSafeInteger(item.resultado_centavos) &&
    Number.isSafeInteger(item.receitas_centavos) &&
    Number.isSafeInteger(item.despesas_centavos) &&
    Array.isArray(item.serie_diaria) &&
    item.serie_diaria.every(
      (point) =>
        !!point && typeof point.data === "string" && Number.isSafeInteger(point.resultado_centavos)
    ) &&
    Array.isArray(item.lancamentos) &&
    item.lancamentos.every(
      (entry) =>
        !!entry &&
        Number.isSafeInteger(entry.id) &&
        typeof entry.titulo === "string" &&
        typeof entry.tipo === "string" &&
        typeof entry.data === "string" &&
        Number.isSafeInteger(entry.valor_centavos)
    )
  )
}
const validReserves = (data: unknown): data is Reserve[] =>
  Array.isArray(data) &&
  data.every(
    (item) =>
      item &&
      Number.isSafeInteger(item.id) &&
      typeof item.titulo === "string" &&
      Number.isSafeInteger(item.valor_centavos)
  )

export function useFinances({ token, ownerId, onUnauthorized, enabled = true, month = undefined }) {
  const key = `${ownerId}:${month ?? "current"}`
  const durableKey = `finances:${month ?? "current"}`
  const [snapshot, setSnapshot] = useState<{ key: string; data: FinanceOverview } | null>(() => {
    const data = getFinanceSnapshot(key)
    return data ? { key, data } : null
  })
  const [operations, setOperations] = useState<OutboxOperation[]>([])
  const [reserves, setReserves] = useState<Reserve[]>([])
  useEffect(() => (ownerId ? subscribeOutbox(ownerId, setOperations) : undefined), [ownerId])
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: number; key: string }>).detail
      if (detail?.ownerId !== ownerId || detail.key !== durableKey) return
      void readSnapshot(ownerId, durableKey, validFinance).then((entry) => {
        if (entry) {
          setFinanceSnapshot(key, entry.data)
          setSnapshot({ key, data: entry.data })
        }
      })
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [ownerId, durableKey, key])
  useEffect(() => {
    let alive = true
    void readSnapshot(ownerId, "reserves", validReserves).then((entry) => {
      if (alive && entry) setReserves(entry.data)
    })
    if (enabled && getApiAvailability() !== "unavailable") {
      void api.listReserves(token).then(async (result) => {
        if (alive && result.ok && validReserves(result.data)) {
          setReserves(result.data)
          await saveSnapshot(ownerId, "reserves", result.data)
        }
      })
    }
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: number; key: string }>).detail
      if (detail?.ownerId === ownerId && detail.key === "reserves")
        void readSnapshot(ownerId, "reserves", validReserves).then((entry) => {
          if (alive && entry) setReserves(entry.data)
        })
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => {
      alive = false
      window.removeEventListener("bunkermode-official-change", update)
    }
  }, [ownerId, token, enabled])
  const [loading, setLoading] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const version = useRef(0)
  const mutation = useRef(false)
  const refresh = useCallback(async () => {
    if (!enabled || !token) return false
    const current = ++version.current
    setLoading(true)
    const result = await api.getFinances(token, month)
    if (current !== version.current) return false
    setLoading(false)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível carregar as finanças."))
      return false
    }
    if (!validFinance(result.data) || (month && result.data.mes !== month)) {
      setError("Resposta financeira inválida.")
      return false
    }
    setFinanceSnapshot(key, result.data)
    setSnapshot({ key, data: result.data })
    const saved = await saveSnapshot(ownerId, durableKey, result.data)
    setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
    setError("")
    return true
  }, [enabled, token, month, key, durableKey, ownerId, onUnauthorized])
  useEffect(() => {
    setLastUpdated(null)
    version.current += 1
    setError("")
    setBusy(false)
    mutation.current = false
    let cancelled = false
    if (enabled)
      void (async () => {
        const entry = await readSnapshot(ownerId, durableKey, validFinance)
        if (cancelled) return
        if (entry && !getFinanceSnapshot(key)) {
          setFinanceSnapshot(key, entry.data)
          setSnapshot({ key, data: entry.data })
        }
        setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
        if (getApiAvailability() !== "unavailable") void refresh()
        else setLoading(false)
      })()
    return () => {
      cancelled = true
      version.current++
    }
  }, [refresh, enabled, durableKey, key, ownerId])

  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (enabled && previous === "unavailable" && next === "available") void refresh()
      previous = next
    })
  }, [enabled, refresh])
  async function mutate(action) {
    if (mutation.current || !enabled) return false
    mutation.current = true
    setBusy(true)
    setError("")
    const current = ++version.current
    const result = await action()
    if (current !== version.current) return false
    if (onUnauthorized?.(result)) {
      mutation.current = false
      setBusy(false)
      return false
    }
    if (!result.ok) {
      mutation.current = false
      setBusy(false)
      setError(getErrorMessage(result, "Não foi possível salvar a alteração."))
      return false
    }
    await refresh()
    if (version.current !== current + 1) return false
    mutation.current = false
    setBusy(false)
    // A escrita confirmada não deve ser repetida se apenas a releitura falhar.
    return true
  }
  async function saveEntry(payload, id?) {
    if (id && typeof id === "number") {
      if (getApiAvailability() === "unavailable") {
        setError("Editar um lançamento confirmado exige conexão com a API.")
        return false
      }
      return mutate(() => api.saveFinanceEntry(token, payload, id))
    }
    try {
      await enqueueOperation(ownerId, "entry", id ? "update" : "create", payload, id)
      setError("")
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível salvar localmente.")
      return false
    }
  }
  async function deleteEntry(id) {
    if (typeof id === "number") {
      if (getApiAvailability() === "unavailable") {
        setError("Excluir um lançamento confirmado exige conexão com a API.")
        return false
      }
      return mutate(() => api.deleteFinanceEntry(token, id))
    }
    try {
      await enqueueOperation(ownerId, "entry", "delete", {}, id)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível remover localmente.")
      return false
    }
  }
  async function saveReserve(payload, id?) {
    if (id && typeof id === "number") {
      if (getApiAvailability() === "unavailable") {
        setError("Editar uma reserva confirmada exige conexão com a API.")
        return false
      }
      return mutate(() => api.saveReserve(token, payload, id))
    }
    try {
      await enqueueOperation(ownerId, "reserve", id ? "update" : "create", payload, id)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível salvar localmente.")
      return false
    }
  }
  async function deleteReserve(id) {
    if (typeof id === "number") {
      if (getApiAvailability() === "unavailable") {
        setError("Excluir uma reserva confirmada exige conexão com a API.")
        return false
      }
      return mutate(() => api.deleteReserve(token, id))
    }
    try {
      await enqueueOperation(ownerId, "reserve", "delete", {}, id)
      return true
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível remover localmente.")
      return false
    }
  }
  return {
    lastUpdated,
    data: enabled
      ? projectFinances(
          snapshot?.key === key ? snapshot.data : getFinanceSnapshot(key),
          operations,
          month
        )
      : null,
    hasOfficialSnapshot: Boolean(snapshot?.key === key ? snapshot.data : getFinanceSnapshot(key)),
    reserves: enabled ? projectReserves(reserves, operations) : [],
    loading,
    busy,
    error,
    refresh,
    saveEntry,
    deleteEntry,
    saveReserve,
    deleteReserve,
  }
}
