import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
const vite = await createServer({ appType: "custom", logLevel: "silent", root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true } })
const [{ useTrackers }, { useObjectiveTasks }, { api }, cache] = await Promise.all([
  vite.ssrLoadModule("/src/features/objectives/hooks/useTrackers.ts"),
  vite.ssrLoadModule("/src/features/objectives/hooks/useObjectiveTasks.ts"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
  vite.ssrLoadModule("/src/state/overviewCache.ts"),
])
after(() => vite.close())

async function mount(hook, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let current
  function Probe() { current = hook(props); return null }
  await act(async () => root.render(React.createElement(Probe)))
  return { get current() { return current }, async close() { await act(async () => root.unmount()); container.remove() } }
}

test("acompanhamento registra eventos reais, permite remoção e não chama tarefas", async () => {
  const token = "tracker-flow"
  const original = { listTrackers: api.listTrackers, createTracker: api.createTracker, recordTrackerOccurrence: api.recordTrackerOccurrence, deleteTrackerOccurrence: api.deleteTrackerOccurrence, deleteTracker: api.deleteTracker }
  let finishRecord
  let taskCalls = 0
  api.listTrackers = async () => ({ ok: true, data: [] })
  api.createTracker = async (_token, payload) => {
    assert.equal(payload.objetivo_id, 4)
    return { ok: true, data: { id: 10, objetivo_id: 4, titulo: payload.titulo, descricao: null, ocorrencias: [] } }
  }
  api.recordTrackerOccurrence = async () => new Promise((resolve) => { finishRecord = resolve })
  api.deleteTrackerOccurrence = async () => ({ ok: true, status: 204 })
  api.deleteTracker = async () => ({ ok: true, status: 204 })
  const originalTask = api.createTask
  api.createTask = () => { taskCalls++; throw new Error("Acompanhamento não cria tarefa") }
  const view = await mount(useTrackers, { token, onUnauthorized: () => false })
  try {
    await act(async () => { assert.equal(await view.current.createTracker({ objetivo_id: 4, titulo: "Não fumar" }), true) })
    assert.equal(view.current.byObjective[4][0].ocorrencias.length, 0)
    let pending
    await act(async () => { pending = view.current.recordOccurrence(view.current.byObjective[4][0]) })
    assert.equal(view.current.byObjective[4][0].ocorrencias.length, 1)
    assert.ok(view.current.byObjective[4][0].ocorrencias[0].id < 0)
    await act(async () => finishRecord({ ok: true, data: { id: 21, acompanhamento_id: 10, occurred_at: "2026-09-23T12:00:00Z", created_at: "2026-09-23T12:00:00Z" } }))
    assert.equal(await pending, true)
    assert.equal(view.current.byObjective[4][0].ocorrencias[0].id, 21)
    await act(async () => { assert.equal(await view.current.deleteOccurrence(view.current.byObjective[4][0], view.current.byObjective[4][0].ocorrencias[0]), true) })
    assert.equal(view.current.byObjective[4][0].ocorrencias.length, 0)
    await act(async () => { assert.equal(await view.current.deleteTracker(view.current.byObjective[4][0]), true) })
    assert.equal(view.current.byObjective[4], undefined)
    assert.equal(taskCalls, 0)
  } finally {
    Object.assign(api, original, { createTask: originalTask })
    await view.close()
    cache.clearOverview()
  }
})

test("desvincular série atualiza cache de todas as ocorrências sem remover tarefas", async () => {
  const token = "unlink-flow"
  const task = (id, seriesId, status = "PENDENTE") => ({ id, titulo: "Mesmo título", status, status_code: status, objetivo_id: 4, recurrence: seriesId ? { series_id: seriesId, termination_policy: "ate_objetivo" } : null })
  const tasks = [task(1, 30, "CONCLUIDA"), task(2, 30), task(3, 31)]
  cache.updateOverview(token, { all: tasks, daily: tasks })
  const original = { listTasks: api.listTasks, unlinkTaskFromObjective: api.unlinkTaskFromObjective }
  api.listTasks = async () => ({ ok: true, data: tasks })
  api.unlinkTaskFromObjective = async () => ({ ok: true, data: { tarefa_id: 1, series_id: 30, objetivo_id: null } })
  const view = await mount(useObjectiveTasks, { token, enabled: true, onUnauthorized: () => false })
  try {
    await act(async () => { assert.equal(await view.current.unlinkTask(tasks[0]), true) })
    assert.equal(view.current.tasksByObjetivo[4].length, 1)
    assert.equal(view.current.tasksByObjetivo[4][0].recurrence.series_id, 31)
    assert.deepEqual(cache.getOverview(token).all.map((item) => item.objetivo_id), [null, null, 4])
    assert.equal(cache.getOverview(token).all[0].status, "CONCLUIDA")
    assert.equal(cache.getOverview(token).all[0].recurrence.termination_policy, "sem_termino")
  } finally {
    Object.assign(api, original)
    await view.close()
    cache.clearOverview()
  }
})

test("desvínculo pontual preserva status e só altera a tarefa selecionada", () => {
  const token = "point-unlink"
  const tasks = [
    { id: 1, objetivo_id: 4, status: "CONCLUIDA", recurrence: null },
    { id: 2, objetivo_id: 4, status: "PENDENTE", recurrence: null },
  ]
  cache.updateOverview(token, { all: tasks, daily: tasks })
  cache.unlinkCachedObjectiveTask(token, tasks[0])
  assert.deepEqual(cache.getOverview(token).all.map((item) => item.objetivo_id), [null, 4])
  assert.equal(cache.getOverview(token).all[0].status, "CONCLUIDA")
  cache.clearOverview()
})

test("remover objetivo limpa vínculos e acompanhamentos do cache sem apagar tarefas", () => {
  const token = "removed-goal"
  const tasks = [
    { id: 1, objetivo_id: 4, status: "CONCLUIDA" },
    { id: 2, objetivo_id: 5, status: "PENDENTE" },
  ]
  cache.updateOverview(token, { all: tasks, daily: tasks, trackers: [
    { id: 10, objetivo_id: 4 }, { id: 11, objetivo_id: 5 },
  ] })
  cache.removeObjectiveFromOverview(token, 4)
  assert.deepEqual(cache.getOverview(token).all.map((item) => item.objetivo_id), [null, 5])
  assert.equal(cache.getOverview(token).all[0].status, "CONCLUIDA")
  assert.deepEqual(cache.getOverview(token).trackers.map((item) => item.id), [11])
  cache.clearOverview()
})

test("401 em Acompanhamentos passa pelo tratamento global", async () => {
  const token = "tracker-401"
  const original = { listTrackers: api.listTrackers, createTracker: api.createTracker }
  let unauthorized = 0
  api.listTrackers = async () => ({ ok: true, data: [] })
  api.createTracker = async () => ({ ok: false, status: 401 })
  const view = await mount(useTrackers, { token, onUnauthorized: (result) => { if (result.status === 401) unauthorized++; return result.status === 401 } })
  try {
    await act(async () => { assert.equal(await view.current.createTracker({ objetivo_id: 4, titulo: "Não fumar" }), false) })
    assert.equal(unauthorized, 1)
    assert.equal(view.current.byObjective[4], undefined)
  } finally {
    Object.assign(api, original)
    await view.close()
    cache.clearOverview()
  }
})

test("falha ao remover ocorrência restaura o evento no cache", async () => {
  const token = "tracker-rollback"
  const occurrence = { id: 9, acompanhamento_id: 10, occurred_at: "2026-09-23T12:00:00Z", created_at: "2026-09-23T12:00:00Z" }
  const tracker = { id: 10, objetivo_id: 4, titulo: "Não fumar", ocorrencias: [occurrence] }
  cache.updateOverview(token, { trackers: [tracker] })
  const original = { listTrackers: api.listTrackers, deleteTrackerOccurrence: api.deleteTrackerOccurrence }
  let finish
  api.listTrackers = async () => ({ ok: true, data: [tracker] })
  api.deleteTrackerOccurrence = async () => new Promise((resolve) => { finish = resolve })
  const view = await mount(useTrackers, { token, onUnauthorized: () => false })
  try {
    let pending
    await act(async () => { pending = view.current.deleteOccurrence(tracker, occurrence) })
    assert.equal(view.current.byObjective[4][0].ocorrencias.length, 0)
    await act(async () => finish({ ok: false, status: 503, data: { message: "Falha" } }))
    assert.equal(await pending, false)
    assert.equal(view.current.byObjective[4][0].ocorrencias[0].id, 9)
    assert.equal(cache.getOverview(token).trackers[0].ocorrencias[0].id, 9)
  } finally {
    Object.assign(api, original)
    await view.close()
    cache.clearOverview()
  }
})
