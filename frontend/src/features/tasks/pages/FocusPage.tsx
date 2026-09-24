import React, { useEffect, useRef } from "react"
import Button from "../../../components/ui/Button"
import StatusNotice from "../../../components/ui/StatusNotice"
import FocusPreparation from "../components/FocusPreparation"
import { remainingMinutes } from "../focusSession"
import { useFocusSession } from "../hooks/useFocusSession"
import { canCompleteInFocus } from "../taskSelectors"

export default function FocusPage({ board, dailyTasks, timezone, userId, onExit }) {
  const focus = useFocusSession(userId)
  const { session } = focus
  const phase = session?.phase ?? "preparation"
  const heading = useRef<HTMLHeadingElement>(null)
  const previousPhase = useRef(phase)
  const deciding = phase === "ended" || phase === "break-ended"
  const linkedTask = dailyTasks.find((task) => task.id === session?.taskId)
  const refresh = board.refreshFocusBoard

  useEffect(() => {
    if (previousPhase.current !== phase) heading.current?.focus()
    previousPhase.current = phase
  }, [phase])

  // Revalida o vínculo ao decidir e ao voltar de outra aba; o texto é independente.
  useEffect(() => {
    if (!deciding || !session?.taskId) return
    void refresh()
    const refreshOnReturn = () => {
      if (!document.hidden) void refresh()
    }
    window.addEventListener("focus", refreshOnReturn)
    return () => window.removeEventListener("focus", refreshOnReturn)
  }, [deciding, session?.taskId, refresh])

  const title =
    phase === "preparation"
      ? "Modo Foco"
      : phase === "active"
        ? "Modo Foco"
        : phase === "break"
          ? "Pausa"
          : phase === "break-ended"
            ? "A pausa terminou."
            : session.endedManually
              ? "Bloco encerrado."
              : "O tempo deste bloco terminou."

  return (
    <section className="mx-auto grid w-full min-w-0 max-w-[640px] gap-6 rounded-card border border-border bg-surface p-5 shadow-surface sm:gap-8 sm:p-10">
      <header className="grid gap-3">
        <span
          aria-hidden="true"
          className={`h-0.5 w-8 rounded-full ${phase === "active" ? "bg-accent" : "bg-border-strong"}`}
        />
        <h1
          ref={heading}
          tabIndex={-1}
          className={`m-0 font-medium focus-visible:outline-2 focus-visible:outline-focus-ring ${phase === "active" ? "text-sm text-accent" : phase === "preparation" ? "text-sm text-text-secondary" : "text-xl text-text-primary"}`}
        >
          {title}
          {phase === "active" && <span className="sr-only"> — bloco ativo</span>}
        </h1>
      </header>
      {focus.storageUnavailable && (
        <p role="status" className="text-sm text-text-secondary">
          Este navegador não conseguiu guardar o bloco. Mantenha esta página aberta para continuar.
        </p>
      )}
      {phase === "preparation" ? (
        <>
          <StatusNotice status={board.status} />
          <FocusPreparation
            todayTasks={dailyTasks.filter(canCompleteInFocus)}
            duration={focus.duration}
            onDurationChange={focus.chooseDuration}
            onStart={focus.start}
          />
          {board.taskLoading && (
            <p role="status" className="text-sm text-text-secondary">
              Carregando tarefas de hoje…
            </p>
          )}
        </>
      ) : (
        <>
          {phase !== "break" && (
            <div className="grid min-w-0 gap-3">
              <h2 className="m-0 text-3xl font-semibold leading-snug sm:text-4xl text-text-primary [overflow-wrap:anywhere]">
                {session.activityText}
              </h2>
            </div>
          )}
          {phase === "active" && (
            <>
              <div className="grid gap-2">
                <p className="m-0 text-2xl font-medium text-text-primary">
                  Até{" "}
                  <time dateTime={new Date(session.endsAt).toISOString()}>
                    {new Intl.DateTimeFormat("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: timezone,
                    }).format(session.endsAt)}
                  </time>
                </p>
                <p role="timer" aria-live="off" className="m-0 text-sm text-text-secondary">
                  {remainingMinutes(session, focus.now)} min restantes
                </p>
              </div>
              {session.taskId && (
                <p className="m-0 text-sm text-text-secondary [overflow-wrap:anywhere]">
                  Tarefa vinculada · {linkedTask?.titulo ?? session.taskTitle ?? "Indisponível"}
                </p>
              )}
              <div className="border-t border-border pt-5">
                <Button className="w-full sm:w-auto" variant="secondary" onClick={focus.finish}>
                  Encerrar bloco
                </Button>
              </div>
            </>
          )}
          {phase === "break" && (
            <>
              <p className="m-0 text-lg text-text-secondary">
                Você não precisa começar outra coisa agora.
              </p>
              <p role="timer" aria-live="off" className="m-0 text-sm text-text-secondary">
                {remainingMinutes(session, focus.now)} min restantes
              </p>
              <Button
                className="w-full sm:w-auto sm:justify-self-start"
                variant="secondary"
                onClick={focus.finishBreak}
              >
                Encerrar pausa
              </Button>
            </>
          )}
          {deciding && (
            <>
              {session.taskId && (
                <p className="m-0 text-sm text-text-secondary [overflow-wrap:anywhere]">
                  Tarefa vinculada · {linkedTask?.titulo ?? session.taskTitle ?? "Indisponível"}
                </p>
              )}
              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:flex-wrap">
                <Button
                  onClick={() =>
                    focus.start(
                      {
                        activityText: session.activityText,
                        taskId: session.taskId,
                        taskTitle: session.taskTitle,
                      },
                      session.durationMinutes
                    )
                  }
                >
                  Continuar · {session.durationMinutes} min
                </Button>
                {phase === "ended" && (
                  <Button variant="secondary" onClick={focus.startBreak}>
                    Pausa de 5 min
                  </Button>
                )}
                <Button variant="secondary" onClick={focus.clear}>
                  Escolher outra atividade
                </Button>
              </div>
              <StatusNotice status={board.status} />
              {linkedTask && canCompleteInFocus(linkedTask) && board.status.type !== "error" && (
                <Button
                  className="sm:justify-self-start"
                  variant="ghost"
                  disabled={board.taskLoading}
                  loading={board.completeLoadingId === linkedTask.id}
                  onClick={() => board.completeTask(linkedTask)}
                >
                  Concluir tarefa
                </Button>
              )}
              <Button
                className="sm:justify-self-start"
                variant="ghost"
                onClick={() => {
                  focus.clear()
                  onExit()
                }}
              >
                Encerrar foco e voltar às tarefas
              </Button>
            </>
          )}
        </>
      )}
    </section>
  )
}
