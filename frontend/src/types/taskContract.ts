const REQUIRED_PERMISSION_KEYS = Object.freeze([
  "can_complete",
  "can_edit",
  "can_delete",
  "can_pin",
  "can_view_history",
  "can_reopen",
] as const)

export type TaskPermissionKey = (typeof REQUIRED_PERMISSION_KEYS)[number]

export type TaskPermissions = Record<TaskPermissionKey, boolean>

export type TaskPriority = 1 | 2 | 3

export type TaskStatus = "PENDENTE" | "CONCLUIDA"

export type TaskRecurrencePolicy = "sem_termino" | "ate_data" | "ate_objetivo"

export type TaskRecurrence = {
  series_id: number
  weekdays: number[]
  termination_policy: TaskRecurrencePolicy
  end_date: string | null
}

export type Task = {
  id: number
  syncStatus?: string
  recurringIntent?: { weekdays: number[] }
  titulo: string
  instrucao: string | null
  prioridade: TaskPriority
  prazo: string | null
  status: TaskStatus
  status_code: TaskStatus | "NAO_REALIZADA"
  status_label: string
  is_pinned: boolean
  created_at: string
  updated_at: string
  completed_at: string | null
  user_id: number
  responsavel_id: number
  criada_por_id: number
  objetivo_id: number | null
  recurrence: TaskRecurrence | null
  permissions: TaskPermissions
}

export type FocusBoard = {
  tasks: Task[]
  daily_tasks: Task[]
}

export type TaskHistoryEvent = {
  id: number
  tarefa_id: number
  usuario_id: number
  acao: string
  detalhes: unknown
  criado_em: string
  occurred_at?: string
}

function buildContractError(message: string): Error {
  return new Error(`Contrato inválido: ${message}`)
}

export function assertTaskContract(task: unknown): Task {
  if (!task || typeof task !== "object") {
    throw buildContractError("tarefa ausente ou inválida")
  }

  const candidate = task as Partial<Task>

  if (![1, 2, 3].includes(candidate.prioridade as number)) {
    throw buildContractError("tarefa com prioridade inválida")
  }

  if (!["PENDENTE", "CONCLUIDA", "NAO_REALIZADA"].includes(candidate.status_code as string)) {
    throw buildContractError("tarefa com status_code inválido")
  }

  if (!candidate.status_label) {
    throw buildContractError("tarefa sem status_label")
  }

  if (!candidate.permissions || typeof candidate.permissions !== "object") {
    throw buildContractError("tarefa sem permissions")
  }

  for (const key of REQUIRED_PERMISSION_KEYS) {
    if (typeof candidate.permissions[key] !== "boolean") {
      throw buildContractError(`permissions.${key} ausente ou não booleano`)
    }
  }

  if (candidate.recurrence !== null && candidate.recurrence !== undefined) {
    const recurrence = candidate.recurrence
    const validPolicy = ["sem_termino", "ate_data", "ate_objetivo"].includes(
      recurrence.termination_policy
    )
    if (
      !Number.isInteger(recurrence.series_id) ||
      recurrence.series_id < 1 ||
      !Array.isArray(recurrence.weekdays) ||
      recurrence.weekdays.some(
        (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6
      ) ||
      !validPolicy ||
      (recurrence.end_date !== null && typeof recurrence.end_date !== "string")
    ) {
      throw buildContractError("recurrence inválida")
    }
  }

  return candidate as Task
}

export function assertTaskListContract(tasks: unknown): Task[] {
  if (!Array.isArray(tasks)) {
    throw buildContractError("lista de tarefas inválida")
  }

  return tasks.map(assertTaskContract)
}
