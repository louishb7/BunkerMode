import ObjectiveOperationalPanel from "../components/ObjectiveOperationalPanel"
import ObjectiveLinkComposer from "../components/ObjectiveLinkComposer"
import { Plus } from "lucide-react"
import React, { useEffect, useState } from "react"

import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import Button from "../../../components/ui/Button"
import Dialog from "../../../components/ui/Dialog"
import PageHeader from "../../../components/ui/PageHeader"
import StatusNotice from "../../../components/ui/StatusNotice"
import OfflineNotice from "../../../components/system/OfflineNotice"
import { emptyStatus } from "../../../constants/uiState"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import TaskForm from "../../tasks/components/TaskForm"
import ObjetivoForm from "../components/ObjetivoForm"
import ObjetivoList from "../components/ObjetivoList"
import { useObjectives } from "../hooks/useObjectives"
import { useObjectiveTasks } from "../hooks/useObjectiveTasks"
import { useTrackers } from "../hooks/useTrackers"
import TrackerForm from "../components/TrackerForm"
import AchievementGallery from "../components/AchievementGallery"
import AchievementDetails from "../components/AchievementDetails"
import ConquerObjectiveDialog from "../components/ConquerObjectiveDialog"
import { useAchievements } from "../hooks/useAchievements"
import "../objectives.css"

export default function ObjectivesPage({ onUnauthorized, token, user }) {
  const objectives = useObjectives({ onUnauthorized, token, ownerId: user.id })
  const achievements = useAchievements({ onUnauthorized, token, ownerId: user.id })
  const [context, setContext] = useState(
    window.location.hash.startsWith("#conquista") ? "achievements" : "active"
  )
  const [memoryId, setMemoryId] = useState(
    Number(window.location.hash.match(/^#conquista-(\d+)$/)?.[1]) || null
  )
  const [conquerTarget, setConquerTarget] = useState(null)
  const memory = achievements.achievements.find((item) => item.id === memoryId)
  const conqueredIds = new Set(achievements.achievements.map((item) => item.objetivo_id))
  const ongoing = objectives.objetivos.filter(
    (item) => item.status !== "concluido" && !conqueredIds.has(item.id)
  )
  useEffect(() => {
    const update = () => {
      setContext(window.location.hash.startsWith("#conquista") ? "achievements" : "active")
      setMemoryId(Number(window.location.hash.match(/^#conquista-(\d+)$/)?.[1]) || null)
    }
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])
  function selectContext(next) {
    setContext(next)
    setMemoryId(null)
    window.history.replaceState(null, "", next === "achievements" ? "#conquistas" : "#em-andamento")
  }
  function openMemory(achievement) {
    setConquerTarget(null)
    setContext("achievements")
    setMemoryId(achievement.id)
    window.history.replaceState(null, "", `#conquista-${achievement.id}`)
  }
  const tasksEnabled = getEnabledModules(user).some((module) => module.key === "tasks")
  const objectiveTasks = useObjectiveTasks({
    token,
    ownerId: user.id,
    onUnauthorized,
    enabled: tasksEnabled,
  })
  const trackers = useTrackers({ token, ownerId: user.id, onUnauthorized })
  const secondaryTrackerGroups = [
    {
      title: "Acompanhamentos sem objetivo",
      copy: "Seus registros permanecem aqui. Você pode vinculá-los novamente ao adicionar a um objetivo.",
      items: trackers.trackers.filter((item) => item.objetivo_id === null),
    },
    {
      title: "Acompanhamentos de objetivos conquistados",
      copy: "Os registros atuais continuam disponíveis. Novas ocorrências preservam a memória da conquista.",
      items: trackers.trackers.filter(
        (item) =>
          item.objetivo_id !== null &&
          (conqueredIds.has(item.objetivo_id) ||
            objectives.objetivos.some(
              (goal) => goal.id === item.objetivo_id && goal.status === "concluido"
            ))
      ),
    },
  ].filter((group) => group.items.length)
  const [addingTo, setAddingTo] = useState(null)
  const [linkType, setLinkType] = useState("task")
  const [linkSearch, setLinkSearch] = useState("")
  const [editingObjetivo, setEditingObjetivo] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [taskObjetivo, setTaskObjetivo] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [trackerForm, setTrackerForm] = useState(null)
  const [deleteTrackerTarget, setDeleteTrackerTarget] = useState(null)
  const [unlinkTarget, setUnlinkTarget] = useState(null)
  const busy = objectives.loading || objectives.mutating

  function openCreateObjective() {
    setEditingObjetivo(null)
    setFormOpen(true)
  }

  function closeObjectiveForm() {
    setFormOpen(false)
    setEditingObjetivo(null)
  }

  async function submitObjetivo(payload) {
    const saved = editingObjetivo
      ? await objectives.updateObjetivo(editingObjetivo.id, payload)
      : await objectives.createObjetivo(payload)
    if (saved) {
      closeObjectiveForm()
    }
  }

  async function createTask(payload) {
    const saved = await objectiveTasks.createTask(payload)
    if (saved) {
      setTaskObjetivo(null)
    }
  }

  async function submitTracker(payload) {
    if (!trackerForm) return
    const saved = trackerForm.tracker
      ? await trackers.updateTracker(trackerForm.tracker, payload)
      : await trackers.createTracker({ ...payload, objetivo_id: trackerForm.objetivo.id })
    if (saved) setTrackerForm(null)
  }

  function moveObjetivoToTop(objetivoId) {
    const reordered = [...objectives.objetivos]
    const index = reordered.findIndex((objetivo) => objetivo.id === objetivoId)
    if (index <= 0) {
      return
    }
    const [selected] = reordered.splice(index, 1)
    reordered.unshift(selected)
    objectives.reorderObjetivos(reordered.map((objetivo) => objetivo.id))
  }

  return (
    <section className="objectives-page mx-auto grid max-w-[1200px] gap-5">
      <PageHeader
        actions={
          <Button variant="secondary" disabled={busy} onClick={openCreateObjective}>
            <Plus size={17} aria-hidden="true" />
            Novo objetivo
          </Button>
        }
        title="Objetivos"
      />

      <OfflineNotice updatedAt={objectives.lastUpdated ?? trackers.lastUpdated} />

      <StatusNotice status={objectives.status} />
      <StatusNotice status={trackers.status} />

      <nav className="objective-contexts" aria-label="Contextos dos objetivos">
        <button
          type="button"
          aria-pressed={context === "active"}
          onClick={() => selectContext("active")}
        >
          Em andamento <span>{ongoing.length}</span>
        </button>
        <button
          type="button"
          aria-pressed={context === "achievements"}
          onClick={() => selectContext("achievements")}
        >
          Conquistas <span>{achievements.achievements.length}</span>
        </button>
      </nav>

      {formOpen && (
        <Dialog
          closeOnBackdrop={false}
          onClose={closeObjectiveForm}
          title={editingObjetivo ? "Editar objetivo" : "Novo objetivo"}
        >
          <ObjetivoForm
            editingObjetivo={editingObjetivo}
            loading={busy}
            onCancel={closeObjectiveForm}
            onSubmit={submitObjetivo}
          />
        </Dialog>
      )}

      {context === "active" && (
        <ObjetivoList
          onAdd={(goal) => {
            setLinkType(tasksEnabled && goal.status === "ativo" ? "task" : "tracker")
            setLinkSearch("")
            setAddingTo(goal)
          }}
          onUnlinkTracker={(tracker) => trackers.updateTracker(tracker, { objetivo_id: null })}
          onCompleteTask={(task) => objectiveTasks.operateTask(task)}
          tasksEnabled={tasksEnabled}
          loading={busy}
          objectivesLoading={objectives.loading}
          objectivesError={objectives.status.type === "error" ? objectives.status.message : ""}
          tasksByObjetivo={objectiveTasks.summaryTasksByObjetivo}
          tasksLoading={objectiveTasks.loading}
          tasksError={objectiveTasks.error}
          onRetryTasks={objectiveTasks.refresh}
          objetivos={ongoing}
          onCreate={openCreateObjective}
          onDelete={setDeleteTarget}
          onEdit={(objetivo) => {
            setEditingObjetivo(objetivo)
            setFormOpen(true)
          }}
          onMoveToTop={moveObjetivoToTop}
          onUpdateStatus={objectives.updateObjetivoStatus}
          onConquer={(goal) => {
            achievements.clearError()
            setConquerTarget(goal)
          }}
          onUnlinkTask={setUnlinkTarget}
          trackersByObjective={trackers.byObjective}
          trackersLoading={trackers.loading}
          trackersError={trackers.error}
          trackersLoaded={trackers.loaded}
          onRetryTrackers={trackers.refresh}
          onEditTracker={(tracker) =>
            setTrackerForm({
              objetivo: objectives.objetivos.find((item) => item.id === tracker.objetivo_id),
              tracker,
            })
          }
          onDeleteTracker={setDeleteTrackerTarget}
          onRecordOccurrence={trackers.recordOccurrence}
          onDeleteOccurrence={trackers.deleteOccurrence}
          timezone={user?.timezone}
        />
      )}
      {context === "achievements" &&
        (memory ? (
          <AchievementDetails
            key={memory.id}
            achievement={memory}
            onBack={() => selectContext("achievements")}
          />
        ) : (
          <AchievementGallery
            achievements={achievements.achievements}
            onSelect={openMemory}
            loading={achievements.loading}
            error={achievements.error}
            onRetry={achievements.refresh}
            timezone={user?.timezone}
          />
        ))}

      {conquerTarget && (
        <ConquerObjectiveDialog
          objetivo={conquerTarget}
          timezone={user?.timezone}
          saving={achievements.saving}
          error={achievements.error}
          onClose={() => setConquerTarget(null)}
          onOpenMemory={openMemory}
          onConquer={async (note) => {
            const result = await achievements.conquer(conquerTarget.id, note)
            if (result) await objectives.refresh()
            return result
          }}
        />
      )}

      {addingTo && (
        <Dialog title="Adicionar vínculo" onClose={() => setAddingTo(null)}>
          <ObjectiveLinkComposer
            objetivo={addingTo}
            tasksEnabled={tasksEnabled}
            tasks={objectiveTasks.tasks}
            trackers={trackers.trackers}
            type={linkType}
            search={linkSearch}
            onType={setLinkType}
            onSearch={setLinkSearch}
            onCreateTask={() => {
              setTaskObjetivo(addingTo)
              setAddingTo(null)
            }}
            onCreateTracker={() => {
              setTrackerForm({ objetivo: addingTo, tracker: null })
              setAddingTo(null)
            }}
            onLinkTask={async (item) => {
              if (await objectiveTasks.operateTask(item, { objetivo_id: addingTo.id }))
                setAddingTo(null)
            }}
            onLinkTracker={async (item) => {
              if (await trackers.updateTracker(item, { objetivo_id: addingTo.id }))
                setAddingTo(null)
            }}
            error={objectiveTasks.error || trackers.error}
          />
        </Dialog>
      )}
      {context === "active" &&
        secondaryTrackerGroups.map((group) => (
          <section key={group.title} className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <p className="text-sm text-text-secondary">{group.copy}</p>
            <ObjectiveOperationalPanel
              objetivo={{ titulo: group.title }}
              tasksEnabled={false}
              trackers={group.items}
              trackersLoaded={trackers.loaded}
              trackersLoading={trackers.loading}
              trackerBusyId={trackers.busyId}
              onEditTracker={(tracker) => setTrackerForm({ objetivo: null, tracker })}
              onDeleteTracker={setDeleteTrackerTarget}
              onRecordOccurrence={trackers.recordOccurrence}
              onDeleteOccurrence={trackers.deleteOccurrence}
              timezone={user?.timezone}
            />
          </section>
        ))}

      {trackerForm && (
        <Dialog
          closeOnBackdrop={false}
          onClose={() => setTrackerForm(null)}
          title={trackerForm.tracker ? "Editar acompanhamento" : "Novo acompanhamento"}
        >
          <StatusNotice status={trackers.status} />
          <TrackerForm
            key={trackerForm.tracker?.id ?? `new-${trackerForm.objetivo?.id}`}
            tracker={trackerForm.tracker}
            objetivoTitulo={trackerForm.objetivo?.titulo ?? ""}
            loading={trackers.busyId === trackerForm.tracker?.id}
            onCancel={() => setTrackerForm(null)}
            onSubmit={submitTracker}
          />
        </Dialog>
      )}

      {deleteTrackerTarget && (
        <ConfirmDialog
          title="Excluir acompanhamento"
          message={`"${deleteTrackerTarget.titulo}" e suas ocorrências serão removidos. As tarefas do objetivo não serão alteradas.`}
          confirmLabel="Excluir acompanhamento"
          error={trackers.error}
          loading={trackers.busyId === deleteTrackerTarget.id}
          onCancel={() => setDeleteTrackerTarget(null)}
          onConfirm={async () => {
            if (await trackers.deleteTracker(deleteTrackerTarget)) setDeleteTrackerTarget(null)
          }}
        />
      )}

      {unlinkTarget && (
        <ConfirmDialog
          title="Desvincular do objetivo"
          message={
            unlinkTarget.recurrence
              ? `A série "${unlinkTarget.titulo}" e suas ocorrências continuarão em Tarefas sem vínculo com este objetivo.`
              : `"${unlinkTarget.titulo}" continuará em Tarefas com o mesmo status e histórico.`
          }
          confirmLabel="Desvincular"
          error={objectiveTasks.error}
          loading={objectiveTasks.unlinkingId === unlinkTarget.id}
          onCancel={() => setUnlinkTarget(null)}
          onConfirm={async () => {
            if (await objectiveTasks.unlinkTask(unlinkTarget)) setUnlinkTarget(null)
          }}
        />
      )}

      {tasksEnabled && taskObjetivo && (
        <Dialog
          closeOnBackdrop={false}
          onClose={() => {
            setTaskObjetivo(null)
            objectiveTasks.setFormStatus(emptyStatus)
          }}
          title="Nova tarefa"
        >
          <TaskForm
            currentUser={user}
            initialObjetivoId={taskObjetivo.id}
            initialObjetivoTitulo={taskObjetivo.titulo}
            lockObjetivo
            loading={objectiveTasks.formLoading}
            onCancel={() => {
              setTaskObjetivo(null)
              objectiveTasks.setFormStatus(emptyStatus)
            }}
            onCreate={createTask}
            status={objectiveTasks.formStatus}
            timezone={user?.timezone}
          />
        </Dialog>
      )}

      {deleteTarget && (
        <ConfirmDialog
          cancelLabel="Cancelar"
          confirmLabel="Remover"
          message={`"${deleteTarget.titulo}" será removido. Tarefas e acompanhamentos serão preservados sem este vínculo. Séries com término neste objetivo serão desativadas.`}
          title="Remover objetivo"
          error={objectives.status.type === "error" ? objectives.status.message : ""}
          variant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const removed = await objectives.deleteObjetivo(deleteTarget.id)
            if (removed) {
              setDeleteTarget(null)
            }
          }}
        />
      )}
    </section>
  )
}
