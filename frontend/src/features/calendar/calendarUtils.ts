import { formatDateForApi } from "../../utils/date"

export function startOfDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

export function operationalDateFor(timezone, moment = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(moment)
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return new Date(Number(byType.year), Number(byType.month) - 1, Number(byType.day))
  } catch {
    return startOfDay(moment)
  }
}

export function addDays(value, amount) {
  const next = new Date(value)
  next.setDate(next.getDate() + amount)
  return next
}

export function getWeekDays(referenceDate) {
  const base = startOfDay(referenceDate)
  const mondayOffset = base.getDay() === 0 ? -6 : 1 - base.getDay()
  const monday = addDays(base, mondayOffset)
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
}

export function formatShortDate(date) {
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${day}/${month}`
}

export function normalizeTaskDate(value) {
  if (!value || typeof value !== "string") {
    return ""
  }

  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
    return value
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-")
    return `${day}-${month}-${year}`
  }

  return value
}

export function taskBelongsToDate(task, selectedDate, timezone) {
  const date = formatDateForApi(selectedDate)
  if (normalizeTaskDate(task?.prazo) === date) return true
  const event = task?.completed_at
  if (!event) return false
  const moment = new Date(event)
  if (Number.isNaN(moment.getTime())) return false
  return formatDateForApi(operationalDateFor(timezone, moment)) === date
}

export function formatWeekLabel(weekDays) {
  if (!weekDays.length) {
    return ""
  }
  const first = weekDays[0]
  const last = weekDays[6]
  const month = (date) => date.toLocaleDateString("pt-BR", { month: "long" })
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear())
    return `${first.getDate()}–${last.getDate()} ${month(last)}`
  return `${first.getDate()} ${month(first)} – ${last.getDate()} ${month(last)}`
}

export function formatSelectedDate(date) {
  try {
    return date
      .toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      })
      .toUpperCase()
  } catch {
    return formatShortDate(date)
  }
}

export function formatCurrentDay(timezone = undefined) {
  try {
    return new Date()
      .toLocaleDateString("pt-BR", {
        timeZone: timezone,
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      })
      .toUpperCase()
  } catch {
    return "HOJE"
  }
}

export function getDateApiValue(date) {
  return formatDateForApi(date)
}
