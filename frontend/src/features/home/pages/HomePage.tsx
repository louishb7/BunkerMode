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

export const selectHomeTasks = (tasks = []) =>
  tasks.filter((task) => task.status !== "CONCLUIDA").slice(0, 3)
export const selectHomeObjectives = (goals = []) =>
  goals.filter((goal) => goal.status === "ativo").slice(0, 3)

export default function HomePage({ token, user, onUnauthorized }) {
  const modules = getEnabledModules(user)
  const tasksEnabled = modules.some((m) => m.key === "tasks")
  const objectivesEnabled = modules.some((m) => m.key === "objectives")
  const financesEnabled = modules.some((m) => m.key === "finances")
  const preferenceKey = modules.map((m) => m.key).join(",")
  const key = `${token}:${preferenceKey}`
  const [snapshot, setSnapshot] = useState(null)
  const data = snapshot?.key === key ? snapshot.data : null
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(null)
  const [tasksError, setTasksError] = useState("")
  const version = useRef(0)
  const [focus, setFocus] = useState(() =>
    tasksEnabled ? readFocusSession(window.localStorage, user.id) : null
  )
  const refresh = useCallback(async () => {
    const current = ++version.current
    const prepared = tasksEnabled
      ? await api.materializeTaskRecurrences(token)
      : { ok: true as const, status: 200, data: null }
    if (current !== version.current || onUnauthorized?.(prepared)) return
    setTasksError(
      prepared.ok ? "" : getErrorMessage(prepared, "Não foi possível preparar as tarefas de hoje.")
    )
    const result = await api.getOrientation(token, prepared.ok)
    if (current !== version.current || onUnauthorized?.(result)) return
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível carregar seu Bunker."))
      return
    }
    setSnapshot((previous) => ({
      key,
      data: {
        ...result.data,
        tarefas:
          (!prepared.ok || result.data.falhas?.tarefas) && previous?.key === key
            ? previous.data.tarefas
            : result.data.tarefas,
        financeiro:
          result.data.falhas?.recursos && previous?.key === key
            ? previous.data.financeiro
            : result.data.financeiro,
        direcoes:
          result.data.falhas?.direcoes && previous?.key === key
            ? previous.data.direcoes
            : result.data.direcoes,
      },
    }))
    setError("")
  }, [key, tasksEnabled, token, onUnauthorized])
  useEffect(() => {
    version.current += 1
    setError("")
    setBusy(null)
    void refresh()
    const updateFocus = () =>
      setFocus(tasksEnabled ? readFocusSession(window.localStorage, user.id) : null)
    updateFocus()
    const timer = setInterval(updateFocus, 30000)
    window.addEventListener("storage", updateFocus)
    return () => {
      version.current++
      clearInterval(timer)
      window.removeEventListener("storage", updateFocus)
    }
  }, [refresh, tasksEnabled, user.id])
  async function complete(task) {
    if (busy !== null) return
    setBusy(task.id)
    const current = ++version.current
    const result = await api.completeTask(token, task.id)
    if (current !== version.current) return
    setBusy(null)
    if (onUnauthorized?.(result)) return
    if (!result.ok) {
      setError(getErrorMessage(result, "Não foi possível concluir a tarefa."))
      return
    }
    await refresh()
  }
  return (
    <section className="home-orientation">
      <header className="home-heading">
        <p className="eyebrow">Orientação</p>
        <h1>Seu Bunker</h1>
        <p>O que importa agora.</p>
      </header>
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
              {(tasksError || data.falhas?.tarefas) && (
                <p role="status" className="text-sm text-danger">
                  {tasksError || "Não foi possível consultar as tarefas."}{" "}
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
                    </li>
                  ))}
                </ol>
              ) : (
                !tasksError &&
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
                          reserves={financesEnabled ? goal.reserves : []}
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
              <h2>Reservas sem cobertura no saldo registrado</h2>
              <p>Faltam {money(-data.financeiro.livre_centavos)} para cobrir o valor separado.</p>
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
