import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import ts from "typescript"

const validationExports = {}
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../src/features/auth/authValidation.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  { exports: validationExports }
)

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function authHarness(api, stored = {}) {
  const values = []
  const clearedOwners = []
  let retryListener
  let index = 0
  let effects = []
  let cleanups = []
  const localStorage = storage(stored)
  const sessionStorage = storage()
  const react = {
    useState(initial) {
      const slot = index++
      if (!(slot in values)) values[slot] = typeof initial === "function" ? initial() : initial
      return [
        values[slot],
        (next) => {
          values[slot] = typeof next === "function" ? next(values[slot]) : next
        },
      ]
    },
    useRef(initial) {
      const slot = index++
      values[slot] ??= { current: initial }
      return values[slot]
    },
    useCallback: (callback) => callback,
    useEffect(callback) {
      effects.push(callback)
    },
  }
  const exports = {}
  const source = readFileSync(
    new URL("../src/features/auth/hooks/useAuthSession.ts", import.meta.url),
    "utf8"
  )
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports,
      window: { localStorage, sessionStorage, addEventListener() {}, removeEventListener() {} },
      require(path) {
        if (path === "react") return react
        if (path.endsWith("authValidation")) return validationExports
        if (path.endsWith("bunkermodeApi")) return { api }
        if (path.endsWith("overviewCache")) return { clearOverview: () => {} }
        if (path.endsWith("financeCache")) return { clearFinanceSnapshots: () => {} }
        if (path.endsWith("orientationCache")) return { clearOrientationCache: () => {} }
        if (path.endsWith("offline/snapshots")) return { allowUserData: () => {}, clearUserData: async (id) => { clearedOwners.push(id) } }
        if (path.endsWith("offline/apiAvailability")) return { getApiAvailability: () => "available", subscribeApiAvailability: () => () => {}, subscribeApiRetry: (listener) => { retryListener = listener; return () => { retryListener = undefined } }, subscribeApiSuccess: () => () => {} }
        if (path.endsWith("focusSession")) return { focusStorageKey: (id) => `focus:${id}`, durationStorageKey: (id) => `duration:${id}` }
        if (path.endsWith("offline/outbox")) return { activateOutbox: () => {}, getReplayOwner: () => null, syncOutbox: async () => {} }
        if (path.endsWith("/session")) {
          return { TOKEN_KEY: "bunkermode_token", USER_KEY: "bunkermode_usuario", REFRESH_KEY: "bunkermode_refresh_token" }
        }
        if (path.endsWith("uiState")) return { emptyStatus: { type: "", message: "" } }
        if (path.endsWith("httpClient")) {
          return { getErrorMessage: (result, fallback) => result.data?.message || fallback, hasRefreshSession: () => false, ensurePersistentSession: async () => {}, revokePersistentSession: async () => {} }
        }
        throw new Error(path)
      },
    }
  )

  const render = () => {
    index = 0
    effects = []
    return exports.useAuthSession()
  }
  return {
    clearedOwners,
    localStorage,
    render,
    reconnect() {
      render()
      effects.at(-1)?.()
      retryListener?.()
    },
    restore() {
      cleanups.forEach((cleanup) => cleanup?.())
      render()
      cleanups = effects.map((effect) => effect?.())
    },
    unmount() {
      cleanups.forEach((cleanup) => cleanup?.())
    },
  }
}

const cachedUser = {
  id: 1,
  usuario: "cache",
  enabled_modules: ["tasks"],
  timezone: "America/Recife",
}

const updatedUser = {
  ...cachedUser,
  usuario: "servidor",
  enabled_modules: ["objectives"],
}

function storedSession() {
  return {
    bunkermode_token: "token-antigo",
    bunkermode_usuario: JSON.stringify(cachedUser),
  }
}

test("restore com token sempre revalida /usuarios/me e substitui usuário e módulos em cache", async () => {
  const calls = []
  const harness = authHarness(
    {
      getCurrentUser: async (token) => {
        calls.push(token)
        return { ok: true, status: 200, data: updatedUser }
      },
    },
    storedSession()
  )

  assert.equal(harness.render().booting, true)
  assert.equal(harness.render().authenticated, false)
  harness.restore()
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, ["token-antigo"])
  assert.equal(harness.render().authenticated, true)
  assert.equal(harness.render().user.usuario, "servidor")
  assert.deepEqual(Array.from(harness.render().user.enabled_modules), ["objectives"])
  assert.equal(JSON.parse(harness.localStorage.getItem("bunkermode_usuario")).usuario, "servidor")
})

test("401 no restore limpa credenciais pelo fluxo global", async () => {
  const harness = authHarness(
    { getCurrentUser: async () => ({ ok: false, status: 401, data: {} }) },
    storedSession()
  )
  harness.restore()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(harness.localStorage.getItem("bunkermode_token"), null)
  assert.equal(harness.localStorage.getItem("bunkermode_usuario"), null)
  assert.equal(harness.render().authenticated, false)
  assert.equal(harness.render().authStatus.message, "Sessão expirada. Faça login novamente.")
})

for (const result of [
  { ok: false, status: 500, data: { message: "Falha interna" } },
  { ok: false, status: 0, data: { message: "Sem conexão" } },
  { ok: false, status: 0, data: { message: "A API demorou demais para responder." } },
]) {
  test(`erro ${result.status}: ${result.data.message} preserva credenciais em sessão local`, async () => {
    const harness = authHarness({ getCurrentUser: async () => result }, storedSession())
    harness.restore()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(harness.localStorage.getItem("bunkermode_token"), "token-antigo")
    assert.equal(JSON.parse(harness.localStorage.getItem("bunkermode_usuario")).usuario, "cache")
    assert.equal(harness.render().authenticated, true)
    assert.equal(harness.render().sessionMode, "local")
    assert.equal(harness.render().booting, false)
    assert.equal(harness.render().authStatus.message, "")
  })
}

test("reconexão valida usuário atualizado depois de sessão local", async () => {
  let calls = 0
  const harness = authHarness({ getCurrentUser: async () => ++calls === 1
    ? { ok: false, status: 0, data: { message: "Sem conexão" } }
    : { ok: true, status: 200, data: updatedUser } }, storedSession())
  harness.restore()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.render().sessionMode, "local")
  harness.reconnect()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.render().sessionMode, "online")
  assert.equal(harness.render().user.usuario, "servidor")
  assert.equal(calls, 2)
})

test("401 após reconexão encerra sessão local e preserva snapshots/outbox do usuário", async () => {
  let calls = 0
  const harness = authHarness({ getCurrentUser: async () => ++calls === 1
    ? { ok: false, status: 0, data: { message: "Sem conexão" } }
    : { ok: false, status: 401, data: {} } }, storedSession())
  harness.restore()
  await new Promise((resolve) => setImmediate(resolve))
  harness.reconnect()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.render().authenticated, false)
  assert.equal(harness.localStorage.getItem("bunkermode_token"), null)
  assert.deepEqual(harness.clearedOwners, [])
})

test("logout voluntário mantém descarte explícito; login de outra conta não apaga dados da anterior", async () => {
  const newUser = { ...updatedUser, id: 2, usuario: "outra-conta" }
  const harness = authHarness({ login: async () => ({ ok: true, data: { access_token: "outro-token", usuario: newUser } }) }, storedSession())
  await harness.render().clearSession(true)
  assert.deepEqual(harness.clearedOwners, [1])
  await harness.render().login({ email: "outra@bunker.local", senha: "senha" })
  assert.equal(harness.render().user.id, 2)
  assert.deepEqual(harness.clearedOwners, [1])
})

test("invalidação preserva dados; mesma conta pode voltar e outra conta só ativa seu próprio dono", async () => {
  let currentUser = updatedUser
  const harness = authHarness({ login: async () => ({ ok: true, data: { access_token: "novo-token", usuario: currentUser } }) }, storedSession())
  await harness.render().clearSession()
  assert.deepEqual(harness.clearedOwners, [])
  await harness.render().login({ email: "mesma@bunker.local", senha: "senha" })
  assert.equal(harness.render().user.id, 1)
  await harness.render().clearSession()
  currentUser = { ...updatedUser, id: 2 }
  await harness.render().login({ email: "outra@bunker.local", senha: "senha" })
  assert.equal(harness.render().user.id, 2)
  assert.deepEqual(harness.clearedOwners, [])
})

test("logout durante restore impede resposta antiga de ressuscitar a sessão", async () => {
  const pending = deferred()
  const harness = authHarness({ getCurrentUser: () => pending.promise }, storedSession())
  harness.restore()
  harness.render().clearSession()
  pending.resolve({ ok: true, status: 200, data: updatedUser })
  await pending.promise
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(harness.render().authenticated, false)
  assert.equal(harness.localStorage.getItem("bunkermode_token"), null)
  assert.equal(harness.localStorage.getItem("bunkermode_usuario"), null)
})

test("login novo durante restore não é sobrescrito pela resposta antiga", async () => {
  const restore = deferred()
  const newUser = { ...updatedUser, id: 2, usuario: "novo-login" }
  const harness = authHarness(
    {
      getCurrentUser: () => restore.promise,
      login: async () => ({
        ok: true,
        status: 200,
        data: { access_token: "token-novo", usuario: newUser },
      }),
    },
    storedSession()
  )
  harness.restore()
  await harness.render().login({ email: "novo@bunker.local", senha: "senha" })
  restore.resolve({ ok: true, status: 200, data: updatedUser })
  await restore.promise
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(harness.render().token, "token-novo")
  assert.equal(harness.render().user.usuario, "novo-login")
  assert.equal(harness.localStorage.getItem("bunkermode_token"), "token-novo")
  assert.equal(JSON.parse(harness.localStorage.getItem("bunkermode_usuario")).usuario, "novo-login")
})

test("desmontagem e segunda inicialização invalidam restores anteriores", async () => {
  const pending = [deferred(), deferred()]
  let request = 0
  const harness = authHarness({ getCurrentUser: () => pending[request++].promise }, storedSession())
  harness.restore()
  harness.restore()
  pending[0].resolve({ ok: false, status: 401, data: {} })
  pending[1].resolve({ ok: true, status: 200, data: updatedUser })
  await Promise.all(pending.map((item) => item.promise))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(harness.render().user.usuario, "servidor")

  const lastUser = harness.render().user
  harness.unmount()
  assert.equal(harness.render().user, lastUser)
})

test("desmontagem ignora a resposta ainda pendente do restore", async () => {
  const pending = deferred()
  const harness = authHarness({ getCurrentUser: () => pending.promise }, storedSession())
  harness.restore()
  harness.unmount()
  pending.resolve({ ok: true, status: 200, data: updatedUser })
  await pending.promise
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(harness.render().user.usuario, "cache")
  assert.deepEqual(Array.from(harness.render().user.enabled_modules), ["tasks"])
})
