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

test("núcleo permanece dominante e relações distinguem erro, carregamento e vazio", async () => {
  for (const state of [
    { trackersError: "Falha na consulta", trackersLoaded: false, expected: /Falha na consulta/ },
    { trackersLoading: true, trackersLoaded: false, expected: /Carregando relações/ },
    { trackersLoaded: true, expected: /Nenhuma relação ainda/ },
  ]) {
    const view = await mount(Card, { ...cardProps, ...state })
    try {
      assert.match(view.container.textContent, state.expected)
      assert.match(
        view.container.querySelector(".objective-nucleus").textContent,
        /Cuidar da saúde|Reorganizar hábitos/
      )
      if (state.trackersError || state.trackersLoading)
        assert.doesNotMatch(view.container.textContent, /Nenhuma relação ainda/)
    } finally {
      await view.close()
    }
  }
})

test("Home e Objetivos exibem o mesmo fato do acompanhamento", async () => {
  const original = { ...api }
  api.listObjetivos = async () => ({ ok: true, data: [objetivo] })
  api.listTrackers = async () => ({ ok: true, data: [tracker] })
  api.getOrientation = async () => ({
    ok: true,
    data: {
      tarefas: [],
      direcoes: [{ ...objetivo, trackers: [tracker], tasks: [] }],
      financeiro: null,
    },
  })
  const home = await mount(Home, { token: "shared", user, onUnauthorized: () => false })
  const page = await mount(ObjectivesPage, { token: "shared", user, onUnauthorized: () => false })
  try {
    assert.match(home.container.textContent, /Não fumar|Última ocorrência/)
    assert.match(
      page.container.querySelector(".objective-branch-list").textContent,
      /Não fumar|Última ocorrência/
    )
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
    assert.match(view.container.textContent, /Consulta indisponível/)
    assert.doesNotMatch(view.container.textContent, /Nenhuma relação ainda/)
    fail = false
    await act(async () =>
      [...view.container.querySelectorAll("button")]
        .find((b) => b.textContent === "Tentar novamente")
        .click()
    )
    assert.match(view.container.textContent, /Última ocorrência/)
    assert.doesNotMatch(view.container.textContent, /Consulta indisponível/)
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

test("árvore de vínculos expressa pertencimento e inspector fechado", async () => {
  const empty = await mount(Card, { ...cardProps, objetivo: { ...objetivo, descricao: null } })
  try {
    assert.match(empty.container.textContent, /Nenhuma relação ainda/)
  } finally {
    await empty.close()
  }
  const failed = await mount(Card, {
    ...cardProps,
    trackersLoaded: false,
    trackersError: "Falha na leitura",
  })
  try {
    assert.match(failed.container.textContent, /Falha na leitura/)
    assert.doesNotMatch(failed.container.textContent, /Nenhuma relação ainda/)
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
    assert.match(populated.container.textContent, /Data-alvo · 30\/10\/2026/)
    assert.equal(populated.container.querySelectorAll(".objective-branch").length, 2)
    assert.equal(populated.container.querySelector(".objective-branch details").open, false)
    populated.container.querySelector(".objective-branch summary").click()
    assert.equal(populated.container.querySelector(".objective-branch details").open, true)
    assert.ok(
      populated.container.querySelector('[aria-label="Relações do objetivo Cuidar da saúde"]')
    )
  } finally {
    await populated.close()
  }
})

test("descrição longa permanece legível no núcleo sem abrir inspector", async () => {
  const long = "Reorganizar hábitos. ".repeat(20)
  const view = await mount(Card, {
    ...cardProps,
    objetivo: { ...objetivo, descricao: long },
    trackers: [tracker],
  })
  try {
    assert.match(
      view.container.querySelector(".objective-description").textContent,
      /Reorganizar hábitos/
    )
    assert.equal(view.container.querySelector(".objective-branch details").open, false)
    assert.match(
      view.container.querySelector(".objective-branch-list").textContent,
      /Última ocorrência/
    )
  } finally {
    await view.close()
  }
})

test("composer mostra um tipo por vez, pesquisa existentes e permite criar", async () => {
  const { default: Composer } = await load(
    "features/objectives/components/ObjectiveLinkComposer.tsx"
  )
  const chosen = []
  const view = await mount(Composer, {
    objetivo,
    tasksEnabled: true,
    tasks: [
      { id: 1, titulo: "Ler livro", objetivo_id: null },
      { id: 2, titulo: "Outra tarefa", objetivo_id: null },
    ],
    trackers: [{ id: 3, titulo: "Não fumar", objetivo_id: null }],
    type: "task",
    search: "Ler",
    onType: (value) => chosen.push(value),
    onSearch: () => {},
    onCreateTask: () => chosen.push("criar tarefa"),
    onCreateTracker: () => chosen.push("criar acompanhamento"),
    onLinkTask: (item) => chosen.push(item.titulo),
    onLinkTracker: (item) => chosen.push(item.titulo),
  })
  try {
    assert.equal(view.container.querySelectorAll(".composer-options li").length, 1)
    assert.match(view.container.textContent, /Ler livro/)
    assert.doesNotMatch(view.container.textContent, /Não fumar|Outra tarefa/)
    await act(async () => view.container.querySelector(".composer-options button").click())
    await act(async () => view.container.querySelector(".composer-create button").click())
    await act(async () =>
      [...view.container.querySelectorAll('[role="tab"]')]
        .find((item) => item.textContent === "Acompanhamento")
        .click()
    )
    assert.deepEqual(chosen, ["Ler livro", "criar tarefa", "tracker"])
  } finally {
    await view.close()
  }
})
