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
const load = (p) => vite.ssrLoadModule(`/src/${p}`)
const [
  { useFinances },
  { api },
  { parseMoney, money, reserveSignal },
  { summarizeObjective },
  { default: Page },
  { default: Home },
] = await Promise.all([
  load("features/finances/hooks/useFinances.ts"),
  load("services/bunkermodeApi.ts"),
  load("features/finances/money.ts"),
  load("features/objectives/objectiveSummary.ts"),
  load("features/finances/pages/FinancesPage.tsx"),
  load("features/home/pages/HomePage.tsx"),
])
after(() => vite.close())
const empty = () => ({
  mes: "2026-09",
  moeda: "BRL",
  saldo_centavos: 0,
  reservado_centavos: 0,
  livre_centavos: 0,
  receitas_centavos: 0,
  despesas_centavos: 0,
  lancamentos: [],
  reservas: [],
})
async function mount(Component, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const render = async (p) =>
    act(async () =>
      root.render(React.createElement(MemoryRouter, null, React.createElement(Component, p)))
    )
  await render(props)
  return {
    container,
    render,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
test("dinheiro converte decimal em centavos exatos e rejeita representações ambíguas", () => {
  for (const [input, cents] of [
    ["0,01", 1],
    ["0,10", 10],
    ["1,99", 199],
    ["4200", 420000],
    ["21474836,47", 2147483647],
  ])
    assert.equal(parseMoney(input), cents)
  for (const input of ["1.234", "1,234", "1e3", "-1", "NaN", "21474836,48", ""])
    assert.equal(parseMoney(input), null)
  assert.match(money(420001), /4.200,01/)
  assert.match(
    reserveSignal({ valor_centavos: 420000, alvo_centavos: 1000000 }),
    /4.200,00 reservados de R\$\s10.000,00/
  )
})
test("direção admite três vínculos factuais sem percentual nem conclusão automática", () => {
  const result = summarizeObjective({
    objetivo: { id: 1, status: "ativo" },
    trackers: [{ titulo: "Fumar", ocorrencias: [] }],
    tasks: [{ titulo: "Ler", status: "PENDENTE" }],
    reserves: [{ titulo: "Reserva", valor_centavos: 420000, alvo_centavos: 1000000 }],
  })
  assert.deepEqual(
    result.map((x) => x.kind),
    ["tracker", "task", "reserve"]
  )
  assert.doesNotMatch(JSON.stringify(result), /%|sucesso|melhor|concluído/)
})
test("Finanças desativado não consulta API; mudança de token ignora dados antigos e 401 antigos", async () => {
  const original = { ...api }
  let current
  let finish
  let calls = 0
  let unauthorized = 0
  api.getFinances = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const onUnauthorized = (r) => {
    if (r.status === 401) unauthorized++
    return r.status === 401
  }
  function Probe(props) {
    current = useFinances({ ...props, onUnauthorized })
    return null
  }
  const view = await mount(Probe, { token: "a", enabled: false })
  try {
    assert.equal(calls, 0)
    await view.render({ token: "a", enabled: true })
    const old = finish
    await view.render({ token: "b", enabled: true })
    await act(async () => old({ ok: false, status: 401 }))
    assert.equal(unauthorized, 0)
    assert.equal(current.data, null)
    await act(async () => finish({ ok: true, data: empty() }))
    assert.equal(current.data.saldo_centavos, 0)
    await view.render({ token: "b", enabled: false })
    assert.equal(current.data, null)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("mutação espera releitura e não aplica resultado otimista; CRUD chama contratos próprios", async () => {
  const original = { ...api }
  let current
  let data = empty()
  let reads = 0
  let finish
  const actions = []
  api.getFinances = async () => {
    reads++
    return { ok: true, data: structuredClone(data) }
  }
  api.saveFinanceEntry = (_token, payload, id) =>
    new Promise((resolve) => {
      actions.push(["entry", id, payload])
      finish = () => {
        data.saldo_centavos = 123
        resolve({ ok: true, data: { id: 1 } })
      }
    })
  api.saveReserve = async (_t, p, id) => {
    actions.push(["reserve", id, p])
    return { ok: true }
  }
  api.deleteFinanceEntry = async (_t, id) => {
    actions.push(["deleteEntry", id])
    return { ok: true }
  }
  api.deleteReserve = async (_t, id) => {
    actions.push(["deleteReserve", id])
    return { ok: true }
  }
  function Probe() {
    current = useFinances({ token: "crud", onUnauthorized })
    return null
  }
  const onUnauthorized = () => false
  const view = await mount(Probe, {})
  try {
    let pending
    await act(async () => {
      pending = current.saveEntry({ valor_centavos: 123 })
    })
    assert.equal(current.data.saldo_centavos, 0)
    assert.equal(current.busy, true)
    await act(async () => finish())
    assert.equal(await pending, true)
    assert.equal(current.data.saldo_centavos, 123)
    await act(async () => {
      await current.saveReserve({ objetivo_id: null }, 5)
      await current.deleteEntry(1)
      await current.deleteReserve(5)
    })
    assert.equal(reads, 5)
    assert.deepEqual(
      actions.map((a) => a[0]),
      ["entry", "reserve", "deleteEntry", "deleteReserve"]
    )
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("erro após persistência não convida a duplicar lançamento; snapshot permanece e 401 é global", async () => {
  const original = { ...api }
  let current
  let fail = false
  let unauthorized = 0
  api.getFinances = async () =>
    fail
      ? { ok: false, status: 503, data: { message: "Consulta indisponível" } }
      : { ok: true, data: empty() }
  api.saveFinanceEntry = async () => {
    fail = true
    return { ok: true }
  }
  const onUnauthorized = (r) => {
    if (r.status === 401) unauthorized++
    return r.status === 401
  }
  function Probe() {
    current = useFinances({ token: "failure", onUnauthorized })
    return null
  }
  const view = await mount(Probe, {})
  try {
    await act(async () => assert.equal(await current.saveEntry({}), true))
    assert.equal(current.data.saldo_centavos, 0)
    assert.match(current.error, /Consulta indisponível/)
    api.deleteReserve = async () => ({ ok: false, status: 401 })
    await act(async () => assert.equal(await current.deleteReserve(1), false))
    assert.equal(unauthorized, 1)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("página financeira funciona sem Objetivos e tem formulários operáveis", async () => {
  const original = { ...api }
  api.getFinances = async () => ({ ok: true, data: empty() })
  api.listObjetivos = () => {
    throw Error("Módulo desativado")
  }
  const view = await mount(Page, {
    token: "page",
    user: { id: 1, enabled_modules: ["finances"], timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  try {
    assert.match(view.container.textContent, /Livre após reservas|Nenhuma movimentação/)
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((b) => b.textContent === "Nova reserva")
        .click()
    )
    assert.ok(document.querySelector("input[inputmode=decimal]"))
    assert.doesNotMatch(document.querySelector("[role=dialog]").textContent, /Objetivo opcional/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("falha na materialização não dispara leitura de tarefas e preserva direções na Home", async () => {
  const original = { ...api }
  let included
  api.materializeTaskRecurrences = async () => ({
    ok: false,
    status: 503,
    data: { message: "Não foi possível preparar tarefas" },
  })
  api.getOrientation = async (_t, tasks) => {
    included = tasks
    return {
      ok: true,
      data: {
        tarefas: [],
        direcoes: [
          { id: 1, titulo: "Direção independente", tasks: [], trackers: [], reserves: [] },
        ],
        financeiro: null,
      },
    }
  }
  const view = await mount(Home, {
    token: "prepare-failed",
    user: { id: 1, enabled_modules: ["tasks", "objectives"] },
    onUnauthorized: () => false,
  })
  try {
    assert.equal(included, false)
    assert.match(view.container.textContent, /Direção independente/)
    assert.match(view.container.textContent, /Não foi possível preparar/)
    assert.doesNotMatch(view.container.textContent, /O dia está aberto/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

test("falha na exclusão financeira aparece na confirmação e permite tentar novamente", async () => {
  const original = { ...api }
  let deleted = false
  let attempts = 0
  api.getFinances = async () => ({
    ok: true,
    data: {
      ...empty(),
      reservas: deleted ? [] : [{ id: 7, titulo: "Estudos", objetivo_id: null, valor_centavos: 0 }],
    },
  })
  api.deleteReserve = async () => {
    attempts++
    if (attempts === 1)
      return { ok: false, status: 503, data: { message: "Não foi possível excluir a reserva." } }
    deleted = true
    return { ok: true, status: 204, data: null }
  }
  const view = await mount(Page, {
    token: "delete-failure",
    user: { id: 1, enabled_modules: ["finances"], timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  try {
    await act(async () =>
      view.container.querySelector('[aria-label="Ações da reserva: Estudos"]').click()
    )
    await act(async () =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((b) => b.textContent === "Excluir reserva")
        .click()
    )
    const confirm = () =>
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent === "Excluir"
      )
    await act(async () => confirm().click())
    assert.match(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? "",
      /Não foi possível excluir a reserva/
    )
    assert.match(view.container.textContent, /Estudos/)
    await act(async () => confirm().click())
    assert.equal(attempts, 2)
    assert.equal(document.querySelector('[role="dialog"]'), null)
    assert.doesNotMatch(view.container.textContent, /Estudos/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
