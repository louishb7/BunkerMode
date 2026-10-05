import React, { useMemo, useRef, useState } from "react"

import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import Dialog from "../../../components/ui/Dialog"
import PageHeader from "../../../components/ui/PageHeader"
import StatusNotice from "../../../components/ui/StatusNotice"
import OfflineNotice from "../../../components/system/OfflineNotice"
import { emptyStatus } from "../../../constants/uiState"
import { formatDateForApi } from "../../../utils/date"
import TaskForm from "../components/TaskForm"
import {
  addDays,
  formatWeekLabel,
  getWeekDays,
  taskBelongsToDate,
  operationalDateFor,
  startOfDay,
} from "../../calendar/calendarUtils"
import TasksPanel from "../components/TasksPanel"
import WeekPanel from "../components/WeekPanel"
import Button from "../../../components/ui/Button"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import { useObjectives } from "../../objectives/hooks/useObjectives"

export default function TasksPage({
  board,
  onStartFocus,
  user,
  token = null,
  onUnauthorized = undefined,
}) {
  const timezone = user?.timezone
  const [selectedDate, setSelectedDate] = useState(() => operationalDateFor(user?.timezone))
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [linkTarget, setLinkTarget] = useState(null)
  const [objectiveId, setObjectiveId] = useState("")
  const [linking, setLinking] = useState(false)
  const formDirty = useRef(false)
  const objectivesEnabled = getEnabledModules(user).some((module) => module.key === "objectives")
  const objectives = useObjectives({
    token,
    ownerId: user.id,
    onUnauthorized,
    enabled: objectivesEnabled && (formOpen || linkTarget !== null),
  })

  function closeForm() {
    if (board.formLoading) return
    if (formDirty.current && !window.confirm("Descartar as alterações desta tarefa?")) return
    formDirty.current = false
    setFormOpen(false)
    setEditingTask(null)
    board.setFormStatus(emptyStatus)
  }

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate])
  const weekLabel = formatWeekLabel(weekDays)
  const todayDate = useMemo(() => operationalDateFor(timezone), [timezone])
  const selectedDateApi = formatDateForApi(selectedDate)
  const selectedTasks = useMemo(
    () => board.dailyTasks.filter((task) => taskBelongsToDate(task, selectedDate, timezone)),
    [board.dailyTasks, selectedDate, timezone]
  )
  function openCreateForm() {
    formDirty.current = false
    setEditingTask(null)
    board.setFormStatus(emptyStatus)
    setFormOpen(true)
  }

  function openEditForm(task) {
    formDirty.current = false
    setEditingTask(task)
    board.setFormStatus(emptyStatus)
    setFormOpen(true)
  }

  async function createTask(payload) {
    const saved = await board.createTask(payload)
    if (saved?.persisted) {
      setFormOpen(false)
      setEditingTask(null)
    }
  }

  async function updateTask(taskId, payload) {
    const saved = await board.updateTask(taskId, payload)
    if (saved?.persisted) {
      setFormOpen(false)
      setEditingTask(null)
    }
  }

  async function deleteTask(task) {
    const removed = await board.deleteTask(task)
    if (removed?.persisted && editingTask?.id === task.id) {
      setEditingTask(null)
      setFormOpen(false)
    }
    return removed
  }

  return (
    <>
      <section className="mx-auto grid max-w-[920px] gap-5">
        <PageHeader title="Tarefas" />
        <OfflineNotice updatedAt={board.lastUpdated} />

        <div className="empty:hidden">
          <StatusNotice status={board.status} />
        </div>
        <div className="execution-surface">
          <WeekPanel
            onToday={() => setSelectedDate(todayDate)}
            onNextWeek={() => setSelectedDate((current) => addDays(current, 7))}
            onPreviousWeek={() => setSelectedDate((current) => addDays(current, -7))}
            onSelectDate={(date) => setSelectedDate(startOfDay(date))}
            selectedDate={selectedDate}
            todayDate={todayDate}
            weekLabel={weekLabel}
            weekDays={weekDays}
          />

          <TasksPanel
            onCreateTask={openCreateForm}
            onStartFocus={onStartFocus}
            completeLoadingId={board.completeLoadingId}
            loading={board.taskLoading && !board.hasBoardSnapshot}
            onCompleteTask={board.completeTask}
            onDeleteTask={setDeleteTarget}
            onEditTask={openEditForm}
            onReopenTask={board.reopenTask}
            onTogglePin={board.toggleTaskPin}
            onChangeObjective={
              objectivesEnabled
                ? (task) => {
                    setLinkTarget(task)
                    setObjectiveId(task.objetivo_id == null ? "" : String(task.objetivo_id))
                  }
                : undefined
            }
            pinLoadingId={board.pinLoadingId}
            reopenLoadingId={board.reopenLoadingId}
            selectedDate={selectedDate}
            selectedTasks={selectedTasks}
            timezone={user?.timezone}
          />
        </div>
      </section>

      {formOpen && (
        <Dialog
          className="max-w-2xl"
          closeOnBackdrop={false}
          onClose={closeForm}
          title={editingTask ? "Editar tarefa" : "Nova tarefa"}
        >
          <div
            onChangeCapture={() => {
              formDirty.current = true
            }}
          >
            <TaskForm
              currentUser={user}
              editingTask={editingTask}
              initialPrazo={editingTask ? undefined : selectedDateApi}
              loading={board.formLoading}
              onCancel={closeForm}
              onCreate={createTask}
              onUpdate={updateTask}
              status={board.formStatus}
              timezone={user?.timezone}
              objectivesAvailable={objectivesEnabled}
              objectiveOptions={objectives.objetivos}
              objectivesLoading={objectives.loading}
              objectivesError={objectives.status.type === "error" ? objectives.status.message : ""}
            />
          </div>
        </Dialog>
      )}

      {linkTarget && (
        <Dialog
          title="Objetivo da tarefa"
          onClose={() => {
            if (!linking) setLinkTarget(null)
          }}
        >
          <form
            className="grid gap-4"
            onSubmit={async (event) => {
              event.preventDefault()
              if (linking) return
              const selected =
                objectiveId === ""
                  ? null
                  : objectiveId.startsWith("local:")
                    ? objectiveId
                    : Number(objectiveId)
              if (
                selected === linkTarget.objetivo_id ||
                (selected == null && linkTarget.objetivo_id == null)
              ) {
                setLinkTarget(null)
                return
              }
              setLinking(true)
              try {
                const saved = await board.setTaskObjective(linkTarget, selected)
                if (saved?.persisted) setLinkTarget(null)
              } finally {
                setLinking(false)
              }
            }}
          >
            <p className="m-0 text-sm text-text-secondary">{linkTarget.titulo}</p>
            <label className="grid gap-2 text-sm">
              Objetivo (opcional)
              <select
                className="min-h-11 w-full rounded-control border border-control-border bg-surface px-3 text-text-primary"
                value={objectiveId}
                onChange={(event) => setObjectiveId(event.target.value)}
                disabled={linking || objectives.loading}
              >
                <option value="">Nenhum</option>
                {objectives.objetivos
                  .filter((goal) => goal.status === "ativo" || goal.id === linkTarget.objetivo_id)
                  .map((goal) => (
                    <option key={goal.id} value={goal.id} disabled={goal.status !== "ativo"}>
                      {goal.titulo}
                    </option>
                  ))}
              </select>
            </label>
            {(linkTarget.recurrence || linkTarget.recurringIntent) && (
              <p className="m-0 text-sm text-text-secondary">
                Este vínculo afeta a série inteira e todas as suas ocorrências. Desvincular preserva
                a tarefa e seu histórico.
              </p>
            )}
            <StatusNotice
              status={objectives.status.type === "error" ? objectives.status : board.status}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={linking} onClick={() => setLinkTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" loading={linking}>
                Salvar vínculo
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {deleteTarget !== null && (
        <ConfirmDialog
          title={
            deleteTarget?.recurrence || deleteTarget?.recurringIntent
              ? "Excluir tarefa recorrente"
              : "Excluir tarefa"
          }
          message={
            deleteTarget?.recurrence || deleteTarget?.recurringIntent
              ? `A recorrência de "${deleteTarget?.titulo}" será encerrada e todas as ocorrências pendentes serão excluídas. As concluídas serão preservadas.`
              : `"${deleteTarget?.titulo}" será excluída das tarefas.`
          }
          confirmLabel="Excluir"
          variant="danger"
          loading={deleting}
          onCancel={() => {
            if (!deleting) setDeleteTarget(null)
          }}
          onConfirm={async () => {
            if (deleting) return
            setDeleting(true)
            try {
              const removed = await deleteTask(deleteTarget)
              if (removed?.persisted) setDeleteTarget(null)
            } finally {
              setDeleting(false)
            }
          }}
        />
      )}
    </>
  )
}
