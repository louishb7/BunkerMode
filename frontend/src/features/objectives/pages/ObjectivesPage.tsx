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

export default function ObjectivesPage({ onUnauthorized, token, user }) {
  const objectives = useObjectives({ onUnauthorized, token })
  const tasksEnabled = getEnabledModules(user).some((module) => module.key === "tasks")
  const objectiveTasks = useObjectiveTasks({ token, onUnauthorized, enabled: tasksEnabled })
  const [editingObjetivo, setEditingObjetivo] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [taskObjetivo, setTaskObjetivo] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
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
      />

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
              setDeleteTarget(null)
            }
          }}
        />
      )}
    </section>
  )
}
