import { Plus } from "lucide-react"
import React, { useState } from "react"

import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import Button from "../../../components/ui/Button"
import Dialog from "../../../components/ui/Dialog"
import PageHeader from "../../../components/ui/PageHeader"
import StatusNotice from "../../../components/ui/StatusNotice"
import { emptyStatus } from "../../../constants/uiState"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import TaskForm from "../../tasks/components/TaskForm"
import ObjetivoForm from "../components/ObjetivoForm"
import ObjetivoList from "../components/ObjetivoList"
import { useObjectives } from "../hooks/useObjectives"
import { useObjectiveTasks } from "../hooks/useObjectiveTasks"
import { useTrackers } from "../hooks/useTrackers"
import TrackerForm from "../components/TrackerForm"
import { removeObjectiveFromOverview } from "../../../state/overviewCache"

export default function ObjectivesPage({ onUnauthorized, token, user }) {
  const objectives = useObjectives({ onUnauthorized, token })
  const tasksEnabled = getEnabledModules(user).some((module) => module.key === "tasks")
  const objectiveTasks = useObjectiveTasks({ token, onUnauthorized, enabled: tasksEnabled })
  const trackers = useTrackers({ token, onUnauthorized })
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
    <section className="mx-auto grid max-w-[820px] gap-5">
      <PageHeader
        actions={
          <Button disabled={busy} onClick={openCreateObjective}>
            <Plus size={17} aria-hidden="true" />
            Novo objetivo
          </Button>
        }
        title="Objetivos"
      />

      <StatusNotice status={objectives.status} />
      <StatusNotice status={trackers.status} />

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

      <ObjetivoList
        tasksEnabled={tasksEnabled}
        loading={busy}
        tasksByObjetivo={objectiveTasks.tasksByObjetivo}
        tasksLoading={objectiveTasks.loading}
        tasksError={objectiveTasks.error}
        onRetryTasks={objectiveTasks.refresh}
        objetivos={objectives.objetivos}
        onCreate={openCreateObjective}
        onCreateTask={setTaskObjetivo}
        onDelete={setDeleteTarget}
        onEdit={(objetivo) => {
          setEditingObjetivo(objetivo)
          setFormOpen(true)
        }}
        onMoveToTop={moveObjetivoToTop}
        onUpdateStatus={objectives.updateObjetivoStatus}
        onUnlinkTask={setUnlinkTarget}
        unlinkingId={objectiveTasks.unlinkingId}
        trackersByObjective={trackers.byObjective}
        trackersLoading={trackers.loading}
        trackersError=""
        trackerBusyId={trackers.busyId}
        onCreateTracker={(objetivo) => setTrackerForm({ objetivo, tracker: null })}
        onEditTracker={(tracker) => setTrackerForm({ objetivo: objectives.objetivos.find((item) => item.id === tracker.objetivo_id), tracker })}
        onDeleteTracker={setDeleteTrackerTarget}
        onRecordOccurrence={trackers.recordOccurrence}
        onDeleteOccurrence={trackers.deleteOccurrence}
        timezone={user?.timezone}
      />

      {trackerForm && (
        <Dialog closeOnBackdrop={false} onClose={() => setTrackerForm(null)} title={trackerForm.tracker ? "Editar acompanhamento" : "Novo acompanhamento"}>
          <TrackerForm
            key={trackerForm.tracker?.id ?? `new-${trackerForm.objetivo.id}`}
            tracker={trackerForm.tracker}
            objetivoTitulo={trackerForm.objetivo.titulo}
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
          message={unlinkTarget.recurrence
            ? `A série "${unlinkTarget.titulo}" e suas ocorrências continuarão em Tarefas sem vínculo com este objetivo.`
            : `"${unlinkTarget.titulo}" continuará em Tarefas com o mesmo status e histórico.`}
          confirmLabel="Desvincular"
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
          message={`"${deleteTarget.titulo}" será removido. As tarefas vinculadas perderão esse vínculo.`}
          title="Remover objetivo"
          variant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const removed = await objectives.deleteObjetivo(deleteTarget.id)
            if (removed) {
              objectiveTasks.detachObjective(deleteTarget.id)
              trackers.removeForObjective(deleteTarget.id)
              removeObjectiveFromOverview(token, deleteTarget.id)
              setDeleteTarget(null)
            }
          }}
        />
      )}
    </section>
  )
}
