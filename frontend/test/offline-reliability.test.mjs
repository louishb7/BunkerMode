import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"
const dayA = "2026-10-04T18:00:00.000Z",
  dayB = "2026-10-05T10:00:00.000Z"
const op = (domain, action, changes = {}) => ({
  ownerId: 1,
  operationId: randomUUID(),
  domain,
  action,
  payload: {},
  createdAt: dayA,
  status: "pending",
  ...changes,
})
const task = (id, series = null) => ({
  id,
  titulo: "Ler",
  status: "PENDENTE",
  status_code: "PENDENTE",
  status_label: "Pendente",
  objetivo_id: 9,
  completed_at: null,
  permissions: { can_complete: true, can_reopen: false },
  recurrence: series
    ? { series_id: series, termination_policy: "ate_objetivo", weekdays: [0, 1], end_date: null }
    : null,
})
function harness() {
  const operations = new Map(),
    snapshots = new Map(),
    timers = new Map(),
    calls = []
  let time = dayA,
    online = true,
    timerId = 0,
    handler = async () => ({ ok: true, data: { id: 1 } }),
    writeHook = async () => {},
    snapshotHook = async () => true
  const window = new EventTarget(),
    document = new EventTarget(),
    storage = new Map()
  document.visibilityState = "visible"
  Object.assign(window, {
    document,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: (fn, delay) => {
      timers.set(++timerId, { fn, delay })
      return timerId
    },
    clearTimeout: (id) => timers.delete(id),
  })
  const navigator = {
    get onLine() {
      return online
    },
  }
  class Clock extends Date {
    constructor(value) {
      super(value ?? time)
    }
    static now() {
      return Date.parse(time)
    }
  }
  const load = (file, dependencies) => {
    const exports = {}
    vm.runInNewContext(
      ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      {
        exports,
        window,
        navigator,
        Event,
        CustomEvent,
        Date: Clock,
        crypto: { randomUUID },
        require: (name) => {
          assert(name in dependencies, name)
          return dependencies[name]
        },
      }
    )
    return exports
  }
  const availability = load("../src/offline/apiAvailability.ts", {})
  const practiceDomain = load("../../api/src/goals/practice-domain.ts", {})
  const request = async (path, options) => {
    calls.push({ path, options: structuredClone(options) })
    const result = await handler(path, options)
    availability.setApiAvailability(
      !result.ok && (result.status === 0 || result.status >= 500) ? "unavailable" : "available"
    )
    return result
  }
  const outbox = load("../src/offline/outbox.ts", {
    "./apiAvailability": availability,
    "../api/httpClient": { request },
    "./snapshots": {
      listOutbox: async (owner) =>
        [...operations.values()]
          .filter((item) => item.ownerId === owner)
          .map((item) => structuredClone(item)),
      saveOutboxOperation: async (item) => {
        await writeHook(item)
        operations.set(item.operationId, structuredClone(item))
      },
      removeOutboxOperation: async (owner, id) => {
        if (operations.get(id)?.ownerId === owner) operations.delete(id)
      },
      resolveOutboxCreate: async (_owner, id) => operations.delete(id),
      saveSnapshot: async (owner, key, data) => {
        if (!(await snapshotHook(owner, key, data))) return null
        snapshots.set(`${owner}:${key}`, structuredClone(data))
        return { ownerId: owner, key, data, updatedAt: time, schemaVersion: 1 }
      },
      readSnapshot: async (owner, key) =>
        snapshots.has(`${owner}:${key}`)
          ? { data: structuredClone(snapshots.get(`${owner}:${key}`)) }
          : null,
      isDailyTaskSnapshot: () => true,
    },
    "../types/financeContract": {
      financeEntryTypes: ["receita", "despesa", "ajuste_entrada", "ajuste_saida"],
    },
    "../features/tasks/focusSession": { focusStorageKey: (owner) => `focus:${owner}` },
    "../state/overviewCache": { updateOverview() {} },
    "../features/practices/practiceDomain": practiceDomain,
  })
  async function startAuthSession() {
    const states = [],
      effects = []
    let slot = 0
    const react = {
      useState(initial) {
        const index = slot++
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
        return [
          states[index],
          (next) => {
            states[index] = typeof next === "function" ? next(states[index]) : next
          },
        ]
      },
      useRef(initial) {
        const index = slot++
        return (states[index] ??= { current: initial })
      },
      useCallback: (callback) => callback,
      useEffect: (effect) => effects.push(effect),
    }
    window.sessionStorage = { getItem: () => null, removeItem() {} }
    const { useAuthSession } = load("../src/features/auth/hooks/useAuthSession.ts", {
      react,
      "../authValidation": { validateAuth: () => null },
      "../../../api/httpClient": {
        getErrorMessage: () => "Erro",
        hasRefreshSession: () => false,
        ensurePersistentSession: async () => {},
        revokePersistentSession: async () => {},
      },
      "../../../constants/session": {
        TOKEN_KEY: "token",
        USER_KEY: "user",
        REFRESH_KEY: "refresh",
      },
      "../../../constants/uiState": { emptyStatus: { type: "", message: "" } },
      "../../../services/bunkermodeApi": {
        api: {
          getCurrentUser: () => request("/usuarios/me"),
          login: async () => ({
            ok: true,
            data: { access_token: "session", usuario: { id: 1, usuario: "Pessoa" } },
          }),
        },
      },
      "../../../state/overviewCache": { clearOverview() {} },
      "../../../state/financeCache": { clearFinanceSnapshots() {} },
      "../../../state/orientationCache": { clearOrientationCache() {} },
      "../../../offline/snapshots": { allowUserData() {}, clearUserData: async () => {} },
      "../../../offline/apiAvailability": availability,
      "../../tasks/focusSession": {
        focusStorageKey: () => "focus",
        durationStorageKey: () => "duration",
      },
      "../../../offline/outbox": outbox,
    })
    await useAuthSession().login({ email: "pessoa@bunker.local", senha: "senha" })
    slot = 0
    effects.length = 0
    useAuthSession()
    return effects[0]()
  }
  return {
    ...outbox,
    practiceDomain,
    availability,
    calls,
    operations,
    snapshots,
    timers,
    window,
    startAuthSession,
    set handler(next) {
      handler = next
    },
    set writeHook(next) {
      writeHook = next
    },
    set snapshotHook(next) {
      snapshotHook = next
    },
    set time(next) {
      time = next
    },
    set online(next) {
      online = next
    },
    async drain() {
      await new Promise(setImmediate)
    },
    async fireTimer() {
      const [id, timer] = [...timers][0]
      timers.delete(id)
      timer.fn()
      await this.drain()
    },
  }
}
for (const status of ["failed", "conflict"])
  test(`${status} não modifica fatos de tarefas, objetivos, práticas ou vínculos`, () => {
    const h = harness(),
      official = task(2),
      goal = { id: 9, titulo: "Direção", status: "ativo" },
      tracker = {
        id: 5,
        titulo: "Registro livre",
        objetivo_id: 9,
        ocorrencias: [{ id: 7, occurred_at: dayA }],
      }
    for (const action of ["complete", "delete", "update", "link", "unlink"])
      assert.deepEqual(
        structuredClone(
          h.projectTasks(
            [official],
            [
              op("task", action, {
                status,
                target: 2,
                payload: { titulo: "Outro", objetivo_id: 10 },
              }),
            ]
          )
        ),
        [official]
      )
    const deletion = op("goal", "delete", { status, target: 9 })
    assert.deepEqual(structuredClone(h.projectGoals([goal], [deletion])), [goal])
    assert.deepEqual(structuredClone(h.projectTasks([official], [deletion])), [official])
    assert.deepEqual(structuredClone(h.projectTrackers([tracker], [deletion])), [tracker])
    for (const action of ["update", "delete"])
      assert.deepEqual(
        structuredClone(
          h.projectTrackers(
            [tracker],
            [op("tracker", action, { status, target: 5, payload: { titulo: "Outro" } })]
          )
        ),
        [tracker]
      )
    for (const action of ["create", "delete"])
      assert.deepEqual(
        structuredClone(
          h.projectTrackers(
            [tracker],
            [op("occurrence", action, { status, parentId: 5, target: 7 })]
          )
        ),
        [tracker]
      )
    assert.equal(h.projectTasks([], [op("task", "create", { status })]).length, 0)
    assert.equal(h.projectGoals([], [op("goal", "create", { status })]).length, 0)
    assert.equal(h.projectTrackers([], [op("tracker", "create", { status })]).length, 0)
  })
test("dependentes de criação rejeitada não aparecem como intenções válidas", () => {
  const h = harness(),
    goal = op("goal", "create", { status: "conflict" }),
    tracker = op("tracker", "create", { payload: { objetivo_id: `local:${goal.operationId}` } }),
    occurrence = op("occurrence", "create", { parentId: `local:${tracker.operationId}` })
  const commands = [
    goal,
    tracker,
    occurrence,
    op("task", "create", { payload: { objetivo_id: `local:${goal.operationId}` } }),
  ]
  assert.equal(h.projectTasks([], commands).length, 0)
  assert.equal(h.projectTrackers([], commands).length, 0)
  assert.equal(h.projectGoals([], commands).length, 0)
})
test("vínculo recorrente projeta toda série, concluídas e snapshot sem ocorrência alvo", () => {
  const h = harness(),
    tasks = [task(1, 31), { ...task(2, 31), status: "CONCLUIDA" }, task(3, 32), task(4)]
  const link = op("task", "link", {
    target: 1,
    payload: { objetivo_id: 12 },
    recurrenceSeriesId: 31,
  })
  assert.deepEqual(
    Array.from(h.projectTasks(tasks, [link]), (item) => item.objetivo_id),
    [12, 12, 9, 9]
  )
  assert.deepEqual(
    Array.from(h.projectTasks(tasks.slice(1), [link]), (item) => item.objetivo_id),
    [12, 9, 9]
  )
  const projected = h.projectTasks(tasks, [{ ...link, action: "unlink", payload: {} }])
  assert.deepEqual(
    Array.from(projected, (item) => item.objetivo_id),
    [null, null, 9, 9]
  )
  assert.equal(projected[1].status, "CONCLUIDA")
  assert.equal(projected[0].recurrence.termination_policy, "sem_termino")
  assert.equal(tasks[0].recurrence.termination_policy, "ate_objetivo")
})
test("evento capturado no dia A sincronizado no dia B mantém occurred_at", async () => {
  const h = harness()
  await h.enqueueOperation(1, "task", "complete", {}, 2, dayA)
  await h.enqueueOperation(1, "occurrence", "create", {}, undefined, undefined, 5)
  const stored = [...h.operations.values()]
  assert(stored.every((item) => item.payload.occurred_at === dayA))
  assert.equal(h.projectTasks([task(2)], stored)[0].completed_at, dayA)
  assert.equal(
    h.projectTrackers([{ id: 5, ocorrencias: [] }], stored)[0].ocorrencias[0].occurred_at,
    dayA
  )
  h.time = dayB
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 33, updated_at: dayB } }
        : { ok: true, data: [] }
  h.activateOutbox(1)
  await h.drain()
  assert(
    h.calls
      .filter((call) => call.path === "/offline/operations")
      .every((call) => call.options.body.payload.occurred_at === dayA)
  )
  h.activateOutbox(null)
})
test("503 recupera autonomamente com backoff sem nova mutação e mantém identidade", async () => {
  const h = harness(),
    command = op("task", "complete", {
      target: 2,
      baseUpdatedAt: dayA,
      payload: { occurred_at: dayA },
    })
  h.operations.set(command.operationId, command)
  let recovered = false
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? recovered
          ? { ok: true, data: { id: 2 } }
          : { ok: false, status: 503, data: {} }
        : { ok: true, data: [task(2)] }
  const stop = h.availability.subscribeApiRetry(() => h.syncOutbox(1))
  h.activateOutbox(1)
  await h.drain()
  assert.equal(h.operations.get(command.operationId).status, "pending")
  const firstDelay = [...h.timers.values()][0].delay
  assert(firstDelay >= 4250 && firstDelay <= 5750)
  await h.fireTimer()
  const secondDelay = [...h.timers.values()][0].delay
  assert(secondDelay >= 8500 && secondDelay <= 11500)
  recovered = true
  await h.fireTimer()
  assert.equal(h.operations.size, 0)
  assert.equal(h.timers.size, 0)
  const attempts = h.calls.filter((call) => call.path === "/offline/operations")
  assert.equal(attempts.length, 3)
  assert.deepEqual(attempts[0].options.body, attempts[2].options.body)
  stop()
  h.activateOutbox(null)
})
test("probe de sessão durante replay não contorna backoff com retries imediatos", async () => {
  const h = harness(),
    command = op("task", "complete", { target: 2, baseUpdatedAt: dayA })
  h.operations.set(command.operationId, command)
  let attempts = 0,
    recovered = false
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? ++attempts >= 4 || recovered
          ? { ok: true, data: { id: 2 } }
          : { ok: false, status: 503, data: {} }
        : { ok: true, data: [task(2)] }
  const stop = await h.startAuthSession()
  try {
    await h.drain()
    assert.equal(attempts, 1, "probe saudável não deve iniciar outro replay em execução")
    assert.equal(h.operations.get(command.operationId).status, "pending")
    assert.equal(h.timers.size, 1)
    await h.fireTimer()
    assert.equal(attempts, 2)
    assert([...h.timers.values()][0].delay >= 8500)
    recovered = true
    await h.fireTimer()
    assert.equal(attempts, 3)
    assert.equal(h.operations.size, 0)
    assert.equal(h.timers.size, 0)
  } finally {
    stop()
  }
})
test("retry manual faz probe indisponível e não altera payload legado já enviado", async () => {
  const h = harness(),
    command = op("task", "complete", {
      target: 2,
      baseUpdatedAt: dayA,
      attemptedAt: dayA,
      status: "failed",
    })
  h.operations.set(command.operationId, command)
  h.activateOutbox(1)
  await h.drain()
  h.availability.setApiAvailability("unavailable")
  h.time = dayB
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 2 } }
        : { ok: true, data: [] }
  await h.retryOperation(1, command.operationId)
  assert.equal(h.operations.size, 0)
  assert.deepEqual(
    h.calls.find((call) => call.path === "/offline/operations").options.body.payload,
    {}
  )
  h.activateOutbox(null)
})
for (const domain of ["task", "goal", "tracker", "occurrence", "entry"])
  test(`${domain}: aceite sem snapshot durável preserva intenção e retry idempotente`, async () => {
    const h = harness(),
      command = op(domain, "create", {
        ...(domain === "occurrence" ? { parentId: 5 } : {}),
        payload:
          domain === "entry"
            ? { titulo: "Entrada", tipo: "receita", valor_centavos: 100, data: "2026-10-04" }
            : domain === "occurrence"
              ? { occurred_at: dayA }
              : { titulo: "Registro" },
      })
    h.operations.set(command.operationId, command)
    h.snapshotHook = async () => false
    h.handler = async (path) =>
      path === "/usuarios/me"
        ? { ok: true, data: { id: 1 } }
        : path === "/offline/operations"
          ? { ok: true, data: { id: 33, updated_at: dayB } }
          : { ok: true, data: domain === "task" ? [task(33)] : [] }
    h.activateOutbox(1)
    await h.drain()
    assert.equal(h.operations.get(command.operationId).status, "pending")
    assert.equal(h.snapshots.size, 0)
    h.snapshotHook = async () => true
    await h.retryOperation(1, command.operationId)
    assert.equal(h.operations.size, 0)
    const attempts = h.calls.filter((call) => call.path === "/offline/operations")
    assert.equal(attempts.length, 2)
    assert.deepEqual(attempts[0].options.body, attempts[1].options.body)
    h.activateOutbox(null)
  })
test("todas as mutações de tarefa reconciliam fatos no snapshot diário antes de retirar intenção", async () => {
  for (const action of ["complete", "reopen", "update", "pin", "link", "unlink", "delete"]) {
    const h = harness(),
      original = task(2, 31),
      other = task(3, 31)
    h.snapshots.set("1:tasks:daily:last", { date: "2026-10-04", tasks: [original, other] })
    const command = op("task", action, { target: 2, baseUpdatedAt: dayA })
    h.operations.set(command.operationId, command)
    const official =
      action === "delete"
        ? []
        : [
            { ...original, titulo: "Confirmado", status: "CONCLUIDA", objetivo_id: 12 },
            { ...other, objetivo_id: 12 },
          ]
    h.snapshotHook = async (_owner, key) => key !== "tasks:daily:last"
    h.handler = async (path) =>
      path === "/usuarios/me"
        ? { ok: true, data: { id: 1 } }
        : path === "/offline/operations"
          ? { ok: true, data: { id: 2 } }
          : { ok: true, data: official }
    h.activateOutbox(1)
    await h.drain()
    assert.equal(h.operations.get(command.operationId).status, "pending", action)
    assert.deepEqual(h.snapshots.get("1:tasks:daily:last").tasks, [original, other])
    h.snapshotHook = async () => true
    await h.retryOperation(1, command.operationId)
    assert.equal(h.operations.size, 0, action)
    assert.deepEqual(h.snapshots.get("1:tasks:daily:last"), { date: "2026-10-04", tasks: official })
    h.activateOutbox(null)
  }
})
test("exclusão de objetivo só retira intenção após vínculos de tarefas e acompanhamentos duráveis", async () => {
  const h = harness(),
    command = op("goal", "delete", { target: 9, baseUpdatedAt: dayA })
  h.operations.set(command.operationId, command)
  h.snapshotHook = async (_owner, key) => key !== "trackers"
  const tasks = [{ ...task(2), objetivo_id: null }],
    trackers = [{ id: 5, objetivo_id: null, ocorrencias: [] }]
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: {} }
        : {
            ok: true,
            data: path === "/tarefas" ? tasks : path === "/acompanhamentos" ? trackers : [],
          }
  h.activateOutbox(1)
  await h.drain()
  assert.equal(h.operations.get(command.operationId).status, "pending")
  assert(h.snapshots.has("1:objectives"))
  assert(!h.snapshots.has("1:trackers"))
  h.snapshotHook = async () => true
  await h.retryOperation(1, command.operationId)
  assert.equal(h.operations.size, 0)
  assert.deepEqual(h.snapshots.get("1:tasks:all"), tasks)
  assert.deepEqual(h.snapshots.get("1:trackers"), trackers)
  const attempts = h.calls.filter((call) => call.path === "/offline/operations")
  assert.deepEqual(attempts[0].options.body, attempts[1].options.body)
  h.activateOutbox(null)
})
test("confirmação financeira do mês atual exige também snapshot usado pela Home", async () => {
  const h = harness(),
    command = op("entry", "create", {
      payload: { titulo: "Entrada", tipo: "receita", valor_centavos: 100, data: "2026-10-04" },
    })
  h.operations.set(command.operationId, command)
  h.snapshotHook = async (_owner, key) => key !== "finances:current"
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 33 } }
        : { ok: true, data: [] }
  h.activateOutbox(1)
  await h.drain()
  assert.equal(h.operations.get(command.operationId).status, "pending")
  assert(h.snapshots.has("1:finances:2026-10"))
  assert(!h.snapshots.has("1:finances:current"))
  h.snapshotHook = async () => true
  await h.retryOperation(1, command.operationId)
  assert.equal(h.operations.size, 0)
  assert(h.snapshots.has("1:finances:current"))
  h.activateOutbox(null)
})
test("401 preserva operação; replay valida dono e nunca envia fila à outra conta", async () => {
  const h = harness(),
    command = op("task", "complete", { target: 2, baseUpdatedAt: dayA })
  h.operations.set(command.operationId, command)
  let invalid = 0
  h.window.addEventListener("bunkermode-auth-invalid", () => {
    invalid++
    h.activateOutbox(null)
  })
  h.handler = async () => ({ ok: false, status: 401, data: {} })
  h.activateOutbox(1)
  await h.drain()
  assert.equal(invalid, 1)
  assert.equal(h.operations.size, 1)
  h.handler = async () => ({ ok: true, data: { id: 2 } })
  h.activateOutbox(2)
  await h.drain()
  assert.equal(h.operations.size, 1)
  h.activateOutbox(1)
  await h.drain()
  assert.equal(invalid, 2)
  assert.equal(h.calls.filter((call) => call.path === "/offline/operations").length, 0)
})
for (const race of ["request", "write"])
  test(`troca de conta durante ${race} impede envio da fila antiga e próxima conta progride`, async () => {
    const h = harness(),
      first = op("task", "complete", { target: 2, baseUpdatedAt: dayA }),
      second = op("task", "complete", { ownerId: 2, target: 8, baseUpdatedAt: dayA })
    h.operations.set(first.operationId, first)
    h.operations.set(second.operationId, second)
    let resolve,
      owner = 1
    const deferred = new Promise((done) => {
      resolve = done
    })
    if (race === "write")
      h.writeHook = async (item) => {
        if (item.ownerId === 1 && item.status === "syncing") await deferred
      }
    h.handler = async (path) =>
      path === "/usuarios/me"
        ? race === "request" && owner === 1
          ? deferred
          : { ok: true, data: { id: owner } }
        : path === "/offline/operations"
          ? { ok: true, data: { id: 8 } }
          : { ok: true, data: [task(8)] }
    h.activateOutbox(1)
    await h.drain()
    owner = 2
    h.activateOutbox(2)
    resolve({ ok: true, data: { id: 1 } })
    await h.drain()
    await h.drain()
    assert(h.operations.has(first.operationId))
    assert(!h.operations.has(second.operationId))
    assert(!h.snapshots.has("1:tasks:all"))
    assert(h.snapshots.has("2:tasks:all"))
    assert.equal(h.calls.find((call) => call.path === "/offline/operations").options.body.target, 8)
    h.activateOutbox(null)
  })
test("foco e conectividade retomam recovery; offline não agenda polling", () => {
  const h = harness()
  let retries = 0
  const stop = h.availability.subscribeApiRetry(() => retries++)
  h.availability.setApiAvailability("unavailable")
  h.window.dispatchEvent(new Event("focus"))
  assert.equal(retries, 1)
  h.online = false
  h.window.dispatchEvent(new Event("offline"))
  assert.equal(h.timers.size, 0)
  h.online = true
  h.window.dispatchEvent(new Event("online"))
  assert.equal(retries, 2)
  stop()
})

test("parciais offline preservam eventos e unidades; rejeição de plano não reinterpreta um registro", () => {
  const h = harness()
  h.time = dayB
  const plan = {
    effective_from: "2026-10-04",
    frequency: "diaria",
    weekdays: [],
    target_amount: 30,
    unit: "páginas",
    paused: false,
    timezone: "America/Recife",
  }
  const official = {
    id: 5,
    intent: "repetir",
    status: "ativo",
    planos: [plan],
    ocorrencias: [{ id: 1, occurred_at: dayA, kind: "atividade", amount: 20, unit: "páginas" }],
  }
  const partial = op("occurrence", "create", {
    parentId: 5,
    payload: {
      occurred_at: dayA,
      recorded_at: dayA,
      kind: "atividade",
      amount: 10,
      plan_effective_from: "2026-10-04",
      unit: "páginas",
    },
  })
  const projected = h.projectTrackers([official], [partial])[0]
  assert.equal(projected.ocorrencias.length, 2)
  assert.equal(h.practiceDomain.derivePractice(projected, new Date(dayB)).closedFulfilled, 1)
  const incompatible = { ...partial, payload: { ...partial.payload, unit: "minutos" } }
  assert.equal(h.projectTrackers([official], [incompatible])[0].ocorrencias.length, 1)
  assert.equal(
    h.projectTrackers([official], [{ ...partial, status: "conflict" }])[0].ocorrencias.length,
    1
  )
  assert.equal(official.ocorrencias.length, 1)
})

test("pausa local com vigência futura não pausa hoje e não altera o plano oficial", () => {
  const h = harness()
  h.time = dayB
  const plan = {
    effective_from: "2026-10-04",
    frequency: "diaria",
    weekdays: [],
    target_amount: null,
    unit: null,
    paused: false,
    timezone: "America/Recife",
  }
  const official = { id: 5, intent: "repetir", status: "ativo", planos: [plan], ocorrencias: [] }
  const projected = h.projectTrackers(
    [official],
    [
      op("tracker", "update", {
        target: 5,
        payload: { status: "pausado", effective_from: "2026-10-06" },
      }),
    ]
  )[0]
  assert.equal(projected.status, "ativo")
  assert.equal(projected.planos.length, 2)
  assert.equal(projected.planos[1].paused, true)
  assert.equal(official.planos[0].effective_until, undefined)
})
test("registro livre offline preserva quantidade e unidade sem oportunidade artificial", () => {
  const h = harness()
  const official = { id: 5, intent: "registro_livre", planos: [], ocorrencias: [] }
  const pending = op("occurrence", "create", {
    parentId: 5,
    payload: { occurred_at: dayA, amount: 1.5, unit: "copos" },
  })
  const projected = h.projectTrackers([official], [pending])[0]
  assert.equal(projected.ocorrencias[0].amount, 1.5)
  assert.equal(projected.ocorrencias[0].unit, "copos")
  assert.equal(h.practiceDomain.derivePractice(projected, new Date(dayB)).closedExpected, 0)
  assert.equal(
    h.projectTrackers([official], [{ ...pending, status: "failed" }])[0].ocorrencias.length,
    0
  )
})

test("criação local não absorve uma pausa ou nova vigência e preserva sequência de comandos", async () => {
  const h = harness()
  const id = await h.enqueueOperation(1, "tracker", "create", {
    titulo: "Ler",
    intent: "repetir",
    plan: { effective_from: "2026-10-04", frequency: "diaria", weekdays: [] },
  })
  await h.enqueueOperation(
    1,
    "tracker",
    "update",
    { status: "pausado", effective_from: "2026-10-05" },
    id
  )
  const operations = [...h.operations.values()]
  assert.equal(operations.length, 2)
  assert.equal(operations[0].action, "create")
  assert.equal(operations[0].payload.status, undefined)
  assert.equal(operations[1].payload.recorded_at, dayA)
  assert.equal(operations[1].target, id)
})
test("formulário aberto antes da reconciliação registra na mesma prática após receber ID oficial", async () => {
  const h = harness(),
    create = op("tracker", "create", { payload: { titulo: "Ler" } })
  h.operations.set(create.operationId, create)
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 33, updated_at: dayB } }
        : { ok: true, data: [] }
  h.activateOutbox(1)
  await h.drain()
  assert.equal(h.operations.size, 0)
  await h.enqueueOperation(
    1,
    "occurrence",
    "create",
    { occurred_at: dayA },
    undefined,
    undefined,
    `local:${create.operationId}`
  )
  await h.drain()
  assert.equal(
    h.operations.size,
    0,
    "a criação já reconciliada não pode deixar um registro dependente sem destino"
  )
  assert.equal(
    h.calls.filter((call) => call.path === "/offline/operations").at(-1).options.body.parentId,
    33
  )
  h.activateOutbox(null)
})
test("edição aberta usa ID e versão oficiais; referências recentes nunca atravessam contas", async () => {
  const h = harness(),
    create = op("tracker", "create", { payload: { titulo: "Ler" } })
  h.operations.set(create.operationId, create)
  let owner = 1
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: owner } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 33, updated_at: dayB } }
        : { ok: true, data: [] }
  h.activateOutbox(1)
  await h.drain()
  await h.enqueueOperation(
    1,
    "tracker",
    "update",
    { titulo: "Ler mais" },
    `local:${create.operationId}`,
    dayA
  )
  await h.drain()
  const update = h.calls.filter((call) => call.path === "/offline/operations").at(-1).options.body
  assert.equal(update.target, 33)
  assert.equal(update.baseUpdatedAt, dayB)
  const before = h.calls.filter((call) => call.path === "/offline/operations").length
  owner = 2
  h.activateOutbox(2)
  await h.drain()
  await h.enqueueOperation(
    2,
    "occurrence",
    "create",
    { occurred_at: dayA },
    undefined,
    undefined,
    `local:${create.operationId}`
  )
  await h.drain()
  assert.equal(h.calls.filter((call) => call.path === "/offline/operations").length, before)
  assert.equal([...h.operations.values()][0].status, "failed")
  h.activateOutbox(null)
})
test("tarefa criada em formulário antigo preserva vínculo com objetivo recém-reconciliado", async () => {
  const h = harness(),
    create = op("goal", "create", { payload: { titulo: "Ler mais" } })
  h.operations.set(create.operationId, create)
  h.handler = async (path) =>
    path === "/usuarios/me"
      ? { ok: true, data: { id: 1 } }
      : path === "/offline/operations"
        ? { ok: true, data: { id: 33, updated_at: dayB } }
        : { ok: true, data: [] }
  h.activateOutbox(1)
  await h.drain()
  await h.enqueueOperation(1, "task", "create", {
    titulo: "Comprar livro",
    objetivo_id: `local:${create.operationId}`,
  })
  await h.drain()
  assert.equal(
    h.calls.filter((call) => call.path === "/offline/operations").at(-1).options.body.payload
      .objetivo_id,
    33
  )
  assert.equal(h.operations.size, 0)
  h.activateOutbox(null)
})
