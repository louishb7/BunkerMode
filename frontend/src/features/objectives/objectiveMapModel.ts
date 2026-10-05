import type { ObjectiveMapNode } from "../../types/achievementContract"
import type { Task } from "../../types/taskContract"
import type { Tracker } from "../../types/trackerContract"
import { operationalDateFor, taskBelongsToDate } from "../calendar/calendarUtils"
import { practiceFact } from "../practices/practiceDomain"

export function elapsedDays(from: string, to: Date, timezone?: string) {
  const date = new Date(from)
  if (!Number.isFinite(date.getTime())) return null
  const day = (moment: Date) => {
    const parts = operationalDateFor(timezone, moment)
    return Date.UTC(parts.getFullYear(), parts.getMonth(), parts.getDate())
  }
  return Math.max(0, Math.round((day(to) - day(date)) / 86400000))
}

export function displayDate(value?: string | null, timezone?: string) {
  if (!value) return "Data não registrada"
  const iso = /^\d{2}-\d{2}-\d{4}$/.test(value) ? value.split("-").reverse().join("-") : value
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: timezone,
      })
    : "Data não registrada"
}

export function todayTasks(tasks: Task[], timezone?: string, now = new Date()) {
  const today = operationalDateFor(timezone, now)
  return tasks.filter((task) => taskBelongsToDate(task, today, timezone))
}

export function liveMapNodes(
  tasks: Task[],
  trackers: Tracker[],
  timezone?: string
): ObjectiveMapNode[] {
  const nodes: ObjectiveMapNode[] = []
  const series = new Map<number | string, Task[]>()
  for (const task of tasks) {
    const recurrence =
      task.recurrence ??
      (task.recurringIntent
        ? { series_id: task.id, weekdays: task.recurringIntent.weekdays }
        : null)
    if (recurrence) {
      const group = series.get(recurrence.series_id) ?? []
      group.push(task)
      series.set(recurrence.series_id, group)
    } else
      nodes.push({
        id: `task-${task.id}`,
        source_id: task.id,
        tipo: "tarefa",
        titulo: task.titulo,
        descricao: task.instrucao,
        estado: task.status_code || task.status,
        data: task.prazo,
        syncStatus: task.syncStatus,
        atividade_em: task.completed_at,
      })
  }
  for (const [id, occurrences] of series) {
    const today = todayTasks(occurrences, timezone)
    const task =
      today.find((item) => item.status !== "CONCLUIDA") ??
      today[0] ??
      occurrences.find((item) => (item.status_code || item.status) === "PENDENTE") ??
      occurrences.at(-1)!
    nodes.push({
      id: `routine-${id}`,
      source_id: task.id,
      tipo: "rotina",
      titulo: task.titulo,
      descricao: task.instrucao,
      estado: task.status_code || task.status,
      data: task.prazo,
      frequencia: task.recurrence?.weekdays ?? task.recurringIntent?.weekdays,
      realizadas: occurrences.filter((item) => item.status === "CONCLUIDA" && !item.syncStatus)
        .length,
      atividade_em: occurrences
        .map((item) => item.completed_at)
        .filter(Boolean)
        .sort()
        .at(-1),
      syncStatus: task.syncStatus,
    })
  }
  for (const tracker of trackers) {
    const last = [...(tracker.ocorrencias ?? [])].sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at)
    )[0]
    nodes.push({
      id: `tracker-${tracker.id}`,
      tipo: "acompanhamento",
      titulo: tracker.titulo,
      descricao: tracker.descricao,
      ultima_ocorrencia: last?.occurred_at ?? null,
      syncStatus: tracker.syncStatus,
      practice_intent: tracker.intent,
      practice_fact: tracker.intent && tracker.intent !== "registro_livre" ? practiceFact(tracker, new Date(), timezone) : undefined,
    })
  }
  return nodes
}

export function nodeFact(node: ObjectiveMapNode, timezone?: string, now = new Date()) {
  if (node.tipo === "acompanhamento") {
    if (node.practice_fact) return node.practice_fact
    if (!node.ultima_ocorrencia) return "Nenhuma ocorrência registrada"
    const days = elapsedDays(node.ultima_ocorrencia, now, timezone)
    return days === null
      ? "Data indisponível"
      : days === 0
        ? "Ocorrência registrada hoje"
        : `${days} ${days === 1 ? "dia" : "dias"} desde a ocorrência`
  }
  if (node.tipo === "rotina") {
    const count = node.frequencia?.length
    return count
      ? count === 7
        ? "Todos os dias"
        : `${count} ${count === 1 ? "dia" : "dias"} por semana`
      : "Recorrente"
  }
  if (node.estado === "CONCLUIDA") return "Concluída"
  if (node.estado === "NAO_REALIZADA") return "Não realizada"
  return node.data ? `Prevista · ${displayDate(node.data, timezone)}` : "Em aberto"
}
