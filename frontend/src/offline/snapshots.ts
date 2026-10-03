import { openDB, type DBSchema, type IDBPDatabase } from "idb"
import { assertTaskListContract } from "../types/taskContract"

export type Snapshot<T> = {
  ownerId: number
  key: string
  data: T
  updatedAt: string
  schemaVersion: 1
}

export type OutboxOperation = {
  ownerId: number
  operationId: string
  domain: "task" | "goal" | "tracker" | "occurrence" | "entry"
  action: string
  target?: number | string
  parentId?: number | string
  payload: Record<string, unknown>
  baseUpdatedAt?: string
  createdAt: string
  serverId?: number
  attemptedAt?: string
  status: "pending" | "syncing" | "failed" | "conflict"
  error?: string
}

interface OfflineDB extends DBSchema {
  snapshots: {
    key: [number, string]
    value: Snapshot<unknown>
    indexes: { ownerId: number }
  }
  outbox: {
    key: [number, string]
    value: OutboxOperation
    indexes: { ownerId: number }
  }
}

let database: Promise<IDBPDatabase<OfflineDB>> | null = null
function openDatabase() {
  if (typeof indexedDB === "undefined") return null
  try {
    database ??= openDB<OfflineDB>("bunkermode-offline", 3, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("snapshots", { keyPath: ["ownerId", "key"] })
          store.createIndex("ownerId", "ownerId")
        }
        if (oldVersion < 2) {
          const outbox = db.createObjectStore("outbox", { keyPath: ["ownerId", "operationId"] })
          outbox.createIndex("ownerId", "ownerId")
        }
        if (oldVersion < 3) {
          let operation = await transaction.objectStore("outbox").openCursor()
          while (operation) {
            if ((operation.value.domain as string) === "reserve") await operation.delete()
            else if (operation.value.domain === "entry" && !operation.value.attemptedAt) {
              delete operation.value.payload.categoria
              await operation.update(operation.value)
            }
            // Operações já enviadas preservam o payload usado na identidade idempotente.
            operation = await operation.continue()
          }
          let snapshot = await transaction.objectStore("snapshots").openCursor()
          while (snapshot) {
            if (snapshot.value.key === "reserves") await snapshot.delete()
            else if (snapshot.value.key.startsWith("finances:")) {
              const data = snapshot.value.data as { lancamentos?: Record<string, unknown>[] }
              if (Array.isArray(data?.lancamentos)) {
                for (const entry of data.lancamentos)
                  if (entry && typeof entry === "object") delete entry.categoria
                await snapshot.update(snapshot.value)
              }
            }
            snapshot = await snapshot.continue()
          }
        }
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
    const tx = db.transaction(["snapshots", "outbox"], "readwrite")
    for (const name of ["snapshots", "outbox"] as const) {
      let cursor = await tx.objectStore(name).index("ownerId").openCursor(ownerId)
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
    }
    await tx.done
    window.dispatchEvent(new CustomEvent("bunkermode-outbox-change", { detail: ownerId }))
  } catch {
    /* armazenamento indisponível */
  }
}

export async function listOutbox(ownerId: number): Promise<OutboxOperation[]> {
  const db = openDatabase()
  if (!db || !validOwner(ownerId)) return []
  try {
    // Domínios desconhecidos não entram na fila ativa.
    return (await (await db).getAllFromIndex("outbox", "ownerId", ownerId))
      .filter((item) => ["task", "goal", "tracker", "occurrence", "entry"].includes(item.domain))
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId)
      )
  } catch {
    return []
  }
}

export async function saveOutboxOperation(operation: OutboxOperation): Promise<void> {
  const db = openDatabase()
  if (!db || !validOwner(operation.ownerId) || revokedOwners.has(operation.ownerId))
    throw new Error("Armazenamento local indisponível.")
  await (await db).put("outbox", operation)
  window.dispatchEvent(new CustomEvent("bunkermode-outbox-change", { detail: operation.ownerId }))
}

export async function removeOutboxOperation(ownerId: number, operationId: string): Promise<void> {
  const db = openDatabase()
  if (!db || !validOwner(ownerId)) return
  await (await db).delete("outbox", [ownerId, operationId])
  window.dispatchEvent(new CustomEvent("bunkermode-outbox-change", { detail: ownerId }))
}

export async function resolveOutboxCreate(
  ownerId: number,
  operationId: string,
  serverId: number,
  version?: string
) {
  const database = openDatabase()
  if (!database || !validOwner(ownerId)) return
  const db = await database
  const tx = db.transaction("outbox", "readwrite")
  const localId = `local:${operationId}`
  let cursor = await tx.store.index("ownerId").openCursor(ownerId)
  while (cursor) {
    const value = cursor.value
    if (value.operationId !== operationId) {
      const payload = { ...value.payload }
      if (payload.objetivo_id === localId) payload.objetivo_id = serverId
      const next = {
        ...value,
        target: value.target === localId ? serverId : value.target,
        parentId: value.parentId === localId ? serverId : value.parentId,
        payload,
        baseUpdatedAt: value.target === localId && version ? version : value.baseUpdatedAt,
      }
      if (JSON.stringify(next) !== JSON.stringify(value)) await cursor.update(next)
    }
    cursor = await cursor.continue()
  }
  await tx.store.delete([ownerId, operationId])
  await tx.done
  window.dispatchEvent(new CustomEvent("bunkermode-outbox-change", { detail: ownerId }))
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
