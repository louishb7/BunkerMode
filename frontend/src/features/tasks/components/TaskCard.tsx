import React from "react"
import { Check, Circle, Repeat2, Pin, RotateCcw } from "lucide-react"
import Button from "../../../components/ui/Button"
import { operationalDateFor, normalizeTaskDate } from "../../calendar/calendarUtils"
import Badge from "../../../components/ui/Badge"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import { isCompleted, isNotPerformed } from "../../../utils/taskStatus"

export default function TaskCard({
  completing = false,
  task,
  onComplete,
  onDelete = undefined,
  onEdit = undefined,
  onReopen = undefined,
  onTogglePin = undefined,
  pinning = false,
  reopening = false,
  selectedDate = undefined,
  timezone = undefined,
  variant = "tasks",
}) {
  const title = task?.titulo || "Tarefa sem título"
  const completed = isCompleted(task)
  const notPerformed = isNotPerformed(task)
  const permissions = task?.id !== undefined && task?.id !== null ? task.permissions || {} : {}
  const busy = completing || pinning || reopening
  const focus = variant === "focus"
  const compactCompleted = !focus && completed
  const administrative = [
    ...(permissions.can_edit && onEdit ? [{ label: "Editar", onSelect: onEdit }] : []),
    ...(permissions.can_pin && onTogglePin
      ? [
          {
            label: task.is_pinned ? "Remover prioridade" : "Priorizar",
            onSelect: () => onTogglePin(task),
          },
        ]
      : []),
    ...(permissions.can_delete && onDelete
      ? [{ label: "Remover", onSelect: onDelete, danger: true }]
      : []),
  ]
  // O contexto de prazo continua disponível quando a tarefa aparece no dia da conclusão.
  const deadline = normalizeTaskDate(task?.prazo).replaceAll("-", "/")
  const selected = (selectedDate || operationalDateFor(timezone)).toLocaleDateString("pt-BR")
  const showDeadline = deadline && selected && deadline !== selected
  return (
    <article
      className={`group relative border-b border-border last:border-b-0 ${focus ? "px-5 py-6 sm:px-7" : compactCompleted ? "px-2 py-0.5 sm:px-4" : "px-2 py-1.5 sm:px-4"}`}
    >
      <div className={`flex min-w-0 items-start ${focus ? "gap-4" : "gap-1 sm:gap-2"}`}>
        {!focus && (
          <div className="shrink-0">
            {permissions.can_complete ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Concluir: ${title}`}
                title="Concluir tarefa"
                disabled={busy}
                loading={completing}
                onClick={onComplete}
              >
                <Circle
                  size={23}
                  className="text-text-muted group-hover:text-accent"
                  aria-hidden="true"
                />
              </Button>
            ) : (
              <span
                className={`grid size-11 place-items-center ${completed ? "text-success" : "text-text-muted"}`}
              >
                {completed ? (
                  <Check size={21} aria-hidden="true" />
                ) : (
                  <Circle size={21} aria-hidden="true" />
                )}
                <span className="sr-only">{completed ? "Concluída" : "Sem ação disponível"}</span>
              </span>
            )}
          </div>
        )}
        <div className={`min-w-0 flex-1 ${focus ? "pt-2" : compactCompleted ? "py-1" : "py-2"}`}>
          <h3
            className={`m-0 break-words font-semibold ${focus ? "text-xl leading-6 tracking-tight" : "text-sm leading-5 sm:text-base"} ${completed ? "text-text-secondary line-through" : "text-text-primary"}`}
          >
            {title}
          </h3>
          {task?.instrucao && !compactCompleted && (
            <p
              className={`mb-0 break-words text-text-secondary ${focus ? "mt-1.5 text-base leading-6" : "mt-1 line-clamp-2 text-sm leading-5"}`}
              title={!focus ? task.instrucao : undefined}
            >
              {task.instrucao}
            </p>
          )}
          {task?.instrucao && compactCompleted && (
            <span className="sr-only">Instrução: {task.instrucao}</span>
          )}
          {((!focus && (task.is_pinned || task.recurrence) && !compactCompleted) ||
            (!compactCompleted && (notPerformed || showDeadline)) ||
            (compactCompleted && task.recurrence) ||
            (focus && completed)) && (
            <div className={`${focus ? "mt-2 gap-2" : "mt-1 gap-x-2 gap-y-0.5"} flex flex-wrap items-center text-xs text-text-muted`}>
              {notPerformed && <Badge>Não realizada</Badge>}
              {focus && completed && <span className="text-success">Concluída</span>}
              {!focus && !compactCompleted && task.is_pinned && (
                <span className="inline-flex items-center gap-1">
                  <Pin size={12} aria-hidden="true" />
                  Prioridade alta
                </span>
              )}
              {!focus && task.recurrence && (
                <span className="inline-flex items-center gap-1">
                  <Repeat2 size={13} aria-hidden="true" />
                  Recorrente
                </span>
              )}
              {showDeadline && !compactCompleted && <span>Prazo {deadline}</span>}
            </div>
          )}
          {focus && permissions.can_complete && (
            <Button className="mt-5" loading={completing} disabled={busy} onClick={onComplete}>
              <Check size={18} aria-hidden="true" />
              Concluir
            </Button>
          )}
        </div>
        {compactCompleted && permissions.can_reopen && onReopen && (
          <Button className="px-2" size="small" variant="ghost" loading={reopening} onClick={onReopen}>
            <RotateCcw size={14} aria-hidden="true" />
            Reabrir
          </Button>
        )}
        {!focus && administrative.length > 0 && (
          <ActionsMenu label={`Ações da tarefa: ${title}`} disabled={busy} items={administrative} />
        )}
      </div>
    </article>
  )
}
