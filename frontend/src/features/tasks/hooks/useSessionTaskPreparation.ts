import { useEffect } from "react"
import { api } from "../../../services/bunkermodeApi"
import { getEnabledModules } from "../../../modules/moduleCatalog"
import {
  getApiAvailability,
  requestApiRecovery,
  subscribeApiRetry,
} from "../../../offline/apiAvailability"

// O comando é do domínio Tarefas, independente da página inicial ou de Objetivos.
export function useSessionTaskPreparation({
  authenticated,
  booting,
  sessionMode,
  token,
  user,
  handleUnauthorized,
}) {
  const enabled = getEnabledModules(user).some((module) => module.key === "tasks")
  useEffect(() => {
    if (!authenticated || booting || sessionMode !== "online" || !enabled) return
    let live = true
    const prepare = async () => {
      if (navigator.onLine === false || getApiAvailability() === "unavailable") return
      const result = await api.materializeTaskRecurrences(token, user?.timezone)
      if (!live || handleUnauthorized(result)) return
      if (
        !result.ok &&
        (result.status === 0 ||
          result.status === 408 ||
          result.status === 429 ||
          result.status >= 500)
      )
        requestApiRecovery()
    }
    void prepare()
    const stop = subscribeApiRetry(prepare)
    return () => {
      live = false
      stop()
    }
  }, [authenticated, booting, sessionMode, enabled, token, user?.timezone, handleUnauthorized])
}
