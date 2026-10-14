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

let navigationId = 0
async function navigate(path, user = null, preview = {}) {
  localStorage.clear()
  sessionStorage.clear()
  const calls = []
  if (user) {
    localStorage.setItem("bunkermode_token", `router-token-${++navigationId}`)
    localStorage.setItem("bunkermode_usuario", JSON.stringify({ ...user, usuario: "cache" }))
  }

  globalThis.fetch = async (url) => {
    const pathname = new URL(url).pathname
    calls.push(pathname)
    if (pathname.endsWith("/health/database")) return Response.json({status:"ok",database:"ok"})
    if (pathname.endsWith("/financas"))
      return Response.json({
        mes: "2026-09",
        saldo_centavos: 0,
        resultado_centavos: 0,
        serie_diaria: [],
        reservado_centavos: 0,
        livre_centavos: 0,
        receitas_centavos: 0,
        despesas_centavos: 0,
        lancamentos: [],
        reservas: [],
      })
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
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await flush()
  })
  for (let attempt = 0; attempt < 20 && container.querySelector(".route-loading"); attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })
  }

  const rendered = container.textContent ?? ""
  await act(async () => root.unmount())
  container.remove()
  return { calls, path: currentPath, rendered }
}

for (const path of [
  "/",
  "/tarefas",
  "/tarefas/foco",
  "/objetivos",
  "/configuracoes",
  "/financas",
]) {
  test(`não autenticado: ${path} redireciona para /auth`, async () => {
    const result = await navigate(path)
    assert.equal(result.path, "/auth")
    assert.match(result.rendered, /Entrar no Bunker/)
  })
}

for (const [path, marker] of [
  ["/", "Novo objetivo"],
  ["/tarefas", "Nova tarefa"],
  ["/tarefas/foco", "Modo Foco"],
  ["/objetivos", "Novo objetivo"],
  ["/configuracoes", "Aparência"],
]) {
  test(`autenticado com ambos: ${path} permanece acessível`, async () => {
    const result = await navigate(path, users.both)
    assert.equal(result.path, path === "/" ? "/objetivos" : path)
    assert.match(result.rendered, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  })
}

test("Tasks desabilitado bloqueia /tarefas antes de montar TaskBoardProvider", async () => {
  for (const path of ["/tarefas", "/tarefas/foco"]) {
    const result = await navigate(path, users.objectives)
    assert.equal(result.path, "/objetivos")
    assert.equal(
      result.calls.some((call) => call.endsWith("/tarefas/recorrencias/materializar")),
      false
    )
  }
  assert.equal((await navigate("/objetivos", users.objectives)).path, "/objetivos")
})

test("Objectives desabilitado bloqueia /objetivos e mantém /tarefas", async () => {
  assert.equal((await navigate("/objetivos", users.tasks)).path, "/tarefas")
  assert.equal((await navigate("/tarefas", users.tasks)).path, "/tarefas")
})

for (const [modules, expected] of [
  [["objectives", "tasks"], "/objetivos"], [["objectives"], "/objetivos"],
  [["tasks"], "/tarefas"], [["finances"], "/financas"], [[], "/configuracoes"],
  [["tasks", "finances"], "/tarefas"], [["objectives", "finances"], "/objetivos"],
  [["finances", "tasks", "objectives"], "/objetivos"],
]) test(`raiz resolve ${modules.join(",") || "nenhum"} sem depender de dados`, async () => {
  const result = await navigate("/", {...users.both, enabled_modules: modules})
  assert.equal(result.path, expected)
  assert.doesNotMatch(result.rendered, /Seu Bunker|Início/)
  assert.equal(result.calls.some(path=>path.endsWith("/orientacao")), false)
  if (!modules.includes("tasks")) assert.equal(result.calls.some(path=>/tarefas/.test(path)), false)
})

test("nenhum módulo leva à configuração; rotas desabilitadas não criam ciclos", async () => {
  for (const path of ["/", "/tarefas", "/tarefas/foco", "/objetivos", "/financas", "/configuracoes"]) {
    const result = await navigate(path, users.none)
    assert.equal(result.path, "/configuracoes")
    assert.match(result.rendered, /Módulos/)
    assert.equal(result.calls.some(path=>/tarefas|objetivos|financas/.test(path)), false)
  }
})

test("Objetivos vazio permite começar; tarefas só são lidas após preparar recorrências", async () => {
  const result = await navigate("/", users.both)
  assert.match(result.rendered, /Novo objetivo/)
  assert(result.calls.indexOf("/api/v2/tarefas/recorrencias/materializar") < result.calls.indexOf("/api/v2/tarefas"))
  assert.equal(result.calls.filter(path=>path.endsWith("/tarefas/recorrencias/materializar")).length,1)
})

test("Finanças respeita guard e habilitação independente", async () => {
  assert.equal((await navigate("/financas", users.both)).path, "/objetivos")
  const result = await navigate("/financas", { ...users.both, enabled_modules: ["finances"] })
  assert.equal(result.path, "/financas")
  assert.match(result.rendered, /Resultado do mês|Movimento/)
  assert.equal(
    result.calls.some((path) => /objetivos|tarefas/.test(path)),
    false
  )
})

test("/auth autenticado redireciona para Objetivos", async () => {
  assert.equal((await navigate("/auth", users.both)).path, "/objetivos")
})

test("/reset-password permanece público mesmo com sessão e não carrega módulos", async () => {
  for (const user of [undefined, users.both]) {
    const result = await navigate(`/reset-password#token=${"a".repeat(64)}`, user)
    assert.equal(result.path, "/reset-password")
    assert.match(result.rendered, /Criar nova senha/)
    assert.doesNotMatch(result.rendered, /Link inválido/)
    assert.equal(
      result.calls.some((call) => /tarefas|objetivos/.test(call)),
      false
    )
  }
})

test("rota desconhecida segue fallback genérico conforme autenticação", async () => {
  assert.equal((await navigate("/desconhecida")).path, "/auth")
  const authenticated = await navigate("/desconhecida", users.both)
  assert.equal(authenticated.path, "/objetivos")
  assert.equal(
    authenticated.calls.some((call) => call.endsWith("/tarefas/foco")),
    false
  )
})
