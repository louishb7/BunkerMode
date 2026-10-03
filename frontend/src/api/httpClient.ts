import { API_CONFIG_ERROR, API_URL } from "./config"
import {
  getApiAvailability,
  notifyApiSuccess,
  setApiAvailability,
} from "../offline/apiAvailability"
import { REFRESH_KEY, TOKEN_KEY } from "../constants/session"

const REQUEST_TIMEOUT_MS = 30000
const pendingReads = new Map<string, Promise<ApiResult>>()
let refreshPromise: Promise<ApiResult<{ access_token: string; refresh_token: string }>> | null =
  null
let sessionUpgradePromise: Promise<void> | null = null

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

async function parseResponse<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 204) {
    return { ok: true, status: 204, data: null }
  }

  try {
    const data = await response.json()
    return response.ok
      ? { ok: true, status: response.status, data }
      : { ok: false, status: response.status, data }
  } catch {
    if (response.ok) {
      return { ok: true, status: response.status, data: null }
    }

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
  const key = `${token ?? ""}:${path}`
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
  recover = true
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
  if (method !== "GET" && !authenticationAction && getApiAvailability() === "unavailable") {
    return { ok: false, status: 0, data: { message: "Esta ação exige conexão com a API." } }
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setApiAvailability("unavailable")
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
    setApiAvailability(response.status >= 500 ? "unavailable" : "available")
    if (response.ok && path !== "/usuarios/me") notifyApiSuccess()
    if (response.ok && recover && !authenticationAction && !hasRefreshSession()) {
      void ensurePersistentSession().catch(() => {})
    }
    if (response.status === 401 && recover && !authenticationAction && hasRefreshSession()) {
      const currentToken = window.localStorage.getItem(TOKEN_KEY)
      if (currentToken && currentToken !== effectiveToken) {
        return performRequest<T>(path, { token: currentToken, method, body, timeoutMs }, false)
      }
      const refreshed = await rotateSession()
      if (refreshed.ok) {
        return performRequest<T>(
          path,
          { token: refreshed.data.access_token, method, body, timeoutMs },
          false
        )
      }
      if (refreshed.status === 0 || refreshed.status >= 500) return refreshed as ApiResult<T>
    }
    return parseResponse<T>(response)
  } catch (error: any) {
    setApiAvailability("unavailable")
    if (error?.name === "AbortError") {
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
  }
}
