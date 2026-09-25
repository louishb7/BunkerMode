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

  function apply(items: Tracker[]) {
    setTrackers(items)
    updateOverview(token, { trackers: items })
  }

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

  async function createTracker(payload) {
    if (!loaded || busyRef.current) return false
    busyRef.current = true
    const currentRequest = ++requestId.current
    const result = await api.createTracker(token, payload)
    busyRef.current = false
    if (currentRequest !== requestId.current || onUnauthorized?.(result)) return false
    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível criar o acompanhamento."),
      })
      return false
    }
    apply([...trackers, result.data])
    setStatus(emptyStatus)
    return true
  }

  async function updateTracker(tracker: Tracker, payload) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusyId(tracker.id)
    const currentRequest = ++requestId.current
    const result = await api.updateTracker(token, tracker.id, payload)
    busyRef.current = false
    if (currentRequest !== requestId.current) return false
    setBusyId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível editar o acompanhamento."),
      })
      return false
    }
    apply(trackers.map((item) => (item.id === tracker.id ? result.data : item)))
    setStatus(emptyStatus)
    return true
  }

  async function deleteTracker(tracker: Tracker) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusyId(tracker.id)
    const currentRequest = ++requestId.current
    const result = await api.deleteTracker(token, tracker.id)
    busyRef.current = false
    if (currentRequest !== requestId.current) return false
    setBusyId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível excluir o acompanhamento."),
      })
      return false
    }
    apply(trackers.filter((item) => item.id !== tracker.id))
    setStatus(emptyStatus)
    return true
  }

  async function recordOccurrence(tracker: Tracker) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusyId(tracker.id)
    const previous = trackers
    const optimistic: TrackerOccurrence = {
      id: -Date.now(),
      acompanhamento_id: tracker.id,
      occurred_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    apply(
      trackers.map((item) =>
        item.id === tracker.id
          ? { ...item, ocorrencias: [optimistic, ...item.ocorrencias].slice(0, 5) }
          : item
      )
    )
    const currentRequest = ++requestId.current
    const result = await api.recordTrackerOccurrence(token, tracker.id)
    busyRef.current = false
    if (currentRequest !== requestId.current) return false
    setBusyId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      apply(previous)
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível registrar a ocorrência."),
      })
      return false
    }
    apply(
      getOverview(token).trackers!.map((item) =>
        item.id === tracker.id
          ? {
              ...item,
              ocorrencias: item.ocorrencias.map((occurrence) =>
                occurrence.id === optimistic.id ? result.data : occurrence
              ),
            }
          : item
      )
    )
    setStatus(emptyStatus)
    return true
  }

  async function deleteOccurrence(tracker: Tracker, occurrence: TrackerOccurrence) {
    if (busyRef.current) return false
    busyRef.current = true
    setBusyId(tracker.id)
    const previous = trackers
    apply(
      trackers.map((item) =>
        item.id === tracker.id
          ? { ...item, ocorrencias: item.ocorrencias.filter((event) => event.id !== occurrence.id) }
          : item
      )
    )
    const currentRequest = ++requestId.current
    const result = await api.deleteTrackerOccurrence(token, tracker.id, occurrence.id)
    busyRef.current = false
    if (currentRequest !== requestId.current) return false
    setBusyId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      apply(previous)
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível remover a ocorrência."),
      })
      return false
    }
    setStatus(emptyStatus)
    return true
  }

  function removeForObjective(objectiveId: number) {
    requestId.current += 1
    setTrackers((current) => current.filter((item) => item.objetivo_id !== objectiveId))
  }

  return {
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
