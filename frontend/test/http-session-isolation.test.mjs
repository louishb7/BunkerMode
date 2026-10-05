import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function harness() {
  const storage = new Map(), calls = [], window = new EventTarget()
  Object.assign(window, {
    localStorage: { getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)) },
    setTimeout, clearTimeout,
  })
  let handler, availability = "available"
  const exports = {}
  vm.runInNewContext(ts.transpileModule(
    readFileSync(new URL("../src/api/httpClient.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText, { exports, window, navigator: { onLine: true }, Event, AbortController,
    fetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname, authorization: options.headers.Authorization,
        body: options.body && JSON.parse(options.body) })
      return handler(calls.at(-1))
    },
    require(path) {
      if (path === "./config") return { API_URL: "https://api.test", API_CONFIG_ERROR: "" }
      if (path === "../constants/session") return { TOKEN_KEY: "token", USER_KEY: "user", REFRESH_KEY: "refresh" }
      if (path === "../offline/apiAvailability") return {
        getApiAvailability: () => availability, setApiAvailability: (next) => { availability = next },
        notifyApiSuccess() {},
      }
      throw new Error(path)
    },
  })
  return { ...exports, calls, set handler(next) { handler = next },
    session(id, token, refresh) {
      storage.set("user", JSON.stringify({ id })); storage.set("token", token); storage.set("refresh", refresh)
    },
  }
}

test("401 de comando antigo nunca reenvia o corpo com credenciais de outra conta", async () => {
  const h = harness(), oldResponse = deferred()
  h.session(1, "account-one", "refresh-one")
  h.handler = () => h.calls.length === 1 ? oldResponse.promise : Response.json({ id: 99 })
  const body = { operationId: "one-local-intention", domain: "task", action: "create", payload: { titulo: "Privado" } }
  const pending = h.request("/offline/operations", { method: "POST", body })
  h.session(2, "account-two", "refresh-two")
  oldResponse.resolve(Response.json({ message: "Token expirado" }, { status: 401 }))
  const result = await pending
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].authorization, "Bearer account-one")
  assert.equal(result.ok, false)
  assert.notEqual(result.status, 401, "resposta da sessão antiga não deve invalidar a conta atual")
})

test("troca de conta durante refresh interrompe comando antigo antes de novo envio", async () => {
  const h = harness(), refreshResponse = deferred()
  h.session(1, "expired-one", "refresh-one")
  h.handler = ({ path }) => path === "/auth/refresh" ? refreshResponse.promise
    : Response.json({ message: "Token expirado" }, { status: 401 })
  const pending = h.request("/offline/operations", { method: "POST", body: { domain: "goal", action: "create" } })
  await new Promise(setImmediate)
  assert.equal(h.calls.length, 2)
  h.session(2, "account-two", "refresh-two")
  refreshResponse.resolve(Response.json({ access_token: "renewed-one", refresh_token: "rotated-one" }))
  const result = await pending
  assert.equal(h.calls.length, 2)
  assert.equal(result.ok, false)
  assert.notEqual(result.status, 401)
})

test("rotação da mesma conta preserva corpo e recupera autenticação", async () => {
  const h = harness()
  h.session(1, "expired", "refresh-one")
  h.handler = ({ path, authorization }) => path === "/auth/refresh"
    ? Response.json({ access_token: "renewed", refresh_token: "rotated" })
    : authorization === "Bearer expired" ? Response.json({}, { status: 401 }) : Response.json({ id: 3 })
  const body = { operationId: "unchanged", domain: "task", action: "complete", target: 3, payload: {} }
  const result = await h.request("/offline/operations", { method: "POST", body })
  assert.equal(result.ok, true)
  const commands = h.calls.filter(({ path }) => path === "/offline/operations")
  assert.equal(commands.length, 2)
  assert.deepEqual(commands[0].body, commands[1].body)
  assert.equal(commands[1].authorization, "Bearer renewed")
})

test("token atualizado da mesma conta pode recuperar comando sem refresh extra", async () => {
  const h = harness(), oldResponse = deferred()
  h.session(1, "expired", "refresh-one")
  h.handler = () => h.calls.length === 1 ? oldResponse.promise : Response.json({ id: 3 })
  const pending = h.request("/offline/operations", { method: "POST", body: { action: "create" } })
  h.session(1, "renewed", "refresh-one")
  oldResponse.resolve(Response.json({}, { status: 401 }))
  assert.equal((await pending).ok, true)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].authorization, "Bearer renewed")
})
