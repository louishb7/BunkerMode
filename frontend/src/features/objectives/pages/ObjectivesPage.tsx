import ObjectiveOperationalPanel from "../components/ObjectiveOperationalPanel"
import ObjectiveLinkComposer from "../components/ObjectiveLinkComposer"
import { Plus } from "lucide-react"
import React, { useEffect, useRef, useState } from "react"

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
import PracticeRecordForm from "../../practices/components/PracticeRecordForm"
import PracticePauseForm from "../../practices/components/PracticePauseForm"
import AchievementGallery from "../components/AchievementGallery"
import AchievementDetails from "../components/AchievementDetails"
import ConquerObjectiveDialog from "../components/ConquerObjectiveDialog"
import { useAchievements } from "../hooks/useAchievements"
import "../objectives.css"

export default function ObjectivesPage({ onUnauthorized, token, user }) {
  const objectives = useObjectives({ onUnauthorized, token, ownerId: user.id })
  const achievements = useAchievements({ onUnauthorized, token, ownerId: user.id })
  const [context, setContext] = useState(
    window.location.hash.startsWith("#conquista")
      ? "achievements"
      : window.location.hash === "#habitos"
        ? "practices"
        : "active"
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
      setContext(
        window.location.hash.startsWith("#conquista")
          ? "achievements"
          : window.location.hash === "#habitos"
            ? "practices"
            : "active"
      )
      setMemoryId(Number(window.location.hash.match(/^#conquista-(\d+)$/)?.[1]) || null)
    }
    window.addEventListener("hashchange", update)
    return () => window.removeEventListener("hashchange", update)
  }, [])
  function selectContext(next) {
    setContext(next)
    setMemoryId(null)
    window.history.replaceState(
      null,
      "",
      next === "achievements" ? "#conquistas" : next === "practices" ? "#habitos" : "#em-andamento"
    )
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
  const [addingTo, setAddingTo] = useState(null)
  const [linkType, setLinkType] = useState<"task" | "tracker" | null>(null)
  const [linkSearch, setLinkSearch] = useState("")
  const [editingObjetivo, setEditingObjetivo] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [taskObjetivo, setTaskObjetivo] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [trackerForm, setTrackerForm] = useState(null)
  const [deleteTrackerTarget, setDeleteTrackerTarget] = useState(null)
  const [unlinkTarget, setUnlinkTarget] = useState(null)
  const [recordTarget, setRecordTarget] = useState(null)
  const [pauseTarget, setPauseTarget] = useState(null)
  const recordDirty = useRef(false)
  const pauseDirty = useRef(false)
  const objectiveDirty = useRef(false)
  const trackerDirty = useRef(false)
  const taskDirty = useRef(false)
  const busy = objectives.loading || objectives.mutating

  function openCreateObjective() {
    objectiveDirty.current = false
    setEditingObjetivo(null)
    setFormOpen(true)
  }

  function closeObjectiveForm() {
    if (objectives.mutating) return
    if (objectiveDirty.current && !window.confirm("Descartar as alterações deste objetivo?")) return
    discardObjectiveForm()
  }

  function discardObjectiveForm() {
    objectiveDirty.current = false
    setFormOpen(false)
    setEditingObjetivo(null)
  }

  function openTrackerForm(value) {
    trackerDirty.current = false
    setTrackerForm(value)
  }

  function closeTrackerForm() {
    if (trackers.busyId != null) return
    if (trackerDirty.current && !window.confirm("Descartar as alterações deste comportamento?"))
      return
    trackerDirty.current = false
    setTrackerForm(null)
  }

  function closeTaskForm() {
    if (objectiveTasks.formLoading) return
    if (taskDirty.current && !window.confirm("Descartar as alterações desta tarefa?")) return
    taskDirty.current = false
    setTaskObjetivo(null)
    objectiveTasks.setFormStatus(emptyStatus)
  }

  async function submitObjetivo(payload) {
    const saved = editingObjetivo
      ? await objectives.updateObjetivo(editingObjetivo.id, payload)
      : await objectives.createObjetivo(payload)
    if (saved) {
      discardObjectiveForm()
    }
  }

  async function createTask(payload) {
    const saved = await objectiveTasks.createTask(payload)
    if (saved) {
      taskDirty.current = false
      setTaskObjetivo(null)
    }
  }

  async function submitTracker(payload) {
    if (!trackerForm) return
    const saved = trackerForm.tracker
      ? await trackers.updateTracker(trackerForm.tracker, payload)
      : await trackers.createTracker({
          ...payload,
          objetivo_id: trackerForm.objetivo?.id ?? payload.objetivo_id ?? null,
        })
    if (saved) {
      trackerDirty.current = false
      setTrackerForm(null)
    }
  }

  function recordPractice(tracker, withDetails = false) {
    if (!withDetails && (!tracker.intent || tracker.intent === "registro_livre"))
      return trackers.recordOccurrence(tracker)
    recordDirty.current = false
    setRecordTarget(tracker)
    return false
  }

  function closeRecordForm() {
    if (recordDirty.current && !window.confirm("Descartar este registro?")) return
    recordDirty.current = false
    setRecordTarget(null)
  }

  function pausePractice(tracker) {
    pauseDirty.current = false
    setPauseTarget(tracker)
  }

  function closePauseForm() {
    if (pauseDirty.current && !window.confirm("Descartar esta alteração de pausa?")) return
    pauseDirty.current = false
    setPauseTarget(null)
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
          <Button
            variant="secondary"
            disabled={context === "practices" ? trackers.loading && !trackers.loaded : busy}
            onClick={
              context === "practices"
                ? () => openTrackerForm({ objetivo: null, tracker: null })
                : openCreateObjective
            }
          >
            <Plus size={17} aria-hidden="true" />
            {context === "practices" ? "Novo comportamento" : "Novo objetivo"}
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
        <button
          type="button"
          aria-pressed={context === "practices"}
          onClick={() => selectContext("practices")}
        >
          Hábitos e mudanças <span>{trackers.trackers.length}</span>
        </button>
      </nav>

      {formOpen && (
        <Dialog
          closeOnBackdrop={false}
          onClose={closeObjectiveForm}
          title={editingObjetivo ? "Editar objetivo" : "Novo objetivo"}
        >
          <div
            onInputCapture={() => {
              objectiveDirty.current = true
            }}
            onChangeCapture={() => {
              objectiveDirty.current = true
            }}
          >
            <ObjetivoForm
              editingObjetivo={editingObjetivo}
              loading={busy}
              onCancel={closeObjectiveForm}
              onSubmit={submitObjetivo}
            />
          </div>
        </Dialog>
      )}

      {context === "active" && (
        <ObjetivoList
          onAdd={(goal) => {
            setLinkType(null)
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
            objectiveDirty.current = false
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
            openTrackerForm({
              objetivo: objectives.objetivos.find((item) => item.id === tracker.objetivo_id),
              tracker,
            })
          }
          onDeleteTracker={setDeleteTrackerTarget}
          onRecordOccurrence={recordPractice}
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
        <Dialog title="Adicionar vínculo" closeOnBackdrop onClose={() => setAddingTo(null)}>
          <ObjectiveLinkComposer
            objetivo={addingTo}
            tasksEnabled={tasksEnabled}
            tasks={objectiveTasks.tasks}
            trackers={trackers.trackers}
            type={linkType}
            search={linkSearch}
            timezone={user?.timezone}
            onType={setLinkType}
            onSearch={setLinkSearch}
            onCreateTask={() => {
              taskDirty.current = false
              setTaskObjetivo(addingTo)
              setAddingTo(null)
            }}
            onCreateTracker={() => {
              openTrackerForm({ objetivo: addingTo, tracker: null })
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
          <Button variant="secondary" onClick={() => setAddingTo(null)}>
            Fechar
          </Button>
        </Dialog>
      )}
      {context === "practices" && (
        <section className="practice-surface" aria-label="Hábitos e mudanças">
          <p className="text-sm text-text-secondary">
            Comportamentos têm registros e metas próprios. O vínculo com um objetivo é opcional.
          </p>
          {trackers.error && (
            <p className="text-sm text-danger" role="alert">
              {trackers.error}{" "}
              <Button variant="ghost" onClick={trackers.refresh}>
                Tentar novamente
              </Button>
            </p>
          )}
          {trackers.loaded && !trackers.trackers.length && !trackers.error && (
            <p className="text-sm text-text-secondary">
              Comece com algo que deseja repetir, reduzir, evitar ou apenas observar.
            </p>
          )}
          <ObjectiveOperationalPanel
            objetivo={{ titulo: "Hábitos e mudanças" }}
            tasksEnabled={false}
            trackers={trackers.trackers}
            trackersLoaded={trackers.loaded}
            trackersLoading={trackers.loading}
            trackerBusyId={trackers.busyId}
            onEditTracker={(tracker) => openTrackerForm({ objetivo: null, tracker })}
            onDeleteTracker={setDeleteTrackerTarget}
            onRecordOccurrence={recordPractice}
            onDeleteOccurrence={trackers.deleteOccurrence}
            onPauseTracker={pausePractice}
            onUnlinkTracker={(tracker) => trackers.updateTracker(tracker, { objetivo_id: null })}
            timezone={user?.timezone}
          />
        </section>
      )}

      {recordTarget && (
        <Dialog title="Registrar comportamento" onClose={closeRecordForm}>
          <StatusNotice status={trackers.status} />
          <div
            onInputCapture={() => {
              recordDirty.current = true
            }}
            onChangeCapture={() => {
              recordDirty.current = true
            }}
          >
            <PracticeRecordForm
              tracker={
                trackers.trackers.find((item) => item.id === recordTarget.id) ?? recordTarget
              }
              timezone={user?.timezone}
              onCancel={closeRecordForm}
              onSubmit={async (payload) => {
                if (await trackers.recordOccurrence(recordTarget, payload)) {
                  recordDirty.current = false
                  setRecordTarget(null)
                }
              }}
            />
          </div>
        </Dialog>
      )}
      {pauseTarget && (
        <Dialog
          title={
            pauseTarget.status === "pausado" ? "Retomar comportamento" : "Pausar comportamento"
          }
          onClose={closePauseForm}
        >
          <StatusNotice status={trackers.status} />
          <div
            onInputCapture={() => {
              pauseDirty.current = true
            }}
            onChangeCapture={() => {
              pauseDirty.current = true
            }}
          >
            <PracticePauseForm
              tracker={pauseTarget}
              timezone={user?.timezone}
              onCancel={closePauseForm}
              onSubmit={async (payload) => {
                if (await trackers.updateTracker(pauseTarget, payload)) {
                  pauseDirty.current = false
                  setPauseTarget(null)
                }
              }}
            />
          </div>
        </Dialog>
      )}

      {trackerForm && (
        <Dialog
          closeOnBackdrop={false}
          onClose={closeTrackerForm}
          title={trackerForm.tracker ? "Editar comportamento" : "Novo comportamento"}
        >
          <StatusNotice status={trackers.status} />
          <div
            onInputCapture={() => {
              trackerDirty.current = true
            }}
            onChangeCapture={() => {
              trackerDirty.current = true
            }}
          >
            <TrackerForm
              key={trackerForm.tracker?.id ?? `new-${trackerForm.objetivo?.id}`}
              tracker={trackerForm.tracker}
              objetivoTitulo={trackerForm.objetivo?.titulo ?? ""}
              lockObjetivo={Boolean(trackerForm.objetivo && !trackerForm.tracker)}
              objectiveOptions={objectives.objetivos}
              timezone={user?.timezone}
              loading={trackers.busyId === trackerForm.tracker?.id}
              onCancel={closeTrackerForm}
              onDirty={() => {
                trackerDirty.current = true
              }}
              onSubmit={submitTracker}
            />
          </div>
        </Dialog>
      )}

      {deleteTrackerTarget && (
        <ConfirmDialog
          title="Excluir comportamento"
          message={`"${deleteTrackerTarget.titulo}" e suas ocorrências serão removidos. As tarefas do objetivo não serão alteradas.`}
          confirmLabel="Excluir comportamento"
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
        <Dialog closeOnBackdrop={false} onClose={closeTaskForm} title="Nova tarefa">
          <div
            onInputCapture={() => {
              taskDirty.current = true
            }}
            onChangeCapture={() => {
              taskDirty.current = true
            }}
          >
            <TaskForm
              currentUser={user}
              initialObjetivoId={taskObjetivo.id}
              initialObjetivoTitulo={taskObjetivo.titulo}
              lockObjetivo
              loading={objectiveTasks.formLoading}
              onCancel={closeTaskForm}
              onCreate={createTask}
              status={objectiveTasks.formStatus}
              timezone={user?.timezone}
            />
          </div>
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
