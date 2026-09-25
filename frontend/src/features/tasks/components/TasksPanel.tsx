import React from "react"

import EmptyState from "../../../components/ui/EmptyState"
import { isCompleted, isNotPerformed } from "../../../utils/taskStatus"
import TaskCard from "./TaskCard"

function groupTasks(tasks) {
  const open = tasks.filter((task) => !isCompleted(task) && !isNotPerformed(task))
  return {
    open: [
      ...open.filter((task) => task?.is_pinned === true),
      ...open.filter((task) => task?.is_pinned !== true),
    ],
    unperformed: tasks.filter(isNotPerformed),
    completed: tasks.filter(isCompleted),
  }
}

export default function TasksPanel({
  completeLoadingId,
  loading,
  onCompleteTask,
  onDeleteTask,
  onEditTask,
  onReopenTask,
  onTogglePin,
  pinLoadingId,
  reopenLoadingId,
  selectedDate,
  selectedTasks,
  timezone,
}) {
  const groups = groupTasks(selectedTasks)
  function renderTaskGroup(label, tasks, tone = "default") {
    if (tasks.length === 0) {
      return null
    }

    return (
      <section className="grid gap-0">
        <h3
          className={`m-0 bg-surface-subtle px-4 text-xs font-medium ${tone === "default" ? "py-2 text-text-primary" : "py-1.5 text-text-secondary"}`}
        >
          {label}
        </h3>
        <div className="grid gap-0">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              completing={completeLoadingId === task.id}
              task={task}
              onComplete={() => onCompleteTask(task)}
              onDelete={() => onDeleteTask(task)}
              onEdit={() => onEditTask(task)}
              onReopen={() => onReopenTask(task)}
              onTogglePin={() => onTogglePin(task)}
              pinning={pinLoadingId === task.id}
              reopening={reopenLoadingId === task.id}
              selectedDate={selectedDate}
              timezone={timezone}
              variant="tasks"
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section className="grid gap-0">
      {loading ? (
        <EmptyState
          flat
          title="Sincronizando tarefas"
          message="Carregando tarefas do dia selecionado."
        />
      ) : selectedTasks.length > 0 ? (
        <div className="grid">
          {renderTaskGroup("Em aberto", groups.open)}
          {renderTaskGroup("Concluídas", groups.completed, "subdued")}
          {renderTaskGroup("Não realizadas", groups.unperformed, "subdued")}
        </div>
      ) : (
        <EmptyState
          flat
          message="Nenhuma tarefa foi definida para o dia selecionado."
          title="Sem tarefas neste dia"
        />
      )}
    </section>
  )
}
