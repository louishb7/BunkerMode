import React, { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ArrowUpRight, ListTodo, Compass, Circle, Check } from "lucide-react"
import { Link } from "react-router-dom"

import { getErrorMessage } from "../../../api/httpClient"
import StatusNotice from "../../../components/ui/StatusNotice"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import { APP_ROUTES } from "../../../routes/routeConstants"
import { api } from "../../../services/bunkermodeApi"
import { getOverview, subscribeOverview, updateCachedTask, updateOverview } from "../../../state/overviewCache"
import { operationalDateFor, taskBelongsToDate } from "../../calendar/calendarUtils"
import { formatDateForApi } from "../../../utils/date"

const emptyOverview = { daily: null, dailyDate: null, all: null, objectives: null }

const emptyPreview = { error: "", items: [], loading: false }

export function selectHomeTasks(tasks = []) {
  return [
    ...tasks.filter((task) => task?.status !== "CONCLUIDA").slice(0, 3),
    ...tasks.filter((task) => task?.status === "CONCLUIDA").slice(0, 3),
  ]
}

function dailyFromBoard(tasks, timezone) {
  const date = operationalDateFor(timezone)
  return tasks.filter((task) => taskBelongsToDate(task, date, timezone))
}

export function selectHomeObjectives(objetivos = []) {
  return objetivos
    .filter((objetivo) => objetivo?.status !== "concluido" && objetivo?.status !== "abandonado")
    .slice(0, 2)
}

function CompartmentLink({ children, to }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-sm font-semibold text-text-primary no-underline hover:bg-surface-subtle"
      to={to}
    >
      {children}
      <ArrowUpRight size={18} aria-hidden="true" />
    </Link>
  )
}
function PreviewState({ preview, empty }) {
  if (preview.loading)
    return (
      <p role="status" className="m-0 py-5 text-sm text-text-secondary">
        Carregando…
      </p>
    )
  if (preview.error) return <StatusNotice status={{ type: "error", message: preview.error }} />
  if (!preview.items.length) return <p className="m-0 py-5 text-sm text-text-secondary">{empty}</p>
  return null
}
function TasksCompartment({ preview, onComplete, completingId }) {
  return (
    <section aria-labelledby="home-tasks-title" className="work-surface p-5 sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-peripheral text-text-primary">
            <ListTodo size={21} aria-hidden="true" />
          </span>
          <div>
            <h2 id="home-tasks-title" className="m-0 text-base font-semibold">
              Tarefas
            </h2>
            <span className="text-xs text-text-secondary">Hoje</span>
          </div>
        </div>
        <Link
          to={APP_ROUTES.TASKS}
          aria-label="Abrir Tarefas"
          title="Abrir Tarefas"
          className="grid size-11 place-items-center rounded-control text-text-secondary hover:bg-peripheral"
        >
          <ArrowUpRight size={21} aria-hidden="true" />
        </Link>
      </header>
      <PreviewState preview={preview} empty="Nenhuma tarefa aberta para hoje." />
      {!preview.loading && !preview.error && (
        <ul className="m-0 list-none p-0">
          {preview.items.map((task) => (
            <li
              key={task.id}
              className="flex items-start gap-3 border-t border-border py-4 text-sm font-medium leading-6"
            >
              <button
                type="button"
                aria-label={`${task.status === "CONCLUIDA" ? "Concluída" : "Concluir"}: ${task.titulo}`}
                disabled={task.status === "CONCLUIDA" || completingId === task.id || !task.permissions?.can_complete}
                onClick={() => onComplete(task)}
                className="mt-1 grid size-[17px] shrink-0 place-items-center rounded-full border-0 bg-transparent p-0 text-text-muted focus-visible:outline-2 focus-visible:outline-focus-ring disabled:cursor-default"
              >
                {task.status === "CONCLUIDA" ? <Check size={17} aria-hidden="true" /> : <Circle size={17} aria-hidden="true" />}
              </button>
              <span className={`min-w-0 break-words ${task.status === "CONCLUIDA" ? "text-text-muted line-through" : ""}`}>{task.titulo}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
function ObjectivesCompartment({ preview }) {
  return (
    <section aria-labelledby="home-objectives-title" className="work-surface p-5 sm:p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-peripheral text-text-primary">
            <Compass size={21} aria-hidden="true" />
          </span>
          <div>
            <h2 id="home-objectives-title" className="m-0 text-base font-semibold">
              Objetivos
            </h2>
            <span className="text-xs text-text-secondary">Em andamento</span>
          </div>
        </div>
        <Link
          to={APP_ROUTES.OBJECTIVES}
          aria-label="Abrir Objetivos"
          title="Abrir Objetivos"
          className="grid size-11 place-items-center rounded-control text-text-secondary hover:bg-peripheral"
        >
          <ArrowUpRight size={21} aria-hidden="true" />
        </Link>
      </header>
      <PreviewState preview={preview} empty="Nenhum objetivo em andamento." />
      {!preview.loading && !preview.error && (
        <ol className="m-0 grid list-none gap-5 p-0">
          {preview.items.map((objetivo) => (
            <li key={objetivo.id} className="border-l-2 border-selection-border pl-4">
              <h3 className="m-0 break-words text-lg font-semibold leading-snug tracking-tight">
                {objetivo.titulo}
              </h3>
              {objetivo.descricao && (
                <p className="mt-2 mb-0 break-words text-sm leading-6 text-text-secondary">
                  {objetivo.descricao}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default function HomePage({ onUnauthorized, token, user }) {
  const enabledModules = getEnabledModules(user)
  const tasksEnabled = enabledModules.some((module) => module.key === "tasks")
  const objectivesEnabled = enabledModules.some((module) => module.key === "objectives")
  const cached = useSyncExternalStore(subscribeOverview, () => getOverview(token), () => emptyOverview)
  const [tasksPreview, setTasksPreview] = useState(emptyPreview)
  const [objectivesPreview, setObjectivesPreview] = useState(emptyPreview)
  const [completingId, setCompletingId] = useState(null)
  const [completeError, setCompleteError] = useState("")
  const mutationVersion = useRef(0)
  const todayKey = formatDateForApi(operationalDateFor(user?.timezone))
  const knownDaily = cached.dailyDate === todayKey ? cached.daily : (cached.all ? dailyFromBoard(cached.all, user?.timezone) : null)
  const taskView = knownDaily ? { error: "", items: selectHomeTasks(knownDaily), loading: false } : tasksPreview
  const objectiveView = cached.objectives ? { error: "", items: selectHomeObjectives(cached.objectives), loading: false } : objectivesPreview

  async function completeTask(task) {
    if (!task.permissions?.can_complete || completingId) return
    setCompletingId(task.id)
    setCompleteError("")
    mutationVersion.current += 1
    const previous = task
    updateCachedTask(token, { ...task, status: "CONCLUIDA", status_code: "CONCLUIDA", status_label: "Concluída", completed_at: new Date().toISOString(), permissions: { ...task.permissions, can_complete: false } })
    const result = await api.completeTask(token, task.id)
    setCompletingId(null)
    if (onUnauthorized?.(result)) return
    if (!result.ok) {
      updateCachedTask(token, previous)
      setCompleteError(getErrorMessage(result, "Não foi possível concluir a tarefa."))
      return
    }
    updateCachedTask(token, result.data)
  }

  useEffect(() => {
    let cancelled = false

    if (!tasksEnabled || !token) {
      setTasksPreview(emptyPreview)
      return () => {
        cancelled = true
      }
    }

    async function loadTasks() {
      const startedAtVersion = mutationVersion.current
      const known = getOverview(token)
      if (!(known.daily && known.dailyDate === todayKey) && !known.all) setTasksPreview({ error: "", items: [], loading: true })

      const result = await api.listDailyTasks(token)
      if (cancelled || onUnauthorized?.(result)) {
        return
      }
      if (startedAtVersion !== mutationVersion.current) return

      if (!result.ok) {
        setTasksPreview({
          error: getErrorMessage(result, "Não foi possível carregar as tarefas de hoje."),
          items: [],
          loading: false,
        })
        return
      }

      updateOverview(token, { daily: result.data, dailyDate: todayKey })
      setTasksPreview({ error: "", items: selectHomeTasks(result.data), loading: false })
    }

    void loadTasks()
    return () => {
      cancelled = true
    }
  }, [onUnauthorized, tasksEnabled, token, todayKey])

  useEffect(() => {
    let cancelled = false

    if (!objectivesEnabled || !token) {
      setObjectivesPreview(emptyPreview)
      return () => {
        cancelled = true
      }
    }

    async function loadObjectives() {
      if (!getOverview(token).objectives) setObjectivesPreview({ error: "", items: [], loading: true })
      const result = await api.listObjetivos(token)
      if (cancelled || onUnauthorized?.(result)) {
        return
      }

      if (!result.ok) {
        setObjectivesPreview({
          error: getErrorMessage(result, "Não foi possível carregar objetivos."),
          items: [],
          loading: false,
        })
        return
      }

      const objetivos = Array.isArray(result.data) ? result.data : []
      updateOverview(token, { objectives: objetivos })
      setObjectivesPreview({ error: "", items: selectHomeObjectives(objetivos), loading: false })
    }

    void loadObjectives()
    return () => {
      cancelled = true
    }
  }, [objectivesEnabled, onUnauthorized, token])

  return (
    <section className="grid gap-7">
      <header className="pt-2 pb-3">
        <p className="m-0 mb-2 text-sm text-text-secondary">{user?.usuario}</p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">Seu Bunker</h1>
      </header>
      {enabledModules.length === 0 ? (
        <section className="work-surface grid gap-3 p-6" aria-labelledby="home-empty-title">
          <h2 id="home-empty-title" className="m-0 text-lg font-semibold">
            Nenhuma ferramenta habilitada
          </h2>
          <p className="m-0 text-sm text-text-secondary">
            Ative Tarefas ou Objetivos nas configurações do seu Bunker.
          </p>
          <div>
            <CompartmentLink to={APP_ROUTES.SETTINGS}>Configurações</CompartmentLink>
          </div>
        </section>
      ) : (
        <div
          className={`grid items-start gap-5 ${tasksEnabled && objectivesEnabled ? "xl:grid-cols-[1fr_1.1fr]" : "max-w-2xl"}`}
        >
          {tasksEnabled && <div className="grid gap-2"><StatusNotice status={completeError || (knownDaily && tasksPreview.error) ? { type: "error", message: completeError || tasksPreview.error } : null} /><TasksCompartment preview={taskView} onComplete={completeTask} completingId={completingId} /></div>}
          {objectivesEnabled && <div className="grid gap-2"><StatusNotice status={cached.objectives && objectivesPreview.error ? { type: "error", message: objectivesPreview.error } : null} /><ObjectivesCompartment preview={objectiveView} /></div>}
        </div>
      )}
    </section>
  )
}
