import { useCallback, useEffect, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { isObjectiveList, readSnapshot, saveSnapshot } from "../../../offline/snapshots"

function sortObjetivosByOrder(objetivos = []) {
  return [...objetivos].sort((left, right) => {
    const orderDiff = Number(left.order_index || 0) - Number(right.order_index || 0)
    return orderDiff || Number(left.id || 0) - Number(right.id || 0)
  })
}

export function useObjectives({ onUnauthorized, token, ownerId, enabled = true }) {
  const [objetivos, setObjetivos] = useState(() => getOverview(ownerId).objectives ?? [])
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
      if (enabled && previous === "unavailable" && next === "available") void loadObjectives()
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

  return {
    lastUpdated,
    loading,
    mutating,
    objetivos,
    refresh: loadObjectives,
    setStatus,
    status,
    createObjetivo: (payload) =>
      mutate(
        () => api.createObjetivo(token, payload),
        "Objetivo registrado.",
        "Não foi possível registrar o objetivo."
      ),
    deleteObjetivo: (objetivoId) =>
      mutate(
        () => api.deleteObjetivo(token, objetivoId),
        "Objetivo removido.",
        "Não foi possível remover o objetivo."
      ),
    reorderObjetivos: (objetivoIds) =>
      mutate(
        () => api.reorderObjetivos(token, { objetivo_ids: objetivoIds }),
        "Organização dos objetivos atualizada.",
        "Não foi possível reordenar os objetivos."
      ),
    updateObjetivo: (objetivoId, payload) =>
      mutate(
        () => api.updateObjetivo(token, objetivoId, payload),
        "Objetivo atualizado.",
        "Não foi possível atualizar o objetivo."
      ),
    updateObjetivoStatus: (objetivoId, objetivoStatus) =>
      mutate(
        () => api.updateObjetivoStatus(token, objetivoId, { status: objetivoStatus }),
        "Status atualizado.",
        "Não foi possível atualizar o status."
      ),
  }
}
