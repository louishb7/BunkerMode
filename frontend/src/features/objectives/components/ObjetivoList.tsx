import React from "react"

import EmptyState from "../../../components/ui/EmptyState"
import ObjetivoCard from "./ObjetivoCard"

export default function ObjetivoList({
  tasksEnabled,
  loading,
  tasksByObjetivo,
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
  trackerBusyId,
  onCreateTracker,
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
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
      {objetivos.map((objetivo, index) => (
        <ObjetivoCard
          tasksEnabled={tasksEnabled}
          key={objetivo.id}
          loading={loading}
          tasks={tasksByObjetivo[String(objetivo.id)] || []}
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
          trackerBusyId={trackerBusyId}
          onCreateTracker={() => onCreateTracker(objetivo)}
          onEditTracker={onEditTracker}
          onDeleteTracker={onDeleteTracker}
          onRecordOccurrence={onRecordOccurrence}
          onDeleteOccurrence={onDeleteOccurrence}
          timezone={timezone}
        />
      ))}
    </div>
  )
}
