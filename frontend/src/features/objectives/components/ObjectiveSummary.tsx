import React from "react"
import { CalendarDays, ListChecks, ListTodo, Wallet } from "lucide-react"
import { summarizeObjective } from "../objectiveSummary"
import LoadingLines from "../../../components/ui/LoadingLines"
export default function ObjectiveSummary({
  objetivo,
  trackers = [],
  tasks = [],
  reserves = [],
  timezone = undefined,
  trackersLoading = false,
  trackersLoaded = true,
  tasksLoading = false,
  trackersError = "",
  tasksError = "",
  onRetryTrackers = undefined,
  variant = "compact",
  tasksEnabled = true,
}) {
  const allSignals = summarizeObjective({
    objetivo,
    trackers,
    tasks: tasksEnabled ? tasks : [],
    reserves,
    timezone,
  })
  const signals =
    variant === "home"
      ? [allSignals.find((signal) => signal.kind === "reserve") || allSignals[0]].filter(Boolean)
      : allSignals
  const unavailable = (trackersError && !trackersLoaded) || (tasksError && !tasks.length)
  return (
    <div className="min-w-0">
      {signals.length > 0 ? (
        <ul aria-label={`Resumo de ${objetivo.titulo}`} className="signal-list">
          {signals.map((signal, i) => {
            const Icon = {
              tracker: ListChecks,
              task: ListTodo,
              date: CalendarDays,
              reserve: Wallet,
            }[signal.kind]
            return (
              <li key={i}>
                <Icon size={15} aria-hidden="true" />
                <span className="min-w-0">
                  <span
                    className={`break-words font-medium ${variant === "home" ? "line-clamp-1" : "block"}`}
                  >
                    {signal.label}
                  </span>
                  <span className="mt-1 block text-xs text-text-secondary">{signal.detail}</span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (trackersLoading && !trackersLoaded) || tasksLoading ? (
        <LoadingLines label="Carregando sinais" />
      ) : !unavailable && variant !== "home" ? (
        <p className="m-0 text-sm text-text-secondary">
          Uma direção pode começar sem vínculos. Adicione o que ajudar a sustentá-la.
        </p>
      ) : null}
      {unavailable && (
        <p role="status" className="text-xs text-text-secondary">
          {trackersError && !trackersLoaded
            ? "Acompanhamentos indisponíveis."
            : "Tarefas indisponíveis."}
          {onRetryTrackers && (
            <button className="text-link" onClick={onRetryTrackers}>
              Tentar novamente
            </button>
          )}
        </p>
      )}
    </div>
  )
}
