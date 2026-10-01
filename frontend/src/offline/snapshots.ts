import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import { assertTaskListContract } from "../types/taskContract"

export type Snapshot<T> = {
  ownerId: number
  key: string
  data: T
  updatedAt: string
  schemaVersion: 1
}

interface OfflineDB extends DBSchema {
  snapshots: {
    key: [number, string]
    value: Snapshot<unknown>
    indexes: { ownerId: number }
  }
}

let database: Promise<IDBPDatabase<OfflineDB>> | null = null
function openDatabase() {
  if (typeof indexedDB === "undefined") return null
  try {
    database ??= openDB<OfflineDB>("bunkermode-offline", 1, {
      upgrade(db) {
        const store = db.createObjectStore("snapshots", { keyPath: ["ownerId", "key"] })
        store.createIndex("ownerId", "ownerId")
      },
    })
    return database
  } catch {
    return null
  }
}

const validOwner = (ownerId: number) => Number.isSafeInteger(ownerId) && ownerId > 0
const validKey = (key: string) =>
  typeof key === "string" && key.length > 0 && !key.includes("token")
const revokedOwners = new Set<number>()

export function allowUserData(ownerId: number) {
  revokedOwners.delete(ownerId)
}

export async function readSnapshot<T>(
  ownerId: number,
  key: string,
  valid: (data: unknown) => data is T
): Promise<Snapshot<T> | null> {
  const database = openDatabase()
  if (!database || !validOwner(ownerId) || !validKey(key)) return null
  try {
    const entry = await (await database).get("snapshots", [ownerId, key])
    if (
      entry?.schemaVersion !== 1 ||
      entry.ownerId !== ownerId ||
      entry.key !== key ||
      !Number.isFinite(Date.parse(entry.updatedAt)) ||
      !valid(entry.data)
    )
      return null
    return entry as Snapshot<T>
  } catch {
    return null
  }
}

export async function saveSnapshot<T>(
  ownerId: number,
  key: string,
  data: T
): Promise<Snapshot<T> | null> {
  const database = openDatabase()
  if (!database || !validOwner(ownerId) || !validKey(key) || revokedOwners.has(ownerId)) return null
  const entry: Snapshot<T> = {
    ownerId,
    key,
    data,
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  }
  try {
    const db = await database
    if (revokedOwners.has(ownerId)) return null
    await db.put("snapshots", entry)
    return entry
  } catch {
    return null
  }
}

export async function deleteSnapshot(ownerId: number, key: string) {
  const database = openDatabase()
  if (!database || !validOwner(ownerId) || !validKey(key)) return
  try {
    await (await database).delete("snapshots", [ownerId, key])
  } catch {
    /* armazenamento indisponível */
  }
}

export async function clearUserData(ownerId: number) {
  revokedOwners.add(ownerId)
  const database = openDatabase()
  if (!database || !validOwner(ownerId)) return
  try {
    const db = await database
    const tx = db.transaction("snapshots", "readwrite")
    let cursor = await tx.store.index("ownerId").openCursor(ownerId)
    while (cursor) {
      await cursor.delete()
      cursor = await cursor.continue()
    }
    await tx.done
  } catch {
    /* armazenamento indisponível */
  }
}

export const isRecordList = (data: unknown): data is { id: number; [key: string]: unknown }[] =>
  Array.isArray(data) &&
  data.every((item) => item && typeof item === "object" && Number.isSafeInteger(item.id))
export const isTaskList = (
  data: unknown
): data is { id: number; titulo: string; status: string }[] => {
  if (
    !isRecordList(data) ||
    !data.every((item) => typeof item.titulo === "string" && typeof item.status === "string")
  )
    return false
  try {
    assertTaskListContract(data)
    return true
  } catch {
    return false
  }
}
export const isObjectiveList = (
  data: unknown
): data is { id: number; titulo: string; status: string }[] =>
  isRecordList(data) &&
  data.every((item) => typeof item.titulo === "string" && typeof item.status === "string")
export const isTrackerList = (
  data: unknown
): data is { id: number; titulo: string; ocorrencias: unknown[] }[] =>
  isRecordList(data) &&
  data.every(
    (item) =>
      typeof item.titulo === "string" &&
      Array.isArray(item.ocorrencias) &&
      item.ocorrencias.every(
        (occurrence: unknown) =>
          !!occurrence &&
          typeof occurrence === "object" &&
          Number.isSafeInteger((occurrence as { id?: number }).id) &&
          typeof (occurrence as { occurred_at?: string }).occurred_at === "string"
      )
  )
