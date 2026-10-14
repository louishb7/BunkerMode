export type ApiAvailability = "unknown" | "available" | "unavailable"

let availability: ApiAvailability = "unknown"
const listeners = new Set<() => void>()
const retryListeners = new Set<() => void | Promise<unknown>>()
let recoveryTimer: number | undefined
let recoveryAttempt = 0
let recoveryRequested = false
let retryCycleRunning = false
let retryCycleQueued = false

function cancelRecovery() {
  if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
  recoveryTimer = undefined
}

function scheduleRecovery() {
  if (retryCycleRunning) return
  if (
    typeof window === "undefined" ||
    (availability !== "unavailable" && !recoveryRequested) ||
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
    if (navigator.onLine === false) return
    void runRecovery()
  }, delay)
}

function runRecovery() {
  if (navigator.onLine === false) return
  if (retryCycleRunning) {
    retryCycleQueued = true
    return
  }
  cancelRecovery()
  retryCycleRunning = true
  recoveryRequested = false
  const work = [...retryListeners].map((listener) => {
    try {
      return listener()
    } catch (error) {
      return Promise.reject(error)
    }
  })
  return Promise.allSettled(work).finally(() => {
    retryCycleRunning = false
    if (availability !== "unavailable" && !recoveryRequested) recoveryAttempt = 0
    if (retryCycleQueued && retryListeners.size && navigator.onLine !== false) {
      retryCycleQueued = false
      void runRecovery()
    } else scheduleRecovery()
  })
}

// Recuperação de sessão/comando independe de a API inteira estar indisponível.
export function requestApiRecovery() {
  recoveryRequested = true
  scheduleRecovery()
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
    if (!recoveryRequested) cancelRecovery()
    // Somente o fim do ciclo de recuperação, não sucesso de outra operação, reinicia o backoff.
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

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => {
    cancelRecovery()
    setApiAvailability("unavailable")
  })
  window.addEventListener("online", () => {
    // A nova conexão precisa ser verificada; a falha anterior não descreve sua saúde.
    setApiAvailability("unknown")
    void runRecovery()
  })
  const resume = () => {
    if (navigator.onLine === false || window.document.visibilityState === "hidden") return
    void runRecovery()
  }
  window.addEventListener("focus", resume)
  window.document.addEventListener("visibilitychange", resume)
  if (navigator.onLine === false) availability = "unavailable"
}
