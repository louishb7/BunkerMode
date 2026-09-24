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
const { default: TasksPage } = await vite.ssrLoadModule("/src/features/tasks/pages/TasksPage.tsx")
const { operationalDateFor, addDays } = await vite.ssrLoadModule(
  "/src/features/calendar/calendarUtils.ts"
)
const { formatDateForApi } = await vite.ssrLoadModule("/src/utils/date.ts")
after(() => vite.close())

test("ações no cabeçalho do dia abrem Foco e criação mantém hoje, outro dia e outra semana", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  let focus = 0
  const payloads = []
  const board = {
    dailyTasks: [],
    status: {},
    formStatus: {},
    setFormStatus() {},
    async createTask(payload) {
      payloads.push(payload)
      return { persisted: true }
    },
  }
  const timezone = "America/Recife"
  const today = operationalDateFor(timezone)
  const click = async (element) => {
    assert.ok(element)
    await act(async () => element.click())
  }
  const button = (text) =>
    [...document.querySelectorAll("button")].find((el) => el.textContent === text)
  try {
    await act(async () =>
      root.render(
        React.createElement(TasksPage, {
          board,
          user: { id: 1, timezone, enabled_modules: ["tasks"] },
          onStartFocus: () => focus++,
        })
      )
    )
    assert.equal(
      [...container.querySelectorAll("button")].filter((el) => el.textContent === "Nova tarefa")
        .length,
      1
    )
    assert.equal(container.querySelector("h1").closest("header").querySelectorAll("button").length, 0)
    const dayHeader = container.querySelector("h2").closest("header")
    assert.deepEqual(
      [...dayHeader.querySelectorAll("button")].map((el) => el.textContent.trim()),
      ["Foco", "Nova tarefa"]
    )
    await click(button("Foco"))
    assert.equal(focus, 1)
    async function createFor(date) {
      await click(button("Nova tarefa"))
      const dialog = document.querySelector('[role="dialog"]')
      assert.equal(
        dialog.querySelector('[name="prazo"]').value,
        formatDateForApi(date).split("-").reverse().join("-")
      )
      const input = dialog.querySelector('[name="titulo"]')
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(
          input,
          "Tarefa da data selecionada"
        )
        input.dispatchEvent(new window.Event("input", { bubbles: true }))
      })
      await click(button("Registrar tarefa"))
      assert.equal(payloads.at(-1).prazo, formatDateForApi(date))
      assert.equal(document.querySelector('[role="dialog"]'), null)
    }
    await createFor(today)
    const other = container.querySelector(
      '[aria-label="Dias da semana"] button:not([aria-current])'
    )
    const label = other.getAttribute("aria-label")
    await click(other)
    assert.equal(
      container.querySelector('[aria-current="date"]').getAttribute("aria-pressed"),
      "false"
    )
    const date = Array.from({ length: 13 }, (_, i) => addDays(today, i - 6)).find(
      (d) =>
        d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) === label
    )
    await createFor(date)
    await click(container.querySelector('[aria-label="Próxima semana"]'))
    assert.equal(container.querySelector('[aria-current="date"]'), null)
    await createFor(addDays(date, 7))
    await click(button("Hoje"))
    assert.equal(
      container.querySelector('[aria-current="date"]').getAttribute("aria-pressed"),
      "true"
    )
    await click(container.querySelector('[aria-label="Semana anterior"]'))
    assert.equal(container.querySelector('[aria-current="date"]'), null)
    await click(button("Hoje"))
    assert.equal(payloads.length, 3)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

test("rotas reais: entradas de Tarefas e Home abrem preparação; Home não repete usuário", async () => {
  const { MemoryRouter } = await import("react-router-dom")
  const { default: App } = await vite.ssrLoadModule("/src/app/App.tsx")
  const { AuthProvider } = await vite.ssrLoadModule("/src/context/AuthContext.tsx")
  const { api } = await vite.ssrLoadModule("/src/services/bunkermodeApi.ts")
  const original = { ...api }
  const user = {
    id: 1,
    usuario: "Usuário da sidebar",
    enabled_modules: ["tasks"],
    timezone: "America/Recife",
  }
  Object.assign(api, {
    getCurrentUser: async () => ({ ok: true, data: user }),
    materializeTaskRecurrences: async () => ({ ok: true }),
    listTasks: async () => ({ ok: true, data: [] }),
    listDailyTasks: async () => ({ ok: true, data: [] }),
    getFocusBoard: async () => ({ ok: true, data: { tasks: [], daily_tasks: [] } }),
  })
  try {
    for (const route of ["/tarefas", "/"]) {
      window.localStorage.clear()
      window.localStorage.setItem("bunkermode_token", "test")
      window.localStorage.setItem("bunkermode_usuario", JSON.stringify(user))
      const container = document.createElement("div")
      document.body.append(container)
      const root = createRoot(container)
      try {
        await act(async () =>
          root.render(
            React.createElement(
              MemoryRouter,
              { initialEntries: [route] },
              React.createElement(AuthProvider, null, React.createElement(App))
            )
          )
        )
        if (route === "/") {
          assert.doesNotMatch(container.querySelector("main").textContent, /Usuário da sidebar/)
          assert.match(container.querySelector("aside").textContent, /Usuário da sidebar/)
          const card = container.querySelector('[aria-labelledby="home-tasks-title"]')
          assert.equal(card.querySelectorAll('a[href="/tarefas/foco"]').length, 1)
          assert.equal(card.querySelector('header a[href="/tarefas/foco"]').getAttribute("aria-label"), "Abrir modo foco")
          assert.doesNotMatch(card.textContent, /Abrir modo foco/)
        }
        const trigger =
          route === "/"
            ? container.querySelector('main a[href="/tarefas/foco"]')
            : [...container.querySelectorAll("button")].find((el) => el.textContent === "Foco")
        assert.ok(trigger)
        await act(async () =>
          trigger.dispatchEvent(
            new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
          )
        )
        assert.match(container.textContent, /No que você vai focar agora/)
        assert.equal(window.localStorage.getItem("bunkermode_focus:1"), null)
      } finally {
        await act(async () => root.unmount())
        container.remove()
      }
    }
  } finally {
    Object.assign(api, original)
  }
})
