import React from "react"

import LoadingLines from "../../../components/ui/LoadingLines"
import EmptyState from "../../../components/ui/EmptyState"
import ObjetivoCard from "./ObjetivoCard"

export default function ObjetivoList({
  onAdd = undefined,
  reserves = [],
  onEditReserve = undefined,
  onUnlinkReserve = undefined,
  onUnlinkTracker = undefined,
  onCompleteTask = undefined,
  objectivesLoading = false,
  objectivesError = "",
  tasksEnabled,
  loading,
  tasksByObjetivo,
  summaryTasksByObjetivo = tasksByObjetivo,
  tasksLoading,
  tasksError,
  onRetryTasks,
  objetivos,
  onCreate,
  onCreateTask,
  onDelete,
  onEdit,
  onMoveToTop,
  onUpdateStatus,
  onUnlinkTask,
  unlinkingId,
  trackersByObjective = {},
  trackersLoading,
  trackersError,
  trackersLoaded,
  onRetryTrackers,
  trackerBusyId,
  onCreateTracker,
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
  if (objetivos.length === 0 && objectivesLoading)
    return <LoadingLines label="Carregando objetivos" />
  if (objetivos.length === 0 && objectivesError) return null
  if (objetivos.length === 0) {
    return (
      <EmptyState
        actionLabel="Criar objetivo"
        message="Crie um objetivo para definir o que você quer alcançar."
        onAction={onCreate}
        title="Nenhum objetivo ainda"
      />
    )
  }

  return (
    <div className="grid gap-5">
      {[
        { label: "Em andamento", states: ["ativo"] },
        { label: "Pausados", states: ["pausado"] },
        { label: "Encerrados", states: ["concluido", "abandonado"] },
      ].map((group) => {
        const items = objetivos.filter((objetivo) => group.states.includes(objetivo.status))
        if (!items.length) return null
        return (
          <section key={group.label} aria-label={group.label} className="grid gap-4">
            <p className="m-0 text-sm font-medium text-text-secondary">
              {group.label} <span className="ml-1 text-text-muted">{items.length}</span>
            </p>
            {items.map((objetivo, index) => (
              <ObjetivoCard
                onAdd={onAdd ? () => onAdd(objetivo) : undefined}
                reserves={reserves.filter((r) => r.objetivo_id === objetivo.id)}
                onEditReserve={onEditReserve}
                onUnlinkReserve={onUnlinkReserve}
                onUnlinkTracker={onUnlinkTracker}
                onCompleteTask={onCompleteTask}
                tasksEnabled={tasksEnabled}
                key={objetivo.id}
                loading={loading}
                tasks={tasksByObjetivo[String(objetivo.id)] || []}
                summaryTasks={summaryTasksByObjetivo[String(objetivo.id)] || []}
                tasksLoading={tasksLoading}
                tasksError={tasksError}
                onRetryTasks={onRetryTasks}
                objetivo={objetivo}
                onCreateTask={() => onCreateTask(objetivo)}
                onDelete={() => onDelete(objetivo)}
                onEdit={() => onEdit(objetivo)}
                onMoveToTop={index > 0 ? () => onMoveToTop(objetivo.id) : null}
                onUpdateStatus={(status) => onUpdateStatus(objetivo.id, status)}
                onUnlinkTask={onUnlinkTask}
                unlinkingId={unlinkingId}
                trackers={trackersByObjective[String(objetivo.id)] || []}
                trackersLoading={trackersLoading}
                trackersError={trackersError}
                trackersLoaded={trackersLoaded}
                onRetryTrackers={onRetryTrackers}
                trackerBusyId={trackerBusyId}
                onCreateTracker={() => onCreateTracker(objetivo)}
                onEditTracker={onEditTracker}
                onDeleteTracker={onDeleteTracker}
                onRecordOccurrence={onRecordOccurrence}
                onDeleteOccurrence={onDeleteOccurrence}
                timezone={timezone}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}
