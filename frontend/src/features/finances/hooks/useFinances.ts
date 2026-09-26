import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"
import type { FinanceOverview } from "../../../types/financeContract"

export function useFinances({ token, onUnauthorized, enabled = true, month = undefined }) {
  const [snapshot, setSnapshot] = useState<{ key: string; data: FinanceOverview } | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const version = useRef(0)
  const mutation = useRef(false)
  const key = `${token}:${month ?? "current"}`
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
    setSnapshot({ key, data: result.data })
    setError("")
    return true
  }, [enabled, token, month, key, onUnauthorized])
  useEffect(() => {
    version.current += 1
    setError("")
    setBusy(false)
    mutation.current = false
    if (enabled) void refresh()
    return () => {
      version.current++
    }
  }, [refresh, enabled])
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
  return {
    data: enabled && snapshot?.key === key ? snapshot.data : null,
    loading,
    busy,
    error,
    refresh,
    saveEntry: (payload, id?) => mutate(() => api.saveFinanceEntry(token, payload, id)),
    deleteEntry: (id) => mutate(() => api.deleteFinanceEntry(token, id)),
    saveReserve: (payload, id?) => mutate(() => api.saveReserve(token, payload, id)),
    deleteReserve: (id) => mutate(() => api.deleteReserve(token, id)),
  }
}
