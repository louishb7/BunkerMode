import React from "react"
import { CalendarDays, Check, Plus, Circle, ListTodo } from "lucide-react"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Badge from "../../../components/ui/Badge"

import Button from "../../../components/ui/Button"
import { normalizeTaskDate } from "../../calendar/calendarUtils"

const statusLabels = {
  ativo: "Ativo",
  pausado: "Pausado",
  abandonado: "Abandonado",
  concluido: "Concluído",
}

const taskStatus = {
  PENDENTE: { label: "Em aberto", className: "text-text-secondary" },
  CONCLUIDA: { label: "Concluída", className: "text-success" },
  NAO_REALIZADA: { label: "Não realizada", className: "text-text-muted" },
}

function formatDateOnly(value, fallback) {
  const normalized = normalizeTaskDate(value)
  if (!/^\d{2}-\d{2}-\d{4}$/.test(normalized)) {
    return fallback
  }

  const [day, month, year] = normalized.split("-")
  return `${day}/${month}/${year}`
}

function getTaskStatus(task) {
  const statusCode = String(task?.status_code || "").toUpperCase()
  return (
    taskStatus[statusCode] || {
      label: task?.status_label || "Sem status",
      className: "text-text-secondary",
    }
  )
}

export default function ObjetivoCard({
  tasksEnabled,
  loading,
  tasks,
  tasksLoading,
  tasksError,
  onRetryTasks,
  objetivo,
  onCreateTask,
  onDelete,
  onEdit,
  onMoveToTop,
  onUpdateStatus,
}) {
  const targetDate = objetivo.data_alvo ? formatDateOnly(objetivo.data_alvo, "") : ""

  const menuItems = [
    { label: "Editar objetivo", onSelect: onEdit },
    ...(onMoveToTop ? [{ label: "Mover para o início", onSelect: onMoveToTop }] : []),
    ...(objetivo.status === "ativo"
      ? [{ label: "Pausar objetivo", onSelect: () => onUpdateStatus("pausado") }]
      : objetivo.status === "pausado"
        ? [{ label: "Retomar objetivo", onSelect: () => onUpdateStatus("ativo") }]
        : []),
    { label: "Remover objetivo", onSelect: onDelete, danger: true },
  ]
  return (
    <article className="work-surface min-w-0">
      <div className="p-5 sm:p-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <Badge variant={objetivo.status === "concluido" ? "success" : "neutral"}>
              {statusLabels[objetivo.status] || objetivo.status}
            </Badge>
            {targetDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={14} aria-hidden="true" />
                {targetDate}
              </span>
            )}
          </div>
          <ActionsMenu
            label={`Ações do objetivo: ${objetivo.titulo}`}
            disabled={loading}
            items={menuItems}
          />
        </header>
        <div className="mt-3 max-w-2xl">
          <h2 className="m-0 break-words text-xl font-semibold leading-snug tracking-tight text-text-primary">
            {objetivo.titulo}
          </h2>
          {objetivo.descricao && (
            <p className="mt-3 mb-0 whitespace-pre-line break-words text-sm leading-6 text-text-secondary">
              {objetivo.descricao}
            </p>
          )}
        </div>
        {objetivo.status !== "concluido" && objetivo.status !== "abandonado" && (
          <Button
            className="mt-4"
            disabled={loading}
            size="small"
            variant="ghost"
            onClick={() => onUpdateStatus("concluido")}
          >
            <Check size={16} aria-hidden="true" />
            Concluir objetivo
          </Button>
        )}
      </div>
      {tasksEnabled && (
        <section
          aria-label={`Tarefas de ${objetivo.titulo}`}
          className="rounded-b-card border-t border-border bg-surface-subtle px-5 py-3 sm:px-6"
        >
          {tasks.length > 0 && (
            <header className="flex items-center justify-between gap-3">
              <h3 className="m-0 flex items-center gap-2 text-xs font-semibold text-text-secondary">
                <ListTodo size={15} aria-hidden="true" />
                Tarefas
              </h3>
              <Button
                size="icon"
                variant="ghost"
                onClick={onCreateTask}
                aria-label={`Adicionar tarefa a ${objetivo.titulo}`}
                title="Adicionar tarefa"
              >
                <Plus size={18} aria-hidden="true" />
              </Button>
            </header>
          )}
          {tasksLoading ? (
            <p role="status" className="m-0 py-3 text-sm text-text-secondary">
              Carregando tarefas…
            </p>
          ) : tasksError ? (
            <div role="status" className="grid gap-2">
              <p className="m-0 text-sm text-text-secondary">Tarefas indisponíveis. {tasksError}</p>
              <Button variant="ghost" onClick={onRetryTasks}>
                Tentar novamente
              </Button>
            </div>
          ) : tasks.length > 0 ? (
            <ul className="m-0 grid list-none p-0">
              {tasks.map((task) => {
                const status = getTaskStatus(task)
                return (
                  <li
                    key={task.id}
                    className="flex items-start gap-2 border-t border-border py-2.5 first:border-0"
                  >
                    <span className="mt-1 text-text-muted" aria-hidden="true">
                      {task.status_code === "CONCLUIDA" ? (
                        <Check size={14} />
                      ) : (
                        <Circle size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm leading-5 text-text-secondary">
                      {task.titulo}
                      <span className="sr-only"> — {status.label}</span>
                      {task.recurrence && (
                        <span className="block text-xs text-text-muted">
                          Recorrente · {task.recurrence.weekdays.length === 7 ? "Todos os dias" : task.recurrence.weekdays.length === 5 && task.recurrence.weekdays.join(",") === "0,1,2,3,4" ? "Dias úteis" : ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].filter((_, index) => task.recurrence.weekdays.includes(index)).join(", ")}
                        </span>
                      )}
                    </span>
                    {task.status_code === "NAO_REALIZADA" && (
                      <span className="text-xs text-text-muted">Não realizada</span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
          {tasks.length === 0 && (
            <Button size="small" variant="ghost" onClick={onCreateTask}>
              <Plus size={16} aria-hidden="true" />
              Adicionar tarefa
            </Button>
          )}
        </section>
      )}
    </article>
  )
}
