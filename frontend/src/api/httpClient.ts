import { API_CONFIG_ERROR, API_URL } from "./config"
import { getApiAvailability, setApiAvailability } from "../offline/apiAvailability"
import { REFRESH_KEY, TOKEN_KEY, USER_KEY } from "../constants/session"

const REQUEST_TIMEOUT_MS = 30000
const pendingReads = new Map<string, Promise<ApiResult>>()
let refreshPromise: Promise<ApiResult<{ access_token: string; refresh_token: string }>> | null =
  null
let sessionUpgradePromise: Promise<void> | null = null

type Diagnostic = {
  sequence: number
  at: string
  path: string
  method: string
  durationMs: number
  status: number
  failure?: "timeout" | "transport" | "stale"
  sessionMode?: "online" | "local" | "none"
  availabilityBefore: ReturnType<typeof getApiAvailability>
  availabilityAfter: ReturnType<typeof getApiAvailability>
}
const diagnostics: Diagnostic[] = []
let diagnosticSequence = 0
let healthPromise: Promise<boolean> | null = null
let healthGeneration = 0
let healthController: AbortController | null = null
if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    healthGeneration++
    healthController?.abort()
    healthPromise = null
  })
}

export function recordSessionMode(sessionMode: "online" | "local" | "none") {
  recordRequest({
    path: "/usuarios/me",
    method: "SESSION",
    status: 0,
    durationMs: 0,
    sessionMode,
    availabilityBefore: getApiAvailability(),
  })
}

export function getApiDiagnostics() {
  return diagnostics.map((event) => ({ ...event }))
}

function recordRequest(event: Omit<Diagnostic, "sequence" | "at" | "availabilityAfter">) {
  // Só templates de endpoints conhecidos: sem query, IDs, corpos ou credenciais.
  const path = event.path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id")
  const safePath =
    /^\/(auth|usuarios|tarefas|objetivos|acompanhamentos|financas|offline|health)(\/|$)/.test(
      path
    ) &&
    path
      .split("/")
      .filter(Boolean)
      .every((segment) =>
        [
          "auth",
          "usuarios",
          "tarefas",
          "objetivos",
          "acompanhamentos",
          "financas",
          "offline",
          "health",
          "database",
          "login",
          "register",
          "forgot-password",
          "reset-password",
          "session",
          "refresh",
          "logout",
          "me",
          "modulos",
          "dia-operacional",
          "foco",
          "recorrencias",
          "materializar",
          "concluir",
          "reabrir",
          "toggle-pin",
          "historico",
          "vincular-objetivo",
          "desvincular-objetivo",
          "conquistas",
          "conquistar",
          "status",
          "ordem",
          "ocorrencias",
          "lancamentos",
          "operations",
          ":id",
        ].includes(segment)
      )
      ? path
      : "/other"
  diagnostics.push({
    ...event,
    path: safePath,
    sequence: ++diagnosticSequence,
    at: new Date().toISOString(),
    availabilityAfter: getApiAvailability(),
  })
  if (diagnostics.length > 200) diagnostics.shift()
}

export function checkApiHealth(): Promise<boolean> {
  if (healthPromise) return healthPromise
  if (navigator.onLine === false || !API_URL || API_CONFIG_ERROR) return Promise.resolve(false)
  const generation = healthGeneration
  healthPromise = (async () => {
    const controller = new AbortController()
    healthController = controller
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    const started = Date.now()
    const before = getApiAvailability()
    let status = 0
    let failure: Diagnostic["failure"]
    try {
      const response = await fetch(`${API_URL}/health/database`, {
        signal: controller.signal,
        cache: "no-store",
      })
      status = response.status
      const data = await response.json()
      const ready = response.ok && data?.status === "ok" && data?.database === "ok"
      if (generation !== healthGeneration) return false
      setApiAvailability(
        navigator.onLine === false ? "unknown" : ready ? "available" : "unavailable"
      )
      return ready
    } catch (error: unknown) {
      failure =
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError"
          ? "timeout"
          : "transport"
      if (generation === healthGeneration)
        setApiAvailability(navigator.onLine === false ? "unknown" : "unavailable")
      return false
    } finally {
      window.clearTimeout(timer)
      recordRequest({
        path: "/health/database",
        method: "GET",
        status,
        failure,
        durationMs: Date.now() - started,
        availabilityBefore: before,
      })
    }
  })().finally(() => {
    if (generation === healthGeneration) {
      healthPromise = null
      healthController = null
    }
  })
  return healthPromise
}

function checkApiHealthInBackground() {
  void checkApiHealth().catch(() => {})
}

export function hasRefreshSession() {
  return Boolean(window.localStorage.getItem(REFRESH_KEY))
}

async function rotateSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const rotate = async (): Promise<
        ApiResult<{ access_token: string; refresh_token: string }>
      > => {
        const credential = window.localStorage.getItem(REFRESH_KEY)
        if (!credential) return { ok: false, status: 401, data: { message: "Sessão ausente." } }
        const result = await performRequest<{ access_token: string; refresh_token: string }>(
          "/auth/refresh",
          { method: "POST", body: { refresh_token: credential } },
          false
        )
        if (
          result.ok &&
          (typeof result.data.access_token !== "string" ||
            typeof result.data.refresh_token !== "string")
        ) {
          return { ok: false, status: 0, data: { message: "Resposta de sessão inválida." } }
        }
        if (result.ok && credential === window.localStorage.getItem(REFRESH_KEY)) {
          window.localStorage.setItem(TOKEN_KEY, result.data.access_token)
          window.localStorage.setItem(REFRESH_KEY, result.data.refresh_token)
          window.dispatchEvent(new Event("bunkermode-token-refreshed"))
        }
        if (
          !result.ok &&
          result.status === 401 &&
          credential !== window.localStorage.getItem(REFRESH_KEY)
        ) {
          return {
            ok: true,
            status: 200,
            data: {
              access_token: window.localStorage.getItem(TOKEN_KEY) || "",
              refresh_token: window.localStorage.getItem(REFRESH_KEY) || "",
            },
          }
        }
        return result
      }
      if (navigator.locks) return navigator.locks.request("bunkermode-refresh", rotate)
      return rotate()
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function ensurePersistentSession() {
  if (hasRefreshSession() || navigator.onLine === false) return
  if (!sessionUpgradePromise) {
    sessionUpgradePromise = (async () => {
      const upgrade = async () => {
        if (hasRefreshSession()) return
        const token = window.localStorage.getItem(TOKEN_KEY)
        if (!token) return
        const result = await performRequest<{ refresh_token: string }>(
          "/auth/session",
          { method: "POST", token },
          false
        )
        if (
          result.ok &&
          typeof result.data.refresh_token === "string" &&
          token === window.localStorage.getItem(TOKEN_KEY)
        ) {
          window.localStorage.setItem(REFRESH_KEY, result.data.refresh_token)
        }
      }
      if (navigator.locks) await navigator.locks.request("bunkermode-session-upgrade", upgrade)
      else await upgrade()
    })().finally(() => {
      sessionUpgradePromise = null
    })
  }
  return sessionUpgradePromise
}

export async function revokePersistentSession() {
  const credential = window.localStorage.getItem(REFRESH_KEY)
  if (credential && navigator.onLine !== false) {
    await performRequest(
      "/auth/logout",
      { method: "POST", body: { refresh_token: credential } },
      false
    )
  }
}

export type ApiErrorData = {
  message?: string
  [key: string]: unknown
}

export type ApiResult<T = any> =
  | {
      ok: true
      status: number
      data: T
    }
  | {
      ok: false
      status: number
      data: ApiErrorData
    }

export type RequestOptions = {
  token?: string | null
  method?: string
  body?: unknown
  timeoutMs?: number
}

function currentSessionOwner(): number | null {
  try {
    const id = JSON.parse(window.localStorage.getItem(USER_KEY) || "null")?.id
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

const sessionChanged = (): ApiResult<never> => ({
  ok: false,
  status: 0,
  data: { message: "A sessão mudou durante a operação." },
})

async function parseResponse<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 204) {
    return { ok: true, status: 204, data: null }
  }

  try {
    const data = await response.json()
    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, data }
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
    )
      throw error
    return {
      ok: false,
      status: response.status,
      data: { message: "Resposta inválida ou vazia do servidor." },
    }
  }
}

export function getErrorMessage(result: ApiResult | null | undefined, fallback: string): string {
  if (result?.status === 0) {
    return result.data?.message === "Esta ação exige conexão com a API."
      ? result.data.message
      : "Não foi possível conectar à API."
  }
  const message = result?.data?.message
  return typeof message === "string" ? message : fallback
}

export function request<T = any>(
  path: string,
  { token, method = "GET", body, timeoutMs }: RequestOptions = {}
): Promise<ApiResult<T>> {
  if (method !== "GET") return performRequest<T>(path, { token, method, body, timeoutMs })
  const key = `${currentSessionOwner()}:${window.localStorage.getItem(TOKEN_KEY) || token || ""}:${timeoutMs ?? REQUEST_TIMEOUT_MS}:${path}`
  const pending = pendingReads.get(key)
  if (pending) return pending as Promise<ApiResult<T>>
  const result = performRequest<T>(path, { token, method, body, timeoutMs })
  pendingReads.set(key, result)
  void result.finally(() => {
    if (pendingReads.get(key) === result) pendingReads.delete(key)
  })
  return result
}

async function performRequest<T>(
  path: string,
  { token, method = "GET", body, timeoutMs }: RequestOptions,
  recover = true,
  expectedOwner = currentSessionOwner()
): Promise<ApiResult<T>> {
  const authenticationAction = [
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/auth/session",
    "/auth/refresh",
    "/auth/logout",
  ].includes(path)
  if (!authenticationAction && expectedOwner !== currentSessionOwner()) return sessionChanged()
  if (method !== "GET" && !authenticationAction && getApiAvailability() === "unavailable") {
    return { ok: false, status: 0, data: { message: "Esta ação exige conexão com a API." } }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, status: 0, data: { message: "Sem conexão com a API." } }
  }
  if (API_CONFIG_ERROR || !API_URL) {
    return {
      ok: false,
      status: 0,
      data: {
        message:
          API_CONFIG_ERROR ||
          "Configuração da API ausente. Defina a URL pública da API antes de usar o sistema.",
      },
    }
  }

  const started = Date.now()
  const availabilityBefore = getApiAvailability()
  let status = 0
  let failure: Diagnostic["failure"]
  let recorded = false
  const headers: Record<string, string> = {}
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS)

  if (body !== undefined) {
    headers["Content-Type"] = "application/json"
  }

  const effectiveToken = recover ? window.localStorage.getItem(TOKEN_KEY) || token : token
  if (effectiveToken) {
    headers.Authorization = `Bearer ${effectiveToken}`
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // Uma resposta antiga não autoriza reenviar o corpo com a sessão que a
    // substituiu, nem invalidar a conta atual ao receber um 401 da anterior.
    if (!authenticationAction && expectedOwner !== currentSessionOwner()) return sessionChanged()
    status = response.status
    const parsed = await parseResponse<T>(response)
    window.clearTimeout(timeoutId)
    recordRequest({ path, method, status, durationMs: Date.now() - started, availabilityBefore })
    recorded = true
    if (response.status >= 500 || response.status === 408 || getApiAvailability() !== "available") {
      checkApiHealthInBackground()
      if (!authenticationAction && expectedOwner !== currentSessionOwner()) return sessionChanged()
    }
    if (response.ok && recover && !authenticationAction && !hasRefreshSession()) {
      void ensurePersistentSession().catch(() => {})
    }
    if (response.status === 401 && recover && !authenticationAction && hasRefreshSession()) {
      const currentToken = window.localStorage.getItem(TOKEN_KEY)
      if (currentToken && currentToken !== effectiveToken) {
        return performRequest<T>(
          path,
          { token: currentToken, method, body, timeoutMs },
          false,
          expectedOwner
        )
      }
      const refreshed = await rotateSession()
      if (expectedOwner !== currentSessionOwner()) return sessionChanged()
      if (refreshed.ok) {
        // Um refresh compartilhado pode ter terminado após outra sessão entrar.
        // Só a credencial ainda armazenada pode autorizar o próximo envio.
        const refreshedToken = window.localStorage.getItem(TOKEN_KEY)
        if (!refreshedToken) return sessionChanged()
        return performRequest<T>(
          path,
          { token: refreshedToken, method, body, timeoutMs },
          false,
          expectedOwner
        )
      }
      if (
        refreshed.status === 0 ||
        refreshed.status === 408 ||
        refreshed.status === 429 ||
        refreshed.status >= 500
      )
        return refreshed as ApiResult<T>
    }
    return parsed
  } catch (error: unknown) {
    if (!authenticationAction && expectedOwner !== currentSessionOwner()) {
      failure = "stale"
      return sessionChanged()
    }
    failure =
      typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
        ? "timeout"
        : "transport"
    recordRequest({
      path,
      method,
      status,
      failure,
      durationMs: Date.now() - started,
      availabilityBefore,
    })
    recorded = true
    checkApiHealthInBackground()
    if (!authenticationAction && expectedOwner !== currentSessionOwner()) return sessionChanged()
    if (failure === "timeout") {
      return {
        ok: false,
        status: 0,
        data: { message: "A API demorou demais para responder. Tente novamente." },
      }
    }
    return {
      ok: false,
      status: 0,
      data: { message: "Não foi possível conectar à API." },
    }
  } finally {
    window.clearTimeout(timeoutId)
    if (!recorded)
      recordRequest({
        path,
        method,
        status,
        failure,
        durationMs: Date.now() - started,
        availabilityBefore,
      })
  }
}
