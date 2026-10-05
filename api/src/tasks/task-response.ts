import { OperationalCalendarService } from "../calendar/operational-calendar.service";

import { auditoria_eventos } from "@prisma/client";

import {
  TASK_STATUS,
  canReopenTask,
  TASK_STATUS_LABEL,
  TaskPermissions,
  TaskPriority,
  TaskRecurrencePolicy,
  TaskRecord,
  TaskResponse,
  TaskUser,
} from "./task.types";

function dateOnly(value: Date | null): string | null {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.toISOString().slice(0, 10).split("-");
  return `${day}-${month}-${year}`;
}

function dateTime(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isPending(task: TaskRecord): boolean {
  return task.status === TASK_STATUS.pending;
}

function isFinalized(task: TaskRecord): boolean {
  return task.status === TASK_STATUS.completed;
}

export function taskPermissions(
  task: TaskRecord,
  user: TaskUser,
): TaskPermissions {
  const owned = task.responsavel_id === user.usuario_id;
  const pending = isPending(task);

  return {
    can_complete: owned && pending,
    can_edit: owned && pending,
    can_delete: owned && pending,
    can_pin: owned && pending,
    can_view_history: owned && isFinalized(task),
    can_reopen: canReopenTask(task, user),
  };
}

export function toTaskResponse(
  task: TaskRecord,
  user: TaskUser,
  now = new Date(),
): TaskResponse {
  const status = task.status as keyof typeof TASK_STATUS_LABEL;
  const notPerformed =
    task.status === TASK_STATUS.pending &&
    task.prazo !== null &&
    task.prazo.toISOString().slice(0, 10) <
      new OperationalCalendarService().currentDateFor(now, user.timezone);
  const recurrence = task.serie_recorrencia
    ? {
        series_id: task.serie_recorrencia.recurrence_series_id,
        weekdays: task.serie_recorrencia.recurrence_weekdays,
        termination_policy: task.serie_recorrencia.termination_policy as TaskRecurrencePolicy,
        end_date: dateOnly(task.serie_recorrencia.end_date),
      }
    : null;

  return {
    id: task.missao_id,
    titulo: task.titulo,
    prioridade: task.prioridade as TaskPriority,
    prazo: dateOnly(task.prazo),
    instrucao: task.instrucao,
    status: task.status as TaskResponse["status"],
    status_code: notPerformed ? "NAO_REALIZADA" : (task.status as TaskResponse["status_code"]),
    status_label: notPerformed ? "Não realizada" : TASK_STATUS_LABEL[status] ?? task.status,
    is_pinned: task.is_pinned,
    created_at: task.created_at.toISOString(),
    updated_at: task.updated_at.toISOString(),
    completed_at: dateTime(task.completed_at),
    user_id: task.responsavel_id,
    criada_por_id: task.criada_por_id,
    responsavel_id: task.responsavel_id,
    objetivo_id: task.objetivo_id,
    recurrence,
    permissions: taskPermissions(task, user),
  };
}

export function toTaskHistoryEventResponse(event: auditoria_eventos) {
  return {
    id: event.evento_id,
    tarefa_id: event.missao_id,
    usuario_id: event.usuario_id,
    acao: event.acao,
    detalhes: event.detalhes,
    criado_em: event.criado_em.toISOString(),
    occurred_at: (event.occurred_at ?? event.criado_em).toISOString(),
  };
}
