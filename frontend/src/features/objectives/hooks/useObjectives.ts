import { useCallback, useEffect, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { isObjectiveList, readSnapshot, saveSnapshot } from "../../../offline/snapshots"
import type { OutboxOperation } from "../../../offline/snapshots"
import { enqueueOperation, projectGoals, subscribeOutbox } from "../../../offline/outbox"

function sortObjetivosByOrder(objetivos = []) {
  return [...objetivos].sort((left, right) => {
    const orderDiff = Number(left.order_index || 0) - Number(right.order_index || 0)
    return orderDiff || Number(left.id || 0) - Number(right.id || 0)
  })
}

export function useObjectives({ onUnauthorized, token, ownerId, enabled = true }) {
  const [objetivos, setObjetivos] = useState(() => getOverview(ownerId).objectives ?? [])
  const [operations, setOperations] = useState<OutboxOperation[]>([])
  const projectedObjectives = projectGoals(objetivos, operations)
  useEffect(() => (ownerId ? subscribeOutbox(ownerId, setOperations) : undefined), [ownerId])
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: number; key: string }>).detail
      if (detail?.ownerId !== ownerId || detail.key !== "objectives") return
      void readSnapshot(ownerId, "objectives", isObjectiveList).then((entry) => {
        if (entry) {
          setObjetivos(entry.data)
          updateOverview(ownerId, { objectives: entry.data })
        }
      })
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [ownerId])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [status, setStatus] = useState(emptyStatus)
  const loadRequestId = useRef(0)
  const mutationRequestId = useRef(0)
  const lifecycleId = useRef(0)

  const loadObjectives = useCallback(
    async (successMessage = "") => {
      if (!token || !enabled) {
        return false
      }

      const requestId = loadRequestId.current + 1
      loadRequestId.current = requestId
      setLoading(true)
      const objetivosResult = await api.listObjetivos(token)
      if (requestId !== loadRequestId.current) {
        return false
      }
      setLoading(false)

      if (onUnauthorized?.(objetivosResult)) {
        return false
      }

      if (!objetivosResult.ok) {
        setStatus({
          type: "error",
          message: getErrorMessage(objetivosResult, "Não foi possível carregar objetivos."),
        })
        return false
      }

      if (!isObjectiveList(objetivosResult.data)) {
        setStatus({ type: "error", message: "Resposta de objetivos inválida." })
        return false
      }
      const sorted = sortObjetivosByOrder(objetivosResult.data)
      setObjetivos(sorted)
      updateOverview(ownerId, { objectives: sorted })
      const saved = await saveSnapshot(ownerId, "objectives", sorted)
      setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
      setStatus(successMessage ? { type: "success", message: successMessage } : emptyStatus)
      return true
    },
    [onUnauthorized, token, enabled, ownerId]
  )

  useEffect(() => {
    setLastUpdated(null)
    setMutating(false)
    let cancelled = false
    if (enabled)
      void (async () => {
        const entry = await readSnapshot(ownerId, "objectives", isObjectiveList)
        if (cancelled) return
        if (entry && getOverview(ownerId).objectives === null) {
          updateOverview(ownerId, { objectives: entry.data })
          setObjetivos(entry.data)
        }
        setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
        if (getApiAvailability() !== "unavailable") void loadObjectives()
      })()
    else setObjetivos([])
    return () => {
      cancelled = true
      loadRequestId.current += 1
      lifecycleId.current += 1
      mutationRequestId.current += 1
    }
  }, [loadObjectives, enabled, ownerId])

  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (enabled && previous !== "available" && next === "available") void loadObjectives()
      previous = next
    })
  }, [enabled, loadObjectives])

  async function mutate(action, successMessage, fallbackMessage) {
    if (mutating) {
      return false
    }

    const requestId = mutationRequestId.current + 1
    const currentLifecycle = lifecycleId.current
    mutationRequestId.current = requestId
    setMutating(true)
    setStatus(emptyStatus)
    const result = await action()
    if (requestId !== mutationRequestId.current || currentLifecycle !== lifecycleId.current) {
      return false
    }
    setMutating(false)

    if (onUnauthorized?.(result)) {
      return false
    }

    if (!result.ok) {
      setStatus({ type: "error", message: getErrorMessage(result, fallbackMessage) })
      return false
    }

    if (result.data && typeof result.data === "object" && "id" in result.data) {
      const current = getOverview(ownerId).objectives
      if (current)
        updateOverview(ownerId, {
          objectives: current.map((item) => (item.id === result.data.id ? result.data : item)),
        })
    } else {
      updateOverview(ownerId, { objectives: null })
    }
    await loadObjectives(successMessage)
    return true
  }

  async function queue(
    action: string,
    payload: Record<string, unknown> = {},
    id?: number | string
  ) {
    try {
      const item = projectedObjectives.find((goal) => goal.id === id)
      await enqueueOperation(ownerId, "goal", action, payload, id, item?.updated_at)
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

  return {
    lastUpdated,
    loading,
    mutating,
    objetivos: projectedObjectives,
    refresh: loadObjectives,
    setStatus,
    status,
    createObjetivo: (payload) => queue("create", payload),
    deleteObjetivo: (objetivoId) => queue("delete", {}, objetivoId),
    reorderObjetivos: (objetivoIds) =>
      getApiAvailability() === "unavailable" || objetivoIds.some((id) => typeof id !== "number")
        ? (setStatus({ type: "error", message: "Organização exige conexão com a API." }),
          Promise.resolve(false))
        : mutate(
            () => api.reorderObjetivos(token, { objetivo_ids: objetivoIds }),
            "Organização dos objetivos atualizada.",
            "Não foi possível reordenar os objetivos."
          ),
    updateObjetivo: (objetivoId, payload) => queue("update", payload, objetivoId),
    updateObjetivoStatus: (objetivoId, objetivoStatus) =>
      queue("status", { status: objetivoStatus }, objetivoId),
  }
}
