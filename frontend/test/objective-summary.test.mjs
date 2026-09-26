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
const load = (path) => vite.ssrLoadModule(`/src/${path}`)
const [
  { summarizeObjective, trackerOccurrenceLabel },
  { default: Card },
  { default: Home, selectHomeObjectives },
  { default: ObjectivesPage },
  { useTrackers },
  { api },
  cache,
] = await Promise.all([
  load("features/objectives/objectiveSummary.ts"),
  load("features/objectives/components/ObjetivoCard.tsx"),
  load("features/home/pages/HomePage.tsx"),
  load("features/objectives/pages/ObjectivesPage.tsx"),
  load("features/objectives/hooks/useTrackers.ts"),
  load("services/bunkermodeApi.ts"),
  load("state/overviewCache.ts"),
])
after(() => vite.close())
const objetivo = {
  id: 4,
  titulo: "Cuidar da saúde",
  descricao: "Reorganizar hábitos com atenção ao contexto.",
  status: "ativo",
}
const tracker = {
  id: 10,
  objetivo_id: 4,
  titulo: "Não fumar",
  ocorrencias: [{ id: 1, occurred_at: "2026-09-17T12:00:00Z" }],
}
const user = { id: 1, timezone: "America/Recife", enabled_modules: ["objectives"] }
async function mount(Component, props) {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(React.createElement(MemoryRouter, null, React.createElement(Component, props)))
  )
  return {
    container,
    async close() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}
const cardProps = {
  objetivo,
  tasksEnabled: true,
  tasks: [],
  trackers: [],
  loading: false,
  onEdit() {},
  onDelete() {},
  onUpdateStatus() {},
}

test("sinais são fatos limitados a três; datas, ausência e última ocorrência respeitam calendário", () => {
  const now = new Date("2026-09-25T12:00:00Z")
  const timezone = user.timezone
  const task = { id: 1, titulo: "Caminhar", status_code: "PENDENTE", prazo: "25-09-2026" }
  const signals = summarizeObjective({
    objetivo: { ...objetivo, data_alvo: "2026-09-30" },
    trackers: [tracker],
    tasks: [task],
    timezone,
    now,
  })
  assert.equal(signals.length, 2)
  assert.equal(signals[0].detail, "Última ocorrência registrada há 8 dias")
  assert.equal(signals[1].detail, "Prevista para hoje")
  assert.doesNotMatch(JSON.stringify(signals), /sucesso|%|progresso/i)
  assert.equal(
    trackerOccurrenceLabel({ ...tracker, ocorrencias: [] }, timezone, now),
    "Nenhuma ocorrência registrada"
  )
  assert.equal(
    trackerOccurrenceLabel(
      { ...tracker, ocorrencias: [{ occurred_at: "2026-09-25T01:00:00Z" }] },
      timezone,
      now
    ),
    "Última ocorrência registrada ontem"
  )
  assert.equal(
    trackerOccurrenceLabel(
      {
        ...tracker,
        ocorrencias: [{ occurred_at: "2026-09-10T12:00:00Z" }, ...tracker.ocorrencias],
      },
      timezone,
      now
    ),
    signals[0].detail
  )
  assert.deepEqual(
    summarizeObjective({ objetivo, tasks: [{ ...task, status_code: "NAO_REALIZADA" }] }),
    []
  )
  assert.equal(
    summarizeObjective({ objetivo: { ...objetivo, data_alvo: "2026-09-30" } })[0].detail,
    "30/09/2026"
  )
  assert.deepEqual(
    selectHomeObjectives([objetivo, { ...objetivo, id: 5, status: "pausado" }]).map((o) => o.id),
    [4]
  )
})

test("resumo tem fallback curto, detalhes locais e distingue erro, vazio real e carregamento", async () => {
  for (const state of [
    {
      trackersError: "Falha na consulta",
      trackersLoaded: false,
      expected: /Acompanhamentos indisponíveis/,
    },
    { trackersLoading: true, trackersLoaded: false, expected: /Reorganizar hábitos/ },
    { trackersLoaded: true, expected: /Uma direção pode começar sem vínculos/ },
  ]) {
    const view = await mount(Card, { ...cardProps, ...state })
    try {
      assert.match(view.container.textContent, state.expected)
      assert.match(view.container.textContent, /Reorganizar hábitos/)
      if (state.trackersError || state.trackersLoading)
        assert.doesNotMatch(view.container.textContent, /Uma direção pode começar sem vínculos/)
      assert.equal(view.container.querySelector("details").open, false)
      view.container.querySelector("details").open = true
      assert.match(view.container.querySelector("details").textContent, /Concluir objetivo/)
    } finally {
      await view.close()
    }
  }
})

test("Home e Objetivos compartilham a leitura factual do mesmo vínculo", async () => {
  const original = { ...api }
  api.listObjetivos = async () => ({ ok: true, data: [objetivo] })
  api.listTrackers = async () => ({ ok: true, data: [tracker] })
  api.getOrientation = async () => ({
    ok: true,
    data: {
      tarefas: [],
      direcoes: [{ ...objetivo, trackers: [tracker], tasks: [], reserves: [] }],
      financeiro: null,
    },
  })
  const home = await mount(Home, { token: "shared", user, onUnauthorized: () => false })
  const page = await mount(ObjectivesPage, { token: "shared", user, onUnauthorized: () => false })
  try {
    const select = (view) =>
      view.container.querySelector('[aria-label="Resumo de Cuidar da saúde"]').textContent
    assert.equal(select(home), select(page))
    assert.match(select(home), /Não fumarÚltima ocorrência/)
    assert.doesNotMatch(home.container.textContent, /Reorganizar hábitos/)
  } finally {
    await home.close()
    await page.close()
    Object.assign(api, original)
    cache.clearOverview()
  }
})

test("erro real do hook chega à página e retry recupera sem anunciar vazio incorretamente", async () => {
  const original = { ...api }
  let fail = true
  api.listObjetivos = async () => ({ ok: true, data: [objetivo] })
  api.listTrackers = async () =>
    fail
      ? { ok: false, status: 503, data: { message: "Consulta indisponível" } }
      : { ok: true, data: [tracker] }
  const view = await mount(ObjectivesPage, {
    token: "summary-error",
    user,
    onUnauthorized: () => false,
  })
  try {
    assert.match(view.container.textContent, /Acompanhamentos indisponíveis/)
    assert.doesNotMatch(view.container.textContent, /Uma direção pode começar sem vínculos/)
    fail = false
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((b) => b.textContent === "Tentar novamente")
        .click()
    )
    assert.match(view.container.textContent, /Última ocorrência/)
    assert.doesNotMatch(view.container.textContent, /Acompanhamentos indisponíveis/)
  } finally {
    await view.close()
    Object.assign(api, original)
    cache.clearOverview()
  }
})

test("refresh preserva snapshot em loading e erro; 401 de leitura segue tratamento global", async () => {
  const token = "summary-stale"
  cache.updateOverview(token, { trackers: [tracker] })
  const original = api.listTrackers
  let finish,
    current,
    unauthorized = 0
  api.listTrackers = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  function Probe() {
    current = useTrackers({ token, onUnauthorized })
    return React.createElement(Card, {
      ...cardProps,
      trackers: current.byObjective[4] || [],
      trackersLoaded: current.loaded,
      trackersLoading: current.loading,
      trackersError: current.error,
    })
  }
  function onUnauthorized(result) {
    if (result.status === 401) unauthorized++
    return result.status === 401
  }
  const view = await mount(Probe, {})
  try {
    assert.doesNotMatch(view.container.textContent, /Atualizando acompanhamentos|Dados anteriores/)
    assert.match(view.container.textContent, /Última ocorrência/)
    await act(async () => finish({ ok: false, status: 503, data: { message: "Falha temporária" } }))
    assert.doesNotMatch(view.container.textContent, /Exibindo dados anteriores/)
    assert.match(view.container.textContent, /Última ocorrência/)
    assert.doesNotMatch(view.container.textContent, /Uma direção pode começar sem vínculos/)
    await act(async () => {
      void current.refresh()
    })
    await act(async () => finish({ ok: false, status: 401 }))
    assert.equal(unauthorized, 1)
  } finally {
    await view.close()
    api.listTrackers = original
    cache.clearOverview()
  }
})

test("Home seleciona apenas direções ativas; pausadas continuam no módulo", () => {
  assert.deepEqual(
    selectHomeObjectives([
      { ...objetivo, id: 5, status: "pausado" },
      objetivo,
      { ...objetivo, id: 6, status: "concluido" },
    ]).map((item) => item.id),
    [4]
  )
})

test("síntese enxerga a ocorrência de hoje mesmo quando a lista agrupa a série", async () => {
  const { groupObjectiveTasks } = await load("features/objectives/hooks/useObjectiveTasks.ts")
  const now = new Date("2026-09-25T12:00:00Z")
  const recurring = {
    id: 1,
    titulo: "Caminhar",
    objetivo_id: 4,
    status: "PENDENTE",
    status_code: "PENDENTE",
    prazo: "24-09-2026",
    recurrence: { series_id: 7, weekdays: [0, 1, 2, 3, 4, 5, 6] },
  }
  const tasks = [recurring, { ...recurring, id: 2, prazo: "25-09-2026" }]
  assert.equal(groupObjectiveTasks(tasks)[4].length, 1)
  const summary = groupObjectiveTasks(tasks, false)[4]
  assert.equal(summary.length, 2)
  assert.equal(
    summarizeObjective({ objetivo, tasks: summary, timezone: user.timezone, now })[0].detail,
    "Prevista para hoje"
  )
  assert.equal(
    summarizeObjective({ objetivo, tasks: [recurring], timezone: user.timezone, now })[0].detail,
    "Tarefa recorrente em aberto"
  )
})

test("sem sinais há orientação; erro não afirma vazio e prazo permanece com dois sinais", async () => {
  const empty = await mount(Card, { ...cardProps, objetivo: { ...objetivo, descricao: null } })
  try {
    assert.match(empty.container.textContent, /Uma direção pode começar sem vínculos/)
    assert.ok(empty.container.querySelector("summary"))
  } finally {
    await empty.close()
  }
  const failed = await mount(Card, {
    ...cardProps,
    trackersLoaded: false,
    trackersError: "Falha na leitura",
  })
  try {
    assert.doesNotMatch(failed.container.textContent, /Ainda sem sinais|Nenhum acompanhamento/)
    assert.match(failed.container.textContent, /Acompanhamentos indisponíveis/)
  } finally {
    await failed.close()
  }
  const populated = await mount(Card, {
    ...cardProps,
    objetivo: { ...objetivo, data_alvo: "2026-10-30" },
    trackers: [tracker],
    tasks: [{ id: 1, titulo: "Caminhar", status_code: "PENDENTE" }],
  })
  try {
    assert.match(populated.container.querySelector("header").textContent, /Data-alvo: 30\/10\/2026/)
    assert.equal(
      populated.container.querySelector('[aria-label="Resumo de Cuidar da saúde"]').children.length,
      2
    )
    assert.equal(populated.container.querySelector("article > details").open, false)
    populated.container.querySelector("summary").click()
    assert.equal(populated.container.querySelector("article > details").open, true)
    assert.ok(populated.container.querySelector('[aria-label="Vínculos de Cuidar da saúde"]'))
  } finally {
    await populated.close()
  }
})

test("descrição extensa expande sem esconder ou abrir a operação do objetivo", async () => {
  const view = await mount(Card, { ...cardProps, trackers: [tracker] })
  try {
    const description = view.container.querySelector("header p")
    Object.defineProperties(description, {
      scrollHeight: { configurable: true, value: 240 },
      clientHeight: { configurable: true, value: 72 },
    })
    await act(async () => window.dispatchEvent(new window.Event("resize")))
    const toggle = [...view.container.querySelectorAll("button")].find(
      (button) => button.textContent === "Ler descrição completa"
    )
    assert.ok(toggle)
    assert.equal(toggle.getAttribute("aria-controls"), description.id)
    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute("aria-expanded"), "true")
    assert.equal(toggle.textContent, "Recolher descrição")
    assert.equal(view.container.querySelector("article > details").open, false)
    assert.match(
      view.container.querySelector('[aria-label="Resumo de Cuidar da saúde"]').textContent,
      /Última ocorrência/
    )
    await act(async () => toggle.click())
    assert.equal(toggle.getAttribute("aria-expanded"), "false")
  } finally {
    await view.close()
  }
})
