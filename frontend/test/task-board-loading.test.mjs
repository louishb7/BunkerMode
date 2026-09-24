import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

// Mesmo harness de hooks dos testes de Objetivos, com efeitos disparados pelo teste.
function boardHarness(api, onUnauthorized = () => false) {
  const values = []
  let index = 0
  let effect
  let cleanup
  const react = {
    useState(initial) {
      const slot = index++
      if (!(slot in values)) values[slot] = initial
      return [values[slot], (value) => { values[slot] = value }]
    },
    useRef(initial) {
      const slot = index++
      values[slot] ??= { current: initial }
      return values[slot]
    },
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect(callback) { effect = callback },
  }
  const source = readFileSync(new URL("../src/features/tasks/hooks/useTaskBoard.ts", import.meta.url), "utf8")
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports,
    require(path) {
      if (path === "react") return react
      if (path.endsWith("bunkermodeApi")) return { api }
      if (path.endsWith("taskSelectors")) return { getActionTasks: (tasks) => tasks }
      if (path.endsWith("uiState")) return { emptyStatus: { type: "", message: "" } }
      if (path.endsWith("httpClient")) return {
        getErrorMessage: (result, fallback) => result.data?.message || fallback,
      }
      if (path.endsWith("overviewCache")) return {
        getOverview: () => ({ all: null, daily: null }),
        updateOverview: () => {},
        updateCachedTask: () => {},
      }
      if (path.endsWith("calendarUtils")) return { operationalDateFor: () => new Date(2026, 8, 9) }
      if (path.endsWith("/date")) return { formatDateForApi: () => "09-09-2026" }
      throw new Error(path)
    },
  })
  const render = (boardMode = "tasks") => {
    index = 0
    return exports.useTaskBoard({ authenticated: true, boardMode, token: "token", onUnauthorized })
  }
  return {
    render,
    load(mode) {
      cleanup?.()
      render(mode)
      cleanup = effect()
    },
    unmount() { cleanup?.() },
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const ok = { ok: true, status: 204, data: null }
const error = (status = 503) => ({ ok: false, status, data: { message: "Falha de preparação" } })
const boardResult = (mode, id) => ({
  ok: true, data: mode === "focus" ? { daily_tasks: [{ id }] } : [{ id }],
})
const methodFor = (mode) => mode === "focus" ? "getFocusBoard" : "listTasks"

test("reabertura usa comando explícito e recarrega o board após persistir", async () => {
  const calls = []
  const harness = boardHarness({
    reopenTask: async (_token, id) => { calls.push(`reopen:${id}`); return ok },
    updateTask: () => { throw new Error("PATCH genérico inválido") },
    materializeTaskRecurrences: async () => { calls.push("POST"); return ok },
    listTasks: async () => { calls.push("GET"); return boardResult("tasks", 1) },
  })
  const result = await harness.render().reopenTask({ id: 1 })
  assert.equal(result.persisted, true)
  assert.equal(result.synchronized, true)
  assert.deepEqual(calls, ["reopen:1", "POST", "GET"])
})

test("cliente HTTP de reabertura aponta para POST /tarefas/:id/reabrir", async () => {
  const calls = []
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/services/bunkermodeApi.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(path) {
    if (path.endsWith("httpClient")) return { request: async (path, options) => { calls.push([path, options.method]); return { ok: true, data: {} } } }
    return { assertTaskContract: (task) => task }
  } })
  await exports.api.reopenTask("token", 42)
  assert.deepEqual(calls, [["/tarefas/42/reabrir", "POST"]])
})

for (const mode of ["tasks", "focus"]) {
  test(`${mode}: prepara recorrências antes de carregar e repetir a leitura`, async () => {
    const calls = []
    const harness = boardHarness({
      materializeTaskRecurrences: async () => { calls.push("POST"); return ok },
      [methodFor(mode)]: async () => { calls.push("GET"); return boardResult(mode, 1) },
    })
    harness.load(mode)
    assert.equal(harness.render(mode).taskLoading, true)
    await flush()
    harness.load(mode)
    await flush()
    assert.deepEqual(calls, ["POST", "GET", "POST", "GET"])
    assert.equal(harness.render(mode).tasks[0].id, 1)
    assert.equal(harness.render(mode).taskLoading, false)
  })

  for (const status of [503, 401]) {
    test(`${mode}: materialização ${status} interrompe GET e trata sessão/erro`, async () => {
      let reads = 0
      let unauthorized = 0
      const harness = boardHarness({
        materializeTaskRecurrences: async () => error(status),
        [methodFor(mode)]: async () => { reads++; return boardResult(mode, 1) },
      }, (result) => {
        if (result.status !== 401) return false
        unauthorized++
        return true
      })
      harness.load(mode)
      await flush()
      const board = harness.render(mode)
      assert.equal(reads, 0)
      assert.equal(board.taskLoading, false)
      assert.equal(board.tasks.length, 0)
      assert.equal(unauthorized, status === 401 ? 1 : 0)
      assert.equal(board.status.message, status === 401 ? "" : "Falha de preparação")
    })
  }

  for (const staleResult of [ok, error(), error(401)]) {
    test(`${mode}: materialização antiga ${staleResult.status} não dispara GET nem erro`, async () => {
      const pending = []
      let reads = 0
      let unauthorized = 0
      const harness = boardHarness({
        materializeTaskRecurrences: () => new Promise((resolve) => pending.push(resolve)),
        [methodFor(mode)]: async () => { reads++; return boardResult(mode, 2) },
      }, (result) => { if (result.status === 401) unauthorized++; return result.status === 401 })
      harness.load(mode)
      harness.load(mode)
      pending[1](ok)
      await flush()
      pending[0](staleResult)
      await flush()
      assert.equal(reads, 1)
      assert.equal(unauthorized, 0)
      assert.equal(harness.render(mode).tasks[0].id, 2)
      assert.equal(harness.render(mode).status.message, "")
    })
  }

  test(`${mode}: GET antigo não sobrescreve board de outra rota`, async () => {
    let resolveOld
    const nextMode = mode === "tasks" ? "focus" : "tasks"
    const harness = boardHarness({
      materializeTaskRecurrences: async () => ok,
      [methodFor(mode)]: () => new Promise((resolve) => { resolveOld = resolve }),
      [methodFor(nextMode)]: async () => boardResult(nextMode, 2),
    })
    harness.load(mode)
    await flush()
    harness.load(nextMode)
    await flush()
    resolveOld(boardResult(mode, 1))
    await flush()
    assert.equal(harness.render(nextMode).tasks[0].id, 2)
  })

  test(`${mode}: desmontagem invalida materialização pendente`, async () => {
    let resolve
    let reads = 0
    const harness = boardHarness({
      materializeTaskRecurrences: () => new Promise((done) => { resolve = done }),
      [methodFor(mode)]: async () => { reads++; return boardResult(mode, 1) },
    })
    harness.load(mode)
    harness.unmount()
    resolve(ok)
    await flush()
    assert.equal(reads, 0)
  })

  test(`${mode}: releitura após mutação prepara recorrências e não aplica erro stale`, async () => {
    const pending = []
    const calls = []
    const harness = boardHarness({
      completeTask: async () => { calls.push("complete"); return ok },
      materializeTaskRecurrences: () => {
        calls.push("POST")
        return new Promise((resolve) => pending.push(resolve))
      },
      [methodFor(mode)]: async () => { calls.push("GET"); return boardResult(mode, 2) },
    })
    const mutation = harness.render(mode).completeTask({ id: 1 })
    await flush()
    harness.load(mode)
    pending[1](ok)
    await flush()
    pending[0](error())
    const result = await mutation
    assert.equal(result.persisted, true)
    assert.equal(result.synchronized, false)
    assert.deepEqual(calls, ["complete", "POST", "POST", "GET"])
    assert.equal(harness.render(mode).status.message, "")
    assert.equal(harness.render(mode).tasks[0].id, 2)
  })
}

test("mutação antiga após desmontagem não altera estado nem dispara unauthorized", async () => {
  let resolveMutation
  let unauthorized = 0
  const harness = boardHarness(
    {
      completeTask: () =>
        new Promise((resolve) => {
          resolveMutation = resolve
        }),
      materializeTaskRecurrences: async () => ok,
      listTasks: async () => boardResult("tasks", 1),
    },
    (result) => {
      if (result.status === 401) unauthorized += 1
      return result.status === 401
    }
  )
  harness.load("tasks")
  await flush()
  const mutation = harness.render("tasks").completeTask({ id: 1 })
  harness.unmount()
  resolveMutation({ ok: false, status: 401, data: { message: "Sessão antiga" } })
  assert.equal(await mutation, false)
  assert.equal(unauthorized, 0)
})
