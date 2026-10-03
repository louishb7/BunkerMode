import { useSyncExternalStore } from "react"

function getOnlineStatus() {
  return navigator.onLine !== false
}

function subscribeOnlineStatus(listener: () => void) {
  window.addEventListener("online", listener)
  window.addEventListener("offline", listener)
  return () => {
    window.removeEventListener("online", listener)
    window.removeEventListener("offline", listener)
  }
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribeOnlineStatus, getOnlineStatus)
}
