import React, { useEffect, useId, useRef, useState } from "react"
import { CalendarDays, Check, ChevronDown } from "lucide-react"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import ObjectiveStatus from "./ObjectiveStatus"
import ObjectiveOperationalPanel from "./ObjectiveOperationalPanel"

import Button from "../../../components/ui/Button"
import ObjectiveSummary from "./ObjectiveSummary"
import { normalizeTaskDate } from "../../calendar/calendarUtils"

function formatDateOnly(value, fallback) {
  const normalized = normalizeTaskDate(value)
  if (!/^\d{2}-\d{2}-\d{4}$/.test(normalized)) {
    return fallback
  }

  const [day, month, year] = normalized.split("-")
  return `${day}/${month}/${year}`
}

export default function ObjetivoCard({
  tasksEnabled,
  loading,
  tasks,
  summaryTasks = tasks,
  tasksLoading,
  tasksError,
  onRetryTasks,
  objetivo,
  onCreateTask,
  onDelete,
  onEdit,
  onMoveToTop,
  onUpdateStatus,
  onUnlinkTask,
  unlinkingId,
  trackers = [],
  trackersLoading = false,
  trackersError = "",
  trackersLoaded = true,
  onRetryTrackers = undefined,
  trackerBusyId = null,
  onCreateTracker,
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const [descriptionClipped, setDescriptionClipped] = useState(false)
  const descriptionRef = useRef<HTMLParagraphElement | null>(null)
  const descriptionId = useId()
  useEffect(() => {
    if (descriptionExpanded || !objetivo.descricao) return
    const checkClipping = () => {
      const element = descriptionRef.current
      if (element) setDescriptionClipped(element.scrollHeight > element.clientHeight + 1)
    }
    checkClipping()
    window.addEventListener("resize", checkClipping)
    return () => window.removeEventListener("resize", checkClipping)
  }, [descriptionExpanded, objetivo.descricao])
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
    <article
      id={`objetivo-${objetivo.id}`}
      aria-label={`Objetivo: ${objetivo.titulo}`}
      className="work-surface min-w-0 scroll-mt-6"
    >
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <header className="min-w-0 p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <ObjectiveStatus status={objetivo.status} />
            <ActionsMenu
              label={`Ações do objetivo: ${objetivo.titulo}`}
              disabled={loading}
              items={menuItems}
            />
          </div>
          <h2 className="m-0 break-words text-2xl font-semibold leading-tight tracking-tight text-text-primary sm:text-[28px]">
            {objetivo.titulo}
          </h2>
          {objetivo.descricao && (
            <p
              ref={descriptionRef}
              id={descriptionId}
              className={`mt-3 mb-0 whitespace-pre-line break-words text-sm leading-6 text-text-secondary ${descriptionExpanded ? "" : "line-clamp-3"}`}
            >
              {objetivo.descricao}
            </p>
          )}
          {(descriptionClipped || descriptionExpanded) && objetivo.descricao && (
            <button
              type="button"
              aria-expanded={descriptionExpanded}
              aria-controls={descriptionId}
              className="mt-1 min-h-9 rounded-control border-0 bg-transparent px-0 text-xs font-medium text-text-secondary underline hover:text-text-primary"
              onClick={() => setDescriptionExpanded((expanded) => !expanded)}
            >
              {descriptionExpanded ? "Recolher descrição" : "Ler descrição completa"}
            </button>
          )}
          {targetDate && (
            <p className="mt-4 mb-0 flex items-center gap-2 text-xs text-text-secondary">
              <CalendarDays size={14} aria-hidden="true" />
              Data-alvo: {targetDate}
            </p>
          )}
        </header>
        <section
          aria-label={`Sinais de ${objetivo.titulo}`}
          className="min-w-0 border-t border-border p-4 sm:p-6 md:border-t-0 md:border-l"
        >
          <h3 className="mt-0 mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
            Sinais atuais
          </h3>
          <ObjectiveSummary
            objetivo={objetivo}
            trackers={trackers}
            tasks={tasksEnabled ? summaryTasks : []}
            timezone={timezone}
            trackersLoading={trackersLoading}
            trackersError={trackersError}
            trackersLoaded={trackersLoaded}
            onRetryTrackers={onRetryTrackers}
            tasksLoading={tasksEnabled && tasksLoading}
            tasksError={tasksEnabled ? tasksError : ""}
            variant="featured"
            tasksEnabled={tasksEnabled}
          />
        </section>
      </div>
      <details className="group/operations border-t border-border">
        <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-control px-4 py-3 text-sm font-medium text-text-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus-ring sm:px-6 [&::-webkit-details-marker]:hidden">
          <span>Acompanhamentos{tasksEnabled ? " e tarefas" : ""}</span>
          <span className="flex items-center gap-2 text-xs">
            <span className="group-open/operations:hidden">Abrir detalhes</span>
            <span className="hidden group-open/operations:inline">Recolher detalhes</span>
            <ChevronDown
              size={16}
              className="group-open/operations:rotate-180"
              aria-hidden="true"
            />
          </span>
        </summary>
        <ObjectiveOperationalPanel
          {...{
            tasksEnabled,
            tasks,
            tasksLoading,
            tasksError,
            onRetryTasks,
            objetivo,
            onCreateTask,
            onUnlinkTask,
            unlinkingId,
            trackers,
            trackersLoading,
            trackersError,
            trackersLoaded,
            trackerBusyId,
            onCreateTracker,
            onEditTracker,
            onDeleteTracker,
            onRecordOccurrence,
            onDeleteOccurrence,
            timezone,
          }}
        />
        {objetivo.status !== "concluido" && objetivo.status !== "abandonado" && (
          <footer className="flex justify-end border-t border-border px-4 py-3 sm:px-6">
            <Button
              disabled={loading}
              size="small"
              variant="ghost"
              onClick={() => onUpdateStatus("concluido")}
            >
              <Check size={16} aria-hidden="true" />
              Concluir objetivo
            </Button>
          </footer>
        )}
      </details>
    </article>
  )
}
