import React, { useState } from "react"
import { Check, Circle } from "lucide-react"
import { todayTasks } from "../objectiveMapModel"

export default function TodayStrip({ tasks, timezone, onComplete, onSelect }) {
  const [expanded, setExpanded] = useState(false)
  const today = todayTasks(tasks, timezone)
  const completed = today.filter((task) => task.status === "CONCLUIDA").length
  return (
    <section className="objective-today" aria-label="Tarefas de hoje neste objetivo">
      <div className="today-heading">
        <h3>Hoje</h3>
        <span>
          {today.length
            ? `${completed} de ${today.length} tarefas concluídas`
            : "Nenhuma tarefa prevista"}
        </span>
      </div>
      {today.length > 0 && (
        <ul>
          {(expanded ? today : today.slice(0, 3)).map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="today-check"
                aria-label={`${task.status === "CONCLUIDA" ? "Concluída" : "Concluir"}: ${task.titulo}`}
                disabled={!task.permissions?.can_complete || Boolean(task.syncStatus)}
                onClick={() => onComplete(task)}
              >
                {task.status === "CONCLUIDA" ? <Check size={17} /> : <Circle size={17} />}
              </button>
              <button type="button" className="today-name" onClick={() => onSelect(task)}>
                {task.titulo}
              </button>
            </li>
          ))}
        </ul>
      )}
      {today.length > 3 && (
        <button
          type="button"
          className="map-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Recolher" : `+${today.length - 3} tarefas de hoje`}
        </button>
      )}
    </section>
  )
}
