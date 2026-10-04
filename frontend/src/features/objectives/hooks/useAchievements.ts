import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { listOutbox, readSnapshot, saveSnapshot } from "../../../offline/snapshots"
import { syncOutbox } from "../../../offline/outbox"
import { isAchievementList, type Achievement } from "../../../types/achievementContract"

export function useAchievements({ token, ownerId, onUnauthorized }) {
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  const lifecycle = useRef(0)
  const savingRef = useRef(false)
  const refresh = useCallback(async () => {
    const id = ++requestId.current
    const result = await api.listAchievements(token)
    if (id !== requestId.current) return false
    setLoading(false)
    if (onUnauthorized?.(result)) return false
    if (!result.ok || !isAchievementList(result.data)) {
      setError(getErrorMessage(result, "Não foi possível carregar conquistas."))
      return false
    }
    setAchievements(result.data)
    setError("")
    await saveSnapshot(ownerId, "achievements", result.data)
    return true
  }, [token, ownerId, onUnauthorized])
  useEffect(() => {
    let cancelled = false
    const requests = requestId
    const life = lifecycle
    void (async () => {
      const entry = await readSnapshot(ownerId, "achievements", isAchievementList)
      if (cancelled) return
      if (entry) {
        setAchievements(entry.data)
        setLoading(false)
      }
      if (getApiAvailability() !== "unavailable") void refresh()
      else setLoading(false)
    })()
    return () => {
      cancelled = true
      requests.current++
      life.current++
    }
  }, [ownerId, refresh])
  useEffect(
    () =>
      subscribeApiAvailability(() => {
        if (getApiAvailability() === "available") void refresh()
      }),
    [refresh]
  )
  // Legacy status commands also create a crown on the server.
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.ownerId === ownerId && detail.key === "objectives") void refresh()
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [ownerId, refresh])

  async function conquer(id: number | string, note: string) {
    if (savingRef.current) return null
    if (getApiAvailability() === "unavailable" || navigator.onLine === false) {
      setError("Conecte-se para preservar a memória desta conquista.")
      return null
    }
    savingRef.current = true
    setSaving(true)
    setError("")
    const epoch = lifecycle.current
    try {
      await syncOutbox(ownerId)
      if (epoch !== lifecycle.current) return null
      const pending = await listOutbox(ownerId)
      if (
        typeof id !== "number" ||
        pending.some((op) => ["goal", "task", "tracker", "occurrence"].includes(op.domain))
      ) {
        setError("Sincronize os registros pendentes antes de conquistar este objetivo.")
        return null
      }
      const result = await api.conquerObjective(token, id, note.trim() || null)
      if (epoch !== lifecycle.current || onUnauthorized?.(result)) return null
      if (!result.ok || !isAchievementList([result.data])) {
        setError(getErrorMessage(result, "Não foi possível conquistar este objetivo."))
        return null
      }
      // The mutation response is authoritative even if the following GET fails.
      const next = [result.data, ...achievements.filter((item) => item.id !== result.data.id)]
      setAchievements(next)
      await saveSnapshot(ownerId, "achievements", next)
      await refresh()
      return result.data
    } finally {
      savingRef.current = false
      if (epoch === lifecycle.current) setSaving(false)
    }
  }
  return { achievements, loading, saving, error, refresh, conquer, clearError: () => setError("") }
}
