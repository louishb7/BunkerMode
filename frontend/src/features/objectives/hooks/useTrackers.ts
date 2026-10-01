import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import type { Tracker, TrackerOccurrence } from "../../../types/trackerContract"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { isTrackerList, readSnapshot, saveSnapshot } from "../../../offline/snapshots"

export function useTrackers({ token, ownerId, onUnauthorized, enabled = true }) {
  const initial = getOverview(ownerId).trackers
  const [trackers, setTrackers] = useState<Tracker[]>(initial ?? [])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(initial !== null)
  const [loading, setLoading] = useState(initial === null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [status, setStatus] = useState(emptyStatus)
  const [error, setError] = useState("")
  const requestId = useRef(0)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!token || !enabled) return false
    const currentRequest = ++requestId.current
    setLoading(true)
    setError("")
    const result = await api.listTrackers(token)
    if (currentRequest !== requestId.current) return false
    setLoading(false)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível carregar acompanhamentos."))
      return false
    }
    if (!isTrackerList(result.data)) {
      setError("Resposta de acompanhamentos inválida.")
      return false
    }
    const items = result.data as Tracker[]
    setTrackers(items)
    updateOverview(ownerId, { trackers: items })
    const saved = await saveSnapshot(ownerId, "trackers", items)
    setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
    setLoaded(true)
    setStatus(emptyStatus)
    return true
  }, [token, ownerId, onUnauthorized, enabled])

  useEffect(() => {
    setLastUpdated(null)
    const cached = enabled ? getOverview(ownerId).trackers : null
    setTrackers(cached ?? [])
    setLoaded(cached !== null)
    setLoading(enabled && cached === null)
    setError("")
    let cancelled = false
    if (enabled)
      void (async () => {
        const entry = await readSnapshot(ownerId, "trackers", isTrackerList)
        if (cancelled) return
        if (entry && getOverview(ownerId).trackers === null) {
          updateOverview(ownerId, { trackers: entry.data as Tracker[] })
          setTrackers(entry.data as Tracker[])
          setLoaded(true)
          setLoading(false)
        }
        setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
        if (getApiAvailability() !== "unavailable") void refresh()
        else setLoading(false)
      })()
    return () => {
      cancelled = true
      requestId.current += 1
    }
  }, [refresh, token, enabled, ownerId])

  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (enabled && previous === "unavailable" && next === "available") void refresh()
      previous = next
    })
  }, [enabled, refresh])

  const byObjective = useMemo(() => {
    const grouped: Record<string, Tracker[]> = {}
    for (const tracker of trackers) {
      const key = String(tracker.objetivo_id)
      grouped[key] ??= []
      grouped[key].push(tracker)
    }
    return grouped
  }, [trackers])

  async function mutate(action, id: number | null = null) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusyId(id)
    const currentRequest = ++requestId.current
    const result = await action()
    if (currentRequest !== requestId.current) return false
    busyRef.current = false
    setBusyId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível salvar o acompanhamento."),
      })
      return false
    }
    const reloaded = await refresh()
    if (!reloaded && requestId.current === currentRequest + 1)
      setStatus({
        type: "error",
        message: "Alteração salva. Não foi possível atualizar os acompanhamentos.",
      })
    return requestId.current === currentRequest + 1
  }
  const createTracker = (payload) => mutate(() => api.createTracker(token, payload))
  const updateTracker = (tracker: Tracker, payload) =>
    mutate(() => api.updateTracker(token, tracker.id, payload), tracker.id)
  const deleteTracker = (tracker: Tracker) =>
    mutate(() => api.deleteTracker(token, tracker.id), tracker.id)
  const recordOccurrence = (tracker: Tracker) =>
    mutate(() => api.recordTrackerOccurrence(token, tracker.id), tracker.id)
  const deleteOccurrence = (tracker: Tracker, occurrence: TrackerOccurrence) =>
    mutate(() => api.deleteTrackerOccurrence(token, tracker.id, occurrence.id), tracker.id)
  function removeForObjective() {
    void refresh()
  }

  return {
    lastUpdated,
    trackers,
    byObjective,
    loaded,
    loading,
    busyId,
    status,
    error,
    refresh,
    createTracker,
    updateTracker,
    deleteTracker,
    recordOccurrence,
    deleteOccurrence,
    removeForObjective,
  }
}
