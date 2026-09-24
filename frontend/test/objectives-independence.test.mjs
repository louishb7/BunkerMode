import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

// Exercita as operações dos hooks com APIs controladas, sem servidor ou banco.
function loadHook(file, name, api, onUnauthorized = () => false) {
  api = { materializeTaskRecurrences: async () => ({ ok: true, status: 204 }), ...api }
  const values = []
  let index = 0
  let effect
  let cleanup
  const react = {
    useState(initial) {
      const slot = index++
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial
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
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require(path) {
      if (path === "react") return react
      if (path.endsWith("bunkermodeApi")) return { api }
      if (path.endsWith("uiState")) return { emptyStatus: { type: "", message: "" } }
      if (path.endsWith("httpClient")) return {
        getErrorMessage: (result, fallback) => result.data?.message || fallback,
      }
      if (path.endsWith("overviewCache")) return { getOverview: () => ({ all: null, objectives: null }), updateOverview: () => {} }
      throw new Error(path)
    },
  })
  const render = (props = {}) => {
    index = 0
    return exports[name]({ token: "test-token", onUnauthorized, ...props })
  }
  render.activate = (props = {}) => {
    cleanup?.()
    render(props)
    cleanup = effect()
  }
  return render
}

test("desativar integração invalida leitura e criação ainda pendentes", async () => {
  let finishRead
  let create
  let reads = 0
  const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
    listTasks: () => { reads++; return new Promise((resolve) => { finishRead = resolve }) },
    createTask: () => new Promise((resolve) => { create = resolve }),
  })
  render.activate({ enabled: true })
  const creation = render().createTask({ titulo: "Tarefa vinculada" })
  render.activate({ enabled: false })
  finishRead({ ok: true, data: [] })
  create({ ok: true })
  assert.equal(await creation, false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(reads, 1)
  assert.equal(render({ enabled: false }).loading, false)
})

test("integração desativada não consulta nem cria tarefas", async () => {
  const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
    listTasks: () => { throw new Error("Não deveria listar") },
    materializeTaskRecurrences: () => { throw new Error("Não deveria materializar") },
    createTask: () => { throw new Error("Não deveria criar") },
  })
  assert.equal(await render({ enabled: false }).refresh(), false)
  assert.equal(await render({ enabled: false }).createTask({ titulo: "Tarefa" }), false)
})

test("Objetivos lista e executa todo CRUD sem consultar Tarefas", async () => {
  const calls = []
  const api = {
    listObjetivos: async () => {
      calls.push("list")
      return { ok: true, data: [{ id: 1, titulo: "Objetivo independente" }] }
    },
    listTasks: () => { throw new Error("Tarefas indisponível") },
  }
  for (const method of ["createObjetivo", "updateObjetivo", "updateObjetivoStatus", "reorderObjetivos", "deleteObjetivo"]) {
    api[method] = async () => {
      calls.push(method)
      return { ok: true, data: null }
    }
  }
  const render = loadHook("../src/features/objectives/hooks/useObjectives.ts", "useObjectives", api)
  assert.equal(await render().refresh(), true)
  assert.equal(render().objetivos[0].titulo, "Objetivo independente")
  for (const method of ["createObjetivo", "updateObjetivo", "updateObjetivoStatus", "reorderObjetivos", "deleteObjetivo"]) {
    assert.equal(await render()[method](1, {}), true)
    assert.equal(calls.at(-2), method)
    assert.equal(calls.at(-1), "list")
  }
})

test("integração mostra falha local e recupera tarefas agrupadas por objetivo", async () => {
  let available = false
  const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
    listTasks: async () => available
      ? { ok: true, data: [{ id: 10, objetivo_id: 1 }, { id: 11, objetivo_id: null }] }
      : { ok: false, status: 503, data: { message: "Serviço indisponível" } },
  })
  assert.equal(await render().refresh(), false)
  assert.equal(render().error, "Serviço indisponível")
  assert.equal(render().loading, false)
  available = true
  assert.equal(await render().refresh(), true)
  assert.equal(render().error, "")
  assert.equal(render().tasksByObjetivo["1"][0].id, 10)
  assert.equal(render().tasksByObjetivo["2"], undefined)
})

test("criação vinculada preserva payload e distingue persistência de falha na releitura", async () => {
  let available = false
  let received
  const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
    createTask: async (_token, payload) => {
      received = payload
      return available ? { ok: true, data: { id: 10 } }
        : { ok: false, data: { message: "Criação indisponível" } }
    },
    listTasks: async () => ({ ok: false, data: { message: "Leitura indisponível" } }),
  })
  const payload = { titulo: "Tarefa", objetivo_id: 1, duration_type: "ate_objetivo", recurrence_weekdays: [0] }
  assert.equal(await render().createTask(payload), false)
  assert.equal(render().formStatus.message, "Criação indisponível")
  available = true
  assert.equal(await render().createTask(payload), true)
  assert.equal(received, payload)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(render().error, "Leitura indisponível")
})

test("respostas 401 da integração acionam a sessão global sem erro local", async () => {
  const unauthorizedResults = []
  const render = loadHook(
    "../src/features/objectives/hooks/useObjectiveTasks.ts",
    "useObjectiveTasks",
    {
      listTasks: async () => ({ ok: false, status: 401, data: { message: "Sessão expirada" } }),
      createTask: async () => ({ ok: false, status: 401, data: { message: "Sessão expirada" } }),
    },
    (result) => {
      if (result.status === 401) unauthorizedResults.push(result)
      return result.status === 401
    },
  )

  assert.equal(await render().refresh(), false)
  assert.equal(render().error, "")
  assert.equal(await render().createTask({ titulo: "Tarefa vinculada" }), false)
  assert.equal(render().formStatus.message, "")
  assert.equal(unauthorizedResults.length, 2)
  assert.equal(unauthorizedResults.every((result) => result.status === 401), true)
})

test("resposta stale não aciona o tratamento global de sessão", async () => {
  const pendingRequests = []
  let unauthorizedCalls = 0
  const render = loadHook(
    "../src/features/objectives/hooks/useObjectiveTasks.ts",
    "useObjectiveTasks",
    {
      listTasks: () => new Promise((resolve) => pendingRequests.push(resolve)),
    },
    (result) => {
      if (result.status !== 401) return false
      unauthorizedCalls += 1
      return true
    },
  )

  const staleRequest = render().refresh()
  await new Promise((resolve) => setImmediate(resolve))
  const currentRequest = render().refresh()
  await new Promise((resolve) => setImmediate(resolve))
  pendingRequests[1]({ ok: true, data: [] })
  assert.equal(await currentRequest, true)
  pendingRequests[0]({ ok: false, status: 401, data: { message: "Sessão expirada" } })
  assert.equal(await staleRequest, false)
  assert.equal(unauthorizedCalls, 0)
})

test("integração lê sem materializar e preserva 401 global", async () => {
  for (const status of [200, 503, 401]) {
    const calls = []
    let unauthorized = 0
    const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
      materializeTaskRecurrences: () => { throw new Error("Leitura não materializa") },
      listTasks: async () => { calls.push("GET"); return { ok: status === 200, status, data: status === 200 ? [] : { message: "Leitura indisponível" } } },
    }, (result) => { if (result.status === 401) unauthorized++; return result.status === 401 })
    assert.equal(await render().refresh(), status === 200)
    assert.deepEqual(calls, ["GET"])
    assert.equal(unauthorized, status === 401 ? 1 : 0)
    assert.equal(render().error, status === 503 ? "Leitura indisponível" : "")
  }
})

test("leitura stale não aplica erro ou 401", async () => {
  for (const status of [200, 503, 401]) {
    const pending = []
    let reads = 0
    let unauthorized = 0
    const render = loadHook("../src/features/objectives/hooks/useObjectiveTasks.ts", "useObjectiveTasks", {
      listTasks: () => { reads++; return new Promise((resolve) => pending.push(resolve)) },
    }, (result) => { if (result.status === 401) unauthorized++; return result.status === 401 })
    const old = render().refresh()
    const latest = render().refresh()
    pending[1]({ ok: true, status: 200, data: [{ id: 2, objetivo_id: 1 }] })
    await latest
    pending[0]({ ok: status === 200, status, data: status === 200 ? [] : { message: "Antigo" } })
    assert.equal(await old, false)
    assert.equal(reads, 2)
    assert.equal(unauthorized, 0)
    assert.equal(render().tasksByObjetivo[1][0].id, 2)
    assert.equal(render().error, "")
  }
})

test("Objetivos aceita somente a leitura mais nova e ignora 401 e erro comuns antigos", async () => {
  for (const staleResult of [
    { ok: false, status: 401, data: { message: "Sessão antiga" } },
    { ok: false, status: 503, data: { message: "Erro antigo" } },
    { ok: true, status: 200, data: [{ id: 1, titulo: "Antigo" }] },
  ]) {
    const pending = []
    let unauthorized = 0
    const render = loadHook(
      "../src/features/objectives/hooks/useObjectives.ts",
      "useObjectives",
      { listObjetivos: () => new Promise((resolve) => pending.push(resolve)) },
      (result) => {
        if (result.status !== 401) return false
        unauthorized += 1
        return true
      }
    )

    const oldRequest = render().refresh()
    const currentRequest = render().refresh()
    pending[1]({ ok: true, status: 200, data: [{ id: 2, titulo: "Atual" }] })
    assert.equal(await currentRequest, true)
    pending[0](staleResult)
    assert.equal(await oldRequest, false)
    assert.equal(render().objetivos[0].titulo, "Atual")
    assert.equal(render().status.message, "")
    assert.equal(render().loading, false)
    assert.equal(unauthorized, 0)
  }
})
