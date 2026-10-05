import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router-dom"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [{ default: Map }, { default: Conquer }, { default: Memory }, model] = await Promise.all([
  vite.ssrLoadModule("/src/features/objectives/components/ObjectiveMap.tsx"),
  vite.ssrLoadModule("/src/features/objectives/components/ConquerObjectiveDialog.tsx"),
  vite.ssrLoadModule("/src/features/objectives/components/AchievementDetails.tsx"),
  vite.ssrLoadModule("/src/features/objectives/objectiveMapModel.ts"),
])
const { default: Details } = await vite.ssrLoadModule("/src/features/objectives/components/ObjectiveNodeDetails.tsx")
after(() => vite.close())
async function mount(Component, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(React.createElement(MemoryRouter, null, React.createElement(Component, props)))
  )
  return {
    container,
    render: async (nextProps) => act(async () =>
      root.render(React.createElement(MemoryRouter, null, React.createElement(Component, nextProps)))
    ),
    close: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const click = (button) => act(async () => button.click())
test("inspector aceita ocorrências e conclusões dependentes de criações locais ainda pendentes", async () => {
  let records = 0, completions = 0
  const tracker = { id: "local:tracker", titulo: "Registro livre", syncStatus: "pending", ocorrencias: [] }
  const view = await mount(Details, { node: { id: "tracker-local", tipo: "acompanhamento", titulo: tracker.titulo }, tracker,
    onClose() {}, onRecordOccurrence: () => { records++ } })
  try {
    const record = [...document.querySelectorAll("button")].find(item => item.textContent === "Registrar ocorrência")
    assert.equal(record.disabled, false)
    await click(record)
    assert.equal(records, 1)
    const task = { id: "local:task", titulo: "Ler", syncStatus: "pending", permissions: { can_complete: true } }
    await view.render({ node: { id: "task-local", tipo: "tarefa", titulo: task.titulo }, task, onClose() {}, onCompleteTask: () => { completions++ } })
    const complete = [...document.querySelectorAll("button")].find(item => item.textContent === "Concluir tarefa")
    assert.equal(complete.disabled, false)
    await click(complete)
    assert.equal(completions, 1)
  } finally { await view.close() }
})
const snapshot = {
  version: 1,
  titulo: "Primeira vaga",
  proposito: "Meu propósito",
  criado_em: "2026-05-03T12:00:00Z",
  fuso_horario: "America/Recife",
  nos: [
    {
      id: "tracker-1",
      tipo: "acompanhamento",
      titulo: "Distrações",
      ultima_ocorrencia: "2026-09-21T12:00:00Z",
      ocorrencias_total: 2,
    },
  ],
}
const achievement = {
  id: 1,
  objetivo_id: 7,
  conquistado_em: "2026-10-03T12:00:00Z",
  nota: "Eu consegui.",
  snapshot,
}

test("conexões existem na montagem e acompanham objetivo, expansão, conteúdo, breakpoint e visibilidade", async () => {
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect
  const originalObserver = globalThis.ResizeObserver
  let width = 900, rootY = 180
  const observers = []
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.elements = new Set(); observers.push(this) }
    observe(element) { this.elements.add(element) }
    disconnect() { this.disconnected = true; this.elements.clear() }
  }
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const canvas = this.classList.contains("objective-canvas")
    const root = this.hasAttribute("data-map-root")
    const top = canvas ? 0 : root ? rootY : this.hasAttribute("data-map-group-anchor") ? 300 : 360
    const left = canvas ? 0 : root ? width / 2 : 70
    return { left, top, width: canvas ? width : 20, height: 20, right: left + width, bottom: top + 20 }
  }
  const nodes = Array.from({ length: 6 }, (_, index) => ({ id: `task-${index}`, tipo: "tarefa", titulo: `Tarefa ${index}`, estado: "PENDENTE" }))
  const props = { title: "Primeiro objetivo", nodes, now: new Date("2026-10-05T12:00:00Z") }
  const view = await mount(Map, props)
  const paths = () => [...view.container.querySelectorAll(".map-line")]
  const notify = () => act(async () => observers.at(-1).callback())
  try {
    assert.equal(paths().length, 5, "montagem com dados deve medir sem alteração posterior")
    assert.ok(observers.at(-1).elements.has(view.container.querySelector(".objective-canvas")))
    assert.match(paths()[0].getAttribute("d"), / C /)
    await click(view.container.querySelector(".map-expand"))
    assert.equal(paths().length, 7)
    assert.equal(observers[0].disconnected, true, "observer anterior deve ser limpo após mudança de nós")
    await click(view.container.querySelector(".map-expand"))
    assert.equal(paths().length, 5)
    width = 500
    await act(async () => window.dispatchEvent(new window.Event("resize")))
    assert.doesNotMatch(paths()[0].getAttribute("d"), / C /)
    const beforeContent = paths()[0].getAttribute("d")
    rootY = 220
    await notify()
    assert.notEqual(paths()[0].getAttribute("d"), beforeContent)
    width = 0
    await notify()
    assert.equal(paths().length, 0, "canvas oculto não mantém geometria antiga")
    width = 900
    await notify()
    assert.equal(paths().length, 5, "observer recupera conexões ao reexibir")
    await view.render({ ...props, title: "Segundo objetivo", purpose: "Propósito novo", nodes: [nodes[1]] })
    assert.equal(paths().length, 2)
    assert.equal(view.container.querySelector("h2").textContent, "Segundo objetivo")
  } finally {
    await view.close()
    assert.equal(observers.every((observer) => observer.disconnected), true)
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect
    globalThis.ResizeObserver = originalObserver
  }
})

test("30 nós continuam limitados por grupo, com expansão acessível e nomes completos", async () => {
  let selected
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: `task-${i}`,
    tipo: "tarefa",
    titulo: `Tarefa ${i} com nome bastante longo`,
    estado: i === 0 ? "CONCLUIDA" : "PENDENTE",
  }))
  const view = await mount(Map, {
    title: "Uma direção importante",
    nodes,
    onSelect: (node) => {
      selected = node
    },
    timezone: "America/Recife",
  })
  try {
    assert.equal(view.container.querySelectorAll(".map-node").length, 4)
    assert.ok(view.container.querySelector("button[aria-label*='Concluída']"))
    assert.ok(view.container.querySelector(".map-task-mark.is-complete svg"))
    await click(view.container.querySelector(".map-node"))
    assert.equal(selected.id, "task-0")
    const expand = view.container.querySelector(".map-expand")
    assert.match(expand.textContent, /\+26/)
    await click(expand)
    assert.equal(expand.getAttribute("aria-expanded"), "true")
    assert.equal(view.container.querySelectorAll(".map-node").length, 30)
    await click(expand)
    assert.equal(view.container.querySelectorAll(".map-node").length, 4)
  } finally {
    await view.close()
  }
})

test("cancelar não conquista; confirmar sem nota aceita uma memória e apresenta coroa preenchida", async () => {
  let cancelled = 0,
    saves = 0,
    note
  const view = await mount(Conquer, {
    objetivo: { id: 7, titulo: snapshot.titulo, created_at: snapshot.criado_em },
    timezone: snapshot.fuso_horario,
    onClose: () => {
      cancelled++
    },
    onConquer: async (value) => {
      saves++
      note = value
      return achievement
    },
    onOpenMemory() {},
    saving: false,
    error: "",
  })
  try {
    assert.equal(document.querySelector(".is-achieved"), null)
    await click(
      [...document.querySelectorAll("button")].find((button) => button.textContent === "Ainda não")
    )
    assert.equal(cancelled, 1)
    assert.equal(saves, 0)
    await act(async () =>
      document
        .querySelector("form")
        .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
    )
    assert.equal(saves, 1)
    assert.equal(note, "")
    assert.match(document.querySelector("[role=dialog]").textContent, /Coroa conquistada/)
    assert.ok(document.querySelector(".is-achieved"))
  } finally {
    await view.close()
  }
})

test("mapa final congela o calendário da conquista e detalhes não oferecem mutações", async () => {
  const view = await mount(Memory, { achievement, onBack() {} })
  try {
    assert.match(view.container.textContent, /12 dias desde a ocorrência/)
    assert.match(view.container.textContent, /Eu consegui/)
    await click(view.container.querySelector("button[aria-controls=achievement-final-map]"))
    await click(view.container.querySelector(".map-node"))
    const detail = document.querySelector(".objective-node-details")
    assert.match(detail.textContent, /12 dias desde a ocorrência/)
    assert.match(detail.textContent, /2 ocorrências registradas/)
    assert.doesNotMatch(detail.textContent, /Registrar ocorrência|Desvincular|Excluir|Editar/)
    assert.equal(detail.querySelectorAll("button").length, 1)
    assert.equal(detail.getAttribute("aria-modal"), "true")
    await act(async () =>
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      )
    )
    assert.equal(document.querySelector("[role=dialog]"), null)
  } finally {
    await view.close()
  }
})

test("os fatos distinguem ausência de registro de tempo decorrido e não criam percentuais", () => {
  assert.equal(
    model.nodeFact({ tipo: "acompanhamento", ultima_ocorrencia: null }),
    "Nenhuma ocorrência registrada"
  )
  const now = new Date("2026-10-03T12:00:00Z")
  assert.equal(
    model.nodeFact(snapshot.nos[0], snapshot.fuso_horario, now),
    "12 dias desde a ocorrência"
  )
  const tasks = [1, 2].map((id) => ({
    id,
    titulo: "Ler",
    status: id === 1 ? "CONCLUIDA" : "PENDENTE",
    recurrence: { series_id: 9, weekdays: [0, 2, 4] },
    completed_at: id === 1 ? now.toISOString() : null,
  }))
  const [routine] = model.liveMapNodes(tasks, [], snapshot.fuso_horario)
  assert.equal(routine.realizadas, 1)
  assert.equal(model.nodeFact(routine), "3 dias por semana")
  assert.doesNotMatch(JSON.stringify(routine), /percent|score|streak|xp/i)
})
