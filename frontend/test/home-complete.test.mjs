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
  IS_REACT_ACT_ENVIRONMENT: true,
})
const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [{ default: Home }, { api }, focus] = await Promise.all([
  vite.ssrLoadModule("/src/features/home/pages/HomePage.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
  vite.ssrLoadModule("/src/features/tasks/focusSession.ts"),
])
after(() => vite.close())
const user = {
  id: 71,
  enabled_modules: ["tasks", "objectives", "finances"],
  timezone: "America/Recife",
}
const task = { id: 1, titulo: "Ler", status: "PENDENTE", permissions: { can_complete: true } }
const snapshot = () => ({
  tarefas: [task],
  direcoes: [
    {
      id: 1,
      titulo: "Aprender",
      status: "ativo",
      descricao: "Não repetir na Home",
      trackers: [],
      tasks: [],
      reserves: [{ titulo: "Curso", valor_centavos: 420000, alvo_centavos: 1000000 }],
    },
  ],
  financeiro: null,
})
async function mount(props = {}) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const render = async (p) =>
    act(async () =>
      root.render(
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(Home, {
            token: "orientation-test",
            user,
            onUnauthorized: () => false,
            ...p,
          })
        )
      )
    )
  await render(props)
  return {
    container,
    render,
    async close() {
      await act(async () => root.unmount())
      container.remove()
      window.localStorage.clear()
    },
  }
}
test("Home não envia conclusão à API antes da gravação local", async () => {
  const original = { ...api }
  const calls = []
  api.materializeTaskRecurrences = async () => {
    calls.push("prepare")
    return { ok: true }
  }
  api.getOrientation = async () => {
    calls.push("read")
    return { ok: true, data: snapshot() }
  }
  api.completeTask = () => { throw Error("Conclusão deve usar a outbox") }
  const view = await mount()
  try {
    assert.deepEqual(calls, ["prepare", "read"])
    assert.doesNotMatch(view.container.textContent, /Não repetir na Home|Finanças/)
    await act(async () => view.container.querySelector('[aria-label="Concluir: Ler"]').click())
    assert.match(view.container.textContent, /Ler/)
    assert.equal(view.container.querySelector(".line-through"), null)
    assert.match(view.container.textContent, /Armazenamento local indisponível/)
    assert.deepEqual(calls, ["prepare", "read"])
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("falha de armazenamento local preserva snapshot sem falso 401", async () => {
  const original = { ...api }
  let unauthorized = 0
  api.materializeTaskRecurrences = async () => ({ ok: true })
  api.getOrientation = async () => ({ ok: true, data: snapshot() })
  api.completeTask = async () => { throw Error("Conclusão deve usar a outbox") }
  const view = await mount({
    onUnauthorized: (r) => {
      if (r.status === 401) unauthorized++
      return r.status === 401
    },
  })
  try {
    await act(async () => view.container.querySelector('[aria-label="Concluir: Ler"]').click())
    assert.match(view.container.textContent, /Ler|Armazenamento local indisponível/)
    assert.equal(unauthorized, 0)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("módulo financeiro desativado não expõe valores, inclusive em dados residuais", async () => {
  const original = { ...api }
  api.getOrientation = async () => ({
    ok: true,
    data: { ...snapshot(), financeiro: { livre_centavos: -10000 } },
  })
  api.materializeTaskRecurrences = async () => ({ ok: true })
  const view = await mount({ user: { ...user, enabled_modules: ["objectives"] } })
  try {
    assert.doesNotMatch(
      view.container.textContent,
      /4.200|10.000|100,00|Reservas sem cobertura|Concluir: Ler/
    )
    assert.match(view.container.textContent, /Aprender/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("foco temporário substitui lista de ações; carregar não vira copy de produto", async () => {
  const original = { ...api }
  let finish
  api.materializeTaskRecurrences = async () => ({ ok: true })
  api.getOrientation = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  window.localStorage.setItem(
    focus.focusStorageKey(user.id),
    JSON.stringify(focus.newFocusBlock({ activityText: "Escrever capítulo" }, 45))
  )
  const view = await mount()
  try {
    assert.ok(view.container.querySelector('[role=status][aria-label="Carregando seu Bunker"]'))
    assert.doesNotMatch(view.container.textContent, /Carregando|Atualizando|Dados anteriores/)
    await act(async () => finish({ ok: true, data: snapshot() }))
    assert.match(view.container.textContent, /Escrever capítulo/)
    assert.equal(view.container.querySelector('[aria-label="Concluir: Ler"]'), null)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

test("Home exclui consulta de tarefas se preparação falhar e mantém direções", async () => {
  const original = { ...api }
  const calls = []
  api.materializeTaskRecurrences = async () => {
    calls.push("prepare")
    return { ok: false, status: 503, data: { message: "Preparação indisponível" } }
  }
  api.getOrientation = async (_token, includeTasks) => {
    calls.push(includeTasks)
    return { ok: true, data: { ...snapshot(), tarefas: [] } }
  }
  const view = await mount({ user: { ...user, id: 72 } })
  try {
    assert.deepEqual(calls, ["prepare", false])
    assert.match(view.container.textContent, /Preparação indisponível|Aprender/)
    assert.equal(view.container.querySelector('[aria-label="Concluir: Ler"]'), null)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

test("401 na preparação bloqueia leitura; Objetivos sem Tarefas não prepara", async () => {
  const original = { ...api }
  let prepares = 0, reads = 0, unauthorized = 0
  api.materializeTaskRecurrences = async () => {
    prepares++
    return { ok: false, status: 401 }
  }
  api.getOrientation = async () => {
    reads++
    return { ok: true, data: { ...snapshot(), tarefas: [] } }
  }
  const view = await mount({ user: { ...user, id: 73 }, onUnauthorized: (result) => {
    if (result.status === 401) { unauthorized++; return true }
    return false
  } })
  try {
    assert.equal(unauthorized, 1)
    assert.equal(reads, 0)
    await view.render({ user: { ...user, id: 74, enabled_modules: ["objectives"] } })
    assert.equal(prepares, 1)
    assert.equal(reads, 1)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
