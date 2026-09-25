import { normalizeTaskDate, operationalDateFor } from "../calendar/calendarUtils"
import { formatDateForApi } from "../../utils/date"
import type { Task } from "../../types/taskContract"
import type { Tracker } from "../../types/trackerContract"

export type ObjectiveSignal = { kind: "tracker" | "task" | "date"; label: string; detail: string }

// Resume apenas fatos presentes no snapshot; ausência de ocorrências não implica sucesso.
export function trackerOccurrenceLabel(tracker: Tracker, timezone?: string, now = new Date()) {
  if (!Array.isArray(tracker.ocorrencias)) return "Ocorrências indisponíveis"
  const dates = tracker.ocorrencias
    .map((item) => new Date(item.occurred_at))
    .filter((date) => !Number.isNaN(date.getTime()))
  if (!dates.length)
    return tracker.ocorrencias.length
      ? "Data da ocorrência indisponível"
      : "Nenhuma ocorrência registrada"
  const last = new Date(Math.max(...dates.map((date) => date.getTime())))
  const calendarDay = (date: Date) => {
    const day = operationalDateFor(timezone, date)
    return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
  }
  const days = Math.round((calendarDay(now) - calendarDay(last)) / 86400000)
  if (days === 0) return "Última ocorrência registrada hoje"
  if (days === 1) return "Última ocorrência registrada ontem"
  if (days > 1) return `Última ocorrência registrada há ${days} dias`
  return `Última ocorrência: ${last.toLocaleDateString("pt-BR", { timeZone: timezone })}`
}

export function summarizeObjective({
  objetivo,
  trackers = [] as Tracker[],
  tasks = [] as Task[],
  timezone = undefined as string | undefined,
  now = new Date(),
}) {
  const signals: ObjectiveSignal[] = []
  const trackerSignals: ObjectiveSignal[] = trackers.map((tracker) => ({
    kind: "tracker",
    label: tracker.titulo,
    detail: trackerOccurrenceLabel(tracker, timezone, now),
  }))
  if (trackerSignals.length) signals.push(trackerSignals[0])
  const open = tasks.filter((task) => (task.status_code || task.status) === "PENDENTE")
  const today = formatDateForApi(operationalDateFor(timezone, now))
  const todayTask = open.find((task) => normalizeTaskDate(task.prazo) === today)
  const task = todayTask || open[0]
  if (task)
    signals.push({
      kind: "task",
      label: task.titulo,
      detail: todayTask ? "Prevista para hoje" : "Tarefa em aberto",
    })
  if (signals.length < 2 && trackerSignals.length > 1) signals.push(trackerSignals[1])
  const target = normalizeTaskDate(objetivo.data_alvo)
  if (signals.length < 2 && /^\d{2}-\d{2}-\d{4}$/.test(target)) {
    signals.push({ kind: "date", label: "Data-alvo", detail: target.replaceAll("-", "/") })
  }
  return signals.slice(0, 2)
}
