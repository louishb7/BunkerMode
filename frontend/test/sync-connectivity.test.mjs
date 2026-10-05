import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { after, beforeEach, test } from "node:test"
import vm from "node:vm"
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { JSDOM } from "jsdom"
import ts from "typescript"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator })
after(() => dom.window.close())
let mockFetch
function load(path, dependencies) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, { exports, window, navigator, AbortController, fetch: (...args) => mockFetch(...args), require: (name) => {
    assert(name in dependencies, name)
    return dependencies[name]
  } })
  return exports
}
const connectivity = load("../src/offline/useOnlineStatus.ts", { react: React })
const apiAvailability = load("../src/offline/apiAvailability.ts", {})
const availabilityHook = load("../src/offline/useApiAvailability.ts", { react: React, "./apiAvailability": apiAvailability })
const presentation = load("../src/offline/syncPresentation.ts", {})
let items = [], ownerId = 1, replayOwner = null
const itemListeners = new Set(), replayListeners = new Set()
const outbox = {
  subscribeOutbox: (owner, callback) => {
    const notify = () => callback(items.filter(item => item.ownerId === owner))
    itemListeners.add(notify)
    notify()
    return () => itemListeners.delete(notify)
  },
  getReplayOwner: () => replayOwner,
  subscribeReplay: (callback) => { replayListeners.add(callback); return () => replayListeners.delete(callback) },
}
const auth = { useAuth: () => ({ user: { id: ownerId }, sessionMode: "online" }) }
const context = load("../src/context/SyncStatusContext.tsx", {
  react: React, "./AuthContext": auth,
  "../offline/useApiAvailability": availabilityHook,
  "../offline/useOnlineStatus": connectivity,
  "../offline/outbox": outbox,
  "../offline/syncPresentation": presentation,
})
const icons = { X: () => null, CircleAlert: () => null, RefreshCw: () => null }
const { default: SyncLabel } = load("../src/components/system/SyncLabel.tsx", { react: React, "lucide-react": icons })
const { default: OutboxNotice } = load("../src/components/system/OutboxNotice.tsx", {
  react: React, "lucide-react": icons, "../../context/AuthContext": auth,
  "react-router-dom": { Link: ({to, ...props}) => React.createElement("a", {...props, href: to}) },
  "../../services/bunkermodeApi": { api: { getCurrentUser: async () => ({ok: true}) } },
  "../../context/SyncStatusContext": context,
  "../../offline/useApiAvailability": availabilityHook,
  "../../offline/outbox": outbox, "./SyncLabel": { __esModule: true, default: SyncLabel },
})
const { default: PwaBanners } = load("../src/components/system/PwaBanners.tsx", {
  react: React, "lucide-react": icons,
  "virtual:pwa-register": { registerSW: () => async () => {} },
  "../../context/SyncStatusContext": context,
  "../../pwa/installPolicy": load("../src/pwa/installPolicy.ts", {}),
})
const client = load("../src/api/httpClient.ts", {
  "./config": { API_URL: "http://localhost/api/v2", API_CONFIG_ERROR: "" },
  "../offline/apiAvailability": apiAvailability,
  "../constants/session": { TOKEN_KEY: "token", REFRESH_KEY: "refresh" },
})
function setOnline(online) { Object.defineProperty(navigator, "onLine", { configurable: true, value: online }) }
const op = (status = "pending", index = 1) => ({ ownerId: 1, operationId: String(index), domain: "task", action: "create", payload: {}, status })
beforeEach(() => {
  setOnline(true)
  items = []; ownerId = 1; replayOwner = null
  apiAvailability.setApiAvailability("available")
  window.localStorage.setItem("refresh", "test")
})
async function mount() {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const render = () => root.render(React.createElement(context.SyncStatusProvider, null,
    React.createElement(PwaBanners), React.createElement(OutboxNotice)))
  await act(async () => render())
  return { container,
    async update(callback) { await act(async () => { callback(); itemListeners.forEach(fn => fn()); replayListeners.forEach(fn => fn()); render() }) },
    async close() { await act(async () => root.unmount()); container.remove() },
  }
}
function assertNeutral(view) {
  assert.equal(view.container.querySelector('[data-sync-status]'), null)
  assert.doesNotMatch(view.container.textContent, /Aguardando sincronização|Alteração salva|alterações? locais|API indisponível/)
}

test("A/B: criação e mutações online permanecem sem texto durante a outbox e replay", async () => {
  const view = await mount()
  try {
    for (const action of ["create", "update", "complete", "reopen", "pin", "link", "unlink", "delete"]) {
      await view.update(() => { items = [{ ...op(), action }] })
      assertNeutral(view)
      await view.update(() => { items = [{ ...op("syncing"), action }]; replayOwner = 1 })
      assertNeutral(view)
      assert.equal(view.container.querySelector('summary'), null)
      await view.update(() => { items = []; replayOwner = null })
      assertNeutral(view)
      assert.equal(view.container.querySelector('summary'), null)
    }
  } finally { await view.close() }
})
test("C/G: offline usa indicador discreto e não mostra contagens técnicas", async () => {
  setOnline(false)
  apiAvailability.setApiAvailability("unavailable")
  const view = await mount()
  try {
    assert.equal(view.container.querySelector('[data-sync-status]').textContent, "Sem conexão")
    for (const count of [1, 4]) {
      await view.update(() => { items = Array.from({ length: count }, (_, i) => op("pending", i)) })
      assert.equal(view.container.querySelectorAll('[data-sync-status]').length, 1)
      assert.equal(view.container.querySelector('[data-sync-status]').textContent, "Sem conexão")
      assert.equal(view.container.querySelector('summary'), null)
      assert.doesNotMatch(view.container.textContent, /alteração|alterações|pendente/)
      assert.doesNotMatch(view.container.textContent, /API indisponível|Alteração salva|alterações? locais/)
    }
  } finally { await view.close() }
})
test("D: reconexão limpa falha anterior imediatamente, mantém pendências e não anuncia sucesso", async () => {
  setOnline(false); items = [op()]; apiAvailability.setApiAvailability("unavailable")
  const view = await mount()
  let retries = 0
  const stop = apiAvailability.subscribeApiRetry(() => retries++)
  try {
    assert.equal(view.container.querySelector('[data-sync-status]').dataset.syncStatus, "offline")
    await view.update(() => { setOnline(true); window.dispatchEvent(new window.Event("online")) })
    assert.equal(apiAvailability.getApiAvailability(), "unknown")
    assert.equal(retries, 1)
    assert.equal(items.length, 1)
    assertNeutral(view)
    await view.update(() => { replayOwner = 1 })
    assertNeutral(view)
    await view.update(() => { apiAvailability.setApiAvailability("available"); replayOwner = null; items = [] })
    assertNeutral(view)
  } finally { stop(); await view.close() }
})
test("E: network error, timeout e 5xx geram uma superfície; 4xx permitem resolução de domínio", async () => {
  items = [op(), op("pending", 2)]
  const view = await mount()
  try {
    for (const failure of ["network", "timeout", 500, 503]) {
      await view.update(() => apiAvailability.setApiAvailability("available"))
      mockFetch = async (_url, { signal }) => {
        if (failure === "network") throw new TypeError("Failed to fetch")
        if (failure === "timeout") return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "AbortError" }))))
        return Response.json({ message: "Falha temporária" }, { status: failure })
      }
      let result
      await act(async () => { result = await client.request("/offline/operations", { method: "POST", timeoutMs: 5 }) })
      assert.equal(result.status, typeof failure === "number" ? failure : 0)
      assert.equal(apiAvailability.getApiAvailability(), "unavailable")
      assert.equal(view.container.querySelectorAll('[data-sync-status]').length, 1)
      assert.equal(view.container.querySelector('[data-sync-status]').textContent, "Serviço temporariamente indisponível")
      assert.equal(items.every(item => item.status === "pending"), true)
      assert.doesNotMatch(view.container.textContent, /Aguardando sincronização|API indisponível|Alteração salva|alterações? locais/)
    }
    mockFetch = async () => Response.json({ message: "Conflito" }, { status: 409 })
    await act(async () => client.request("/usuarios/me"))
    assert.equal(apiAvailability.getApiAvailability(), "available")
    assertNeutral(view)
  } finally { await view.close() }
})
test("F: reload online com outbox pending ou syncing persistida e saúde desconhecida não avisa", async () => {
  for (const status of ["pending", "syncing"]) {
    items = [op(status)]; apiAvailability.setApiAvailability("unknown")
    for (let reload = 0; reload < 2; reload++) {
      const view = await mount()
      try { assertNeutral(view) } finally { await view.close() }
    }
  }
})
test("conflito e falha têm prioridade sobre offline, indisponibilidade e replay", async () => {
  const view = await mount()
  try {
    for (const online of [true, false]) {
      await view.update(() => {
        setOnline(online); window.dispatchEvent(new window.Event(online ? "online" : "offline"))
        apiAvailability.setApiAvailability("unavailable"); replayOwner = 1
        items = [op(), op("failed", 2), op("conflict", 3)]
      })
      assert.equal(view.container.querySelectorAll('[data-sync-status]').length, 1)
      assert.equal(view.container.querySelector('[data-sync-status]').dataset.syncStatus, "conflict")
      await view.update(() => { items = items.filter(item => item.status !== "conflict") })
      assert.equal(view.container.querySelector('[data-sync-status]').dataset.syncStatus, "failed")
    }
  } finally { await view.close() }
})
test("troca de usuário não apresenta pendências de outro dono", async () => {
  setOnline(false); items = [op()]
  const view = await mount()
  try {
    await view.update(() => { ownerId = 2 })
    assert.equal(view.container.querySelector('[data-sync-status]').textContent, "Sem conexão")
    assert.equal(view.container.querySelector('[aria-label="Revisar alterações locais"]'), null)
  } finally { await view.close() }
})


test("fila antiga pede ação sem confundir replay normal, offline ou falha", () => {
  const now = Date.parse("2026-10-05T18:00:00Z")
  const input = {items: [{...op(), createdAt: "2026-10-05T17:40:00Z"}], online: true, availability: "available", replaying: false, now}
  assert.equal(presentation.deriveSyncPresentation(input).state, "stalled")
  assert.equal(presentation.deriveSyncPresentation({...input, replaying: true}).state, "normal")
  assert.equal(presentation.deriveSyncPresentation({...input, online: false}).state, "offline")
  assert.equal(presentation.deriveSyncPresentation({...input, availability: "unavailable"}).state, "stalled")
  assert.equal(presentation.deriveSyncPresentation({...input, items: [op("failed")]}).state, "failed")
})
