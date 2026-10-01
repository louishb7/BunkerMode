import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import type { Task } from "../../../types/taskContract"
import { detachObjectiveTaskList, getOverview, updateOverview } from "../../../state/overviewCache"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { isTaskList, readSnapshot, saveSnapshot } from "../../../offline/snapshots"

// Falhas desta integração não relacionadas à autenticação são locais.
export function useObjectiveTasks({ token, ownerId, onUnauthorized, enabled = true }) {
  const [tasks, setTasks] = useState<Task[]>(() => getOverview(ownerId).all ?? [])
  const [loading, setLoading] = useState(() => !getOverview(ownerId).all)
  const [error, setError] = useState("")
  const [formLoading, setFormLoading] = useState(false)
  const [formStatus, setFormStatus] = useState(emptyStatus)
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null)
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    if (!token || !enabled) return false
    const currentRequest = ++requestId.current
    setLoading(!getOverview(ownerId).all)
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
    updateOverview(ownerId, { all: result.data })
    await saveSnapshot(ownerId, "tasks:all", result.data)
    return true
  }, [token, ownerId, onUnauthorized, enabled])

  useEffect(() => {
    setFormLoading(false)
    if (!enabled) {
      setTasks([])
      setLoading(false)
      setError("")
      return
    }
    let cancelled = false
    void (async () => {
      const entry = await readSnapshot(ownerId, "tasks:all", isTaskList)
      if (cancelled) return
      if (entry && getOverview(ownerId).all === null) {
        updateOverview(ownerId, { all: entry.data as Task[] })
        setTasks(entry.data as Task[])
        setLoading(false)
      }
      if (getApiAvailability() !== "unavailable") void refresh()
      else setLoading(false)
    })()
    return () => {
      cancelled = true
      requestId.current += 1
    }
  }, [refresh, enabled, ownerId])

  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (enabled && previous === "unavailable" && next === "available") void refresh()
      previous = next
    })
  }, [enabled, refresh])

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

  async function unlinkTask(task: Task) {
    if (!token || unlinkingId !== null) return false
    const currentRequest = ++requestId.current
    setUnlinkingId(task.id)
    const result = await api.unlinkTaskFromObjective(token, task.id)
    if (currentRequest !== requestId.current) return false
    setUnlinkingId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível desvincular a tarefa."))
      return false
    }
    return refresh()
  }
  async function operateTask(task: Task, payload = null) {
    if (!enabled || unlinkingId !== null) return false
    const currentRequest = ++requestId.current
    setUnlinkingId(task.id)
    const result = payload
      ? await api.linkTaskToObjective(token, task.id, payload.objetivo_id)
      : await api.completeTask(token, task.id)
    if (currentRequest !== requestId.current) return false
    setUnlinkingId(null)
    if (onUnauthorized?.(result)) return false
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível atualizar a tarefa."))
      return false
    }
    return refresh()
  }

  function detachObjective(objectiveId: number) {
    requestId.current += 1
    setTasks((current) => detachObjectiveTaskList(current, objectiveId))
  }

  return {
    tasks,
    operateTask,
    tasksByObjetivo,
    summaryTasksByObjetivo: groupObjectiveTasks(tasks, false),
    loading,
    error,
    refresh,
    createTask,
    formLoading,
    formStatus,
    setFormStatus,
    unlinkTask,
    unlinkingId,
    detachObjective,
  }
}

export function groupObjectiveTasks(
  tasks: Task[],
  deduplicateSeries = true
): Record<string, Task[]> {
  const grouped: Record<string, Task[]> = {}
  const seriesPositions = new Map<string, number>()
  for (const task of tasks) {
    if (task.objetivo_id == null) continue
    const key = String(task.objetivo_id)
    grouped[key] ??= []
    const seriesId = task.recurrence?.series_id
    if (seriesId && deduplicateSeries) {
      const seriesKey = `${key}:${seriesId}`
      const position = seriesPositions.get(seriesKey)
      if (position !== undefined) {
        const selected = grouped[key][position]
        if (selected.status === "CONCLUIDA" && task.status !== "CONCLUIDA")
          grouped[key][position] = task
        continue
      }
      seriesPositions.set(seriesKey, grouped[key].length)
    }
    grouped[key].push(task)
  }
  return grouped
}
