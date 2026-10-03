import React from "react"
import { CalendarDays, Circle, ListChecks, Plus } from "lucide-react"
import { Link } from "react-router-dom"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Button from "../../../components/ui/Button"
import ObjectiveStatus from "./ObjectiveStatus"
import { trackerOccurrenceLabel } from "../objectiveSummary"
import { normalizeTaskDate, operationalDateFor } from "../../calendar/calendarUtils"
import { formatDateForApi } from "../../../utils/date"
import SyncLabel from "../../../components/system/SyncLabel"

function taskRelationSignal(task, timezone) {
  if (task.status === "CONCLUIDA") return "Concluída"
  if (task.status_code === "NAO_REALIZADA") return "Não realizada"
  const date = normalizeTaskDate(task.prazo)
  if (date && date === formatDateForApi(operationalDateFor(timezone))) return "Hoje"
  if (date) return `Prevista para ${date.replaceAll("-", "/")}`
  return task.recurrence ? "Recorrente" : "Em aberto"
}

export default function ObjetivoCard({
  objetivo,
  tasksEnabled,
  tasks = [],
  tasksLoading,
  tasksError,
  onRetryTasks,
  trackers = [],
  trackersLoading,
  trackersError,
  trackersLoaded,
  onRetryTrackers,
  loading,
  onAdd,
  onDelete,
  onEdit,
  onMoveToTop,
  onUpdateStatus,
  onUnlinkTask,
  unlinkingId,
  onUnlinkTracker,
  onCompleteTask,
  trackerBusyId,
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
  const menuItems = [
    { label: "Editar objetivo", onSelect: onEdit },
    ...(onMoveToTop ? [{ label: "Mover para o início", onSelect: onMoveToTop }] : []),
    ...(objetivo.status === "ativo"
      ? [{ label: "Pausar objetivo", onSelect: () => onUpdateStatus("pausado") }]
      : [{ label: "Retomar objetivo", onSelect: () => onUpdateStatus("ativo") }]),
    ...(objetivo.status === "ativo" || objetivo.status === "pausado"
      ? [{ label: "Concluir objetivo", onSelect: () => onUpdateStatus("concluido") }]
      : []),
    { label: "Remover objetivo", onSelect: onDelete, danger: true },
  ]
  const date = normalizeTaskDate(objetivo.data_alvo)
  return (
    <article
      id={`objetivo-${objetivo.id}`}
      aria-label={`Objetivo: ${objetivo.titulo}`}
      className="relationship-workspace"
    >
      <div className={`objective-nucleus objective-nucleus-${objetivo.status}`}>
        <div className="objective-nucleus-top">
          <ObjectiveStatus status={objetivo.status} />
          <ActionsMenu
            label={`Ações do objetivo: ${objetivo.titulo}`}
            disabled={loading}
            items={menuItems}
          />
        </div>
        <h2>{objetivo.titulo}</h2>
        <SyncLabel status={objetivo.syncStatus} />
        {objetivo.descricao && <p className="objective-description">{objetivo.descricao}</p>}
        {date && (
          <p className="objective-date">
            <CalendarDays size={14} aria-hidden="true" /> Data-alvo · {date.replaceAll("-", "/")}
          </p>
        )}
      </div>
      <div className="objective-connection" aria-hidden="true" />
      <section
        className="objective-branches"
        aria-label={`Relações do objetivo ${objetivo.titulo}`}
      >
        <div className="objective-branches-heading">
          <h3>
            Relações <span>{trackers.length + (tasksEnabled ? tasks.length : 0)}</span>
          </h3>
          <Button variant="ghost" size="small" onClick={onAdd}>
            <Plus size={16} aria-hidden="true" /> Adicionar vínculo
          </Button>
        </div>
        {tasksEnabled && tasksError && (
          <p role="status" className="text-danger text-sm">
            {tasksError}{" "}
            <Button variant="ghost" onClick={onRetryTasks}>
              Tentar novamente
            </Button>
          </p>
        )}
        {trackersError && (
          <p role="status" className="text-danger text-sm">
            {trackersError}{" "}
            <Button variant="ghost" onClick={onRetryTrackers}>
              Tentar novamente
            </Button>
          </p>
        )}
        {(tasksLoading || (trackersLoading && !trackersLoaded)) &&
          !tasks.length &&
          !trackers.length && <p className="empty-copy">Carregando relações…</p>}
        {!tasks.length &&
          !trackers.length &&
          !tasksLoading &&
          !trackersLoading &&
          !tasksError &&
          !trackersError && (
            <p className="objective-empty">
              Nenhuma relação ainda. Adicione uma tarefa ou um acompanhamento a esta direção.
            </p>
          )}
        <ul className="objective-branch-list">
          {tasksEnabled &&
            tasks.map((task) => (
              <li className="objective-branch" key={`task-${task.id}`}>
                <details>
                  <summary>
                    <Circle size={18} aria-hidden="true" />
                    <span className="objective-branch-copy">
                      <small>{task.recurrence ? "Tarefa recorrente" : "Tarefa"}</small>
                      <strong>{task.titulo}</strong>
                      <em>{taskRelationSignal(task, timezone)}</em>
                    </span>
                  </summary>
                  <div className="objective-inspector">
                    {task.instrucao && <p>{task.instrucao}</p>}
                    <div className="objective-inspector-actions">
                      <Link className="text-link" to="/tarefas">
                        Abrir em Tarefas
                      </Link>
                      {task.permissions?.can_complete && (
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={unlinkingId === task.id}
                          onClick={() => onCompleteTask(task)}
                        >
                          Concluir tarefa
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={unlinkingId === task.id}
                        onClick={() => onUnlinkTask(task)}
                      >
                        Desvincular
                      </Button>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          {trackers.map((tracker) => (
            <li className="objective-branch" key={`tracker-${tracker.id}`}>
              <details>
                <summary>
                  <ListChecks size={18} aria-hidden="true" />
                  <span className="objective-branch-copy">
                    <small>Acompanhamento</small>
                    <strong>{tracker.titulo}</strong>
                    <em>{trackerOccurrenceLabel(tracker, timezone)}</em>
                  </span>
                </summary>
                <div className="objective-inspector">
                  {tracker.descricao && <p>{tracker.descricao}</p>}
                  <div className="objective-inspector-actions">
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={trackerBusyId === tracker.id}
                      onClick={() => onRecordOccurrence(tracker)}
                    >
                      Registrar ocorrência
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => onEditTracker(tracker)}>
                      Editar
                    </Button>
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={trackerBusyId === tracker.id}
                      onClick={() => onUnlinkTracker(tracker)}
                    >
                      Desvincular
                    </Button>
                    <Button size="small" variant="ghost" onClick={() => onDeleteTracker(tracker)}>
                      Excluir
                    </Button>
                  </div>
                  {tracker.ocorrencias?.length > 0 && (
                    <ol className="objective-occurrences">
                      {tracker.ocorrencias.slice(0, 5).map((event) => (
                        <li key={event.id}>
                          <span>
                            {new Date(event.occurred_at).toLocaleString("pt-BR", {
                              timeZone: timezone,
                            })}
                          </span>
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => onDeleteOccurrence(tracker, event)}
                          >
                            Remover ocorrência
                          </Button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </article>
  )
}
