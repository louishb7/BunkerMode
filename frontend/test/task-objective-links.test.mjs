import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
const { default: React, act } = await import("react")
const { createRoot } = await import("react-dom/client")
const vite = await createServer({ appType: "custom", logLevel: "silent",
  root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true } })
const [{ default: TasksPage }, { api }] = await Promise.all([
  vite.ssrLoadModule("/src/features/tasks/pages/TasksPage.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
])
after(() => vite.close())

test("Tarefas vincula, troca e desvincula pelo menu; recorrência deixa explícito o alcance da série", async () => {
  const original = { ...api }
  const goals = [{ id: 9, titulo: "Ler mais", status: "ativo" },
    { id: 10, titulo: "Estudar", status: "ativo" }]
  let reads = 0
  api.listObjetivos = async () => { reads++; return { ok: true, data: goals } }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const now = new Date()
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife" }).format(now)
  const task = { id: 2, titulo: "Ler", prazo: date, status: "PENDENTE", objetivo_id: null,
    permissions: { can_edit: true }, recurrence: { series_id: 31, weekdays: [0,1,2,3,4,5,6] } }
  const calls = []
  const board = { dailyTasks: [task], status: {}, formStatus: {}, setFormStatus() {},
    async setTaskObjective(item, id) { calls.push({ task: item.id, series: item.recurrence.series_id, objective: id }); return { persisted: true } } }
  const user = { id: 77, timezone: "America/Recife", enabled_modules: ["tasks", "objectives"] }
  const render = () => act(async () => root.render(React.createElement(TasksPage,
    { board, user, token: "test", onUnauthorized: () => false })))
  const click = (element) => { assert.ok(element); return act(async () => element.click()) }
  const menu = () => container.querySelector('[aria-label="Ações da tarefa: Ler"]')
  try {
    await render()
    assert.equal(reads, 0, "lista de Tarefas não exige consulta de Objetivos")
    for (const [label, value] of [["Vincular objetivo", "9"], ["Trocar ou remover objetivo", "10"], ["Trocar ou remover objetivo", ""]]) {
      await click(menu())
      await click([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === label))
      const dialog = document.querySelector('[role="dialog"]')
      assert.match(dialog.textContent, /série inteira/)
      const select = dialog.querySelector("select")
      assert.equal(select.value, task.objetivo_id == null ? "" : String(task.objetivo_id))
      await act(async () => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })) })
      await act(async () => dialog.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })))
      assert.equal(document.querySelector('[role="dialog"]'), null)
      task.objetivo_id = value ? Number(value) : null
      await render()
    }
    assert.deepEqual(calls, [{ task: 2, series: 31, objective: 9 }, { task: 2, series: 31, objective: 10 }, { task: 2, series: 31, objective: null }])
    user.enabled_modules = ["tasks"]
    await render()
    await click(menu())
    assert.equal([...document.querySelectorAll('[role="menuitem"]')].some((item) => /objetivo/.test(item.textContent)), false)
  } finally { await act(async () => root.unmount()); container.remove(); Object.assign(api, original) }
})
