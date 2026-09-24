import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import type { Task } from "../../../types/taskContract"
import { getOverview, updateOverview } from "../../../state/overviewCache"

// Falhas desta integração não relacionadas à autenticação são locais.
export function useObjectiveTasks({ token, onUnauthorized, enabled = true }) {
  const [tasks, setTasks] = useState<Task[]>(() => getOverview(token).all ?? [])
  const [loading, setLoading] = useState(() => !getOverview(token).all)
  const [error, setError] = useState("")
  const [formLoading, setFormLoading] = useState(false)
  const [formStatus, setFormStatus] = useState(emptyStatus)
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    if (!token || !enabled) return false
    const currentRequest = ++requestId.current
    setLoading(!getOverview(token).all)
    setError("")
    const result = await api.listTasks(token)
    if (currentRequest !== requestId.current) return false
    if (onUnauthorized?.(result)) {
      setLoading(false)
      return false
    }
    setLoading(false)
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível carregar tarefas vinculadas."))
      return false
    }
    setTasks(result.data)
    updateOverview(token, { all: result.data })
    return true
  }, [token, onUnauthorized, enabled])

  useEffect(() => {
    setFormLoading(false)
    if (!enabled) {
      setTasks([])
      setLoading(false)
      setError("")
      return
    }
    refresh()
    return () => {
      requestId.current += 1
    }
  }, [refresh, enabled])

  const tasksByObjetivo = useMemo(() => groupObjectiveTasks(tasks), [tasks])

  async function createTask(payload) {
    if (!enabled || !token || formLoading) return false
    if (!payload.titulo) {
      setFormStatus({ type: "error", message: "Informe o título da tarefa." })
      return false
    }
    setFormLoading(true)
    setFormStatus(emptyStatus)
    const currentRequest = requestId.current
    const result = await api.createTask(token, payload)
    if (currentRequest !== requestId.current) return false
    setFormLoading(false)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setFormStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível criar a tarefa vinculada."),
      })
      return false
    }
    void refresh()
    return true
  }

  return {
    tasksByObjetivo,
    loading,
    error,
    refresh,
    createTask,
    formLoading,
    formStatus,
    setFormStatus,
  }
}

export function groupObjectiveTasks(tasks: Task[]): Record<string, Task[]> {
  const grouped: Record<string, Task[]> = {}
  const seriesPositions = new Map<string, number>()
  for (const task of tasks) {
    if (task.objetivo_id == null) continue
    const key = String(task.objetivo_id)
    grouped[key] ??= []
    const seriesId = task.recurrence?.series_id
    if (seriesId) {
      const seriesKey = `${key}:${seriesId}`
      const position = seriesPositions.get(seriesKey)
      if (position !== undefined) {
        const selected = grouped[key][position]
        if (selected.status === "CONCLUIDA" && task.status !== "CONCLUIDA") grouped[key][position] = task
        continue
      }
      seriesPositions.set(seriesKey, grouped[key].length)
    }
    grouped[key].push(task)
  }
  return grouped
}
