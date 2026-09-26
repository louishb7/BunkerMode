import React from "react"
import { Check, Circle, ListChecks, Wallet } from "lucide-react"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Button from "../../../components/ui/Button"
import LoadingLines from "../../../components/ui/LoadingLines"
import { trackerOccurrenceLabel } from "../objectiveSummary"
import { reserveSignal } from "../../finances/money"

export default function ObjectiveOperationalPanel({
  tasksEnabled,
  tasks = [],
  tasksLoading = false,
  tasksError = "",
  onRetryTasks = undefined,
  onUnlinkTask = undefined,
  onCompleteTask = undefined,
  unlinkingId = null,
  objetivo,
  trackers = [],
  trackersLoading,
  trackersLoaded,
  trackerBusyId,
  onEditTracker,
  onDeleteTracker,
  onUnlinkTracker = undefined,
  onRecordOccurrence,
  onDeleteOccurrence,
  reserves = [],
  onEditReserve = undefined,
  onUnlinkReserve = undefined,
  timezone,
}) {
  return (
    <div className="objective-links" aria-label={`Vínculos de ${objetivo.titulo}`}>
      {trackersLoading && !trackersLoaded && <LoadingLines label="Carregando vínculos" />}
      {tasksEnabled && tasksLoading && !tasks.length && <LoadingLines label="Carregando tarefas" />}
      {tasksEnabled && tasksError && (
        <p role="status" className="text-sm text-danger">
          {tasksError}{" "}
          <Button variant="ghost" onClick={onRetryTasks}>
            Tentar novamente
          </Button>
        </p>
      )}
      <ul className="m-0 list-none p-0">
        {trackers.map((tracker) => (
          <li className="objective-link" key={`tracker-${tracker.id}`}>
            <ListChecks size={18} className="mt-1 text-text-muted" aria-hidden="true" />
            <div className="min-w-0">
              <span className="eyebrow">Acompanhamento</span>
              <h4>{tracker.titulo}</h4>
              <p>{trackerOccurrenceLabel(tracker, timezone)}</p>
              <details className="mt-3 text-xs text-text-secondary">
                <summary className="min-h-9 cursor-pointer">
                  Registrar e consultar ocorrências
                </summary>
                {tracker.descricao && <p className="whitespace-pre-line">{tracker.descricao}</p>}
                <Button
                  size="small"
                  variant="secondary"
                  disabled={trackerBusyId === tracker.id}
                  onClick={() => onRecordOccurrence(tracker)}
                >
                  Registrar ocorrência
                </Button>
                {tracker.ocorrencias?.length > 0 && (
                  <ol className="m-0 list-none p-0">
                    {tracker.ocorrencias.slice(0, 5).map((event) => (
                      <li
                        className="flex flex-wrap items-center justify-between gap-2"
                        key={event.id}
                      >
                        <span>
                          {new Date(event.occurred_at).toLocaleString("pt-BR", {
                            timeZone: timezone,
                          })}
                        </span>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={trackerBusyId === tracker.id}
                          onClick={() => onDeleteOccurrence(tracker, event)}
                        >
                          Remover ocorrência
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
              </details>
            </div>
            <ActionsMenu
              label={`Ações do acompanhamento: ${tracker.titulo}`}
              disabled={trackerBusyId === tracker.id}
              items={[
                { label: "Editar acompanhamento", onSelect: () => onEditTracker(tracker) },
                ...(onUnlinkTracker
                  ? [{ label: "Desvincular do objetivo", onSelect: () => onUnlinkTracker(tracker) }]
                  : []),
                {
                  label: "Excluir acompanhamento",
                  onSelect: () => onDeleteTracker(tracker),
                  danger: true,
                },
              ]}
            />
          </li>
        ))}
        {tasksEnabled &&
          tasks.map((task) => (
            <li className="objective-link" key={`task-${task.id}`}>
              {task.status === "CONCLUIDA" ? (
                <Check size={18} className="mt-1 text-text-muted" />
              ) : (
                <Circle size={18} className="mt-1 text-text-muted" />
              )}
              <div className="min-w-0">
                <span className="eyebrow">{task.recurrence ? "Tarefa recorrente" : "Tarefa"}</span>
                <h4>{task.titulo}</h4>
                <p>
                  {task.status_label ||
                    (task.status === "CONCLUIDA"
                      ? "Concluída"
                      : task.status_code === "NAO_REALIZADA"
                        ? "Não realizada"
                        : "Pendente")}
                </p>
                {task.permissions?.can_complete && onCompleteTask && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={unlinkingId === task.id}
                    onClick={() => onCompleteTask(task)}
                  >
                    Concluir tarefa
                  </Button>
                )}
                <a className="text-link" href="/tarefas">
                  Abrir em Tarefas
                </a>
              </div>
              <ActionsMenu
                label={`Ações da tarefa: ${task.titulo}`}
                disabled={unlinkingId === task.id}
                items={[{ label: "Desvincular do objetivo", onSelect: () => onUnlinkTask(task) }]}
              />
            </li>
          ))}
        {reserves.map((reserve) => (
          <li className="objective-link" key={`reserve-${reserve.id}`}>
            <Wallet size={18} className="mt-1 text-accent" />
            <div className="min-w-0">
              <span className="eyebrow">Reserva financeira</span>
              <h4>{reserve.titulo}</h4>
              <p>{reserveSignal(reserve)}</p>
              <a className="text-link" href={`/financas#reserva-${reserve.id}`}>
                Abrir em Finanças
              </a>
            </div>
            <ActionsMenu
              label={`Ações da reserva: ${reserve.titulo}`}
              items={[
                { label: "Editar reserva", onSelect: () => onEditReserve(reserve) },
                { label: "Desvincular do objetivo", onSelect: () => onUnlinkReserve(reserve) },
              ]}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
