import React, { useState } from "react"
import Button from "../../../components/ui/Button"
import { FOCUS_DURATIONS } from "../focusSession"

export default function FocusPreparation({ todayTasks, duration, onDurationChange, onStart }) {
  const [activityText, setActivityText] = useState("")
  const [linkedTask, setLinkedTask] = useState(null)

  return (
    <form
      className="grid min-w-0 gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (activityText.trim())
          onStart({
            activityText,
            ...(linkedTask ? { taskId: linkedTask.id, taskTitle: linkedTask.titulo } : {}),
          })
      }}
    >
      <div className="grid min-w-0 gap-3">
        <label htmlFor="focus-activity" className="text-xl font-semibold">
          No que você vai focar agora?
        </label>
        <textarea
          id="focus-activity"
          className="w-full min-w-0 resize-y rounded-control border border-control-border bg-surface p-3 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-focus-ring"
          rows={3}
          maxLength={500}
          required
          value={activityText}
          placeholder="Estudar TypeScript"
          onChange={(event) => setActivityText(event.target.value)}
        />
        {linkedTask && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              Tarefa vinculada · {linkedTask.titulo}
            </span>
            <Button variant="ghost" size="small" onClick={() => setLinkedTask(null)}>
              Remover vínculo
            </Button>
          </div>
        )}
      </div>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-3 text-sm text-text-secondary">Duração do bloco</legend>
        <div className="grid grid-cols-4 gap-2">
          {FOCUS_DURATIONS.map((minutes) => (
            <label
              key={minutes}
              className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-control border border-control-border p-1 text-sm has-[:checked]:border-action has-[:checked]:bg-surface-subtle has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring"
            >
              <input
                type="radio"
                name="focus-duration"
                value={minutes}
                checked={duration === minutes}
                onChange={() => onDurationChange(minutes)}
                className="sr-only"
              />
              {minutes} min
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={!activityText.trim()}>
        Iniciar bloco
      </Button>
      {todayTasks.length > 0 && (
        <section aria-labelledby="focus-shortcuts">
          <h2 id="focus-shortcuts" className="mb-2 text-sm font-medium text-text-secondary">
            Tarefas de hoje
          </h2>
          <ul className="m-0 grid list-none gap-1 p-0">
            {todayTasks.map((task) => (
              <li key={task.id} className="min-w-0">
                <button
                  type="button"
                  className="min-h-11 w-full cursor-pointer rounded-control border-0 bg-transparent px-2 py-3 text-left text-sm text-text-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus-ring [overflow-wrap:anywhere]"
                  onClick={() => {
                    setActivityText(task.titulo)
                    setLinkedTask(task)
                  }}
                >
                  {task.titulo}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  )
}
