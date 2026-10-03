import React, { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUpRight, Circle, Focus } from "lucide-react"
import { Link } from "react-router-dom"
import { api } from "../../../services/bunkermodeApi"
import { getErrorMessage } from "../../../api/httpClient"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import LoadingLines from "../../../components/ui/LoadingLines"
import Button from "../../../components/ui/Button"
import ObjectiveSummary from "../../objectives/components/ObjectiveSummary"
import { money } from "../../finances/money"
import { readFocusSession } from "../../tasks/focusSession"
import { getApiAvailability, subscribeApiAvailability } from "../../../offline/apiAvailability"
import { readSnapshot, saveSnapshot } from "../../../offline/snapshots"
import OfflineNotice from "../../../components/system/OfflineNotice"
import { getOrientationCache, setOrientationCache } from "../../../state/orientationCache"
import {
  enqueueOperation,
  projectGoals,
  projectTasks,
  subscribeOutbox,
} from "../../../offline/outbox"
import type { OutboxOperation } from "../../../offline/snapshots"
import SyncLabel from "../../../components/system/SyncLabel"

export const selectHomeTasks = (tasks = []) =>
  tasks.filter((task) => task.status !== "CONCLUIDA").slice(0, 3)
export const selectHomeObjectives = (goals = []) =>
  goals.filter((goal) => goal.status === "ativo").slice(0, 3)
type OrientationSnapshot = {
  tarefas: any[]
  direcoes: any[]
  financeiro: any
  falhas?: Record<string, unknown>
}
const validOrientation = (data: unknown, financesEnabled = true): data is OrientationSnapshot => {
  const item = data as { tarefas: unknown[]; direcoes: unknown[]; financeiro?: unknown }
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object"
  return (
    !!item &&
    typeof item === "object" &&
    Array.isArray(item.tarefas) &&
    item.tarefas.every(
      (task) => record(task) && Number.isSafeInteger(task.id) && typeof task.titulo === "string"
    ) &&
    Array.isArray(item.direcoes) &&
    item.direcoes.every(
      (goal) =>
        record(goal) &&
        Number.isSafeInteger(goal.id) &&
        typeof goal.titulo === "string" &&
        Array.isArray(goal.tasks) &&
        goal.tasks.every(
          (task: unknown) =>
            record(task) && Number.isSafeInteger(task.id) && typeof task.titulo === "string"
        ) &&
        Array.isArray(goal.trackers) &&
        goal.trackers.every(
          (tracker: unknown) =>
            record(tracker) &&
            typeof tracker.titulo === "string" &&
            Array.isArray(tracker.ocorrencias)
        )
    ) &&
    (!financesEnabled ||
      item.financeiro == null ||
      (record(item.financeiro) && Number.isSafeInteger(item.financeiro.saldo_centavos)))
  )
}

export default function HomePage({ token, user, onUnauthorized }) {
  const modules = getEnabledModules(user)
  const tasksEnabled = modules.some((m) => m.key === "tasks")
  const objectivesEnabled = modules.some((m) => m.key === "objectives")
  const financesEnabled = modules.some((m) => m.key === "finances")
  const preferenceKey = modules.map((m) => m.key).join(",")
  const key = `${user.id}:${preferenceKey}`
  const durableKey = `orientation:${preferenceKey}`
  const [snapshot, setSnapshot] = useState(() => getOrientationCache())
  const [operations, setOperations] = useState<OutboxOperation[]>([])
  useEffect(() => subscribeOutbox(user.id, setOperations), [user.id])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const officialData = snapshot?.key === key ? snapshot.data : null
  const data = officialData
    ? {
        ...officialData,
        tarefas: projectTasks(
          officialData.tarefas,
          operations.filter((item) => item.action !== "create")
        )
          .filter((task) => task.status !== "CONCLUIDA")
          .slice(0, 3),
        direcoes: projectGoals(
          officialData.direcoes,
          operations.filter((item) => item.action !== "create")
        ).filter((goal) => goal.status === "ativo"),
      }
    : null
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(null)
  const version = useRef(0)
  const [focus, setFocus] = useState(() =>
    tasksEnabled ? readFocusSession(window.localStorage, user.id) : null
  )
  const refresh = useCallback(async () => {
    const current = ++version.current
    const result = await api.getOrientation(token)
    if (current !== version.current || onUnauthorized?.(result)) return
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível carregar seu Bunker."))
      return
    }
    if (!validOrientation(result.data, financesEnabled)) {
      setError("Resposta da orientação inválida.")
      return
    }
    const next = {
      key,
      data: {
        ...result.data,
        tarefas: !tasksEnabled
          ? []
          : result.data.falhas?.tarefas && getOrientationCache()?.key === key
            ? getOrientationCache().data.tarefas
            : result.data.tarefas,
        financeiro: !financesEnabled
          ? null
          : result.data.falhas?.recursos && getOrientationCache()?.key === key
            ? getOrientationCache().data.financeiro
            : result.data.financeiro,
        direcoes: !objectivesEnabled
          ? []
          : result.data.falhas?.direcoes && getOrientationCache()?.key === key
            ? getOrientationCache().data.direcoes
            : result.data.direcoes,
      },
    }
    setOrientationCache(next)
    setSnapshot(next)
    const saved = await saveSnapshot(user.id, durableKey, next.data)
    setLastUpdated(saved?.updatedAt ?? new Date().toISOString())
    setError("")
  }, [
    key,
    durableKey,
    token,
    user.id,
    onUnauthorized,
    tasksEnabled,
    objectivesEnabled,
    financesEnabled,
  ])
  useEffect(() => {
    setLastUpdated(null)
    version.current += 1
    setError("")
    setBusy(null)
    let cancelled = false
    void (async () => {
      const entry = await readSnapshot(user.id, durableKey, (data): data is OrientationSnapshot =>
        validOrientation(data, financesEnabled)
      )
      if (cancelled) return
      if (entry && getOrientationCache()?.key !== key) {
        const next = { key, data: entry.data }
        setOrientationCache(next)
        setSnapshot(next)
      }
      setLastUpdated((current) => current ?? entry?.updatedAt ?? null)
      if (getApiAvailability() !== "unavailable") void refresh()
    })()
    const updateFocus = () =>
      setFocus(tasksEnabled ? readFocusSession(window.localStorage, user.id) : null)
    updateFocus()
    const timer = setInterval(updateFocus, 30000)
    window.addEventListener("storage", updateFocus)
    return () => {
      cancelled = true
      version.current++
      clearInterval(timer)
      window.removeEventListener("storage", updateFocus)
    }
  }, [refresh, tasksEnabled, financesEnabled, user.id, durableKey, key])
  useEffect(() => {
    let previous = getApiAvailability()
    return subscribeApiAvailability(() => {
      const next = getApiAvailability()
      if (previous === "unavailable" && next === "available") void refresh()
      previous = next
    })
  }, [refresh])
  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ ownerId: number }>).detail?.ownerId === user.id) void refresh()
    }
    window.addEventListener("bunkermode-official-change", update)
    return () => window.removeEventListener("bunkermode-official-change", update)
  }, [user.id, refresh])
  async function complete(task) {
    if (busy !== null) return
    setBusy(task.id)
    try {
      await enqueueOperation(user.id, "task", "complete", {}, task.id, task.updated_at)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Não foi possível salvar localmente.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="home-orientation">
      <header className="home-heading">
        <h1>Seu Bunker</h1>
      </header>
      <OfflineNotice updatedAt={lastUpdated} />
      {error && (
        <div role="alert" className="text-sm text-danger">
          {error}{" "}
          <Button variant="ghost" onClick={refresh}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!modules.length ? (
        <div className="empty-copy">
          <p>Nenhuma ferramenta habilitada.</p>
          <Link className="text-link" to="/configuracoes">
            Escolher ferramentas
          </Link>
        </div>
      ) : !data ? (
        !error && <LoadingLines label="Carregando seu Bunker" />
      ) : (
        <>
          {tasksEnabled && (
            <section className="home-now" aria-labelledby="now-title">
              <header className="section-heading">
                <h2 id="now-title">Agora</h2>
                <Link className="text-link" to="/tarefas/foco">
                  <Focus size={17} />
                  {focus ? "Retomar foco" : "Entrar em Foco"}
                </Link>
              </header>
              {data.falhas?.tarefas && (
                <p role="status" className="text-sm text-danger">
                  Não foi possível consultar as tarefas.{" "}
                  <Button variant="ghost" onClick={refresh}>
                    Tentar novamente
                  </Button>
                </p>
              )}
              {focus ? (
                <Link to="/tarefas/foco" className="home-focus">
                  <span className="eyebrow">
                    {focus.phase === "active"
                      ? "Seu contexto escolhido"
                      : focus.phase === "break"
                        ? "Pausa em andamento"
                        : "Bloco encerrado · escolha o próximo passo"}
                  </span>
                  <strong>{focus.activityText}</strong>
                  <ArrowUpRight size={24} aria-hidden="true" />
                </Link>
              ) : data.tarefas.length ? (
                <ol className="home-actions">
                  {data.tarefas.map((task) => (
                    <li key={task.id}>
                      <button
                        className="home-complete"
                        disabled={busy !== null || !task.permissions?.can_complete}
                        aria-label={`Concluir: ${task.titulo}`}
                        onClick={() => complete(task)}
                      >
                        <Circle size={21} aria-hidden="true" />
                      </button>
                      <span>{task.titulo}</span>
                      <SyncLabel status={task.syncStatus} />
                    </li>
                  ))}
                </ol>
              ) : (
                !data.falhas?.tarefas && (
                  <p className="empty-copy">
                    O dia está aberto. Escolha uma atividade para o próximo bloco de foco.
                  </p>
                )
              )}
              <Link to="/tarefas" className="text-link">
                Ver o dia <ArrowUpRight size={15} />
              </Link>
            </section>
          )}
          {objectivesEnabled && (
            <section className="home-directions" aria-labelledby="directions-title">
              <header className="section-heading">
                <h2 id="directions-title">Direções</h2>
                <Link to="/objetivos" className="text-link">
                  Ver objetivos <ArrowUpRight size={15} />
                </Link>
              </header>
              {data.falhas?.direcoes && (
                <p role="status" className="text-sm text-danger">
                  Não foi possível consultar suas direções.{" "}
                  <Button variant="ghost" onClick={refresh}>
                    Tentar novamente
                  </Button>
                </p>
              )}
              {data.direcoes.length ? (
                <ol className="m-0 list-none p-0">
                  {data.direcoes.map((goal, index) => (
                    <li key={goal.id} className="home-direction">
                      <span className="direction-number" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <h3>
                          <Link to={`/objetivos#objetivo-${goal.id}`}>{goal.titulo}</Link>
                        </h3>
                        <ObjectiveSummary
                          variant="home"
                          objetivo={goal}
                          trackers={goal.trackers}
                          tasks={
                            tasksEnabled
                              ? goal.tasks.filter(
                                  (task) => !data.tarefas.some((shown) => shown.id === task.id)
                                )
                              : []
                          }
                          timezone={user?.timezone}
                        />
                      </div>
                      <Link
                        aria-label={`Abrir objetivo: ${goal.titulo}`}
                        className="direction-open"
                        to={`/objetivos#objetivo-${goal.id}`}
                      >
                        <ArrowUpRight size={20} />
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                !data.falhas?.direcoes && (
                  <p className="empty-copy">
                    Nenhuma direção ativa. Seus objetivos pausados e encerrados continuam em
                    Objetivos.
                  </p>
                )
              )}
            </section>
          )}
          {financesEnabled && data.falhas?.recursos && (
            <p role="status" className="text-sm text-danger">
              Não foi possível verificar os recursos.{" "}
              <Button variant="ghost" onClick={refresh}>
                Tentar novamente
              </Button>
            </p>
          )}
          {financesEnabled && data.financeiro && (
            <section className="home-attention" aria-label="Estado que pede atenção">
              <p className="eyebrow">Recursos</p>
              <h2>Saldo registrado negativo</h2>
              <p>O saldo está em {money(data.financeiro.saldo_centavos)}.</p>
              <Link className="text-link" to="/financas">
                Revisar recursos <ArrowUpRight size={15} />
              </Link>
            </section>
          )}
          {!tasksEnabled && !objectivesEnabled && !data.financeiro && (
            <p className="empty-copy">
              Nenhum estado pede atenção agora. Suas ferramentas estão na navegação.
            </p>
          )}
        </>
      )}
    </section>
  )
}
