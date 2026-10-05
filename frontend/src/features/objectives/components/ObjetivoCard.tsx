import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import ActionsMenu from "../../../components/ui/ActionsMenu"
import Button from "../../../components/ui/Button"
import SyncLabel from "../../../components/system/SyncLabel"
import ObjectiveMap from "./ObjectiveMap"
import ObjectiveNodeDetails from "./ObjectiveNodeDetails"
import { displayDate, liveMapNodes } from "../objectiveMapModel"

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
  onConquer,
  onUnlinkTask,
  onUnlinkTracker,
  onCompleteTask,
  onEditTracker,
  onDeleteTracker,
  onRecordOccurrence,
  onDeleteOccurrence,
  timezone,
}) {
  const visibleTasks = useMemo(() => (tasksEnabled ? tasks : []), [tasksEnabled, tasks])
  const nodes = useMemo(
    () => liveMapNodes(visibleTasks, trackers, timezone),
    [visibleTasks, trackers, timezone]
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pulse, setPulse] = useState(null)
  useEffect(() => {
    if (!pulse) return
    const timeout = window.setTimeout(() => setPulse(null), 1000)
    return () => window.clearTimeout(timeout)
  }, [pulse])
  const closeDetails = useCallback(() => {
    setSelectedId(null)
  }, [])
  const selected = nodes.find((node) => node.id === selectedId)
  const task = selected ? visibleTasks.find((item) => item.id === selected.source_id) : null
  const tracker = selected ? trackers.find((item) => selected.id === `tracker-${item.id}`) : null
  async function complete(task) {
    if (await onCompleteTask(task)) {
      const id =
        task.recurrence || task.recurringIntent
          ? `routine-${task.recurrence?.series_id ?? task.id}`
          : `task-${task.id}`
      setPulse({ id, key: Date.now() })
    }
  }
  async function record(tracker, withDetails = false) {
    if (await onRecordOccurrence(tracker, withDetails))
      setPulse({ id: `tracker-${tracker.id}`, key: Date.now() })
  }
  const menuItems = [
    { label: "Editar objetivo", onSelect: onEdit },
    ...(onMoveToTop ? [{ label: "Mover para o início", onSelect: onMoveToTop }] : []),
    {
      label: objetivo.status === "ativo" ? "Pausar objetivo" : "Retomar objetivo",
      onSelect: () => onUpdateStatus(objetivo.status === "ativo" ? "pausado" : "ativo"),
    },
    ...(["ativo", "pausado"].includes(objetivo.status)
      ? [
          {
            label: "Conquistar objetivo",
            onSelect: onConquer,
            disabled: Boolean(objetivo.syncStatus),
          },
        ]
      : []),
    { label: "Remover objetivo", onSelect: onDelete, danger: true, separatorBefore: true },
  ]
  return (
    <article
      id={`objetivo-${objetivo.id}`}
      aria-label={`Objetivo: ${objetivo.titulo}`}
      className="objective-workspace"
    >
      <div className="objective-workspace-toolbar">
        {objetivo.status === "pausado" && <span className="objective-paused">Pausado</span>}
        <ActionsMenu
          label={`Ações do objetivo: ${objetivo.titulo}`}
          disabled={loading}
          items={menuItems}
        />
      </div>
      <SyncLabel status={objetivo.syncStatus} />
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
      {(tasksLoading || (trackersLoading && !trackersLoaded)) && !nodes.length && (
        <p className="empty-copy">Carregando vínculos…</p>
      )}
      <ObjectiveMap
        title={objetivo.titulo}
        purpose={objetivo.descricao}
        nodes={nodes}
        timezone={timezone}
        onSelect={(node) => {
          setSelectedId(node.id)
        }}
        pulseId={pulse}
        emptyMessage={
          tasksLoading || trackersLoading || tasksError || trackersError ? null : undefined
        }
        rootMeta={
          objetivo.data_alvo ? (
            <p className="map-root-meta">Data-alvo · {displayDate(objetivo.data_alvo, timezone)}</p>
          ) : null
        }
        rootActions={
          <div className="map-root-actions">
            <Button size="small" variant="ghost" onClick={onAdd}>
              <Plus size={15} aria-hidden="true" />
              Adicionar vínculo
            </Button>
          </div>
        }
      />
      {selected && (
        <ObjectiveNodeDetails
          node={selected}
          task={task}
          tracker={tracker}
          timezone={timezone}
          onClose={closeDetails}
          onCompleteTask={complete}
          onUnlinkTask={onUnlinkTask}
          onRecordOccurrence={record}
          onEditTracker={onEditTracker}
          onUnlinkTracker={onUnlinkTracker}
          onDeleteTracker={onDeleteTracker}
          onDeleteOccurrence={onDeleteOccurrence}
          error={tasksError || trackersError}
        />
      )}
    </article>
  )
}
