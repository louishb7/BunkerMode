import React from "react"

import EmptyState from "../../../components/ui/EmptyState"
import StatusNotice from "../../../components/ui/StatusNotice"
import { isCompleted } from "../../../utils/taskStatus"
import { formatCurrentDay } from "../../calendar/calendarUtils"
import TaskCard from "../components/TaskCard"

export default function FocusPage({ actionTasks, board, dailyTasks, timezone }) {
  const allDailyTasksCompleted = dailyTasks.length > 0 && dailyTasks.every(isCompleted)
  const waitingForTasks = board.taskLoading && !board.hasBoardSnapshot

  return (
    <section className="grid gap-7">
      <header>
        <h1 className="m-0 text-xl font-semibold tracking-tight text-text-primary">Modo Foco</h1>
        <p className="mt-2 mb-0 text-sm text-text-secondary">
          {formatCurrentDay(timezone).toLocaleLowerCase("pt-BR")}
        </p>
      </header>

      <StatusNotice status={board.status} />

      <section className="grid gap-3" aria-labelledby="focus-tasks-title">
        <h2 id="focus-tasks-title" className="m-0 text-sm font-medium text-text-secondary">
          Tarefas de hoje
        </h2>

        {waitingForTasks && (
          <EmptyState
            title="Sincronizando tarefas"
            message="Carregando as tarefas programadas para hoje."
          />
        )}

        {!waitingForTasks && dailyTasks.length > 0 && (
          <div className="work-surface grid">
            {dailyTasks.map((task) => (
              <TaskCard
                key={task.id}
                completing={board.completeLoadingId === task.id}
                task={task}
                onComplete={() => board.completeTask(task)}
                timezone={timezone}
                variant="focus"
              />
            ))}
          </div>
        )}

        {!waitingForTasks && actionTasks.length === 0 && (
          <>
            {dailyTasks.length === 0 ? (
              <EmptyState
                title="Nenhuma tarefa para hoje"
                message="Não há nada programado para execução neste dia."
              />
            ) : allDailyTasksCompleted ? (
              <EmptyState
                title="Todas as tarefas foram concluídas"
                message="Você concluiu as tarefas de hoje."
              />
            ) : (
              <EmptyState
                title="Sem tarefas em aberto"
                message="Não há mais ações disponíveis para as tarefas de hoje."
              />
            )}
          </>
        )}
      </section>
    </section>
  )
}
