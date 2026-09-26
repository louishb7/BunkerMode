import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
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
const load = (path) => vite.ssrLoadModule(`/src/${path}`)
const [
  { default: ActionsMenu },
  { default: DaySelector },
  { default: TaskCard },
  { default: TasksPanel },
  { default: ObjetivoCard },
  { validateAuth },
  preference,
] = await Promise.all([
  load("components/ui/ActionsMenu.tsx"),
  load("features/calendar/components/DaySelector.tsx"),
  load("features/tasks/components/TaskCard.tsx"),
  load("features/tasks/components/TasksPanel.tsx"),
  load("features/objectives/components/ObjetivoCard.tsx"),
  load("features/auth/authValidation.ts"),
  load("theme/preference.ts"),
])
after(() => vite.close())
async function mount(Component, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(Component, props)))
  return {
    container,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const click = async (element) => act(async () => element.click())
const key = async (element, key) =>
  act(async () =>
    element.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key, bubbles: true }))
  )

test("menu: teclado, seleção, Escape e retorno de foco", async () => {
  let selected = ""
  const view = await mount(ActionsMenu, {
    label: "Ações",
    items: [
      { label: "Editar", onSelect: () => (selected = "edit") },
      { label: "Remover", onSelect: () => (selected = "delete"), danger: true },
    ],
  })
  const trigger = view.container.querySelector("button")
  trigger.focus()
  await key(trigger, "ArrowDown")
  assert.equal(trigger.getAttribute("aria-expanded"), "true")
  assert.equal(document.activeElement.textContent, "Editar")
  await key(document.activeElement, "ArrowDown")
  assert.equal(document.activeElement.textContent, "Remover")
  await key(document.activeElement, "Escape")
  assert.equal(document.querySelector("[role=menu]"), null)
  assert.equal(document.activeElement, trigger)
  await click(trigger)
  await click(document.querySelector("[role=menuitem]"))
  assert.equal(selected, "edit")
  assert.equal(document.activeElement, trigger)
  await view.close()
})

test("calendário diferencia hoje do contexto selecionado e emite a data escolhida", async () => {
  const today = new Date(2026, 8, 9),
    selected = new Date(2026, 8, 8)
  const days = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 7 + i))
  let chosen
  const view = await mount(DaySelector, {
    todayDate: today,
    selectedDate: selected,
    weekDays: days,
    onSelectDate: (date) => (chosen = date),
  })
  const current = view.container.querySelector("[aria-current=date]"),
    pressed = view.container.querySelector("[aria-pressed=true]")
  assert.notEqual(current, pressed)
  assert.equal(current.getAttribute("aria-pressed"), "false")
  await click(current)
  assert.equal(chosen.getTime(), today.getTime())
  await view.close()
})

test("tarefas preservam conclusão e administração sem ação manual de falha", async () => {
  let complete = 0,
    edit = 0
  const task = {
    id: 1,
    titulo: "Revisar",
    status_code: "NAO_REALIZADA",
    permissions: { can_complete: true, can_edit: true, can_delete: false, can_pin: false },
  }
  const view = await mount(TaskCard, { task, onComplete: () => complete++, onEdit: () => edit++ })
  assert.match(view.container.textContent, /Não realizada/)
  assert.doesNotMatch(view.container.textContent, /falha/i)
  await click(view.container.querySelector('[aria-label="Concluir: Revisar"]'))
  assert.equal(complete, 1)
  await click(view.container.querySelector("[aria-haspopup=menu]"))
  await click(document.querySelector("[role=menuitem]"))
  assert.equal(edit, 1)
  await view.close()
  const focus = await mount(TaskCard, {
    task: { ...task, status_code: "PENDENTE" },
    variant: "focus",
    onComplete: () => complete++,
  })
  assert.equal(focus.container.querySelector("[aria-haspopup=menu]"), null)
  assert.equal(focus.container.querySelector("button").textContent, "Concluir")
  await focus.close()
})

test("detalhes longos expandem localmente; conclusão, menu e recorrência ficam acessíveis recolhidos", async () => {
  let complete = 0,
    edit = 0
  const task = {
    id: 9,
    titulo: "Ler livro",
    instrucao:
      "Ler um capítulo, anotar os conceitos centrais e revisar as notas antes de seguir para o capítulo seguinte.",
    recurrence: { series_id: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] },
    status_code: "PENDENTE",
    permissions: { can_complete: true, can_edit: true },
  }
  const view = await mount(TaskCard, { task, onComplete: () => complete++, onEdit: () => edit++ })
  const description = view.container.querySelector("p")
  Object.defineProperties(description, {
    scrollHeight: { configurable: true, value: 60 },
    clientHeight: { configurable: true, value: 40 },
  })
  await act(async () => window.dispatchEvent(new window.Event("resize")))
  const details = [...view.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Mostrar detalhes"
  )
  assert.ok(details)
  assert.equal(details.getAttribute("aria-expanded"), "false")
  assert.match(view.container.textContent, /Tarefa recorrente: Todos os dias/)
  assert.equal(details.getAttribute("aria-controls"), description.id)
  await click(view.container.querySelector('[aria-label="Concluir: Ler livro"]'))
  assert.equal(complete, 1)
  await click(view.container.querySelector("[aria-haspopup=menu]"))
  await click(document.querySelector("[role=menuitem]"))
  assert.equal(edit, 1)
  await click(details)
  assert.equal(details.textContent, "Ocultar detalhes")
  assert.equal(details.getAttribute("aria-expanded"), "true")
  await click(details)
  assert.equal(details.textContent, "Mostrar detalhes")
  assert.equal(details.getAttribute("aria-expanded"), "false")
  await view.close()
  const short = await mount(TaskCard, {
    task: { ...task, id: 10, instrucao: "Nota breve.", recurrence: null },
    onComplete: () => {},
  })
  assert.equal(
    [...short.container.querySelectorAll("button")].some((button) =>
      button.textContent.includes("detalhes")
    ),
    false
  )
  await short.close()
})

test("concluídas ficam abaixo das abertas e preservam Reabrir sem ações proibidas", async () => {
  let reopened = 0
  const pending = {
    id: 1,
    titulo: "Aberta",
    status: "PENDENTE",
    status_code: "PENDENTE",
    permissions: { can_complete: true, can_edit: true },
  }
  const completed = {
    id: 2,
    titulo: "Concluída",
    instrucao: "Instrução longa que fica fora do resumo compacto",
    status: "CONCLUIDA",
    status_code: "CONCLUIDA",
    permissions: { can_complete: false, can_reopen: true, can_edit: false },
  }
  const view = await mount(TasksPanel, {
    selectedDate: new Date(2026, 8, 23),
    selectedTasks: [completed, pending],
    loading: false,
    onCompleteTask: () => {},
    onCreateTask: () => {},
    onDeleteTask: () => {},
    onEditTask: () => {},
    onReopenTask: () => reopened++,
    onTogglePin: () => {},
  })
  const cards = [...view.container.querySelectorAll("article")]
  assert.deepEqual(
    cards.map((card) => card.querySelector("h3").textContent),
    ["Aberta", "Concluída"]
  )
  assert.equal(cards[1].querySelector("p"), null)
  assert.match(cards[1].textContent, /Instrução longa/)
  await click(
    [...cards[1].querySelectorAll("button")].find((button) =>
      button.textContent.includes("Reabrir")
    )
  )
  assert.equal(reopened, 1)
  assert.equal(cards[1].querySelector("[aria-haspopup=menu]"), null)
  await view.close()
})

test("objetivo permite pausar no menu e concluir pela ação principal", async () => {
  let status = "",
    created = 0
  const props = {
    objetivo: { id: 1, titulo: "Direção", status: "ativo" },
    tasks: [],
    tasksEnabled: true,
    loading: false,
    tasksLoading: false,
    tasksError: "",
    onCreateTask: () => created++,
    onUpdateStatus: (value) => (status = value),
    onEdit: () => {},
    onDelete: () => {},
  }
  const view = await mount(ObjetivoCard, props)
  assert.equal(view.container.querySelector("select"), null)
  assert.match(view.container.textContent, /Ativo/)
  assert.doesNotMatch(view.container.textContent, /Nenhuma tarefa vinculada/)
  await click(
    [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Adicionar ao objetivo")
    )
  )
  assert.equal(created, 1)
  await click(view.container.querySelector("[aria-haspopup=menu]"))
  assert.match(document.querySelector("[role=menu]").textContent, /Pausar objetivo/)
  assert.doesNotMatch(document.querySelector("[role=menu]").textContent, /Abandonado|Concluído/)
  await click(
    [...document.querySelectorAll("[role=menuitem]")].find(
      (b) => b.textContent === "Pausar objetivo"
    )
  )
  assert.equal(status, "pausado")
  await click(
    [...view.container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Concluir objetivo")
    )
  )
  assert.equal(status, "concluido")
  await view.close()
  const paused = await mount(ObjetivoCard, {
    ...props,
    objetivo: { ...props.objetivo, status: "pausado" },
  })
  await click(paused.container.querySelector("[aria-haspopup=menu]"))
  assert.match(document.querySelector("[role=menu]").textContent, /Retomar objetivo/)
  await click(
    [...document.querySelectorAll("[role=menuitem]")].find(
      (b) => b.textContent === "Retomar objetivo"
    )
  )
  assert.equal(status, "ativo")
  await paused.close()
  const standalone = await mount(ObjetivoCard, { ...props, tasksEnabled: false })
  assert.doesNotMatch(standalone.container.textContent, /Adicionar tarefa|Carregando tarefas/)
  await standalone.close()
})

test("tarefa concluída no objetivo oferece desvincular sem exclusão", async () => {
  let unlinked = null
  const task = {
    id: 8,
    titulo: "Faxina no lugar de trabalho!",
    status: "CONCLUIDA",
    status_code: "CONCLUIDA",
    objetivo_id: 1,
    recurrence: null,
  }
  const view = await mount(ObjetivoCard, {
    objetivo: { id: 1, titulo: "Organizar trabalho", status: "ativo" },
    tasks: [task],
    tasksEnabled: true,
    loading: false,
    tasksLoading: false,
    tasksError: "",
    trackers: [],
    trackersLoading: false,
    onCreateTask: () => {},
    onCreateTracker: () => {},
    onUpdateStatus: () => {},
    onUnlinkTask: (value) => (unlinked = value),
    onDelete: () => {},
    onEdit: () => {},
  })
  await click(
    view.container.querySelector('[aria-label="Ações da tarefa: Faxina no lugar de trabalho!"]')
  )
  assert.match(document.querySelector("[role=menu]").textContent, /Desvincular do objetivo/)
  assert.doesNotMatch(document.querySelector("[role=menu]").textContent, /Excluir tarefa/)
  await click(
    [...document.querySelectorAll("[role=menuitem]")].find(
      (b) => b.textContent === "Desvincular do objetivo"
    )
  )
  assert.equal(unlinked, task)
  await view.close()
})

test("política de cadastro e login possui limites distintos e não normaliza senha", () => {
  const good = { usuario: " pessoa ", email: " Pessoa@example.com ", senha: "abcde1" }
  assert.equal(validateAuth(good, true), "")
  for (const patch of [
    { usuario: "ab" },
    { usuario: "a".repeat(33) },
    { email: "x@" },
    { email: "a".repeat(255) },
    { senha: "ab123" },
    { senha: "abcd!1" },
    { senha: "123456" },
    { senha: "abcdef" },
  ])
    assert.notEqual(validateAuth({ ...good, ...patch }, true), "")
  assert.equal(validateAuth({ ...good, senha: " ééééé１２ " }, true), "")
  assert.equal(validateAuth({ email: "pessoa", senha: "a" }, false), "")
  assert.equal(validateAuth({ email: "pessoa", senha: "a".repeat(129) }, false), "")
})

test("tema local aplica light/dark e devolve controle ao sistema", () => {
  for (const value of ["light", "dark"]) {
    preference.setThemePreference(value)
    assert.equal(document.documentElement.dataset.theme, value)
    assert.equal(preference.getThemePreference(), value)
  }
  preference.setThemePreference("system")
  assert.equal(document.documentElement.hasAttribute("data-theme"), false)
  assert.equal(preference.getThemePreference(), "system")
})

test("recorrência semanal permanece legível e expandir uma tarefa não abre as demais", async () => {
  const task = {
    id: 21,
    titulo: "Revisar notas",
    instrucao: "Descrição com detalhes para consultar.",
    status_code: "PENDENTE",
    recurrence: { series_id: 2, weekdays: [0, 2, 4] },
    permissions: { can_complete: true },
  }
  const first = await mount(TaskCard, { task, onComplete: () => {} })
  const second = await mount(TaskCard, { task: { ...task, id: 22 }, onComplete: () => {} })
  try {
    for (const view of [first, second]) {
      const description = view.container.querySelector("p")
      Object.defineProperties(description, {
        scrollHeight: { configurable: true, value: 80 },
        clientHeight: { configurable: true, value: 20 },
      })
    }
    await act(async () => window.dispatchEvent(new window.Event("resize")))
    assert.match(first.container.textContent, /Tarefa recorrente: Seg, Qua, Sex/)
    const toggle = (view) => view.container.querySelector("[aria-controls]")
    await click(toggle(first))
    assert.equal(toggle(first).getAttribute("aria-expanded"), "true")
    assert.equal(toggle(second).getAttribute("aria-expanded"), "false")
    assert.notEqual(
      toggle(first).getAttribute("aria-controls"),
      toggle(second).getAttribute("aria-controls")
    )
  } finally {
    await first.close()
    await second.close()
  }
})
