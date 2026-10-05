import React, { useEffect, useRef, useState } from "react"
import { Activity, ArrowLeft, ListTodo, Plus, Search } from "lucide-react"
import Button from "../../../components/ui/Button"
import { displayDate } from "../objectiveMapModel"
import { practiceFact } from "../../practices/practiceDomain"

function itemContext(item, type, timezone) {
  if (type === "tracker") {
    return practiceFact(item, new Date(), timezone)
  }
  if (item.recurrence || item.recurringIntent)
    return "Série recorrente · O vínculo vale para todas as ocorrências"
  if (item.status === "CONCLUIDA") return "Tarefa concluída"
  return item.prazo ? `Tarefa · ${displayDate(item.prazo, timezone)}` : "Tarefa sem data"
}

export default function ObjectiveLinkComposer({
  objetivo,
  tasksEnabled,
  tasks,
  trackers,
  type,
  search,
  timezone = undefined,
  onType,
  onSearch,
  onCreateTask,
  onCreateTracker,
  onLinkTask,
  onLinkTracker,
  error,
}) {
  const [mode, setMode] = useState<"choose" | "existing">("choose")
  const stepFocus = useRef<HTMLButtonElement | null>(null)
  const searchFocus = useRef<HTMLInputElement | null>(null)
  const previousStep = useRef(`${type}:${mode}`)
  useEffect(() => {
    const step = `${type}:${mode}`
    if (previousStep.current === step) return
    previousStep.current = step
    ;(mode === "existing" ? searchFocus.current : stepFocus.current)?.focus()
  }, [type, mode])
  const query = search.trim().toLocaleLowerCase("pt-BR")
  const taskOptions = tasks.filter(
    (item, index, all) =>
      item.objetivo_id === null &&
      (!item.recurrence ||
        all.findIndex((other) => other.recurrence?.series_id === item.recurrence.series_id) ===
          index)
  )
  const options = query
    ? (type === "task" ? taskOptions : trackers.filter((item) => item.objetivo_id === null))
        .filter((item) => item.titulo.toLocaleLowerCase("pt-BR").includes(query))
        .sort(
          (left, right) =>
            Number(right.titulo.toLocaleLowerCase("pt-BR").startsWith(query)) -
              Number(left.titulo.toLocaleLowerCase("pt-BR").startsWith(query)) ||
            left.titulo.localeCompare(right.titulo, "pt-BR")
        )
        .slice(0, 6)
    : []
  const canAddTask = tasksEnabled && objetivo.status === "ativo"
  function chooseType(next) {
    onType(next)
    onSearch("")
    setMode("choose")
  }
  function back() {
    if (mode === "existing") setMode("choose")
    else onType(null)
    onSearch("")
  }
  return (
    <div className="objective-composer">
      <p className="m-0 text-sm text-text-secondary">
        Para <strong>{objetivo.titulo}</strong>
      </p>
      {type === null ? (
        <div className="composer-choices" role="group" aria-label="Tipo de vínculo">
          {canAddTask && (
            <button
              ref={stepFocus}
              className="composer-choice"
              type="button"
              onClick={() => chooseType("task")}
            >
              <ListTodo size={22} aria-hidden="true" />
              <span>
                <strong>Tarefa</strong>
                <small>Algo pontual ou recorrente para executar.</small>
              </span>
            </button>
          )}
          <button
            ref={canAddTask ? undefined : stepFocus}
            className="composer-choice"
            type="button"
            onClick={() => chooseType("tracker")}
          >
            <Activity size={22} aria-hidden="true" />
            <span>
              <strong>Comportamento</strong>
              <small>Repetir, reduzir, evitar ou observar.</small>
            </span>
          </button>
        </div>
      ) : (
        <>
          <div className="composer-step-heading">
            <Button variant="ghost" size="small" onClick={back}>
              <ArrowLeft size={16} aria-hidden="true" /> Voltar
            </Button>
            <h3>{type === "task" ? "Tarefa" : "Comportamento"}</h3>
          </div>
          {mode === "choose" ? (
            <div className="composer-actions">
              <Button
                ref={stepFocus}
                variant="secondary"
                onClick={type === "task" ? onCreateTask : onCreateTracker}
              >
                <Plus size={17} aria-hidden="true" />
                {type === "task" ? "Criar tarefa" : "Criar comportamento"}
              </Button>
              <Button variant="secondary" onClick={() => setMode("existing")}>
                <Search size={17} aria-hidden="true" />
                {type === "task" ? "Vincular tarefa existente" : "Vincular comportamento existente"}
              </Button>
            </div>
          ) : (
            <div className="composer-existing">
              <label className="composer-search">
                <Search size={17} aria-hidden="true" />
                <input
                  ref={searchFocus}
                  aria-label={`Pesquisar ${type === "task" ? "tarefas" : "comportamentos"}`}
                  value={search}
                  onChange={(event) => onSearch(event.target.value)}
                  placeholder="Digite parte do título"
                />
              </label>
              {!query ? (
                <p className="composer-hint">Pesquise pelo título para encontrar um vínculo.</p>
              ) : options.length ? (
                <ul className="composer-results">
                  {options.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => (type === "task" ? onLinkTask(item) : onLinkTracker(item))}
                      >
                        <span>
                          <strong>{item.titulo}</strong>
                          <small>{itemContext(item, type, timezone)}</small>
                        </span>
                        <span className="sr-only">Vincular ao objetivo</span>
                        <Plus size={17} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="composer-hint" role="status">
                  {type === "task" ? "Nenhuma tarefa" : "Nenhum comportamento"} sem objetivo
                  encontrado para esta busca.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
