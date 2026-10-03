export type ApiAvailability = "unknown" | "available" | "unavailable"

let availability: ApiAvailability = "unknown"
const listeners = new Set<() => void>()
const retryListeners = new Set<() => void>()
const successListeners = new Set<() => void>()

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
  if (availability === next) return
  availability = next
  listeners.forEach((listener) => listener())
}

export function subscribeApiRetry(listener: () => void) {
  retryListeners.add(listener)
  return () => {
    retryListeners.delete(listener)
  }
}

export function subscribeApiSuccess(listener: () => void) {
  successListeners.add(listener)
  return () => {
    successListeners.delete(listener)
  }
}

export function notifyApiSuccess() {
  successListeners.forEach((listener) => listener())
}

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => setApiAvailability("unavailable"))
  window.addEventListener("online", () => {
    // A nova conexão precisa ser verificada; a falha anterior não descreve sua saúde.
    setApiAvailability("unknown")
    retryListeners.forEach((listener) => listener())
  })
  if (navigator.onLine === false) availability = "unavailable"
}
