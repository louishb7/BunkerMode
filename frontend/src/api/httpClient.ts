import { API_CONFIG_ERROR, API_URL } from "./config"
import {
  getApiAvailability,
  notifyApiSuccess,
  setApiAvailability,
} from "../offline/apiAvailability"

const REQUEST_TIMEOUT_MS = 30000
const pendingReads = new Map<string, Promise<ApiResult>>()

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
  { token, method = "GET", body, timeoutMs }: RequestOptions
): Promise<ApiResult<T>> {
  const authenticationAction = [
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password",
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

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      signal: controller.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    setApiAvailability("available")
    if (response.ok && path !== "/usuarios/me") notifyApiSuccess()
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
