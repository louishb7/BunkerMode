export type ApiAvailability = "unknown" | "available" | "unavailable"

let availability: ApiAvailability = "unknown"
const listeners = new Set<() => void>()
const retryListeners = new Set<() => void | Promise<unknown>>()
const successListeners = new Set<() => void>()
let recoveryTimer: number | undefined
let recoveryAttempt = 0

function cancelRecovery() {
  if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
  recoveryTimer = undefined
}

function scheduleRecovery() {
  if (
    typeof window === "undefined" ||
    availability !== "unavailable" ||
    navigator.onLine === false ||
    recoveryTimer !== undefined ||
    !retryListeners.size
  )
    return
  // Uma API pode voltar sem qualquer mudança em navigator.onLine.
  const baseDelay = Math.min(5_000 * 2 ** Math.min(recoveryAttempt++, 5), 120_000)
  const delay = Math.round(baseDelay * (0.85 + Math.random() * 0.3))
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = undefined
    if (availability !== "unavailable" || navigator.onLine === false) return
    void Promise.allSettled([...retryListeners].map((listener) => listener())).then(
      scheduleRecovery
    )
  }, delay)
}

export function getApiAvailability() {
  return availability
}

export function subscribeApiAvailability(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setApiAvailability(next: ApiAvailability) {
  if (next !== "unavailable") {
    cancelRecovery()
    // Um probe de autenticação saudável não prova que o comando voltou a funcionar.
    // Sucesso de uma operação/leitura de produto encerra o ciclo de backoff.
    if (next === "unknown") recoveryAttempt = 0
  }
  if (availability === next) {
    scheduleRecovery()
    return
  }
  availability = next
  listeners.forEach((listener) => listener())
  scheduleRecovery()
}

export function subscribeApiRetry(listener: () => void | Promise<unknown>) {
  retryListeners.add(listener)
  scheduleRecovery()
  return () => {
    retryListeners.delete(listener)
    if (!retryListeners.size) cancelRecovery()
  }
}

export function subscribeApiSuccess(listener: () => void) {
  successListeners.add(listener)
  return () => {
    successListeners.delete(listener)
  }
}

export function notifyApiSuccess() {
  recoveryAttempt = 0
  successListeners.forEach((listener) => listener())
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    cancelRecovery()
    setApiAvailability("unavailable")
  })
  window.addEventListener("online", () => {
    // A nova conexão precisa ser verificada; a falha anterior não descreve sua saúde.
    setApiAvailability("unknown")
    retryListeners.forEach((listener) => listener())
  })
  const resume = () => {
    if (navigator.onLine === false || window.document.visibilityState === "hidden") return
    cancelRecovery()
    retryListeners.forEach((listener) => listener())
    scheduleRecovery()
  }
  window.addEventListener("focus", resume)
  window.document.addEventListener("visibilitychange", resume)
  if (navigator.onLine === false) availability = "unavailable"
}
