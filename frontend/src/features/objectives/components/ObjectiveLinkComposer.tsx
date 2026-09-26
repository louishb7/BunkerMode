import React from "react"
import { Plus, Search } from "lucide-react"
import Button from "../../../components/ui/Button"

export default function ObjectiveLinkComposer({
  objetivo,
  tasksEnabled,
  tasks,
  trackers,
  type,
  search,
  onType,
  onSearch,
  onCreateTask,
  onCreateTracker,
  onLinkTask,
  onLinkTracker,
  error,
}) {
  const taskOptions = tasks.filter(
    (item, index, all) =>
      item.objetivo_id === null &&
      (!item.recurrence ||
        all.findIndex((other) => other.recurrence?.series_id === item.recurrence.series_id) ===
          index)
  )
  const options = (
    type === "task" ? taskOptions : trackers.filter((item) => item.objetivo_id === null)
  )
    .filter((item) =>
      item.titulo.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))
    )
    .slice(0, 12)
  return (
    <div className="objective-composer">
      <p className="m-0 text-sm text-text-secondary">
        Para <strong>{objetivo.titulo}</strong>
      </p>
      <div className="composer-tabs" role="tablist" aria-label="Tipo de vínculo">
        {tasksEnabled && objetivo.status === "ativo" && (
          <button
            type="button"
            role="tab"
            aria-selected={type === "task"}
            onClick={() => {
              onType("task")
              onSearch("")
            }}
          >
            Tarefa
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={type === "tracker"}
          onClick={() => {
            onType("tracker")
            onSearch("")
          }}
        >
          Acompanhamento
        </button>
      </div>
      <div role="tabpanel" className="composer-content">
        <label className="composer-search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label={`Pesquisar ${type === "task" ? "tarefas" : "acompanhamentos"}`}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Pesquisar existente"
          />
        </label>
        <ul className="composer-options">
          {options.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => (type === "task" ? onLinkTask(item) : onLinkTracker(item))}
              >
                <span>{item.titulo}</span>
                <span className="sr-only">Vincular ao objetivo</span>
                <Plus size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {!options.length && <p className="text-sm text-text-secondary">Nenhum item disponível.</p>}
        <div className="composer-create">
          <Button variant="secondary" onClick={type === "task" ? onCreateTask : onCreateTracker}>
            <Plus size={16} aria-hidden="true" /> Criar{" "}
            {type === "task" ? "tarefa" : "acompanhamento"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
