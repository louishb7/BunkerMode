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
    close: async () => {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const click = (button) => act(async () => button.click())
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
