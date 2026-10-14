import { ApiResult, request, RequestOptions } from "../api/httpClient"
import {
  assertTaskContract,
  assertTaskListContract,
  FocusBoard,
  Task,
  TaskHistoryEvent,
} from "../types/taskContract"
import { AuthSession, User } from "../types/userContract"
import { Tracker, TrackerOccurrence } from "../types/trackerContract"

function contractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Contrato inválido."
}

async function requestTask(path: string, options: RequestOptions = {}): Promise<ApiResult<Task>> {
  const result = await request(path, options)
  if (!result.ok) {
    return result
  }

  try {
    return { ...result, data: assertTaskContract(result.data) }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: contractErrorMessage(error) },
    }
  }
}

async function requestTaskList(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResult<Task[]>> {
  const result = await request(path, options)
  if (!result.ok) {
    return result
  }

  try {
    return { ...result, data: assertTaskListContract(result.data) }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: contractErrorMessage(error) },
    }
  }
}

async function requestFocusBoard(
  path: string,
  options: RequestOptions = {}
): Promise<ApiResult<FocusBoard>> {
  const result = await request(path, options)
  if (!result.ok) {
    return result
  }

  try {
    return {
      ...result,
      data: {
        ...result.data,
        tasks: assertTaskListContract(result.data?.tasks),
        daily_tasks: assertTaskListContract(result.data?.daily_tasks),
      },
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: contractErrorMessage(error) },
    }
  }
}

let preparedKey: string | null = null
let preparationEpoch = 0
if (typeof window !== "undefined")
  window.addEventListener("bunkermode-official-change", (event: Event) => {
    if ((event as CustomEvent<{ key: string }>).detail?.key === "tasks:all") {
      preparedKey = null
      preparationEpoch++
    }
  })
const pendingMaterializations = new Map<string, ReturnType<typeof request>>()

export const api = {
  getFinances(token, month?) {
    return request<import("../types/financeContract").FinanceOverview>(
      `/financas${month ? `?mes=${encodeURIComponent(month)}` : ""}`,
      { token }
    )
  },
  saveFinanceEntry(token, payload, id?) {
    return request(`/financas/lancamentos${id ? `/${id}` : ""}`, {
      token,
      method: id ? "PATCH" : "POST",
      body: payload,
    })
  },
  deleteFinanceEntry(token, id) {
    return request(`/financas/lancamentos/${id}`, { token, method: "DELETE" })
  },
  forgotPassword(payload: { email: string }) {
    return request<{ message: string }>("/auth/forgot-password", { method: "POST", body: payload })
  },
  resetPassword(payload: { token: string; password: string }) {
    return request<{ message: string }>("/auth/reset-password", { method: "POST", body: payload })
  },
  register(payload) {
    return request<User>("/auth/register", { method: "POST", body: payload })
  },
  login(payload) {
    return request<AuthSession>("/auth/login", { method: "POST", body: payload })
  },
  getCurrentUser(token) {
    return request<User>("/usuarios/me", { token })
  },
  updateEnabledModules(token, payload) {
    return request<User>("/usuarios/me/modulos", { token, method: "PATCH", body: payload })
  },
  listTasks(token) {
    return requestTaskList("/tarefas", { token })
  },
  listDailyTasks(token) {
    return requestTaskList("/tarefas/dia-operacional", { token })
  },
  getFocusBoard(token) {
    return requestFocusBoard("/tarefas/foco", { token })
  },
  materializeTaskRecurrences(token, timezone = undefined) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(
      new Date()
    )
    const key = `${token}:${timezone ?? "local"}:${day}`
    if (preparedKey === key) return Promise.resolve({ ok: true as const, status: 204, data: null })
    const pending = pendingMaterializations.get(key)
    if (pending) return pending
    const epoch = preparationEpoch
    const result = request("/tarefas/recorrencias/materializar", { token, method: "POST" })
    pendingMaterializations.set(key, result)
    void result.then((response) => {
      if (response.ok && epoch === preparationEpoch) preparedKey = key
    })
    void result.finally(() => {
      if (pendingMaterializations.get(key) === result) pendingMaterializations.delete(key)
    })
    return result
  },
  createTask(token, payload) {
    return requestTask("/tarefas", { token, method: "POST", body: payload })
  },
  updateTask(token, taskId, payload) {
    return requestTask(`/tarefas/${taskId}`, { token, method: "PATCH", body: payload })
  },
  completeTask(token, taskId) {
    return requestTask(`/tarefas/${taskId}/concluir`, { token, method: "PATCH" })
  },
  reopenTask(token, taskId) {
    return requestTask(`/tarefas/${taskId}/reabrir`, { token, method: "POST" })
  },
  toggleTaskPin(token, taskId) {
    return requestTask(`/tarefas/${taskId}/toggle-pin`, {
      token,
      method: "PATCH",
    })
  },
  deleteTask(token, taskId) {
    return request(`/tarefas/${taskId}`, { token, method: "DELETE" })
  },
  linkTaskToObjective(token, taskId, objetivoId) {
    return request(`/tarefas/${taskId}/vincular-objetivo`, {
      token,
      method: "POST",
      body: { objetivo_id: objetivoId },
    })
  },
  unlinkTaskFromObjective(token, taskId) {
    return request<{ tarefa_id: number; series_id: number | null; objetivo_id: null }>(
      `/tarefas/${taskId}/desvincular-objetivo`,
      { token, method: "POST" }
    )
  },
  getTaskHistory(token, taskId) {
    return request<TaskHistoryEvent[]>(`/tarefas/${taskId}/historico`, { token })
  },
  listObjetivos(token) {
    return request("/objetivos", { token })
  },
  listAchievements(token) {
    return request<import("../types/achievementContract").Achievement[]>("/objetivos/conquistas", {
      token,
    })
  },
  conquerObjective(token, id, nota: string | null) {
    return request<import("../types/achievementContract").Achievement>(
      `/objetivos/${id}/conquistar`,
      {
        token,
        method: "POST",
        body: { nota },
      }
    )
  },
  createObjetivo(token, payload) {
    return request("/objetivos", { token, method: "POST", body: payload })
  },
  updateObjetivo(token, objetivoId, payload) {
    return request(`/objetivos/${objetivoId}`, { token, method: "PATCH", body: payload })
  },
  updateObjetivoStatus(token, objetivoId, payload) {
    return request(`/objetivos/${objetivoId}/status`, { token, method: "PATCH", body: payload })
  },
  reorderObjetivos(token, payload) {
    return request("/objetivos/ordem", { token, method: "PATCH", body: payload })
  },
  deleteObjetivo(token, objetivoId) {
    return request(`/objetivos/${objetivoId}`, { token, method: "DELETE" })
  },
  listTrackers(token) {
    return request<Tracker[]>("/acompanhamentos", { token })
  },
  createTracker(token, payload) {
    return request<Tracker>("/acompanhamentos", { token, method: "POST", body: payload })
  },
  updateTracker(token, id, payload) {
    return request<Tracker>(`/acompanhamentos/${id}`, { token, method: "PATCH", body: payload })
  },
  deleteTracker(token, id) {
    return request(`/acompanhamentos/${id}`, { token, method: "DELETE" })
  },
  recordTrackerOccurrence(token, id, payload = {}) {
    return request<TrackerOccurrence>(`/acompanhamentos/${id}/ocorrencias`, {
      token,
      method: "POST",
      body: payload,
    })
  },
  deleteTrackerOccurrence(token, id, occurrenceId) {
    return request(`/acompanhamentos/${id}/ocorrencias/${occurrenceId}`, {
      token,
      method: "DELETE",
    })
  },
}
