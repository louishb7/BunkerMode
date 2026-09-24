import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
const vite = await createServer({ appType: "custom", logLevel: "silent", root: new URL("..", import.meta.url).pathname, server: { middlewareMode: true } })
const [{ default: HomePage }, { api }, cache] = await Promise.all([
  vite.ssrLoadModule("/src/features/home/pages/HomePage.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
  vite.ssrLoadModule("/src/state/overviewCache.ts"),
])
after(() => vite.close())
const todayKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Recife", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.day}-${byType.month}-${byType.year}`
}

test("Home conclui imediatamente, ordena pendentes antes e sincroniza resposta", async () => {
  const task = (id, status = "PENDENTE") => ({ id, titulo: `Tarefa ${id}`, status, status_code: status, permissions: { can_complete: status === "PENDENTE" } })
  const token = "home-complete-test"
  cache.updateOverview(token, { daily: [task(1), task(2)], dailyDate: todayKey() })
  let finish
  const original = { listDailyTasks: api.listDailyTasks, completeTask: api.completeTask }
  api.listDailyTasks = async () => ({ ok: true, data: [task(1), task(2)] })
  api.completeTask = async () => new Promise((resolve) => { finish = resolve })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(HomePage, { token, user: { enabled_modules: ["tasks"], timezone: "America/Recife" }, onUnauthorized: () => false }))))
    await act(async () => container.querySelector('[aria-label="Concluir: Tarefa 1"]').click())
    assert.match(container.querySelector("ul").textContent, /Tarefa 2Tarefa 1/)
    assert.equal(container.querySelector(".line-through")?.textContent, "Tarefa 1")
    await act(async () => finish({ ok: true, data: task(1, "CONCLUIDA") }))
    assert.equal(cache.getOverview(token).daily[0].status, "CONCLUIDA")
  } finally {
    api.listDailyTasks = original.listDailyTasks
    api.completeTask = original.completeTask
    await act(async () => root.unmount())
    container.remove()
    cache.clearOverview()
  }
})

test("Home mantém cache visível durante releitura e desfaz conclusão rejeitada", async () => {
  const token = "home-complete-rollback"
  const first = { id: 1, titulo: "Ler", status: "PENDENTE", status_code: "PENDENTE", permissions: { can_complete: true } }
  const second = { ...first, id: 2, titulo: "Escrever" }
  cache.updateOverview(token, { daily: [first, second], dailyDate: todayKey() })
  let finish
  const original = { listDailyTasks: api.listDailyTasks, completeTask: api.completeTask }
  api.listDailyTasks = async () => new Promise(() => {})
  api.completeTask = async () => new Promise((resolve) => { finish = resolve })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(HomePage, { token, user: { enabled_modules: ["tasks"], timezone: "America/Recife" }, onUnauthorized: () => false }))))
    assert.match(container.textContent, /Ler/)
    assert.doesNotMatch(container.textContent, /Carregando/)
    await act(async () => container.querySelector('[aria-label="Concluir: Ler"]').click())
    assert.equal(container.querySelector(".line-through")?.textContent, "Ler")
    await act(async () => finish({ ok: false, status: 503, data: { message: "Falha" } }))
    assert.equal(container.querySelector(".line-through"), null)
    assert.equal(cache.getOverview(token).daily[0].status, "PENDENTE")
  } finally {
    api.listDailyTasks = original.listDailyTasks
    api.completeTask = original.completeTask
    await act(async () => root.unmount())
    container.remove()
    cache.clearOverview()
  }
})
