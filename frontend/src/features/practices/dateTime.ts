export function formatPracticeLocalDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day, hour, minute] = match
  return `${day}/${month}/${year}, ${hour}:${minute}`
}

export function formatPracticeOccurrence(value: string, timezone?: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value))
}
