import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateOverview } from "../../../state/overviewCache"
import { operationalDateFor, taskBelongsToDate } from "../../calendar/calendarUtils"
import { formatDateForApi } from "../../../utils/date"
import { getActionTasks } from "../taskSelectors"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { readSnapshot, saveSnapshot, isTaskList } from "../../../offline/snapshots"
import type { Task } from "../../../types/taskContract"
import { enqueueOperation, projectTasks, subscribeOutbox } from "../../../offline/outbox"
import type { OutboxOperation } from "../../../offline/snapshots"

const allKey = "tasks:all"
const dailyKey = "tasks:daily:last"
type DailySnapshot = { date: string; tasks: Task[] }
const isDailySnapshot = (data: unknown): data is DailySnapshot =>
  !!data &&
  typeof data === "object" &&
  typeof (data as DailySnapshot).date === "string" &&
  isTaskList((data as DailySnapshot).tasks)

export function useTaskBoard({
  authenticated,
  boardMode,
  onUnauthorized,
  token,
  timezone,
  ownerId,
}) {
  const [tasks, setTasks] = useState(() =>
    boardMode === "focus" ? (getOverview(ownerId).daily ?? []) : (getOverview(ownerId).all ?? [])
  )
  const [operations, setOperations] = useState<OutboxOperation[]>([])
  const [hasBoardSnapshot, setHasBoardSnapshot] = useState(() =>
    boardMode === "focus" ? getOverview(ownerId).daily !== null : getOverview(ownerId).all !== null
  )
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [pinLoadingId, setPinLoadingId] = useState(null)
  const [completeLoadingId, setCompleteLoadingId] = useState(null)
  const [reopenLoadingId, setReopenLoadingId] = useState(null)
  const [status, setStatus] = useState(emptyStatus)
  const [formStatus, setFormStatus] = useState(emptyStatus)
  const loadRequestRef = useRef(0)
  const lifecycleRef = useRef(0)

  const projectedTasks = useMemo(() => projectTasks(tasks, operations), [tasks, operations])
  const actionTasks = useMemo(() => getActionTasks(projectedTasks), [projectedTasks])
  const dailyTasks = projectedTasks

  useEffect(() => (ownerId ? subscribeOutbox(ownerId, setOperations) : undefined), [ownerId])
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: number; key: string }>).detail
      if (detail?.ownerId !== ownerId || detail.key !== allKey) return
      void readSnapshot(ownerId, allKey, isTaskList).then((entry) => {
        if (!entry) return
        const official = entry.data as Task[]
        updateOverview(ownerId, { all: official })
        if (boardMode === "focus") {
          const today = operationalDateFor(timezone)
          setTasks(official.filter((task) => taskBelongsToDate(task, today, timezone)))
        } else setTasks(official)
      })
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [ownerId, boardMode, timezone])

  const loadTasksBoard = useCallback(
    async (successMessage = "") => {
      if (!token || getApiAvailability() === "unavailable") {
        return
      }

      const requestId = loadRequestRef.current + 1
      loadRequestRef.current = requestId
      setTaskLoading(true)
      const materializationResult = await api.materializeTaskRecurrences(token)
      if (requestId !== loadRequestRef.current) {
        return false
      }

      if (onUnauthorized(materializationResult)) {
        setTaskLoading(false)
        return false
      }

      if (!materializationResult.ok) {
        setTaskLoading(false)
        setStatus({
          type: "error",
          message: getErrorMessage(
            materializationResult,
            "Não foi possível preparar as tarefas recorrentes."
          ),
        })
        return false
      }

      const tasksResult = await api.listTasks(token)
      if (requestId !== loadRequestRef.current) {
        return false
      }
      setTaskLoading(false)

      if (onUnauthorized(tasksResult)) {
        return false
      }

      if (!tasksResult.ok) {
        setStatus({
          type: "error",
          message: getErrorMessage(tasksResult, "Não foi possível carregar tarefas."),
        })
        return false
      }

      setTasks(tasksResult.data)
      setHasBoardSnapshot(true)
      updateOverview(ownerId, { all: tasksResult.data, daily: null, dailyDate: null })
      const saved = await saveSnapshot(ownerId, allKey, tasksResult.data)
      setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
      setStatus(successMessage ? { type: "success", message: successMessage } : emptyStatus)
      return true
    },
    [onUnauthorized, token, ownerId]
  )

  const loadFocusBoard = useCallback(
    async (successMessage = "") => {
      if (!token || getApiAvailability() === "unavailable") {
        return
      }

      const requestId = loadRequestRef.current + 1
      loadRequestRef.current = requestId
      setTaskLoading(true)

      const materializationResult = await api.materializeTaskRecurrences(token)
      if (requestId !== loadRequestRef.current) {
        return false
      }

      if (onUnauthorized(materializationResult)) {
        setTaskLoading(false)
        return false
      }

      if (!materializationResult.ok) {
        setTaskLoading(false)
        setStatus({
          type: "error",
          message: getErrorMessage(
            materializationResult,
            "Não foi possível preparar as tarefas recorrentes para o Modo Foco."
          ),
        })
        return false
      }

      const result = await api.getFocusBoard(token)
      if (requestId !== loadRequestRef.current) {
        return false
      }
      setTaskLoading(false)

      if (onUnauthorized(result)) {
        return false
      }

      if (!result.ok) {
        setStatus({
          type: "error",
          message: getErrorMessage(result, "Não foi possível carregar tarefas."),
        })
        return false
      }

      setTasks(result.data.daily_tasks)
      setHasBoardSnapshot(true)
      const date = formatDateForApi(operationalDateFor(timezone))
      updateOverview(ownerId, { daily: result.data.daily_tasks, dailyDate: date })
      const saved = await saveSnapshot(ownerId, dailyKey, { date, tasks: result.data.daily_tasks })
      setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
      setSnapshotDate(date)
      setStatus(successMessage ? { type: "success", message: successMessage } : emptyStatus)
      return true
    },
    [onUnauthorized, token, timezone, ownerId]
  )

  useEffect(() => {
    setLastUpdated(null)
    setSnapshotDate(null)
    setFormLoading(false)
    setPinLoadingId(null)
    setCompleteLoadingId(null)
    setReopenLoadingId(null)

    if (!authenticated) {
      setTasks([])
      setHasBoardSnapshot(false)
      setStatus(emptyStatus)
      setFormStatus(emptyStatus)
      return
    }

    let cancelled = false
    void (async () => {
      if (boardMode === "focus") {
        const entry = await readSnapshot(ownerId, dailyKey, isDailySnapshot)
        if (cancelled) return
        const cached = getOverview(ownerId).daily
        if (entry && cached === null) {
          updateOverview(ownerId, { daily: entry.data.tasks, dailyDate: entry.data.date })
          setTasks(entry.data.tasks)
          setHasBoardSnapshot(true)
        } else {
          setTasks(cached ?? [])
          setHasBoardSnapshot(cached !== null)
        }
        setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
        setSnapshotDate(getOverview(ownerId).dailyDate ?? entry?.data.date ?? null)
      } else {
        const entry = await readSnapshot(ownerId, allKey, isTaskList)
        if (cancelled) return
        const cached = getOverview(ownerId).all
        if (entry && cached === null) {
          updateOverview(ownerId, { all: entry.data as Task[] })
          setTasks(entry.data as Task[])
          setHasBoardSnapshot(true)
        } else {
          setTasks(cached ?? [])
          setHasBoardSnapshot(cached !== null)
        }
        setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
      }
    })()
    if (getApiAvailability() !== "unavailable") {
      if (boardMode === "focus") void loadFocusBoard()
      else void loadTasksBoard()
    }

    return () => {
      cancelled = true
      loadRequestRef.current += 1
      lifecycleRef.current += 1
    }
  }, [authenticated, boardMode, loadFocusBoard, loadTasksBoard, token, ownerId])

  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (authenticated && previous === "unavailable" && next === "available") {
        if (boardMode === "focus") void loadFocusBoard()
        else void loadTasksBoard()
      }
      previous = next
    })
  }, [authenticated, boardMode, loadFocusBoard, loadTasksBoard])

  async function queue(action: string, payload: Record<string, unknown> = {}, task?: Task) {
    try {
      await enqueueOperation(ownerId, "task", action, payload, task?.id, task?.updated_at)
      setStatus({ type: "success", message: "Alteração salva neste dispositivo." })
      return { persisted: true, synchronized: false }
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Não foi possível salvar localmente.",
      })
      return false
    }
  }

  async function createTask(payload) {
    if (!payload.titulo) {
      setFormStatus({ type: "error", message: "Informe o título da tarefa." })
      return false
    }

    return queue("create", payload)
  }

  async function updateTask(taskId, payload) {
    if (!payload.titulo) {
      setFormStatus({ type: "error", message: "Informe o título da tarefa." })
      return false
    }

    const task = projectedTasks.find((item) => item.id === taskId)
    if (!task) return false
    return queue("update", payload, task)
  }

  async function toggleTaskPin(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para subir prioridade." })
      return false
    }

    return queue("pin", { is_pinned: !task.is_pinned }, task)
  }

  async function deleteTask(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para remoção." })
      return false
    }

    return queue("delete", {}, task)
  }

  async function completeTask(task) {
    return queue("complete", {}, task)
  }

  async function reopenTask(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para reabertura." })
      return false
    }

    return queue("reopen", {}, task)
  }

  return {
    lastUpdated,
    snapshotDate,
    hasBoardSnapshot,
    actionTasks,
    completeLoadingId,
    completeTask,
    createTask,
    dailyTasks,
    deleteTask,
    formLoading,
    formStatus,
    taskLoading,
    tasks: projectedTasks,
    pinLoadingId,
    refreshTasksBoard: loadTasksBoard,
    refreshFocusBoard: loadFocusBoard,
    reopenLoadingId,
    reopenTask,
    setFormStatus,
    setStatus,
    status,
    toggleTaskPin,
    updateTask,
  }
}
