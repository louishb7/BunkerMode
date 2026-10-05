import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import React, { act } from "react"
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
const { createRoot } = await import("react-dom/client")
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
  { parseMoney, money, formatMoneyInput },
  { summarizeObjective },
  { default: Page },
  { default: Home },
  { setApiAvailability },
  { default: FinanceForm },
  { projectFinances },
  { default: FinanceChart },
] = await Promise.all([
  load("features/finances/hooks/useFinances.ts"),
  load("services/bunkermodeApi.ts"),
  load("features/finances/money.ts"),
  load("features/objectives/objectiveSummary.ts"),
  load("features/finances/pages/FinancesPage.tsx"),
  load("features/home/pages/HomePage.tsx"),
  load("offline/apiAvailability.ts"),
  load("features/finances/components/FinanceForm.tsx"),
  load("offline/outbox.ts"),
  load("features/finances/components/FinanceChart.tsx"),
])
after(() => vite.close())
beforeEach(() => setApiAvailability("available"))
const empty = () => ({
  mes: "2026-09",
  moeda: "BRL",
  saldo_centavos: 0,
  resultado_centavos: 0,
  receitas_centavos: 0,
  despesas_centavos: 0,
  lancamentos: [],
  serie_diaria: [],
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
    ["4200", 4200],
    ["21474836,47", 2147483647],
  ])
    assert.equal(parseMoney(input), cents)
  for (const input of ["1.234", "1,234", "1e3", "-1", "NaN", "21474836,48", ""])
    assert.equal(parseMoney(input), null)
  assert.match(money(420001), /4.200,01/)
})
test("direção mostra vínculos factuais de tarefas e acompanhamentos sem conclusão automática", () => {
  const result = summarizeObjective({
    objetivo: { id: 1, status: "ativo" },
    trackers: [{ titulo: "Fumar", ocorrencias: [] }],
    tasks: [{ titulo: "Ler", status: "PENDENTE" }],
  })
  assert.deepEqual(
    result.map((x) => x.kind),
    ["tracker", "task"]
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
    current = useFinances({ ownerId: 1, ...props, onUnauthorized })
    return null
  }
  const view = await mount(Probe, { token: "a", enabled: false })
  try {
    assert.equal(calls, 0)
    await view.render({ token: "a", enabled: true })
    const old = finish
    await view.render({ token: "b", ownerId: 2, enabled: true })
    await act(async () => old({ ok: false, status: 401 }))
    assert.equal(unauthorized, 0)
    assert.equal(current.data, null)
    await act(async () => finish({ ok: true, data: empty() }))
    assert.equal(current.data.saldo_centavos, 0)
    await view.render({ token: "b", ownerId: 2, enabled: false })
    assert.equal(current.data, null)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("edição oficial espera releitura e CRUD financeiro online usa contratos próprios", async () => {
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
  api.deleteFinanceEntry = async (_t, id) => {
    actions.push(["deleteEntry", id])
    return { ok: true }
  }
  function Probe() {
    current = useFinances({ token: "crud", ownerId: 1, onUnauthorized })
    return null
  }
  const onUnauthorized = () => false
  const view = await mount(Probe, {})
  try {
    let pending
    await act(async () => {
      pending = current.saveEntry({ valor_centavos: 123 }, 1)
    })
    assert.equal(current.data.saldo_centavos, 0)
    assert.equal(current.busy, true)
    await act(async () => finish())
    assert.equal(await pending, true)
    assert.equal(current.data.saldo_centavos, 123)
    await act(async () => {
      await current.deleteEntry(1)
    })
    assert.equal(reads, 3)
    assert.deepEqual(
      actions.map((a) => a[0]),
      ["entry", "deleteEntry"]
    )
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("erro após edição oficial preserva snapshot e 401 é global", async () => {
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
    current = useFinances({ token: "failure", ownerId: 1, onUnauthorized })
    return null
  }
  const view = await mount(Probe, {})
  try {
    await act(async () => assert.equal(await current.saveEntry({}, 1), true))
    assert.equal(current.data.saldo_centavos, 0)
    assert.match(current.error, /Consulta indisponível/)
    api.deleteFinanceEntry = async () => ({ ok: false, status: 401 })
    await act(async () => assert.equal(await current.deleteEntry(1), false))
    assert.equal(unauthorized, 1)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("página financeira funciona sem Objetivos e tem formulários operáveis", async () => {
  const original = { ...api }
  api.getFinances = async (_token, month) => ({ ok: true, data: { ...empty(), mes: month } })
  api.listObjetivos = () => {
    throw Error("Módulo desativado")
  }
  const view = await mount(Page, {
    token: "page",
    user: { id: 1, enabled_modules: ["finances"], timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  try {
    assert.match(view.container.textContent, /Resultado do mês|Nenhum movimento/)
    assert.doesNotMatch(view.container.textContent, /Reservas|Livre|Categoria/)
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Movimento")
        .click()
    )
    assert.ok(document.querySelector("input[inputmode=numeric]"))
    assert.match(document.querySelector("[role=dialog]").textContent, /Entrada|Saída/)
    assert.doesNotMatch(
      document.querySelector("[role=dialog]").textContent,
      /Objetivo opcional|Ajuste de saldo/
    )
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})
test("Home prepara recorrências explicitamente antes da orientação e preserva direções", async () => {
  const original = { ...api }
  let reads = 0
  api.materializeTaskRecurrences = async () => ({ ok: true })
  api.getOrientation = async () => {
    reads++
    return {
      ok: true,
      data: {
        tarefas: [],
        direcoes: [
          { id: 1, titulo: "Direção independente", status: "ativo", tasks: [], trackers: [] },
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
    assert.equal(reads, 1)
    assert.match(view.container.textContent, /Direção independente/)
    assert.doesNotMatch(view.container.textContent, /Atualizando/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

test("falha na exclusão financeira aparece na confirmação e permite tentar novamente", async () => {
  const original = { ...api }
  let deleted = false
  let attempts = 0
  api.getFinances = async (_token, month) => ({
    ok: true,
    data: {
      ...empty(),
      mes: month,
      lancamentos: deleted
        ? []
        : [
            {
              id: 7,
              titulo: "Estudos",
              tipo: "despesa",
              data: "2026-09-01",
              valor_centavos: 100,
            },
          ],
    },
  })
  api.deleteFinanceEntry = async () => {
    attempts++
    if (attempts === 1)
      return { ok: false, status: 503, data: { message: "Não foi possível excluir o movimento." } }
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
      view.container.querySelector('[aria-label="Ações do movimento: Estudos"]').click()
    )
    await act(async () =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((b) => b.textContent === "Excluir movimento")
        .click()
    )
    const confirm = () =>
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (b) => b.textContent === "Excluir"
      )
    await act(async () => confirm().click())
    assert.match(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? "",
      /Não foi possível excluir o movimento/
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

test("máscara monetária usa os dígitos como centavos sem multiplicação decimal", () => {
  for (const [digits, formatted, cents] of [
    ["1", "0,01", 1],
    ["10", "0,10", 10],
    ["100", "1,00", 100],
    ["1000", "10,00", 1000],
    ["1250", "12,50", 1250],
    ["2147483647", "21474836,47", 2147483647],
  ]) {
    assert.equal(formatMoneyInput(digits), formatted)
    assert.equal(parseMoney(formatted), cents)
    assert.equal(parseMoney(digits), cents)
  }
  assert.equal(formatMoneyInput("1.250,50"), "1250,50")
  assert.equal(formatMoneyInput(""), "")
  assert.equal(parseMoney(formatMoneyInput("2147483648")), null)
})

async function inputValue(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(
      element,
      value
    )
    element.dispatchEvent(new window.Event("input", { bubbles: true }))
  })
}

for (const [label, type] of [
  ["Entrada", "receita"],
  ["Saída", "despesa"],
]) {
  test(`formulário grava ${label} com tipo e centavos corretos, sem categoria`, async () => {
    const saved = []
    const view = await mount(FinanceForm, {
      today: "2026-09-01",
      busy: false,
      error: "",
      onCancel: () => {},
      onSave: async (...args) => saved.push(args),
    })
    try {
      await act(async () =>
        [...view.container.querySelectorAll('[role="radio"]')]
          .find((button) => button.textContent === label)
          .click()
      )
      const value = view.container.querySelector('[name="valor"]')
      for (const [digits, formatted] of [
        ["1", "0,01"],
        ["10", "0,10"],
        ["100", "1,00"],
        ["1000", "10,00"],
        ["1250", "12,50"],
      ]) {
        await inputValue(value, digits)
        assert.equal(value.value, formatted)
      }
      await inputValue(view.container.querySelector('[name="descricao"]'), "  Movimento de teste  ")
      await act(async () =>
        view.container
          .querySelector("form")
          .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
      )
      assert.deepEqual(saved[0][0], {
        titulo: "Movimento de teste",
        tipo: type,
        valor_centavos: 1250,
        data: "2026-09-01",
      })
      assert.equal(view.container.querySelectorAll("input").length, 3)
      assert.equal(view.container.querySelector("select"), null)
      await inputValue(value, "0")
      await act(async () =>
        view.container
          .querySelector("form")
          .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
      )
      assert.equal(saved.length, 1)
      assert.match(view.container.querySelector('[role="alert"]').textContent, /valor/)
    } finally {
      await view.close()
    }
  })
}

test("projeção de Entrada/Saída conserva saldo, totais, gráfico, ordem e falhas", () => {
  const official = {
    ...empty(),
    mes: "2026-09",
    serie_diaria: [
      { data: "2026-09-01", resultado_centavos: 0, receitas_centavos: 0, despesas_centavos: 0 },
      { data: "2026-09-02", resultado_centavos: 0, receitas_centavos: 0, despesas_centavos: 0 },
    ],
  }
  const operation = (operationId, tipo, valor_centavos, data, status = "pending") => ({
    domain: "entry",
    action: "create",
    operationId,
    createdAt: `2026-09-02T12:00:0${operationId}Z`,
    status,
    payload: { tipo, valor_centavos, data, titulo: tipo },
  })
  const operations = [
    operation("1", "receita", 1250, "2026-09-02"),
    operation("2", "despesa", 100, "2026-09-01"),
    operation("3", "receita", 500, "2026-09-02", "failed"),
  ]
  const projected = projectFinances(official, operations, "2026-09")
  assert.equal(projected.saldo_centavos, 1150)
  assert.equal(projected.receitas_centavos, 1250)
  assert.equal(projected.despesas_centavos, 100)
  assert.equal(projected.resultado_centavos, 1150)
  assert.deepEqual(
    projected.serie_diaria.map((point) => point.resultado_centavos),
    [-100, 1150]
  )
  assert.equal(projected.serie_diaria.at(-1).receitas_centavos, 1250)
  assert.equal(projected.serie_diaria.at(-1).despesas_centavos, 100)
  assert.deepEqual(
    projected.lancamentos.map((entry) => entry.id),
    ["local:3", "local:1", "local:2"]
  )
  const confirmed = { ...projected, lancamentos: [{ ...projected.lancamentos[1], id: 7 }] }
  const replay = projectFinances(confirmed, [{ ...operations[0], serverId: 7 }], "2026-09")
  assert.equal(replay.saldo_centavos, 1150)
  assert.equal(replay.lancamentos.length, 1)
  const past = projectFinances(official, [operation("4", "despesa", 10, "2026-08-31")], "2026-09")
  assert.equal(past.saldo_centavos, -10)
  assert.equal(past.lancamentos[0].data, "2026-08-31")
  assert.equal(past.resultado_centavos, 0)
  assert.deepEqual(past.serie_diaria, official.serie_diaria)
  const localPast = projectFinances(null, [operation("4", "despesa", 10, "2026-08-31")], "2026-09")
  assert.equal(localPast.saldo_centavos, -10)
  assert.equal(localPast.lancamentos.length, 1)
  assert.equal(localPast.resultado_centavos, 0)
  assert.equal(
    projectFinances(official, [operation("4", "inválido", 10, "2026-09-01")], "2026-09")
      .saldo_centavos,
    0
  )
})

test("saldo de ajuste antigo fica acessível no histórico e é recalculado após exclusão", async () => {
  const original = { ...api }
  let deleted = false
  api.getFinances = async (_token, month) => ({
    ok: true,
    data: {
      ...empty(),
      mes: month,
      saldo_centavos: deleted ? 0 : 14000,
      lancamentos: deleted
        ? []
        : [
            {
              id: 140,
              titulo: "Saldo anterior",
              tipo: "ajuste_entrada",
              valor_centavos: 14000,
              data: "2026-01-01",
            },
          ],
    },
  })
  api.deleteFinanceEntry = async (_token, id) => {
    assert.equal(id, 140)
    deleted = true
    return { ok: true, status: 204 }
  }
  const view = await mount(Page, {
    token: "old-balance",
    user: { id: 140, timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  try {
    assert.equal(view.container.querySelector(".finance-result").textContent, money(14000))
    assert.match(
      view.container.querySelector(".finance-ledger").textContent,
      /Saldo anterior.*Entrada.*01\/01\/2026.*Ajuste de saldo/
    )
    await act(async () =>
      view.container.querySelector('[aria-label="Ações do movimento: Saldo anterior"]').click()
    )
    await act(async () =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((button) => button.textContent === "Excluir movimento")
        .click()
    )
    await act(async () =>
      [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent === "Excluir")
        .click()
    )
    assert.equal(view.container.querySelector(".finance-result").textContent, money(0))
    assert.match(view.container.textContent, /Nenhum movimento registrado/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

test("gráfico mostra escala em reais, valores diários e resultado acumulado sem dias futuros", async () => {
  const points = [
    {
      data: "2026-09-01",
      receitas_centavos: 10000,
      despesas_centavos: 0,
      resultado_centavos: 10000,
    },
    {
      data: "2026-09-02",
      receitas_centavos: 10000,
      despesas_centavos: 12500,
      resultado_centavos: -2500,
    },
    {
      data: "2026-09-03",
      receitas_centavos: 11250,
      despesas_centavos: 12500,
      resultado_centavos: -1250,
    },
    {
      data: "2026-09-04",
      receitas_centavos: 99900,
      despesas_centavos: 12500,
      resultado_centavos: 87400,
    },
  ]
  const view = await mount(FinanceChart, { points, today: "2026-09-03" })
  const amounts = () =>
    [...view.container.querySelectorAll(".finance-chart-details dd")].map((el) => el.textContent)
  try {
    assert.equal(
      view.container.querySelector(".finance-chart-total strong").textContent,
      money(-1250)
    )
    assert.match(view.container.querySelector(".finance-chart-axis").textContent, /R\$/)
    assert.ok(view.container.querySelector(".finance-chart-axis").textContent.includes(money(0)))
    assert.ok(
      view.container.querySelector(".finance-chart-axis").textContent.includes(money(-5000))
    )
    assert.deepEqual(amounts(), [money(1250), money(0), money(-1250)])
    const slider = view.container.querySelector('[aria-label="Dia do gráfico"]')
    assert.equal(slider.max, "2")
    assert.equal(slider.getAttribute("aria-valuetext"), "03/09/2026")
    await inputValue(slider, "1")
    assert.deepEqual(amounts(), [money(0), money(12500), money(-2500)])
    assert.equal(slider.getAttribute("aria-valuetext"), "02/09/2026")
    await inputValue(slider, "0")
    assert.deepEqual(amounts(), [money(10000), money(0), money(10000)])
    const svg = view.container.querySelector("svg")
    svg.getBoundingClientRect = () => ({ left: 0, width: 600 })
    await act(async () => {
      const event = new window.Event("pointerdown", { bubbles: true })
      Object.defineProperty(event, "clientX", { value: 600 })
      svg.dispatchEvent(event)
    })
    assert.deepEqual(amounts(), [money(1250), money(0), money(-1250)])
    assert.doesNotMatch(view.container.textContent, /04\/09/)
  } finally {
    await view.close()
  }
})

test("gráfico trata mês vazio, primeiro dia e fluxos que se anulam", async () => {
  const view = await mount(FinanceChart, { points: [], today: "2026-09-01" })
  try {
    assert.match(view.container.textContent, /Ainda não há entradas ou saídas/)
    assert.equal(view.container.querySelector("svg"), null)
    await view.render({
      points: [
        {
          data: "2026-09-01",
          receitas_centavos: 1250,
          despesas_centavos: 1250,
          resultado_centavos: 0,
        },
      ],
      today: "2026-09-01",
    })
    assert.equal(view.container.querySelector('input[type="range"]').disabled, true)
    assert.equal(view.container.querySelector(".finance-chart-total strong").textContent, money(0))
    assert.equal(
      view.container.querySelectorAll(".finance-chart-details dd")[0].textContent,
      money(1250)
    )
    assert.doesNotMatch(view.container.querySelector("path").getAttribute("d"), /NaN|Infinity/)
  } finally {
    await view.close()
  }
})

test("histórico mostra até oito itens, ordena datas e navega por todas as páginas", async () => {
  const original = { ...api }
  api.getFinances = async (_token, month) => ({
    ok: true,
    data: {
      ...empty(),
      mes: month,
      lancamentos: Array.from({ length: 17 }, (_, index) => ({
        id: index + 1,
        titulo: `Movimento ${index + 1}`,
        tipo: index % 2 ? "receita" : "despesa",
        data: `${month}-01`,
        valor_centavos: 100,
      })),
    },
  })
  const view = await mount(Page, {
    token: "pagination",
    user: { id: 91, timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  const rows = () =>
    [...view.container.querySelectorAll(".finance-ledger li")].map(
      (row) => row.querySelector("strong").textContent
    )
  const click = async (label) =>
    act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === label)
        .click()
    )
  try {
    assert.deepEqual(
      rows(),
      Array.from({ length: 8 }, (_, i) => `Movimento ${17 - i}`)
    )
    assert.match(view.container.querySelector(".finance-ledger").textContent, /Entrada/)
    assert.match(view.container.querySelector(".finance-ledger").textContent, /Saída/)
    assert.match(view.container.textContent, /Página 1 de 3/)
    await click("Próxima")
    assert.deepEqual(
      rows(),
      Array.from({ length: 8 }, (_, i) => `Movimento ${9 - i}`)
    )
    await click("Próxima")
    assert.deepEqual(rows(), ["Movimento 1"])
    assert.equal(
      [...view.container.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Próxima"
      ).disabled,
      true
    )
    await click("Anterior")
    assert.equal(rows().length, 8)
    await act(async () => view.container.querySelector('[aria-label="Mês anterior"]').click())
    assert.match(view.container.textContent, /Página 2 de 3/)
    assert.match(view.container.querySelector(".finance-state").textContent, /Movimento/)
    assert.equal(view.container.querySelector(".finance-state .finance-month"), null)
    assert.doesNotMatch(view.container.textContent, /Reservas|Categoria/)
  } finally {
    await view.close()
    Object.assign(api, original)
  }
})

 test("poucos movimentos recolhem evolução, sem esconder fluxos que se compensam", async () => {
  const points = [{data:"2026-09-01",receitas_centavos:1000,despesas_centavos:1000,resultado_centavos:0}]
  const view = await mount(FinanceChart, {points, today:"2026-09-01", movementCount:2})
  try {
    assert.equal(view.container.querySelector('details').open, false)
    assert.match(view.container.querySelector('summary').textContent, /2 movimentos/)
    await act(async()=>{view.container.querySelector('details').open=true})
    assert.ok(view.container.querySelector('svg'))
    await view.render({points, today:"2026-09-01", movementCount:3})
    assert.equal(view.container.querySelector('details'),null)
    assert.ok(view.container.querySelector('svg'))
  } finally {await view.close()}
})
