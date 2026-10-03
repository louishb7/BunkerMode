import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import type { Tracker, TrackerOccurrence } from "../../../types/trackerContract"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { isTrackerList, readSnapshot, saveSnapshot } from "../../../offline/snapshots"
import type { OutboxOperation } from "../../../offline/snapshots"
import { enqueueOperation, projectTrackers, subscribeOutbox } from "../../../offline/outbox"

export function useTrackers({ token, ownerId, onUnauthorized, enabled = true }) {
  const initial = getOverview(ownerId).trackers
  const [trackers, setTrackers] = useState<Tracker[]>(initial ?? [])
  const [operations, setOperations] = useState<OutboxOperation[]>([])
  const projectedTrackers = useMemo(
    () => projectTrackers(trackers, operations),
    [trackers, operations]
  )
  useEffect(() => (ownerId ? subscribeOutbox(ownerId, setOperations) : undefined), [ownerId])
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: number; key: string }>).detail
      if (detail?.ownerId !== ownerId || detail.key !== "trackers") return
      void readSnapshot(ownerId, "trackers", isTrackerList).then((entry) => {
        if (entry) {
          setTrackers(entry.data as Tracker[])
          updateOverview(ownerId, { trackers: entry.data as Tracker[] })
        }
      })
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [ownerId])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(initial !== null)
  const [loading, setLoading] = useState(initial === null)
  const [busyId] = useState<number | null>(null)
  const [status, setStatus] = useState(emptyStatus)
  const [error, setError] = useState("")
  const requestId = useRef(0)

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
      if (enabled && previous !== "available" && next === "available") void refresh()
      previous = next
    })
  }, [enabled, refresh])

  const byObjective = useMemo(() => {
    const grouped: Record<string, Tracker[]> = {}
    for (const tracker of projectedTrackers) {
      const key = String(tracker.objetivo_id)
      grouped[key] ??= []
      grouped[key].push(tracker)
    }
    return grouped
  }, [projectedTrackers])

  async function queue(
    domain: "tracker" | "occurrence",
    action: string,
    payload: Record<string, unknown> = {},
    target?: number | string,
    version?: string,
    parentId?: number | string
  ) {
    try {
      await enqueueOperation(ownerId, domain, action, payload, target, version, parentId)
      setStatus(emptyStatus)
      return true
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível salvar localmente.",
      })
      return false
    }
  }
  const createTracker = (payload) => queue("tracker", "create", payload)
  const updateTracker = (tracker: Tracker, payload) =>
    queue("tracker", "update", payload, tracker.id, tracker.updated_at)
  const deleteTracker = (tracker: Tracker) =>
    queue("tracker", "delete", {}, tracker.id, tracker.updated_at)
  const recordOccurrence = (tracker: Tracker) =>
    queue("occurrence", "create", {}, undefined, undefined, tracker.id)
  const deleteOccurrence = (tracker: Tracker, occurrence: TrackerOccurrence) =>
    queue("occurrence", "delete", {}, occurrence.id, undefined, tracker.id)
  return {
    lastUpdated,
    trackers: projectedTrackers,
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
  }
}
