import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/objetivos",
})
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
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [
  { default: Form },
  { default: RecordForm },
  { default: History },
  { default: PauseForm },
  { default: Page },
  { api },
  domain,
] = await Promise.all([
  vite.ssrLoadModule("/src/features/objectives/components/TrackerForm.tsx"),
  vite.ssrLoadModule("/src/features/practices/components/PracticeRecordForm.tsx"),
  vite.ssrLoadModule("/src/features/practices/components/PracticeHistory.tsx"),
  vite.ssrLoadModule("/src/features/practices/components/PracticePauseForm.tsx"),
  vite.ssrLoadModule("/src/features/objectives/pages/ObjectivesPage.tsx"),
  vite.ssrLoadModule("/src/services/bunkermodeApi.ts"),
  vite.ssrLoadModule("/src/features/practices/practiceDomain.ts"),
])
after(async () => {
  await vite.close()
  dom.window.close()
})
const today = domain.practiceDate(new Date()),
  yesterday = domain.addPracticeDays(today, -1)
const plan = (changes = {}) => ({
  effective_from: yesterday,
  effective_until: null,
  frequency: "diaria",
  weekdays: [],
  target_amount: 30,
  unit: "páginas",
  paused: false,
  timezone: "America/Recife",
  ...changes,
})
const tracker = (changes = {}) => ({
  id: 7,
  titulo: "Ler",
  objetivo_id: null,
  intent: "repetir",
  status: "ativo",
  planos: [plan()],
  ocorrencias: [],
  ...changes,
})
const click = (element) => act(async () => element.click())
const input = (element, value) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(
      element,
      value
    )
    element.dispatchEvent(new window.Event("input", { bubbles: true }))
  })
const select = (element, value) =>
  act(async () => {
    element.value = value
    element.dispatchEvent(new window.Event("change", { bubbles: true }))
  })
const submit = (container) =>
  act(async () =>
    container
      .querySelector("form")
      .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
  )
const button = (text, scope = document) =>
  [...scope.querySelectorAll("button")].find((item) => item.textContent.trim() === text)
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

test("criação qualitativa começa curta e sem objetivo; quantidade e dias fixos aparecem progressivamente", async () => {
  let payload
  const view = await mount(Form, {
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
    objectiveOptions: [{ id: 9, titulo: "Ler mais" }],
  })
  try {
    assert.equal(view.container.querySelector("input[name=target_amount]"), null)
    assert.equal(view.container.querySelector("select[name=objetivo_id]").value, "")
    await input(view.container.querySelector("input[name=titulo]"), "Ler")
    await submit(view.container)
    assert.equal(payload.objetivo_id, null)
    assert.equal(payload.plan.target_amount, null)
    assert.equal(payload.plan.frequency, "diaria")
    await click(view.container.querySelector("input[type=checkbox]"))
    await input(view.container.querySelector("input[name=target_amount]"), "30")
    await input(view.container.querySelector("input[name=unit]"), "páginas")
    await select(view.container.querySelector("select[name=frequency]"), "dias_fixos")
    await select(view.container.querySelector("select[name=objetivo_id]"), "9")
    await submit(view.container)
    assert.equal(payload.objetivo_id, 9)
    assert.equal(payload.plan.target_amount, 30)
    assert.deepEqual(payload.plan.weekdays, [0, 2, 4])
  } finally {
    await view.close()
  }
})
test("meta semanal é flexível, e registro livre não recebe plano nem cumprimento", async () => {
  let payload
  const view = await mount(Form, {
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    await input(view.container.querySelector("input[name=titulo]"), "Academia")
    await select(view.container.querySelector("select[name=frequency]"), "semanal")
    await input(view.container.querySelector("input[name=times_per_week]"), "3")
    await submit(view.container)
    assert.equal(payload.plan.times_per_week, 3)
    assert.deepEqual(payload.plan.weekdays, [])
    await select(view.container.querySelector("select[name=intent]"), "registro_livre")
    await submit(view.container)
    assert.equal(payload.plan, undefined)
    assert.equal(payload.intent, "registro_livre")
  } finally {
    await view.close()
  }
})
test("editar título ou vínculo preserva o plano; nova meta tem vigência própria", async () => {
  let payload
  const view = await mount(Form, {
    tracker: tracker({ objetivo_id: 9 }),
    objectiveOptions: [{ id: 9, titulo: "Ler mais" }],
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    await input(view.container.querySelector("input[name=titulo]"), "Leitura")
    await select(view.container.querySelector("select[name=objetivo_id]"), "")
    await submit(view.container)
    assert.equal(payload.plan, undefined)
    assert.equal(payload.objetivo_id, null)
    await input(view.container.querySelector("input[name=target_amount]"), "40")
    await submit(view.container)
    assert.equal(payload.plan.target_amount, 40)
    assert.equal(payload.plan.effective_from, domain.addPracticeDays(today, 1))
    assert.match(view.container.textContent, /plano anterior e seus registros permanecem/)
  } finally {
    await view.close()
  }
})
test("registro parcial usa unidade e meta da data histórica, mesmo após mudar o plano", async () => {
  let payload
  const data = tracker({
    planos: [
      plan({ effective_until: today, target_amount: 10 }),
      plan({ effective_from: today, target_amount: 30, unit: "minutos" }),
    ],
  })
  const view = await mount(RecordForm, {
    tracker: data,
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    await input(view.container.querySelector("input[name=occurred_at]"), `${yesterday}T15:00`)
    assert.match(view.container.textContent, /Quantidade · páginas/)
    await input(view.container.querySelector("input[name=amount]"), "10")
    await submit(view.container)
    assert.equal(payload.amount, 10)
    assert.equal(payload.occurred_at, `${yesterday}T18:00:00.000Z`)
    assert.equal(payload.kind, "atividade")
    assert.equal(
      payload.unit,
      "páginas",
      "unidade capturada deve ser conferida com o plano no servidor"
    )
    assert.equal(payload.plan_effective_from, yesterday)
  } finally {
    await view.close()
  }
})
test("data do registro permanece explícita em dia/mês/ano e 24 horas", async () => {
  const view = await mount(RecordForm, {
    tracker: tracker({ planos: [plan({ effective_from: "2026-01-01" })] }),
    onSubmit() {},
    onCancel() {},
  })
  try {
    await input(view.container.querySelector("input[name=occurred_at]"), "2026-10-05T17:07")
    assert.equal(
      view.container.querySelector("input[name=occurred_at]").getAttribute("lang"),
      "pt-BR",
    )
    assert.match(view.container.textContent, /05\/10\/2026, 17:07/)
    assert.doesNotMatch(view.container.textContent, /10\/05\/2026, 05:07 PM/)
  } finally {
    await view.close()
  }
})
test("registro livre detalhado aceita quantidade e unidade sem meta", async () => {
  let payload
  const view = await mount(RecordForm, {
    tracker: tracker({ intent: "registro_livre", planos: [] }),
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    assert.equal(view.container.querySelector("input[name=amount]"), null)
    await click(view.container.querySelector("input[type=checkbox]"))
    await input(view.container.querySelector("input[name=amount]"), "1,5")
    await input(view.container.querySelector("input[name=unit]"), "copos")
    await submit(view.container)
    assert.equal(payload.amount, 1.5)
    assert.equal(payload.unit, "copos")
    assert.equal(payload.kind, "ocorrencia")
    assert.equal(payload.plan_signature, undefined)
    assert.match(view.container.textContent, /sem meta ou conclusão automática/)
  } finally {
    await view.close()
  }
})
test("alterar apenas um dia fixo comunica rascunho alterado", async () => {
  let dirty = 0
  const view = await mount(Form, {
    tracker: tracker({ planos: [plan({ frequency: "dias_fixos", weekdays: [0, 2, 4] })] }),
    onSubmit() {},
    onCancel() {},
    onDirty() {
      dirty++
    },
  })
  try {
    await click(button("Ter", view.container))
    assert.equal(dirty, 1)
    assert.equal(button("Ter", view.container).getAttribute("aria-pressed"), "true")
  } finally {
    await view.close()
  }
})
test("evitação não confirma um período aberto nem presume dias sem informação", async () => {
  let payload
  const view = await mount(RecordForm, {
    tracker: tracker({ intent: "evitar", planos: [plan({ target_amount: null, unit: null })] }),
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    await select(view.container.querySelector("select[name=kind]"), "confirmacao")
    assert.equal(
      view.container.querySelector("input[name=occurred_at]").value.slice(0, 10),
      yesterday
    )
    await submit(view.container)
    assert.equal(payload.kind, "confirmacao")
    payload = undefined
    await input(view.container.querySelector("input[name=occurred_at]"), `${today}T00:00`)
    await submit(view.container)
    assert.equal(payload, undefined)
    assert.match(view.container.querySelector("[role=alert]").textContent, /período já encerrado/)
  } finally {
    await view.close()
  }
})
test("histórico mantém parciais, todas as páginas, planos e marcos factuais sem coroa", async () => {
  const records = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    occurred_at: `${yesterday}T18:00:00Z`,
    kind: "atividade",
    amount: 100,
    unit: "páginas",
  }))
  const view = await mount(History, {
    tracker: tracker({ ocorrencias: records }),
    timezone: "America/Recife",
    onDeleteOccurrence() {},
  })
  try {
    assert.equal(view.container.querySelectorAll(".objective-occurrences li").length, 8)
    assert.match(view.container.textContent, /10 registros|1000 páginas registrados/)
    assert.match(view.container.textContent, /oportunidades encerradas/)
    assert.equal(view.container.querySelector(".objective-crown"), null)
    await click(button("Próxima", view.container))
    assert.equal(view.container.querySelectorAll(".objective-occurrences li").length, 2)
    assert.match(view.container.textContent, /2 de 2/)
  } finally {
    await view.close()
  }
})
test("histórico converte o instante para America/Recife em formato de 24 horas", async () => {
  const view = await mount(History, {
    tracker: tracker({
      ocorrencias: [{ id: 1, occurred_at: "2026-10-05T20:07:00.000Z", kind: "atividade" }],
    }),
    timezone: "America/Recife",
  })
  try {
    assert.match(view.container.textContent, /05\/10\/2026, 17:07/)
  } finally {
    await view.close()
  }
})
test("pausa preserva o plano de um dia registrado e inicia na próxima data", async () => {
  let payload
  const view = await mount(PauseForm, {
    tracker: tracker({ ocorrencias: [{ id: 1, occurred_at: new Date().toISOString() }] }),
    onSubmit: (value) => {
      payload = value
    },
    onCancel() {},
  })
  try {
    await submit(view.container)
    assert.equal(payload.status, "pausado")
    assert.equal(payload.effective_from, domain.addPracticeDays(today, 1))
  } finally {
    await view.close()
  }
})
test("área independente funciona sem objetivos, não lê Tarefas e expõe falha de armazenamento imediato", async () => {
  const original = { ...api }
  let tasksRead = 0
  api.listObjetivos = async () => ({ ok: true, data: [] })
  api.listAchievements = async () => ({ ok: true, data: [] })
  api.listTrackers = async () => ({ ok: true, data: [tracker()] })
  api.listTasks = async () => {
    tasksRead++
    return { ok: true, data: [] }
  }
  window.history.replaceState(null, "", "#habitos")
  const view = await mount(Page, {
    token: "practices",
    user: { id: 81, enabled_modules: ["objectives"], timezone: "America/Recife" },
    onUnauthorized: () => false,
  })
  try {
    assert.equal(tasksRead, 0)
    assert.ok(button("Novo comportamento", view.container))
    assert.match(view.container.textContent, /Ler/)
    await click(button("Novo comportamento", view.container))
    await input(document.querySelector("input[name=titulo]"), "Meditar")
    await submit(document.querySelector("[role=dialog]"))
    assert.match(
      document.querySelector("[role=dialog]").textContent,
      /Armazenamento local indisponível/
    )
    assert.equal(document.querySelector("input[name=titulo]").value, "Meditar")
  } finally {
    await view.close()
    Object.assign(api, original)
    window.history.replaceState(null, "", "/objetivos")
  }
})
