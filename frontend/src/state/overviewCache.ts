import type { Task } from "../types/taskContract"
import type { Tracker } from "../types/trackerContract"

type Snapshot = {
  daily: Task[] | null
  dailyDate: string | null
  all: Task[] | null
  objectives: any[] | null
  trackers: Tracker[] | null
}
const snapshots = new Map<number, Snapshot>()
const listeners = new Set<() => void>()
const empty: Snapshot = {
  daily: null,
  dailyDate: null,
  all: null,
  objectives: null,
  trackers: null,
}

export function getOverview(ownerId: number): Snapshot {
  return snapshots.get(ownerId) ?? empty
}

export function updateOverview(ownerId: number, patch: Partial<Snapshot>) {
  if (!ownerId) return
  snapshots.set(ownerId, { ...getOverview(ownerId), ...patch })
  listeners.forEach((listener) => listener())
}

export function updateCachedTask(ownerId: number, task: Task) {
  const current = getOverview(ownerId)
  const replace = (tasks: Task[] | null) =>
    tasks?.map((item) => (item.id === task.id ? task : item)) ?? null
  updateOverview(ownerId, { daily: replace(current.daily), all: replace(current.all) })
}

export function unlinkTaskList(items: Task[], task: Task): Task[] {
  const seriesId = task.recurrence?.series_id
  return items.map((item) => {
    if (seriesId ? item.recurrence?.series_id !== seriesId : item.id !== task.id) return item
    return {
      ...item,
      objetivo_id: null,
      recurrence:
        item.recurrence?.termination_policy === "ate_objetivo"
          ? { ...item.recurrence, termination_policy: "sem_termino" as const }
          : item.recurrence,
    }
  })
}

export function unlinkCachedObjectiveTask(ownerId: number, task: Task) {
  const current = getOverview(ownerId)
  updateOverview(ownerId, {
    all: current.all ? unlinkTaskList(current.all, task) : null,
    daily: current.daily ? unlinkTaskList(current.daily, task) : null,
  })
}

export function detachObjectiveTaskList(items: Task[], objectiveId: number): Task[] {
  return items.map((item) =>
    item.objetivo_id === objectiveId ? { ...item, objetivo_id: null } : item
  )
}

export function removeObjectiveFromOverview(ownerId: number, objectiveId: number) {
  const current = getOverview(ownerId)
  updateOverview(ownerId, {
    all: current.all ? detachObjectiveTaskList(current.all, objectiveId) : null,
    daily: current.daily ? detachObjectiveTaskList(current.daily, objectiveId) : null,
    trackers:
      current.trackers?.map((item) =>
        item.objetivo_id === objectiveId ? { ...item, objetivo_id: null } : item
      ) ?? null,
  })
}

export function subscribeOverview(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearOverview() {
  snapshots.clear()
  listeners.forEach((listener) => listener())
}
