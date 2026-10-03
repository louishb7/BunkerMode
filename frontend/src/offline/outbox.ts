import { request } from "../api/httpClient"
import { getApiAvailability } from "./apiAvailability"
import {
  listOutbox,
  removeOutboxOperation,
  resolveOutboxCreate,
  saveOutboxOperation,
  saveSnapshot,
  type OutboxOperation,
} from "./snapshots"
import type { Task } from "../types/taskContract"
import type { Tracker } from "../types/trackerContract"
import { financeEntryTypes, type FinanceOverview } from "../types/financeContract"
import { focusStorageKey } from "../features/tasks/focusSession"

type Domain = OutboxOperation["domain"]
const fields: Record<Domain, string[]> = {
  task: [
    "titulo",
    "instrucao",
    "prioridade",
    "prazo",
    "responsavel_id",
    "objetivo_id",
    "recurrence_weekdays",
    "recurrence_end_date",
    "duration_type",
    "is_pinned",
  ],
  goal: ["titulo", "descricao", "data_alvo", "status"],
  tracker: ["titulo", "descricao", "objetivo_id"],
  occurrence: [],
  entry: ["titulo", "tipo", "valor_centavos", "data"],
}

let activeOwner: number | null = null
let running: Promise<void> | null = null
let generation = 0
let queuedWhileRunning = false
let replayOwner: number | null = null
const replayListeners = new Set<() => void>()

export function getReplayOwner() {
  return replayOwner
}

export function subscribeReplay(listener: () => void) {
  replayListeners.add(listener)
  return () => {
    replayListeners.delete(listener)
  }
}

function setReplayOwner(ownerId: number | null) {
  replayOwner = ownerId
  replayListeners.forEach((listener) => listener())
}

export function activateOutbox(ownerId: number | null) {
  activeOwner = ownerId
  generation++
  if (ownerId) void syncOutbox(ownerId)
}

export function subscribeOutbox(ownerId: number, listener: (items: OutboxOperation[]) => void) {
  let live = true
  const update = () =>
    void listOutbox(ownerId).then((items) => {
      if (live) listener(items)
    })
  const onChange = (event: Event) => {
    if ((event as CustomEvent<number>).detail === ownerId) update()
  }
  window.addEventListener("bunkermode-outbox-change", onChange)
  update()
  return () => {
    live = false
    window.removeEventListener("bunkermode-outbox-change", onChange)
  }
}

export async function enqueueOperation(
  ownerId: number,
  domain: Domain,
  action: string,
  payload: Record<string, unknown> = {},
  target?: number | string,
  baseUpdatedAt?: string,
  parentId?: number | string
): Promise<string> {
  if (!Number.isSafeInteger(ownerId) || ownerId < 1) throw new Error("Usuário inválido.")
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([key]) => fields[domain].includes(key))
  )
  if (Object.keys(normalized).length !== Object.keys(payload).length)
    throw new Error("Campos não permitidos na operação local.")
  const current = await listOutbox(ownerId)
  if (typeof target === "string" && target.startsWith("local:")) {
    const create = current.find(
      (item) => `local:${item.operationId}` === target && item.action === "create"
    )
    if (!create) throw new Error("Registro local não encontrado.")
    if (create.attemptedAt && action === "delete")
      throw new Error("A criação já foi enviada. Aguarde a reconciliação antes de remover.")
    if (action === "delete") {
      await removeOutboxOperation(ownerId, create.operationId)
      for (const item of current) {
        if (item.target === target || item.parentId === target)
          await removeOutboxOperation(ownerId, item.operationId)
        else if (item.payload.objetivo_id === target) {
          if (item.action === "link") {
            await removeOutboxOperation(ownerId, item.operationId)
            continue
          }
          if (
            domain === "goal" &&
            item.domain === "task" &&
            item.payload.duration_type === "ate_objetivo"
          )
            await saveOutboxOperation({
              ...item,
              status: "failed",
              error: "Objetivo local removido; revise a recorrência.",
            })
          else
            await saveOutboxOperation({ ...item, payload: { ...item.payload, objetivo_id: null } })
        }
      }
      return target
    }
    if (action === "update" && create.attemptedAt && domain === "entry")
      throw new Error(
        "A criação financeira já foi enviada. Aguarde a reconciliação antes de editar."
      )
    if (
      action === "update" &&
      !create.attemptedAt &&
      ["task", "goal", "tracker", "entry"].includes(domain)
    ) {
      await saveOutboxOperation({ ...create, payload: { ...create.payload, ...normalized } })
      if (activeOwner === ownerId) void syncOutbox(ownerId)
      return target
    }
  }
  const operationId = crypto.randomUUID()
  const operation: OutboxOperation = {
    ownerId,
    operationId,
    domain,
    action,
    payload: normalized,
    target,
    parentId,
    baseUpdatedAt,
    createdAt: new Date().toISOString(),
    status: "pending",
  }
  await saveOutboxOperation(operation)
  if (activeOwner === ownerId) void syncOutbox(ownerId)
  return action === "create" ? `local:${operationId}` : operationId
}

async function refreshOfficial(ownerId: number, op: OutboxOperation) {
  const endpoint =
    op.domain === "task"
      ? "/tarefas"
      : op.domain === "goal"
        ? "/objetivos"
        : op.domain === "tracker" || op.domain === "occurrence"
          ? "/acompanhamentos"
          : `/financas?mes=${String(op.payload.data ?? new Date().toISOString()).slice(0, 7)}`
  const key =
    op.domain === "task"
      ? "tasks:all"
      : op.domain === "goal"
        ? "objectives"
        : op.domain === "tracker" || op.domain === "occurrence"
          ? "trackers"
          : `finances:${String(op.payload.data ?? new Date().toISOString()).slice(0, 7)}`
  const result = await request(endpoint)
  if (!result.ok) return false
  await saveSnapshot(ownerId, key, result.data)
  if (op.domain === "entry") {
    const currentMonth = new Date().toISOString().slice(0, 7)
    if (key === `finances:${currentMonth}`)
      await saveSnapshot(ownerId, "finances:current", result.data)
  }
  window.dispatchEvent(new CustomEvent("bunkermode-official-change", { detail: { ownerId, key } }))
  return true
}

async function refreshSecondaryAfterGoalDelete(ownerId: number) {
  await Promise.allSettled(
    [
      ["tasks:all", "/tarefas"],
      ["trackers", "/acompanhamentos"],
    ].map(async ([key, endpoint]) => {
      const result = await request(endpoint)
      if (!result.ok || activeOwner !== ownerId) return
      await saveSnapshot(ownerId, key, result.data)
      window.dispatchEvent(
        new CustomEvent("bunkermode-official-change", { detail: { ownerId, key } })
      )
    })
  )
}

function resolveRef(
  ref: number | string | undefined,
  items: OutboxOperation[]
): number | undefined {
  if (typeof ref === "number") return ref
  if (typeof ref !== "string" || !ref.startsWith("local:")) return undefined
  const creator = items.find((item) => item.operationId === ref.slice(6))
  return creator &&
    typeof (creator as OutboxOperation & { serverId?: number }).serverId === "number"
    ? (creator as OutboxOperation & { serverId: number }).serverId
    : undefined
}

async function run(ownerId: number, epoch: number): Promise<void> {
  if (navigator.onLine === false || getApiAvailability() === "unavailable") return
  const validated = await request("/usuarios/me")
  if (!validated.ok) {
    if (validated.status === 401) window.dispatchEvent(new Event("bunkermode-auth-invalid"))
    return
  }
  let items = await listOutbox(ownerId)
  let madeProgress = false
  let skipped = false
  for (const original of items) {
    const op = (await listOutbox(ownerId)).find((item) => item.operationId === original.operationId)
    if (!op) continue
    if (activeOwner !== ownerId || epoch !== generation) return
    if (op.status === "failed" || op.status === "conflict") continue
    const target = op.action === "create" ? undefined : resolveRef(op.target, items)
    const parentId = op.domain === "occurrence" ? resolveRef(op.parentId, items) : undefined
    const goalRef = op.payload.objetivo_id
    const goalId = goalRef == null ? goalRef : resolveRef(goalRef as number | string, items)
    if (
      (op.action !== "create" && target === undefined) ||
      (op.domain === "occurrence" && parentId === undefined) ||
      (goalRef != null && goalId === undefined)
    ) {
      // A prior create is still pending; failed/circular dependencies stop here.
      const dependsOn = items.some(
        (item) =>
          item.status === "pending" &&
          [`local:${item.operationId}`].some(
            (ref) => ref === op.target || ref === op.parentId || ref === goalRef
          )
      )
      if (dependsOn) {
        skipped = true
        continue
      }
      await saveOutboxOperation({
        ...op,
        status: "failed",
        error: "Dependência local não pôde ser resolvida.",
      })
      continue
    }
    const attempted = { ...op, attemptedAt: op.attemptedAt ?? new Date().toISOString() }
    await saveOutboxOperation({ ...attempted, status: "syncing" })
    const payload = { ...op.payload }
    if (goalRef != null) payload.objetivo_id = goalId
    const result = await request("/offline/operations", {
      method: "POST",
      body: {
        operationId: op.operationId,
        domain: op.domain,
        action: op.action,
        ...(target ? { target } : {}),
        ...(parentId ? { parentId } : {}),
        payload,
        ...(op.baseUpdatedAt ? { baseUpdatedAt: op.baseUpdatedAt } : {}),
      },
    })
    if (!result.ok) {
      if (result.status === 0 || result.status >= 500) {
        await saveOutboxOperation({ ...attempted, status: "pending" })
        return
      }
      if (result.status === 401) {
        await saveOutboxOperation({ ...attempted, status: "pending" })
        window.dispatchEvent(new Event("bunkermode-auth-invalid"))
        return
      }
      await saveOutboxOperation({
        ...attempted,
        status: result.status === 409 ? "conflict" : "failed",
        error:
          typeof result.data.message === "string"
            ? result.data.message.slice(0, 180)
            : "Não foi possível sincronizar.",
      })
      continue
    }
    if (op.domain === "entry" && op.action === "create" && Number.isSafeInteger(result.data?.id)) {
      op.serverId = result.data.id
      attempted.serverId = op.serverId
      await saveOutboxOperation({ ...attempted, status: "syncing", serverId: op.serverId })
    }
    if (!(await refreshOfficial(ownerId, op))) {
      await saveOutboxOperation({ ...attempted, status: "pending" })
      return
    }
    if (op.action === "create") {
      const serverId = result.data?.id
      if (!Number.isSafeInteger(serverId) || serverId < 1) {
        await saveOutboxOperation({
          ...attempted,
          status: "failed",
          error: "Resposta oficial inválida.",
        })
        return
      }
      await resolveOutboxCreate(ownerId, op.operationId, serverId, result.data?.updated_at)
      if (op.domain === "task") {
        const key = focusStorageKey(ownerId)
        const raw = window.localStorage.getItem(key)
        if (raw) {
          try {
            const focus = JSON.parse(raw)
            if (focus.taskId === `local:${op.operationId}`) {
              window.localStorage.setItem(key, JSON.stringify({ ...focus, taskId: serverId }))
              window.dispatchEvent(
                new CustomEvent("bunkermode-focus-resolved", { detail: ownerId })
              )
            }
          } catch {
            /* focus state validation handles malformed local data */
          }
        }
      }
    } else await removeOutboxOperation(ownerId, op.operationId)
    if (op.domain === "goal" && op.action === "delete")
      void refreshSecondaryAfterGoalDelete(ownerId)
    const version = result.data?.updated_at
    if (typeof version === "string" && target !== undefined) {
      for (const next of await listOutbox(ownerId)) {
        if (next.domain === op.domain && next.target === target && next.status === "pending")
          await saveOutboxOperation({ ...next, baseUpdatedAt: version })
      }
    }
    items = await listOutbox(ownerId)
    madeProgress = true
  }
  if (skipped && activeOwner === ownerId) {
    if (madeProgress) return run(ownerId, epoch)
    for (const item of await listOutbox(ownerId)) {
      if (item.status === "pending" || item.status === "syncing")
        await saveOutboxOperation({
          ...item,
          status: "failed",
          error: "Dependência circular ou indisponível.",
        })
    }
  }
}

export function syncOutbox(ownerId: number): Promise<void> {
  if (running) {
    queuedWhileRunning = true
    return running
  }
  if (activeOwner !== ownerId) return Promise.resolve()
  const epoch = generation
  running = (async () => {
    const work = async () => {
      if (navigator.onLine === false || getApiAvailability() === "unavailable") return
      setReplayOwner(ownerId)
      try {
        await run(ownerId, epoch)
      } finally {
        setReplayOwner(null)
      }
    }
    if (navigator.locks) await navigator.locks.request(`bunkermode-outbox-${ownerId}`, work)
    else await work()
  })().finally(() => {
    running = null
    if (queuedWhileRunning) {
      queuedWhileRunning = false
      if (
        activeOwner === ownerId &&
        navigator.onLine !== false &&
        getApiAvailability() !== "unavailable"
      )
        void syncOutbox(ownerId)
    }
  })
  return running
}

export async function discardOperation(ownerId: number, operationId: string) {
  const op = (await listOutbox(ownerId)).find((item) => item.operationId === operationId)
  if (op?.attemptedAt && ["pending", "syncing"].includes(op.status))
    throw new Error("A operação enviada precisa ser reconciliada antes de descartar.")
  await removeOutboxOperation(ownerId, operationId)
}

export async function discardForServerVersion(ownerId: number, operationId: string) {
  const op = (await listOutbox(ownerId)).find((item) => item.operationId === operationId)
  if (!op) return
  if (
    activeOwner !== ownerId ||
    getApiAvailability() === "unavailable" ||
    !(await refreshOfficial(ownerId, op))
  )
    throw new Error("Não foi possível carregar a versão do servidor.")
  await removeOutboxOperation(ownerId, operationId)
}

export async function applyMyVersion(ownerId: number, operationId: string) {
  const op = (await listOutbox(ownerId)).find((item) => item.operationId === operationId)
  if (
    !op ||
    !["task", "goal", "tracker"].includes(op.domain) ||
    !["update", "status", "pin", "link", "unlink"].includes(op.action) ||
    typeof op.target !== "number" ||
    getApiAvailability() === "unavailable"
  )
    return false
  const endpoint =
    op.domain === "task" ? "/tarefas" : op.domain === "goal" ? "/objetivos" : "/acompanhamentos"
  const current = await request(endpoint)
  if (!current.ok || !Array.isArray(current.data)) return false
  const latest = current.data.find((item: { id: number }) => item.id === op.target)
  if (!latest || typeof latest.updated_at !== "string") return false
  await saveOutboxOperation({
    ...op,
    baseUpdatedAt: latest.updated_at,
    status: "pending",
    error: undefined,
  })
  await syncOutbox(ownerId)
  return true
}

export async function retryOperation(ownerId: number, operationId: string) {
  const item = (await listOutbox(ownerId)).find((op) => op.operationId === operationId)
  if (!item) return
  await saveOutboxOperation({ ...item, status: "pending", error: undefined })
  await syncOutbox(ownerId)
}

export function projectTasks(official: Task[], operations: OutboxOperation[]): Task[] {
  const items = official.map((item) => ({ ...item })) as Array<Task & { syncStatus?: string }>
  for (const op of operations) {
    if (op.domain !== "task") continue
    const id = op.action === "create" ? `local:${op.operationId}` : op.target
    if (op.action === "create") {
      const now = op.createdAt
      items.push({
        id: id as unknown as number,
        titulo: String(op.payload.titulo ?? "Nova tarefa"),
        instrucao: (op.payload.instrucao as string) ?? null,
        prioridade: (op.payload.prioridade as Task["prioridade"]) ?? 2,
        prazo: (op.payload.prazo as string) ?? null,
        status: "PENDENTE",
        status_code: "PENDENTE",
        status_label: "Pendente",
        is_pinned: false,
        created_at: now,
        updated_at: now,
        completed_at: null,
        user_id: op.ownerId,
        responsavel_id: op.ownerId,
        criada_por_id: op.ownerId,
        objetivo_id: (op.payload.objetivo_id as number) ?? null,
        recurrence: null,
        recurringIntent:
          Array.isArray(op.payload.recurrence_weekdays) && op.payload.recurrence_weekdays.length
            ? { weekdays: op.payload.recurrence_weekdays as number[] }
            : undefined,
        permissions: {
          can_complete: true,
          can_edit: true,
          can_delete: !op.attemptedAt,
          can_pin: true,
          can_view_history: false,
          can_reopen: false,
        },
        syncStatus: op.status,
      })
      continue
    }
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) continue
    if (op.action === "delete") {
      items.splice(index, 1)
      continue
    }
    const item = items[index]
    if (op.action === "update") Object.assign(item, op.payload)
    if (op.action === "complete" || op.action === "reopen") {
      const completed = op.action === "complete"
      item.status = completed ? "CONCLUIDA" : "PENDENTE"
      item.status_code = item.status
      item.status_label = completed ? "Concluída" : "Pendente"
      item.completed_at = completed ? op.createdAt : null
      item.permissions = {
        ...item.permissions,
        can_complete: !completed,
        can_reopen: completed,
        can_edit: !completed,
        can_pin: !completed,
        can_delete: !completed && !item.recurrence,
      }
    }
    if (op.action === "pin") item.is_pinned = op.payload.is_pinned === true
    if (op.action === "link") item.objetivo_id = op.payload.objetivo_id as number
    if (op.action === "unlink") item.objetivo_id = null
    item.syncStatus = op.status
  }
  const deletedGoals = new Set(
    operations.filter((op) => op.domain === "goal" && op.action === "delete").map((op) => op.target)
  )
  for (const item of items) {
    if (item.objetivo_id != null && deletedGoals.has(item.objetivo_id)) {
      item.objetivo_id = null
      item.syncStatus = item.syncStatus ?? "pending"
    }
  }
  return items
}

export function projectGoals(official: any[], operations: OutboxOperation[]) {
  const items = official.map((item) => ({ ...item }))
  for (const op of operations) {
    if (op.domain !== "goal") continue
    const id = op.action === "create" ? `local:${op.operationId}` : op.target
    if (op.action === "create") {
      items.push({
        id,
        usuario_id: op.ownerId,
        titulo: op.payload.titulo,
        descricao: op.payload.descricao ?? null,
        data_alvo: op.payload.data_alvo ?? null,
        status: "ativo",
        order_index: items.length + 1,
        created_at: op.createdAt,
        updated_at: op.createdAt,
        concluded_at: null,
        syncStatus: op.status,
      })
      continue
    }
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) continue
    if (op.action === "delete") {
      items.splice(index, 1)
      continue
    }
    if (op.action === "update") Object.assign(items[index], op.payload)
    if (op.action === "status") items[index].status = op.payload.status
    items[index].syncStatus = op.status
  }
  return items
}

export function projectTrackers(official: Tracker[], operations: OutboxOperation[]): Tracker[] {
  const items = official.map((item) => ({ ...item, ocorrencias: [...item.ocorrencias] })) as Array<
    Tracker & { syncStatus?: string }
  >
  for (const op of operations) {
    if (op.domain === "tracker") {
      const id = op.action === "create" ? `local:${op.operationId}` : op.target
      if (op.action === "create")
        items.push({
          id: id as unknown as number,
          objetivo_id: (op.payload.objetivo_id as number) ?? null,
          titulo: String(op.payload.titulo ?? ""),
          descricao: (op.payload.descricao as string) ?? null,
          created_at: op.createdAt,
          updated_at: op.createdAt,
          ocorrencias: [],
          syncStatus: op.status,
        })
      else {
        const index = items.findIndex((item) => item.id === id)
        if (index < 0) continue
        if (op.action === "delete") items.splice(index, 1)
        else {
          Object.assign(items[index], op.payload)
          items[index].syncStatus = op.status
        }
      }
    } else if (op.domain === "occurrence") {
      const tracker = items.find((item) => item.id === op.parentId)
      if (!tracker) continue
      if (op.action === "create")
        tracker.ocorrencias.unshift({
          id: `local:${op.operationId}` as unknown as number,
          acompanhamento_id: tracker.id,
          occurred_at: op.createdAt,
          created_at: op.createdAt,
        })
      else tracker.ocorrencias = tracker.ocorrencias.filter((item) => item.id !== op.target)
      tracker.syncStatus = op.status
    }
  }
  const deletedGoals = new Set(
    operations.filter((op) => op.domain === "goal" && op.action === "delete").map((op) => op.target)
  )
  for (const item of items) {
    if (item.objetivo_id != null && deletedGoals.has(item.objetivo_id)) {
      item.objetivo_id = null
      item.syncStatus = item.syncStatus ?? "pending"
    }
  }
  return items
}

export function projectFinances(
  official: FinanceOverview | null,
  operations: OutboxOperation[],
  month?: string
): FinanceOverview | null {
  const localMonth = month ?? new Date().toISOString().slice(0, 7)
  if (
    !official &&
    !operations.some((item) => item.domain === "entry" && item.action === "create")
  )
    return null
  const baseline: FinanceOverview = official ?? {
    mes: localMonth,
    moeda: "BRL",
    saldo_centavos: 0,
    resultado_centavos: 0,
    receitas_centavos: 0,
    despesas_centavos: 0,
    serie_diaria: Array.from(
      {
        length: new Date(
          Number(localMonth.slice(0, 4)),
          Number(localMonth.slice(5, 7)),
          0
        ).getDate(),
      },
      (_, index) => ({
        data: `${localMonth}-${String(index + 1).padStart(2, "0")}`,
        resultado_centavos: 0,
        receitas_centavos: 0,
        despesas_centavos: 0,
      })
    ),
    lancamentos: [],
  }
  const result = {
    ...baseline,
    lancamentos: [...baseline.lancamentos],
    serie_diaria: [...baseline.serie_diaria],
  }
  for (const op of operations) {
    if (op.domain !== "entry" || op.action !== "create") continue
    if (op.serverId && baseline.lancamentos.some((entry) => entry.id === op.serverId)) continue
    const cents = op.payload.valor_centavos
    const tipo = op.payload.tipo as FinanceOverview["lancamentos"][number]["tipo"]
    if (
      typeof cents !== "number" ||
      !Number.isSafeInteger(cents) ||
      cents <= 0 ||
      cents > 2147483647 ||
      !financeEntryTypes.includes(tipo)
    )
      continue
    const contributes = op.status !== "failed" && op.status !== "conflict"
    const incoming = op.payload.tipo === "receita" || op.payload.tipo === "ajuste_entrada"
    const inMonth = String(op.payload.data).slice(0, 7) === result.mes
    if (contributes && !(op.serverId && !inMonth))
      result.saldo_centavos += incoming ? cents : -cents
    if (inMonth && contributes && tipo === "receita") result.receitas_centavos += cents
    if (inMonth && contributes && tipo === "despesa") result.despesas_centavos += cents
    result.resultado_centavos = result.receitas_centavos - result.despesas_centavos
    result.lancamentos.unshift({
      id: `local:${op.operationId}`,
      titulo: String(op.payload.titulo ?? ""),
      created_at: op.createdAt,
      tipo,
      valor_centavos: cents,
      data: String(op.payload.data),
      syncStatus: op.status,
    } as FinanceOverview["lancamentos"][number])
    if (!inMonth) continue
    result.serie_diaria = result.serie_diaria.map((point) =>
      contributes &&
      point.data >= String(op.payload.data) &&
      ["receita", "despesa"].includes(String(op.payload.tipo))
        ? {
            ...point,
            resultado_centavos: point.resultado_centavos + (incoming ? cents : -cents),
            receitas_centavos: (point.receitas_centavos ?? 0) + (incoming ? cents : 0),
            despesas_centavos: (point.despesas_centavos ?? 0) + (incoming ? 0 : cents),
          }
        : point
    )
  }
  result.lancamentos.sort(
    (a, b) =>
      b.data.localeCompare(a.data) ||
      (b.created_at ?? "").localeCompare(a.created_at ?? "") ||
      (typeof a.id === "number" && typeof b.id === "number"
        ? b.id - a.id
        : typeof a.id === "string" && typeof b.id === "number"
          ? -1
          : typeof b.id === "string" && typeof a.id === "number"
            ? 1
            : String(b.id).localeCompare(String(a.id)))
  )
  return result
}
