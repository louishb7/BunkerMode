import { useSyncExternalStore } from "react"
import { getApiAvailability, subscribeApiAvailability } from "./apiAvailability"

export function useApiAvailability() {
  return useSyncExternalStore(subscribeApiAvailability, getApiAvailability)
}
