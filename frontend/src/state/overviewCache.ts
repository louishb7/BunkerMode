import type { Task } from "../types/taskContract"

type Snapshot = { daily: Task[] | null; dailyDate: string | null; all: Task[] | null; objectives: any[] | null }
const snapshots = new Map<string, Snapshot>()
const listeners = new Set<() => void>()
const empty: Snapshot = { daily: null, dailyDate: null, all: null, objectives: null }

export function getOverview(token: string): Snapshot {
  return snapshots.get(token) ?? empty
}

export function updateOverview(token: string, patch: Partial<Snapshot>) {
  if (!token) return
  snapshots.set(token, { ...getOverview(token), ...patch })
  listeners.forEach((listener) => listener())
}

export function updateCachedTask(token: string, task: Task) {
  const current = getOverview(token)
  const replace = (tasks: Task[] | null) => tasks?.map((item) => item.id === task.id ? task : item) ?? null
  updateOverview(token, { daily: replace(current.daily), all: replace(current.all) })
}

export function subscribeOverview(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function clearOverview() {
  snapshots.clear()
  listeners.forEach((listener) => listener())
}
