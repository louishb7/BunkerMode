import React, { useMemo, useState } from "react"

import ConfirmDialog from "../../../components/ui/ConfirmDialog"
import Dialog from "../../../components/ui/Dialog"
import PageHeader from "../../../components/ui/PageHeader"
import StatusNotice from "../../../components/ui/StatusNotice"
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

export default function TasksPage({ board, onStartFocus, user }) {
  const [selectedDate, setSelectedDate] = useState(() => operationalDateFor(user?.timezone))
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate])
  const weekLabel = formatWeekLabel(weekDays)
  const todayDate = useMemo(() => operationalDateFor(user?.timezone), [user?.timezone])
  const selectedDateApi = formatDateForApi(selectedDate)
  const selectedTasks = useMemo(
    () => board.dailyTasks.filter((task) => taskBelongsToDate(task, selectedDate, user?.timezone)),
    [board.dailyTasks, selectedDate, user?.timezone]
  )
  function openCreateForm() {
    setEditingTask(null)
    board.setFormStatus(emptyStatus)
    setFormOpen(true)
  }

  function openEditForm(task) {
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
  }

  return (
    <>
      <section className="mx-auto grid max-w-[900px] gap-5">
        <PageHeader title="Tarefas" />

        <div className="empty:hidden">
          <StatusNotice status={board.status} />
        </div>
        <div className="work-surface min-w-0">
          <WeekPanel
            onCreateTask={openCreateForm}
            onStartFocus={onStartFocus}
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
            completeLoadingId={board.completeLoadingId}
            loading={board.taskLoading && !board.hasBoardSnapshot}
            onCompleteTask={board.completeTask}
            onDeleteTask={setDeleteTarget}
            onEditTask={openEditForm}
            onReopenTask={board.reopenTask}
            onTogglePin={board.toggleTaskPin}
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
          onClose={() => {
            setFormOpen(false)
            setEditingTask(null)
            board.setFormStatus(emptyStatus)
          }}
          title={editingTask ? "Editar tarefa" : "Nova tarefa"}
        >
          <TaskForm
            currentUser={user}
            editingTask={editingTask}
            initialPrazo={editingTask ? undefined : selectedDateApi}
            loading={board.formLoading}
            onCancel={() => {
              setFormOpen(false)
              setEditingTask(null)
              board.setFormStatus(emptyStatus)
            }}
            onCreate={createTask}
            onUpdate={updateTask}
            status={board.formStatus}
            timezone={user?.timezone}
          />
        </Dialog>
      )}

      {deleteTarget !== null && (
        <ConfirmDialog
          title="Remover tarefa"
          message={`"${deleteTarget?.titulo}" será removida das tarefas.`}
          confirmLabel="Remover"
          variant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteTask(deleteTarget)
            setDeleteTarget(null)
          }}
        />
      )}
    </>
  )
}
