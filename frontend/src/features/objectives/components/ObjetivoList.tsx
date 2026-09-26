import React, { useEffect, useState } from "react"
import LoadingLines from "../../../components/ui/LoadingLines"
import EmptyState from "../../../components/ui/EmptyState"
import ObjetivoCard from "./ObjetivoCard"

const labels = {
  ativo: "Em andamento",
  pausado: "Pausados",
  concluido: "Encerrados",
  abandonado: "Encerrados",
}
const statusOrder = { ativo: 0, pausado: 1, concluido: 2, abandonado: 3 }

export default function ObjetivoList({
  onAdd,
  onUnlinkTracker,
  onCompleteTask,
  objectivesLoading = false,
  objectivesError = "",
  tasksEnabled,
  loading,
  tasksByObjetivo,
  tasksLoading,
  tasksError,
  onRetryTasks,
  objetivos,
  onCreate,
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
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
  const fromHash = () => Number(window.location.hash.match(/^#objetivo-(\d+)$/)?.[1]) || null
  const [selectedId, setSelectedId] = useState(fromHash)
  useEffect(() => {
    const update = () => setSelectedId(fromHash())
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])
  if (!objetivos.length && objectivesLoading) return <LoadingLines label="Carregando objetivos" />
  if (!objetivos.length && objectivesError) return null
  if (!objetivos.length)
    return (
      <EmptyState
        actionLabel="Criar objetivo"
        message="Crie um objetivo para definir o que você quer alcançar."
        onAction={onCreate}
        title="Nenhum objetivo ainda"
      />
    )
  const ordered = [...objetivos].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] || a.order_index - b.order_index || a.id - b.id
  )
  const selected = ordered.find((item) => item.id === selectedId) || ordered[0]
  const activeIndex = ordered
    .filter((item) => item.status === "ativo")
    .findIndex((item) => item.id === selected.id)
  const select = (id) => {
    setSelectedId(id)
    window.history.replaceState(null, "", `#objetivo-${id}`)
  }
  return (
    <div className="objective-layout">
      <nav className="objective-rail" aria-label="Selecionar objetivo">
        <p className="objective-rail-title">
          Suas direções <span>{ordered.length}</span>
        </p>
        <div className="objective-rail-items">
          {ordered.map((item, index) => (
            <React.Fragment key={item.id}>
              {(index === 0 || labels[item.status] !== labels[ordered[index - 1].status]) && (
                <p className="objective-rail-group">{labels[item.status]}</p>
              )}
              <button
                type="button"
                className="objective-rail-item"
                aria-current={selected.id === item.id ? "true" : undefined}
                onClick={() => select(item.id)}
              >
                <span className="objective-rail-dot" aria-hidden="true" />
                <span>{item.titulo}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      </nav>
      <ObjetivoCard
        key={selected.id}
        objetivo={selected}
        tasksEnabled={tasksEnabled}
        tasks={tasksByObjetivo[String(selected.id)] || []}
        tasksLoading={tasksLoading}
        tasksError={tasksError}
        onRetryTasks={onRetryTasks}
        trackers={trackersByObjective[String(selected.id)] || []}
        trackersLoading={trackersLoading}
        trackersError={trackersError}
        trackersLoaded={trackersLoaded}
        onRetryTrackers={onRetryTrackers}
        loading={loading}
        onAdd={() => onAdd(selected)}
        onDelete={() => onDelete(selected)}
        onEdit={() => onEdit(selected)}
        onMoveToTop={activeIndex > 0 ? () => onMoveToTop(selected.id) : null}
        onUpdateStatus={(status) => onUpdateStatus(selected.id, status)}
        onUnlinkTask={onUnlinkTask}
        unlinkingId={unlinkingId}
        onUnlinkTracker={onUnlinkTracker}
        onCompleteTask={onCompleteTask}
        trackerBusyId={trackerBusyId}
        onEditTracker={onEditTracker}
        onDeleteTracker={onDeleteTracker}
        onRecordOccurrence={onRecordOccurrence}
        onDeleteOccurrence={onDeleteOccurrence}
        timezone={timezone}
      />
    </div>
  )
}
