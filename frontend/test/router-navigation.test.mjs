import assert from "node:assert/strict"
import { after, test } from "node:test"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation } from "react-router-dom"
import { JSDOM } from "jsdom"
import { createServer } from "vite"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
})
globalThis.window = dom.window
globalThis.document = dom.window.document

const { localStorage, sessionStorage } = dom.window

const vite = await createServer({
  appType: "custom",
  logLevel: "silent",
  root: new URL("..", import.meta.url).pathname,
  server: { middlewareMode: true },
})
const [{ default: App }, { AuthProvider }] = await Promise.all([
  vite.ssrLoadModule("/src/app/App.tsx"),
  vite.ssrLoadModule("/src/context/AuthContext.tsx"),
])

after(async () => {
  await vite.close()
})

const users = {
  both: {
    id: 1,
    usuario: "tester",
    email: "tester@bunker.local",
    enabled_modules: ["tasks", "objectives"],
    timezone: "America/Recife",
    created_at: "2026-09-08T12:00:00.000Z",
    updated_at: "2026-09-08T12:00:00.000Z",
    ativo: true,
  },
  tasks: null,
  objectives: null,
  none: null,
}
users.tasks = { ...users.both, enabled_modules: ["tasks"] }
users.objectives = { ...users.both, enabled_modules: ["objectives"] }
users.none = { ...users.both, enabled_modules: [] }

const flush = () => new Promise((resolve) => setImmediate(resolve))

function taskFixture(id, titulo, status = "PENDENTE") {
  return {
    id,
    titulo,
    instrucao: null,
    prioridade: 1,
    prazo: "09-09-2026",
    status,
    status_code: status,
    status_label: status === "PENDENTE" ? "Pendente" : status,
    is_pinned: false,
    created_at: "2026-09-08T12:00:00.000Z",
    updated_at: "2026-09-08T12:00:00.000Z",
    completed_at: status === "CONCLUIDA" ? "2026-09-09T12:00:00.000Z" : null,

    user_id: 1,
    responsavel_id: 1,
    criada_por_id: 1,
    objetivo_id: null,
    recurrence: null,
    permissions: {
      can_complete: true,
      can_delete: true,
      can_edit: true,

      can_pin: true,
      can_reopen: true,
      can_view_history: true,
    },
  }
}

async function navigate(path, user = null, preview = {}) {
  localStorage.clear()
  sessionStorage.clear()
  const calls = []
  if (user) {
    localStorage.setItem("bunkermode_token", "router-token")
    localStorage.setItem("bunkermode_usuario", JSON.stringify({ ...user, usuario: "cache" }))
  }

  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname
    calls.push(pathname)
    if (pathname.endsWith("/usuarios/me")) {
      return Response.json(user, { status: 200 })
    }
    if (pathname.endsWith("/tarefas/recorrencias/materializar")) {
      return new Response(null, { status: 204 })
    }
    if (pathname.endsWith("/tarefas/dia-operacional")) {
      return Response.json(preview.dailyTasks || [], { status: preview.dailyTasksStatus || 200 })
    }
    if (pathname.endsWith("/objetivos")) {
      return Response.json(preview.objectives || [], { status: preview.objectivesStatus || 200 })
    }
    return Response.json([], { status: 200 })
  }

  let currentPath = path
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  function LocationProbe() {
    currentPath = useLocation().pathname
    return null
  }

  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(
          AuthProvider,
          null,
          React.createElement(App),
          React.createElement(LocationProbe)
        )
      )
    )
    for (let index = 0; index < 6; index += 1) {
      await flush()
    }
  })

  const rendered = container.textContent ?? ""
  await act(async () => root.unmount())
  container.remove()
  return { calls, path: currentPath, rendered }
}

for (const path of ["/", "/tarefas", "/tarefas/foco", "/objetivos", "/configuracoes"]) {
  test(`não autenticado: ${path} redireciona para /auth`, async () => {
    const result = await navigate(path)
    assert.equal(result.path, "/auth")
    assert.match(result.rendered, /Entrar no Bunker/)
  })
}

for (const [path, marker] of [
  ["/", "Seu Bunker"],
  ["/tarefas", "Nova tarefa"],
  ["/tarefas/foco", "Modo Foco"],
  ["/objetivos", "Novo objetivo"],
  ["/configuracoes", "Aparência"],
]) {
  test(`autenticado com ambos: ${path} permanece acessível`, async () => {
    const result = await navigate(path, users.both)
    assert.equal(result.path, path)
    assert.match(result.rendered, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  })
}

test("Tasks desabilitado bloqueia /tarefas antes de montar TaskBoardProvider", async () => {
  for (const path of ["/tarefas", "/tarefas/foco"]) {
    const result = await navigate(path, users.objectives)
    assert.equal(result.path, "/")
    assert.equal(
      result.calls.some((call) => call.endsWith("/tarefas/recorrencias/materializar")),
      false
    )
  }
  assert.equal((await navigate("/objetivos", users.objectives)).path, "/objetivos")
})

test("Objectives desabilitado bloqueia /objetivos e mantém /tarefas", async () => {
  assert.equal((await navigate("/objetivos", users.tasks)).path, "/")
  assert.equal((await navigate("/tarefas", users.tasks)).path, "/tarefas")
})

test("com ambos desabilitados Home e Configurações permanecem acessíveis", async () => {
  assert.equal((await navigate("/", users.none)).path, "/")
  assert.equal((await navigate("/configuracoes", users.none)).path, "/configuracoes")
  assert.equal((await navigate("/tarefas", users.none)).path, "/")
  assert.equal((await navigate("/tarefas/foco", users.none)).path, "/")
  assert.equal((await navigate("/objetivos", users.none)).path, "/")
})

test("Home revela recortes independentes dos módulos habilitados", async () => {
  const result = await navigate("/", users.both, {
    dailyTasks: [
      taskFixture(1, "Preparar proposta"),
      taskFixture(2, "Revisar contrato"),
      taskFixture(3, "Organizar notas"),
      taskFixture(4, "Não deve aparecer"),
      taskFixture(5, "Tarefa concluída", "CONCLUIDA"),
    ],
    objectives: [
      { id: 1, titulo: "Construir portfólio", descricao: "Projetos publicados", status: "ativo" },
      { id: 2, titulo: "Estudar arquitetura", descricao: null, status: "pausado" },
      { id: 3, titulo: "Não deve aparecer", descricao: null, status: "ativo" },
      { id: 4, titulo: "Objetivo concluído", descricao: null, status: "concluido" },
      { id: 5, titulo: "Objetivo abandonado", descricao: null, status: "abandonado" },
    ],
  })

  for (const marker of [
    "Preparar proposta",
    "Revisar contrato",
    "Organizar notas",
    "Construir portfólio",
    "Projetos publicados",
    "Estudar arquitetura",


  ]) {
    assert.match(result.rendered, new RegExp(marker), JSON.stringify(result.calls))
  }
  for (const marker of ["Tarefa concluída", "Objetivo concluído", "Objetivo abandonado"]) {
    assert.doesNotMatch(result.rendered, new RegExp(marker))
  }
  assert.equal(result.rendered.match(/Não deve aparecer/g)?.length ?? 0, 0)
  assert.equal(result.calls.some((call) => call.endsWith("/tarefas/recorrencias/materializar")), true)
  assert.equal(result.calls.some((call) => call.endsWith("/tarefas/dia-operacional")), true)
  assert.equal(result.calls.some((call) => call.endsWith("/objetivos")), true)
})

test("Home consulta apenas os módulos habilitados e integra estados vazios", async () => {
  const tasksOnly = await navigate("/", users.tasks, { dailyTasks: [] })
  assert.match(tasksOnly.rendered, /Nenhuma tarefa aberta para hoje/)
  assert.equal(tasksOnly.calls.some((call) => call.endsWith("/tarefas/dia-operacional")), true)
  assert.equal(tasksOnly.calls.some((call) => call.endsWith("/objetivos")), false)

  const objectivesOnly = await navigate("/", users.objectives, { objectives: [] })
  assert.match(objectivesOnly.rendered, /Nenhum objetivo em andamento/)
  assert.equal(objectivesOnly.calls.some((call) => call.endsWith("/tarefas/dia-operacional")), false)
  assert.equal(objectivesOnly.calls.some((call) => call.endsWith("/tarefas/recorrencias/materializar")), false)
  assert.equal(objectivesOnly.calls.some((call) => call.endsWith("/objetivos")), true)

  const none = await navigate("/", users.none)
  assert.match(none.rendered, /Nenhuma ferramenta habilitada/)
  assert.match(none.rendered, /Configurações/)
  assert.equal(none.calls.some((call) => call.endsWith("/tarefas/dia-operacional")), false)
  assert.equal(none.calls.some((call) => call.endsWith("/objetivos")), false)
})

test("erro local de Tarefas preserva o recorte de Objetivos na Home", async () => {
  const result = await navigate("/", users.both, {
    dailyTasks: { message: "Tarefas indisponíveis" },
    dailyTasksStatus: 503,
    objectives: [{ id: 1, titulo: "Objetivo disponível", descricao: null, status: "ativo" }],
  })

  assert.match(result.rendered, /Tarefas indisponíveis/)
  assert.match(result.rendered, /Objetivo disponível/)
})

test("/auth autenticado redireciona para Home", async () => {
  assert.equal((await navigate("/auth", users.both)).path, "/")
})

test("/reset-password permanece público mesmo com sessão e não carrega módulos", async () => {
  for (const user of [undefined, users.both]) {
    const result = await navigate(`/reset-password#token=${"a".repeat(64)}`, user)
    assert.equal(result.path, "/reset-password")
    assert.match(result.rendered, /Criar nova senha/)
    assert.doesNotMatch(result.rendered, /Link inválido/)
    assert.equal(result.calls.some((call) => /tarefas|objetivos/.test(call)), false)
  }
})

test("rota desconhecida segue fallback genérico conforme autenticação", async () => {
  assert.equal((await navigate("/desconhecida")).path, "/auth")
  const authenticated = await navigate("/desconhecida", users.both)
  assert.equal(authenticated.path, "/")
  assert.equal(authenticated.calls.some((call) => call.endsWith("/tarefas/foco")), false)
})
