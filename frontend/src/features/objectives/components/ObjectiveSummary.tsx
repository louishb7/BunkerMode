import React from "react"
import { CalendarDays, ListChecks, ListTodo } from "lucide-react"
import { summarizeObjective } from "../objectiveSummary"

export default function ObjectiveSummary({
  variant = "compact",
  tasksEnabled = true,
  objetivo,
  trackers = [],
  tasks = [],
  timezone = undefined,
  trackersLoading = false,
  trackersError = "",
  trackersLoaded = true,
  tasksLoading = false,
  tasksError = "",
  onRetryTrackers = undefined,
}) {
  const signals = summarizeObjective({ objetivo, trackers, tasks, timezone })
  const featured = variant === "featured"
  const settled =
    !trackersLoading && !trackersError && trackersLoaded && !tasksLoading && !tasksError
  return (
    <div className="grid min-w-0 gap-3">
      {signals.length > 0 ? (
        <ul aria-label={`Resumo de ${objetivo.titulo}`} className="m-0 grid list-none gap-2 p-0">
          {signals.map((signal, index) => {
            const Icon =
              signal.kind === "tracker"
                ? ListChecks
                : signal.kind === "task"
                  ? ListTodo
                  : CalendarDays
            return (
              <li
                key={index}
                className={`flex min-w-0 items-start gap-3 text-text-secondary ${featured ? "rounded-xl bg-surface-subtle p-3 text-sm leading-5" : "text-xs leading-5"}`}
              >
                <Icon size={14} className="mt-1 shrink-0 text-text-muted" aria-hidden="true" />
                <span className="min-w-0 break-words">
                  <span
                    className="block break-words font-medium text-text-primary"
                    title={signal.label}
                  >
                    {signal.label}
                  </span>
                  <span className="mt-1 block">{signal.detail}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : settled ? (
        <div className="grid gap-2">
          {!featured && objetivo.descricao && (
            <p className="m-0 line-clamp-2 break-words text-sm leading-5 text-text-secondary">
              {objetivo.descricao}
            </p>
          )}
          <p className="m-0 text-sm leading-6 text-text-secondary">
            {featured
              ? `Ainda sem sinais. Adicione um acompanhamento${tasksEnabled ? " ou uma tarefa vinculada" : ""} para dar contexto a este objetivo.`
              : "Sem sinais disponíveis neste resumo."}
          </p>
        </div>
      ) : null}
      {trackersError ? (
        <div role="status" className="text-xs leading-5 text-text-secondary">
          Acompanhamentos indisponíveis. {trackersLoaded ? "Exibindo dados anteriores. " : ""}
          {trackersError}
          {onRetryTrackers && (
            <button
              type="button"
              onClick={onRetryTrackers}
              className="ml-1 min-h-6 rounded-control border-0 bg-transparent px-1 text-xs text-text-primary underline focus-visible:outline-2 focus-visible:outline-focus-ring"
            >
              Tentar novamente
            </button>
          )}
        </div>
      ) : trackersLoading ? (
        <p role="status" className="m-0 text-xs text-text-muted">
          {trackersLoaded
            ? "Atualizando acompanhamentos… Dados anteriores visíveis."
            : "Carregando acompanhamentos…"}
        </p>
      ) : null}
      {tasksError ? (
        <p role="status" className="m-0 text-xs text-text-secondary">
          Tarefas indisponíveis. {tasks.length > 0 ? "Exibindo dados anteriores. " : ""}
          {tasksError}
        </p>
      ) : tasksLoading ? (
        <p role="status" className="m-0 text-xs text-text-muted">
          Carregando tarefas…
        </p>
      ) : null}
    </div>
  )
}
