import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import type { Tracker, TrackerOccurrence } from "../../../types/trackerContract"

export function useTrackers({ token, onUnauthorized, enabled = true }) {
  const initial = getOverview(token).trackers
  const [trackers, setTrackers] = useState<Tracker[]>(initial ?? [])
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
    const items = Array.isArray(result.data) ? result.data : []
    setTrackers(items)
    updateOverview(token, { trackers: items })
    setLoaded(true)
    setStatus(emptyStatus)
    return true
  }, [token, onUnauthorized, enabled])

  useEffect(() => {
    const cached = enabled ? getOverview(token).trackers : null
    setTrackers(cached ?? [])
    setLoaded(cached !== null)
    setLoading(enabled && cached === null)
    setError("")
    if (enabled) void refresh()
    return () => {
      requestId.current += 1
    }
  }, [refresh, token, enabled])

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
