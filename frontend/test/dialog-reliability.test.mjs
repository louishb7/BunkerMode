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
const { MemoryRouter } = await import("react-router-dom")
const vite = await createServer({
  appType: "custom", logLevel: "silent", root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [{ default: Dialog }, { default: ObjectivesPage }, { api }] = await Promise.all([
  vite.ssrLoadModule("/src/components/ui/Dialog.tsx"),
  vite.ssrLoadModule("/src/features/objectives/pages/ObjectivesPage.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
])
after(() => vite.close())
async function mount(Component, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(MemoryRouter, null, React.createElement(Component, props)))
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
  return { container, close: async () => { await act(async () => root.unmount()); container.remove() } }
}
const click = (element) => act(async () => element.click())
const key = (key, shiftKey = false) => act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true })))
const button = (label, scope = document) => [...scope.querySelectorAll("button")].find((item) => item.textContent.trim() === label)
const choice = (label) => [...document.querySelectorAll(".composer-choice")].find((item) => item.querySelector("strong").textContent === label)
const type = (element, value) => act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(element, value)
  element.dispatchEvent(new window.Event("input", { bubbles: true }))
})

test("rerenders preservam foco de busca; trap, opções atuais, Escape e origem continuam corretos", async () => {
  const origin = document.createElement("button")
  document.body.append(origin)
  origin.focus()
  let rerender, closeVersion = null
  function SearchDialog() {
    const [search, setSearch] = React.useState("")
    const [version, setVersion] = React.useState(0)
    rerender = setVersion
    return React.createElement(Dialog, {
      title: "Busca", closeOnEscape: version !== 1, onClose: () => { closeVersion = version },
    }, React.createElement("button", null, "Primeiro"), React.createElement("input", {
      value: search, onChange: (event) => setSearch(event.target.value), "aria-label": "Pesquisar tarefas",
    }), React.createElement("button", null, "Último"))
  }
  const view = await mount(SearchDialog)
  try {
    const input = document.querySelector("input")
    input.focus()
    for (const value of ["l", "le", "ler"]) {
      await type(input, value)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 2)))
      assert.equal(document.activeElement, input)
      assert.equal(input.value, value)
    }
    await act(async () => rerender(1))
    await key("Escape")
    assert.equal(closeVersion, null, "opção atual bloqueia Escape sem reinstalar foco")
    assert.equal(document.activeElement, input)
    button("Último").focus()
    await key("Tab")
    assert.equal(document.activeElement, button("Primeiro"))
    await key("Tab", true)
    assert.equal(document.activeElement, button("Último"))
    await act(async () => rerender(2))
    await key("Escape")
    assert.equal(closeVersion, 2, "Escape usa callback mais recente")
  } finally {
    await view.close()
    assert.equal(document.activeElement, origin)
    origin.remove()
  }
})

test("dialog superior mantém teclado e devolve foco ao dialog anterior antes da origem", async () => {
  const origin = document.createElement("button")
  document.body.append(origin)
  origin.focus()
  let parentCloses = 0
  function NestedDialogs() {
    const [nested, setNested] = React.useState(false)
    return React.createElement(React.Fragment, null,
      React.createElement(Dialog, { title: "Anterior", onClose: () => { parentCloses++ } },
        React.createElement("button", { onClick: () => setNested(true) }, "Abrir detalhe")),
      nested && React.createElement(Dialog, { title: "Detalhe", onClose: () => setNested(false) },
        React.createElement("button", null, "Ação do detalhe")))
  }
  const view = await mount(NestedDialogs)
  try {
    const opener = button("Abrir detalhe")
    opener.focus()
    await click(opener)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
    assert.equal(document.activeElement, button("Ação do detalhe"))
    await key("Tab")
    assert.equal(document.activeElement, button("Ação do detalhe"))
    await key("Escape")
    assert.equal(parentCloses, 0, "Escape atua apenas no dialog superior")
    assert.equal(document.querySelectorAll("[role=dialog]").length, 1)
    assert.equal(document.activeElement, opener)
    assert.equal(document.body.style.overflow, "hidden")
  } finally {
    await view.close()
    assert.equal(document.activeElement, origin)
    assert.equal(document.body.style.overflow, "")
    origin.remove()
  }
})

test("seletor sai por botão, backdrop e Escape; formulário alterado exige descarte e preserva rascunho", { timeout: 10000 }, async () => {
  const originalApi = { ...api }, originalConfirm = window.confirm
  let confirmations = 0, discard = false
  window.confirm = () => { confirmations++; return discard }
  api.listObjetivos = async () => ({ ok: true, data: [{ id: 42, titulo: "Ler mais", descricao: null, status: "ativo", order_index: 0, created_at: "2026-10-01T12:00:00Z", updated_at: "2026-10-01T12:00:00Z", data_alvo: null }] })
  api.listTrackers = async () => ({ ok: true, data: [] })
  api.listAchievements = async () => ({ ok: true, data: [] })
  api.listTasks = async () => ({ ok: true, data: [
    { id: 10, titulo: "Ler livro", objetivo_id: null, status: "PENDENTE", prazo: null },
    { id: 11, titulo: "Comprar tênis", objetivo_id: null, status: "PENDENTE", prazo: null },
  ] })
  const view = await mount(ObjectivesPage, { token: "dialogs", user: { id: 42, enabled_modules: ["tasks", "objectives"], timezone: "America/Recife" }, onUnauthorized: () => false })
  try {
    await click(button("Adicionar vínculo", view.container))
    assert.ok(button("Fechar", document.querySelector("[role=dialog]")))
    await click(button("Fechar", document.querySelector("[role=dialog]")))
    assert.equal(document.querySelector("[role=dialog]"), null)
    await click(button("Adicionar vínculo", view.container))
    const backdrop = document.querySelector("[role=dialog]").parentElement
    await act(async () => backdrop.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true })))
    assert.equal(document.querySelector("[role=dialog]"), null)
    await click(button("Adicionar vínculo", view.container))
    await key("Escape")
    assert.equal(document.querySelector("[role=dialog]"), null)
    assert.equal(confirmations, 0)

    const addLink = button("Adicionar vínculo", view.container)
    addLink.focus()
    await click(addLink)
    assert.equal(document.querySelector("[role=dialog] input"), null)
    await click(choice("Tarefa"))
    assert.equal(document.querySelector("[role=dialog] input"), null)
    await click(button("Vincular tarefa existente", document.querySelector("[role=dialog]")))
    assert.equal(document.querySelector(".composer-results"), null, "busca vazia não despeja tarefas")
    const search = document.querySelector('input[aria-label="Pesquisar tarefas"]')
    search.focus()
    for (const value of ["l", "le", "ler"]) {
      await type(search, value)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 2)))
      assert.ok(document.activeElement === search, "busca real preserva foco entre filtros, inclusive antes do foco inicial agendado")
      assert.equal(search.value, value)
    }
    const results = document.querySelector(".composer-results")
    assert.match(results.textContent, /Ler livro/)
    assert.doesNotMatch(results.textContent, /Comprar tênis/)
    await key("Escape")
    assert.ok(document.activeElement === addLink, "fechar compositor devolve foco à origem")
    assert.equal(confirmations, 0, "pesquisa não é um formulário com alterações")

    await click(button("Adicionar vínculo", view.container))
    await click(choice("Tarefa"))
    await click(button("Criar tarefa", document.querySelector("[role=dialog]")))
    const taskTitle = document.querySelector('input[name="titulo"]')
    taskTitle.focus()
    await type(taskTitle, "Comprar livro")
    await key("Escape")
    assert.equal(confirmations, 1)
    assert.equal(document.querySelector('input[name="titulo"]').value, "Comprar livro")
    await click(button("Cancelar", document.querySelector("[role=dialog]")))
    assert.equal(confirmations, 2)
    assert.ok(document.querySelector("[role=dialog]"))
    discard = true
    await key("Escape")
    assert.equal(document.querySelector("[role=dialog]"), null)

    await click(button("Novo objetivo", view.container))
    await type(document.querySelector('input[name="titulo"]'), "Meu rascunho")
    discard = false
    await key("Escape")
    assert.equal(document.querySelector('input[name="titulo"]').value, "Meu rascunho")
    discard = true
    await key("Escape")
    assert.equal(document.querySelector("[role=dialog]"), null)

    await click(button("Adicionar vínculo", view.container))
    await click(choice("Comportamento"))
    await click(button("Criar comportamento", document.querySelector("[role=dialog]")))
    await type(document.querySelector("[role=dialog] input"), "Observar distrações")
    discard = false
    await key("Escape")
    assert.equal(document.querySelector("[role=dialog] input").value, "Observar distrações")
    discard = true
    await key("Escape")
    assert.equal(document.querySelector("[role=dialog]"), null)
  } finally {
    await view.close()
    Object.assign(api, originalApi)
    window.confirm = originalConfirm
  }
})

test("desmontar dialogs aninhados juntos libera a rolagem independentemente da ordem de limpeza", async () => {
  document.body.style.overflow = "auto"
  function Pair() {
    return React.createElement(React.Fragment, null,
      React.createElement(Dialog, { title: "Anterior" }, React.createElement("button", null, "Origem")),
      React.createElement(Dialog, { title: "Registro" }, React.createElement("button", null, "Salvar")))
  }
  const view = await mount(Pair)
  assert.equal(document.body.style.overflow, "hidden")
  await view.close()
  assert.equal(document.body.style.overflow, "auto")
  document.body.style.overflow = ""
})
