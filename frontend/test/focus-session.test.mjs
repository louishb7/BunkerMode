import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const { default: React, act } = await import("react")
const { createRoot } = await import("react-dom/client")
const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const { default: FocusPage } = await vite.ssrLoadModule("/src/features/tasks/pages/FocusPage.tsx")
const model = await vite.ssrLoadModule("/src/features/tasks/focusSession.ts")
const { useTaskBoard } = await vite.ssrLoadModule("/src/features/tasks/hooks/useTaskBoard.ts")
const { api } = await vite.ssrLoadModule("/src/services/bunkermodeApi.ts")
const { getOverview, clearOverview } = await vite.ssrLoadModule("/src/state/overviewCache.ts")
after(() => vite.close())
const storage = window.localStorage
const task = {
  id: 7,
  titulo: "Implementar System Map",
  status_code: "PENDENTE",
  permissions: { can_complete: true },
}
async function mount(options = {}) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let completed = 0
  const props = {
    userId: 1,
    timezone: "America/Recife",
    onExit() {},
    dailyTasks: [task],
    board: {
      status: {},
      taskLoading: false,
      completeTask() {
        completed++
      },
      refreshFocusBoard: async () => true,
    },
    ...options,
  }
  await act(async () => root.render(React.createElement(FocusPage, props)))
  return {
    container,
    props,
    get completed() {
      return completed
    },
    button(text) {
      return [...container.querySelectorAll("button")].find((el) => el.textContent === text)
    },
    async click(text) {
      const button = this.button(text)
      assert.ok(button, text)
      await act(async () => button.click())
    },
    async input(text) {
      const input = container.querySelector("textarea")
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(
          input,
          text
        )
        input.dispatchEvent(new window.Event("input", { bubbles: true }))
      })
    },
    async render(patch) {
      Object.assign(props, patch)
      await act(async () => root.render(React.createElement(FocusPage, props)))
    },
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const current = (id = 1) => JSON.parse(storage.getItem(model.focusStorageKey(id)))
const seed = (session, id = 1) =>
  storage.setItem(model.focusStorageKey(id), JSON.stringify(session))

test("intenção livre, presets, padrão 45 e ausência de lista durante bloco", async () => {
  storage.clear()
  const view = await mount()
  assert.deepEqual(
    [...view.container.querySelectorAll("input[type=radio]")].map((el) => Number(el.value)),
    [25, 45, 60, 90]
  )
  assert.equal(view.container.querySelector("input:checked").value, "45")
  assert.equal(view.button("Iniciar bloco").disabled, true)
  await view.input("Estudar TypeScript")
  await view.click("Iniciar bloco")
  assert.equal(current().activityText, "Estudar TypeScript")
  assert.equal(current().taskId, undefined)
  assert.equal(current().endsAt - current().startedAt, 45 * 60000)
  assert.doesNotMatch(view.container.textContent, /Tarefas de hoje|Implementar System Map/)
  assert.equal(view.container.querySelector("[role=timer]").getAttribute("aria-live"), "off")
  assert.equal(view.completed, 0)
  await view.close()
})

test("atalho mantém taskId ao editar contexto; remover vínculo preserva texto", async () => {
  storage.clear()
  const view = await mount()
  await view.click(task.titulo)
  await view.input("BunkerCode — System Map")
  await view.click("Iniciar bloco")
  assert.equal(current().taskId, task.id)
  assert.equal(current().activityText, "BunkerCode — System Map")
  await view.click("Encerrar bloco")
  assert.match(view.container.textContent, /Bloco encerrado/)
  assert.doesNotMatch(view.container.textContent, /falha|fracasso|abandonad/i)
  assert.equal(document.activeElement.textContent, "Bloco encerrado.")
  assert.equal(view.completed, 0)
  await view.click("Concluir tarefa")
  assert.equal(view.completed, 1)
  await view.click("Escolher outra atividade")
  assert.equal(current(), null)
  await view.click(task.titulo)
  await view.click("Remover vínculo")
  assert.equal(view.container.querySelector("textarea").value, task.titulo)
  await view.click("Iniciar bloco")
  assert.equal(current().taskId, undefined)
  await view.close()
})

test("última duração persiste separadamente por usuário", async () => {
  storage.clear()
  let view = await mount()
  await act(async () => view.container.querySelector('input[value="90"]').click())
  await view.close()
  view = await mount()
  assert.equal(view.container.querySelector("input:checked").value, "90")
  await view.close()
  view = await mount({ userId: 2 })
  assert.equal(view.container.querySelector("input:checked").value, "45")
  await view.close()
})

test("reload recupera timestamps e vínculo, outra conta não vê o bloco", async () => {
  storage.clear()
  const session = model.newFocusBlock({ activityText: "Contexto privado", taskId: task.id }, 60)
  seed(session)
  let view = await mount()
  assert.match(view.container.textContent, /Contexto privado|60 min restantes/)
  assert.equal(view.container.querySelector("textarea"), null)
  assert.equal(current().endsAt, session.endsAt)
  await view.close()
  view = await mount({ userId: 2 })
  assert.doesNotMatch(view.container.textContent, /Contexto privado/)
  assert.ok(view.container.querySelector("textarea"))
  await view.close()
})

test("storage inválido é descartado com segurança", () => {
  const valid = model.newFocusBlock({ activityText: "Contexto" }, 25)
  for (const value of [
    "{",
    "null",
    "[]",
    JSON.stringify({ ...valid, phase: "unknown" }),
    JSON.stringify({ ...valid, endsAt: 0 }),
    JSON.stringify({ ...valid, activityText: " " }),
    JSON.stringify({ ...valid, taskId: -1 }),
    JSON.stringify({ ...valid, durationMinutes: 20 }),
  ]) {
    storage.setItem(model.focusStorageKey(1), value)
    assert.equal(model.readFocusSession(storage, 1), null)
    assert.equal(current(), null)
  }
})

test("tempo deriva de endsAt; expiração ausente não reinicia e continuar é explícito", async () => {
  storage.clear()
  const session = model.newFocusBlock(
    { activityText: "Contexto", taskId: 7 },
    25,
    Date.now() - 30 * 60000
  )
  assert.equal(model.remainingMinutes(session, session.endsAt - 38000), 1)
  assert.equal(model.remainingMinutes(session, session.endsAt + 1), 0)
  seed(session)
  const view = await mount()
  assert.match(view.container.textContent, /O tempo deste bloco terminou/)
  assert.equal(view.completed, 0)
  await view.click("Continuar · 25 min")
  assert.equal(current().activityText, session.activityText)
  assert.equal(current().taskId, 7)
  assert.ok(current().startedAt > session.endsAt)
  assert.equal(current().endsAt - current().startedAt, 25 * 60000)
  await view.close()
})

test("voltar de suspensão atualiza pelo horário real sem milhares de ticks", async () => {
  storage.clear()
  const session = model.newFocusBlock({ activityText: "Contexto" }, 45)
  seed(session)
  const view = await mount()
  const original = Date.now
  try {
    Date.now = () => session.endsAt + 1
    await act(async () => window.dispatchEvent(new window.Event("focus")))
    assert.match(view.container.textContent, /O tempo deste bloco terminou/)
    assert.equal(view.completed, 0)
  } finally {
    Date.now = original
    await view.close()
  }
})

test("pausa de 5 minutos sobrevive reload e expiração não inicia foco", async () => {
  storage.clear()
  seed({
    ...model.newFocusBlock({ activityText: "Contexto" }, 45),
    phase: "ended",
    endedManually: true,
  })
  let view = await mount()
  await view.click("Pausa de 5 min")
  const pause = current()
  assert.equal(pause.endsAt - pause.startedAt, 5 * 60000)
  await view.close()
  view = await mount()
  assert.match(view.container.textContent, /Você não precisa começar outra coisa agora/)
  assert.equal(current().endsAt, pause.endsAt)
  await view.close()
  seed({ ...pause, startedAt: Date.now() - 6 * 60000, endsAt: Date.now() - 60000 })
  view = await mount()
  assert.match(view.container.textContent, /A pausa terminou/)
  assert.ok(view.button("Continuar · 45 min"))
  assert.equal(view.container.querySelector("[role=timer]"), null)
  assert.equal(view.button("Pausa de 5 min"), undefined)
  await view.click("Encerrar foco e voltar às tarefas")
  assert.equal(current(), null)
  await view.close()
})

test("encerrar pausa manualmente apenas abre decisão", async () => {
  storage.clear()
  seed(model.newFocusBreak(model.newFocusBlock({ activityText: "Contexto" }, 45)))
  const view = await mount()
  await view.click("Encerrar pausa")
  assert.equal(current().phase, "break-ended")
  assert.equal(view.container.querySelector("[role=timer]"), null)
  await view.close()
})

test("tarefa removida, concluída ou sem permissão mantém atividade e omite conclusão", async () => {
  storage.clear()
  seed({
    ...model.newFocusBlock({ activityText: "Contexto próprio", taskId: 7 }, 45),
    phase: "ended",
  })
  for (const dailyTasks of [
    [],
    [{ ...task, status_code: "CONCLUIDA" }],
    [{ ...task, permissions: { can_complete: false } }],
  ]) {
    const view = await mount({ dailyTasks })
    assert.match(view.container.textContent, /Contexto próprio/)
    assert.equal(view.button("Concluir tarefa"), undefined)
    assert.equal(current().activityText, "Contexto próprio")
    await view.close()
  }
})

test("conclusão explícita integra API, cache e releitura; 401 chega ao handler global", async () => {
  const original = { ...api }
  const container = document.createElement("div")
  document.body.append(container)
  let root
  try {
    for (const status of [200, 401]) {
      storage.clear()
      clearOverview()
      seed({ ...model.newFocusBlock({ activityText: "Contexto", taskId: 7 }, 45), phase: "ended" })
      const calls = []
      let completed = false
      let unauthorized = 0
      const onUnauthorized = (result) => {
        if (result.status === 401) {
          unauthorized++
          return true
        }
        return false
      }
      api.materializeTaskRecurrences = async () => {
        calls.push("materialize")
        return { ok: true }
      }
      api.getFocusBoard = async () => {
        calls.push("read")
        return {
          ok: true,
          data: { daily_tasks: [{ ...task, status_code: completed ? "CONCLUIDA" : "PENDENTE" }] },
        }
      }
      api.completeTask = async (token, id) => {
        calls.push(`complete:${token}:${id}`)
        completed = status === 200
        return { ok: completed, status, data: { ...task, status_code: "CONCLUIDA" } }
      }
      function Harness() {
        const board = useTaskBoard({
          authenticated: true,
          boardMode: "focus",
          token: "focus-test",
          onUnauthorized,
        })
        return React.createElement(FocusPage, { userId: 1, board, dailyTasks: board.dailyTasks })
      }
      root = createRoot(container)
      await act(async () => root.render(React.createElement(Harness)))
      assert.equal(
        calls.some((call) => call.startsWith("complete")),
        false
      )
      calls.length = 0
      await act(async () =>
        [...container.querySelectorAll("button")]
          .find((el) => el.textContent === "Concluir tarefa")
          .click()
      )
      assert.equal(unauthorized, status === 401 ? 1 : 0)
      assert.deepEqual(
        calls,
        status === 200
          ? ["complete:focus-test:7", "materialize", "read"]
          : ["complete:focus-test:7"]
      )
      if (status === 200) assert.equal(getOverview("focus-test").daily[0].status_code, "CONCLUIDA")
      assert.match(container.textContent, /Contexto/)
      await act(async () => root.unmount())
      root = null
    }
  } finally {
    if (root) await act(async () => root.unmount())
    container.remove()
    Object.assign(api, original)
  }
})

test("tarefa removida durante bloco não destrói contexto; encerrar apaga apenas sessão atual", async () => {
  storage.clear()
  const view = await mount()
  await view.click(task.titulo)
  await view.click("Iniciar bloco")
  await view.render({ dailyTasks: [] })
  assert.equal(current().phase, "active")
  assert.match(view.container.textContent, /Implementar System Map/)
  await view.click("Encerrar bloco")
  assert.equal(view.button("Concluir tarefa"), undefined)
  await view.click("Encerrar foco e voltar às tarefas")
  assert.deepEqual(Object.keys(storage), [model.durationStorageKey(1)])
  await view.close()
})

test("storage bloqueado mantém bloco em memória e informa limite de recuperação", async () => {
  storage.clear()
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage")
  Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new Error("Blocked") } })
  let view
  try {
    view = await mount()
    await view.input("Estudar")
    await view.click("Iniciar bloco")
    assert.match(view.container.textContent, /Estudar/)
    assert.match(view.container.textContent, /não conseguiu guardar o bloco/)
  } finally {
    if (view) await view.close()
    Object.defineProperty(window, "localStorage", descriptor)
  }
})
