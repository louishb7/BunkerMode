export const FOCUS_DURATIONS = [25, 45, 60, 90] as const
export type FocusDuration = (typeof FOCUS_DURATIONS)[number]
export type FocusSession = {
  activityText: string
  taskId?: number
  taskTitle?: string
  phase: "active" | "ended" | "break" | "break-ended"
  startedAt: number
  endsAt: number
  durationMinutes: FocusDuration
  endedManually?: boolean
}

export const focusStorageKey = (userId: number | string) => `bunkermode_focus:${userId}`
export const durationStorageKey = (userId: number | string) => `bunkermode_focus_duration:${userId}`
export const isFocusDuration = (value: unknown): value is FocusDuration =>
  FOCUS_DURATIONS.some((duration) => duration === value)

export function resolveFocusTime(session: FocusSession, now = Date.now()): FocusSession {
  if (now < session.endsAt) return session
  if (session.phase === "active") return { ...session, phase: "ended", endedManually: false }
  if (session.phase === "break") return { ...session, phase: "break-ended" }
  return session
}

export function remainingMinutes(session: FocusSession, now = Date.now()) {
  return Math.max(0, Math.ceil((session.endsAt - now) / 60000))
}

export function newFocusBlock(
  activity: Pick<FocusSession, "activityText" | "taskId" | "taskTitle">,
  durationMinutes: FocusDuration,
  now = Date.now()
): FocusSession {
  return {
    ...activity,
    activityText: activity.activityText.trim(),
    durationMinutes,
    phase: "active",
    startedAt: now,
    endsAt: now + durationMinutes * 60000,
  }
}

export function newFocusBreak(session: FocusSession, now = Date.now()): FocusSession {
  return { ...session, phase: "break", startedAt: now, endsAt: now + 5 * 60000 }
}

export function readFocusSession(
  storage: Storage,
  userId: number | string,
  now = Date.now()
): FocusSession | null {
  const key = focusStorageKey(userId)
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw)
    const valid =
      value &&
      typeof value.activityText === "string" &&
      value.activityText.trim().length > 0 &&
      value.activityText.length <= 500 &&
      ["active", "ended", "break", "break-ended"].includes(value.phase) &&
      isFocusDuration(value.durationMinutes) &&
      Number.isSafeInteger(value.startedAt) &&
      value.startedAt > 0 &&
      Number.isSafeInteger(value.endsAt) &&
      value.endsAt <= 8640000000000000 &&
      value.endsAt - value.startedAt ===
        (["break", "break-ended"].includes(value.phase) ? 5 : value.durationMinutes) * 60000 &&
      (value.taskId === undefined || (Number.isSafeInteger(value.taskId) && value.taskId > 0)) &&
      (value.taskTitle === undefined || typeof value.taskTitle === "string") &&
      (value.endedManually === undefined || typeof value.endedManually === "boolean")
    if (valid) return resolveFocusTime(value, now)
  } catch {
    /* Storage indisponível ou corrompido não impede intenção livre. */
  }
  try {
    storage.removeItem(key)
  } catch {
    /* Sem persistência disponível. */
  }
  return null
}

export function readFocusDuration(storage: Storage, userId: number | string): FocusDuration {
  try {
    const value = Number(storage.getItem(durationStorageKey(userId)))
    if (isFocusDuration(value)) return value
  } catch {
    /* Usa o valor inicial quando o navegador bloqueia storage. */
  }
  return 45
}
