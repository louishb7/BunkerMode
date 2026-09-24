import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getErrorMessage } from "../../../api/httpClient"
import { emptyStatus } from "../../../constants/uiState"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, updateCachedTask, updateOverview } from "../../../state/overviewCache"
import { operationalDateFor } from "../../calendar/calendarUtils"
import { formatDateForApi } from "../../../utils/date"
import { getActionTasks } from "../taskSelectors"

export function useTaskBoard({ authenticated, boardMode, onUnauthorized, token, timezone }) {
  const [tasks, setTasks] = useState(() => boardMode === "focus" ? (getOverview(token).daily ?? []) : (getOverview(token).all ?? []))
  const [hasBoardSnapshot, setHasBoardSnapshot] = useState(() => boardMode === "focus" ? getOverview(token).daily !== null : getOverview(token).all !== null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [formLoading, setFormLoading] = useState(false)
  const [pinLoadingId, setPinLoadingId] = useState(null)
  const [completeLoadingId, setCompleteLoadingId] = useState(null)
  const [reopenLoadingId, setReopenLoadingId] = useState(null)
  const [status, setStatus] = useState(emptyStatus)
  const [formStatus, setFormStatus] = useState(emptyStatus)
  const loadRequestRef = useRef(0)
  const lifecycleRef = useRef(0)

  const actionTasks = useMemo(() => getActionTasks(tasks), [tasks])
  const dailyTasks = tasks

  const loadTasksBoard = useCallback(
    async (successMessage = "") => {
      if (!token) {
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
      updateOverview(token, { all: tasksResult.data, daily: null, dailyDate: null })
      setStatus(successMessage ? { type: "success", message: successMessage } : emptyStatus)
      return true
    },
    [onUnauthorized, token]
  )

  const loadFocusBoard = useCallback(
    async (successMessage = "") => {
      if (!token) {
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
      updateOverview(token, { daily: result.data.daily_tasks, dailyDate: formatDateForApi(operationalDateFor(timezone)) })
      setStatus(successMessage ? { type: "success", message: successMessage } : emptyStatus)
      return true
    },
    [onUnauthorized, token, timezone]
  )

  useEffect(() => {
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

    const cachedTasks = boardMode === "focus" ? getOverview(token).daily : getOverview(token).all
    setTasks(cachedTasks ?? [])
    setHasBoardSnapshot(cachedTasks !== null)

    if (boardMode === "focus") {
      loadFocusBoard()
    } else {
      loadTasksBoard()
    }

    return () => {
      loadRequestRef.current += 1
      lifecycleRef.current += 1
    }
  }, [authenticated, boardMode, loadFocusBoard, loadTasksBoard, token])

  async function reloadCurrentBoard(successMessage = "") {
    return boardMode === "focus" ? loadFocusBoard(successMessage) : loadTasksBoard(successMessage)
  }

  async function refreshAfterPersistedMutation(successMessage) {
    const synchronization = reloadCurrentBoard()
    const requestId = loadRequestRef.current
    const synchronized = await synchronization
    if (requestId !== loadRequestRef.current) {
      return { persisted: true, synchronized: false }
    }
    if (!synchronized) {
      setStatus({
        type: "error",
        message: `${successMessage} A tarefa foi salva, mas não foi possível atualizar a visão. Recarregue a página.`,
      })
      return { persisted: true, synchronized: false }
    }

    setStatus({ type: "success", message: successMessage })
    return { persisted: true, synchronized: true }
  }

  async function createTask(payload) {
    if (!payload.titulo) {
      setFormStatus({ type: "error", message: "Informe o título da tarefa." })
      return false
    }

    const currentLifecycle = lifecycleRef.current
    setFormLoading(true)
    setFormStatus(emptyStatus)
    const result = await api.createTask(token, payload)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }
    setFormLoading(false)

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setFormStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível registrar a tarefa."),
      })
      return false
    }

    return refreshAfterPersistedMutation("Tarefa registrada.")
  }

  async function updateTask(taskId, payload) {
    if (!payload.titulo) {
      setFormStatus({ type: "error", message: "Informe o título da tarefa." })
      return false
    }

    const currentLifecycle = lifecycleRef.current
    setFormLoading(true)
    setFormStatus(emptyStatus)
    const result = await api.updateTask(token, taskId, payload)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }
    setFormLoading(false)

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setFormStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível salvar a tarefa."),
      })
      return false
    }

    return refreshAfterPersistedMutation("Tarefa atualizada.")
  }

  async function toggleTaskPin(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para subir prioridade." })
      return false
    }

    const currentLifecycle = lifecycleRef.current
    setPinLoadingId(task.id)
    setStatus(emptyStatus)
    const result = await api.toggleTaskPin(token, task.id)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }
    setPinLoadingId(null)

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível subir prioridade."),
      })
      await reloadCurrentBoard()
      return false
    }

    return refreshAfterPersistedMutation("Prioridade da tarefa atualizada.")
  }

  async function deleteTask(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para remoção." })
      return false
    }

    const currentLifecycle = lifecycleRef.current
    setStatus(emptyStatus)
    const result = await api.deleteTask(token, task.id)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível remover a tarefa."),
      })
      return false
    }

    return refreshAfterPersistedMutation("Tarefa removida.")
  }

  async function completeTask(task) {
    const currentLifecycle = lifecycleRef.current
    setCompleteLoadingId(task.id)
    setStatus(emptyStatus)
    const result = await api.completeTask(token, task.id)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }
    setCompleteLoadingId(null)

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível concluir a tarefa."),
      })
      await reloadCurrentBoard()
      return false
    }

    updateCachedTask(token, result.data)
    setTasks((current) => current.map((item) => item.id === task.id ? result.data : item))
    return refreshAfterPersistedMutation("Tarefa concluída.")
  }

  async function reopenTask(task) {
    if (!task?.id) {
      setStatus({ type: "error", message: "Tarefa inválida para reabertura." })
      return false
    }

    const currentLifecycle = lifecycleRef.current
    setReopenLoadingId(task.id)
    setStatus(emptyStatus)
    const result = await api.reopenTask(token, task.id)
    if (currentLifecycle !== lifecycleRef.current) {
      return false
    }
    setReopenLoadingId(null)

    if (onUnauthorized(result)) {
      return false
    }

    if (!result.ok) {
      setStatus({
        type: "error",
        message: getErrorMessage(result, "Não foi possível reabrir a tarefa."),
      })
      await reloadCurrentBoard()
      return false
    }

    return refreshAfterPersistedMutation("Tarefa reaberta.")
  }

  return {
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
    tasks,
    pinLoadingId,
    refreshTasksBoard: loadTasksBoard,
    reopenLoadingId,
    reopenTask,
    setFormStatus,
    setStatus,
    status,
    toggleTaskPin,
    updateTask,
  }
}
